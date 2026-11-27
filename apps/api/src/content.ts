import { Hono } from "hono";
import {
  MAX_POSTS_PER_WEEK,
  addDays,
  buildInsights,
  canPostTransition,
  isoDate,
  mondayOf,
  postApprovalIssues,
  postMetricsSchema,
  postPatchSchema,
  postSchema,
  postStatusSchema,
  type ContentPlatform,
  type MetricPost,
  type PostStatus,
} from "@ai/shared";
import { audit } from "./audit";
import { requireUser } from "./middleware";
import type { Row } from "./catalog";
import type { AppBindings } from "./types";

/**
 * Semana de conteúdo. Regras: o sistema não publica nada; aprovar exige roteiro (e divulgação, se houver link de afiliado);
 * as métricas são as que o usuário informa (sem integração verificada com as plataformas); editar conteúdo aprovado
 * exige nova aprovação; post publicado fica travado.
 */
export const content = new Hono<AppBindings>();
content.use("*", requireUser);

const json = (c: any) => c.req.json().catch(() => null);
const invalid = (c: any, issues: unknown) => c.json({ error: "invalid_input", issues }, 400);
const uid = (c: any) => c.get("user").id as string;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function view(r: Row) {
  return {
    id: r.id as string,
    weekStart: r.week_start as string,
    day: r.day as number,
    time: (r.post_time as string | null) ?? null,
    title: r.title as string,
    hook: (r.hook as string | null) ?? null,
    script: (r.script as string | null) ?? null,
    platforms: JSON.parse(r.platforms as string) as ContentPlatform[],
    status: r.status as PostStatus,
    usesAffiliateLink: !!r.uses_affiliate_link,
    disclosureConfirmed: !!r.disclosure_confirmed,
    notes: (r.notes as string | null) ?? null,
    metrics:
      r.views === null || r.views === undefined
        ? null
        : { views: num(r.views)!, likes: num(r.likes), shares: num(r.shares), saves: num(r.saves), clicks: num(r.clicks), retentionPct: num(r.retention_pct), at: num(r.metrics_at) },
  };
}

async function mine(c: any, id: string) {
  return c.env.DB.prepare("SELECT * FROM content_posts WHERE id = ? AND user_id = ?").bind(id, uid(c)).first() as Promise<Row | null>;
}

content.get("/week", async (c) => {
  const q = c.req.query("start");
  const start = mondayOf(q && isoDate.safeParse(q).success ? q : new Date().toISOString().slice(0, 10));
  const { results } = await c.env.DB.prepare("SELECT * FROM content_posts WHERE user_id = ? AND week_start = ? ORDER BY day, post_time, created_at")
    .bind(uid(c), start)
    .all<Row>();
  return c.json({ weekStart: start, prev: addDays(start, -7), next: addDays(start, 7), items: results.map(view) });
});

content.post("/posts", async (c) => {
  const parsed = postSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const weekStart = mondayOf(b.weekStart);
  const cnt = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM content_posts WHERE user_id = ? AND week_start = ?").bind(uid(c), weekStart).first<{ n: number }>();
  if ((cnt?.n ?? 0) >= MAX_POSTS_PER_WEEK) return c.json({ error: "week_full", max: MAX_POSTS_PER_WEEK }, 409);
  const id = crypto.randomUUID();
  const t = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO content_posts (id, user_id, week_start, day, post_time, title, hook, script, platforms, status,
       uses_affiliate_link, disclosure_confirmed, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idea', ?, ?, ?, ?, ?)`,
  )
    .bind(id, uid(c), weekStart, b.day, b.time ?? null, b.title, b.hook ?? null, b.script ?? null, JSON.stringify(b.platforms),
      b.usesAffiliateLink ? 1 : 0, b.disclosureConfirmed ? 1 : 0, b.notes ?? null, t, t)
    .run();
  await audit(c.env.DB, uid(c), "content.created", id);
  return c.json({ ok: true, id }, 201);
});

const CONTENT_FIELDS = ["title", "hook", "script", "platforms", "usesAffiliateLink", "disclosureConfirmed"] as const;

content.patch("/posts/:id", async (c) => {
  const parsed = postPatchSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status === "published") return c.json({ error: "published_locked" }, 409);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => (sets.push(`${col} = ?`), vals.push(v));
  if (b.day !== undefined) add("day", b.day);
  if (b.time !== undefined) add("post_time", b.time ?? null);
  if (b.title !== undefined) add("title", b.title);
  if (b.hook !== undefined) add("hook", b.hook ?? null);
  if (b.script !== undefined) add("script", b.script ?? null);
  if (b.platforms !== undefined) add("platforms", JSON.stringify(b.platforms));
  if (b.usesAffiliateLink !== undefined) add("uses_affiliate_link", b.usesAffiliateLink ? 1 : 0);
  if (b.disclosureConfirmed !== undefined) add("disclosure_confirmed", b.disclosureConfirmed ? 1 : 0);
  if (b.notes !== undefined) add("notes", b.notes ?? null);
  // Mudou o conteúdo de um post já aprovado: volta a "ideia" e precisa ser aprovado de novo.
  const changedContent = CONTENT_FIELDS.some((f) => b[f] !== undefined);
  const reset = changedContent && cur.status !== "idea";
  if (reset) add("status", "idea");
  if (sets.length === 0) return c.json({ ok: true, reapprovalNeeded: false });
  add("updated_at", Date.now());
  await c.env.DB.prepare(`UPDATE content_posts SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals, cur.id, uid(c)).run();
  return c.json({ ok: true, reapprovalNeeded: reset });
});

content.post("/posts/:id/status", async (c) => {
  const parsed = postStatusSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  const to = parsed.data.status;
  if (!canPostTransition(cur.status as PostStatus, to)) return c.json({ error: "invalid_transition", from: cur.status, to }, 409);
  if (to === "approved" && cur.status === "idea") {
    const issues = postApprovalIssues({ script: cur.script as string | null, usesAffiliateLink: !!cur.uses_affiliate_link, disclosureConfirmed: !!cur.disclosure_confirmed });
    if (issues.length) return c.json({ error: "approval_blocked", issues }, 409);
  }
  await c.env.DB.prepare("UPDATE content_posts SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(to, Date.now(), cur.id, uid(c)).run();
  await audit(c.env.DB, uid(c), `content.${to}`, cur.id as string);
  return c.json({ ok: true });
});

content.put("/posts/:id/metrics", async (c) => {
  const parsed = postMetricsSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const cur = await mine(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status !== "published") return c.json({ error: "not_published" }, 409);
  await c.env.DB.prepare("UPDATE content_posts SET views = ?, likes = ?, shares = ?, saves = ?, clicks = ?, retention_pct = ?, metrics_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(b.views, b.likes ?? null, b.shares ?? null, b.saves ?? null, b.clicks ?? null, b.retentionPct ?? null, Date.now(), Date.now(), cur.id, uid(c))
    .run();
  return c.json({ ok: true });
});

content.delete("/posts/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM content_posts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/** Ranking e tendências das últimas 12 semanas, só com o que o usuário informou. */
content.get("/insights", async (c) => {
  const since = addDays(mondayOf(new Date().toISOString().slice(0, 10)), -7 * 11);
  const { results } = await c.env.DB.prepare("SELECT * FROM content_posts WHERE user_id = ? AND week_start >= ? AND status = 'published' AND views IS NOT NULL")
    .bind(uid(c), since)
    .all<Row>();
  const posts: MetricPost[] = results.map((r) => {
    const v = view(r);
    return { id: v.id, title: v.title, day: v.day, platforms: v.platforms, views: v.metrics?.views ?? null, likes: v.metrics?.likes ?? null, shares: v.metrics?.shares ?? null, saves: v.metrics?.saves ?? null, retentionPct: v.metrics?.retentionPct ?? null };
  });
  return c.json({ since, ...buildInsights(posts) });
});
