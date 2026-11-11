import { Hono } from "hono";
import {
  adApprovalIssues,
  adClaimIssues,
  adExportText,
  adGenerateSchema,
  adPatchSchema,
  adStatusSchema,
  buildAdCopy,
  canAdTransition,
  channelCheck,
  seasonalEntryPatchSchema,
  seasonalEntrySchema,
  seasonalIssues,
  type AdStatus,
} from "@ai/shared";
import { audit } from "./audit";
import { PROGRAM_SELECT, staleDays, type Row } from "./catalog";
import { docsFor, generate } from "./ai";
import { requireRole, requireUser } from "./middleware";
import { allow } from "./ratelimit";
import type { AppBindings } from "./types";

export const studio = new Hono<AppBindings>();
studio.use("*", requireUser);

const uid = (c: any) => c.get("user").id as string;
const now = () => Date.now();
const editorOnly = requireRole("editor", "admin");

// ---------- Calendário sazonal ----------

async function withPrograms(db: D1Database, rows: Row[]) {
  const ids = rows.map((r) => r.id as string);
  const byEntry = new Map<string, Array<{ id: string; name: string; lifecycleStatus: string }>>();
  if (ids.length) {
    const { results } = await db
      .prepare(
        `SELECT sp.entry_id, p.id, p.name, p.lifecycle_status FROM seasonal_entry_programs sp
         JOIN affiliate_programs p ON p.id = sp.program_id WHERE sp.entry_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.name`,
      )
      .bind(...ids)
      .all<Row>();
    for (const r of results) {
      const l = byEntry.get(r.entry_id) ?? [];
      l.push({ id: r.id, name: r.name, lifecycleStatus: r.lifecycle_status });
      byEntry.set(r.entry_id, l);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    month: r.month,
    niche: r.niche,
    note: r.note,
    metricLabel: r.metric_label,
    metricValue: r.metric_value,
    sourceUrl: r.source_url,
    status: r.status,
    programs: byEntry.get(r.id) ?? [],
    updatedAt: r.updated_at,
  }));
}

async function checkPrograms(db: D1Database, ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM affiliate_programs WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).first<{ n: number }>();
  return (r?.n ?? 0) === new Set(ids).size;
}

async function savePrograms(db: D1Database, entryId: string, ids: string[]) {
  await db.prepare("DELETE FROM seasonal_entry_programs WHERE entry_id = ?").bind(entryId).run();
  for (const id of new Set(ids)) await db.prepare("INSERT INTO seasonal_entry_programs (entry_id, program_id) VALUES (?, ?)").bind(entryId, id).run();
}

/** Só entradas publicadas. Sem dado cadastrado, a lista vem vazia: nada é preenchido por padrão. */
studio.get("/seasonal", async (c) => {
  const m = Number(c.req.query("month"));
  const where = Number.isInteger(m) && m >= 1 && m <= 12 ? "AND month = ?" : "";
  const stmt = c.env.DB.prepare(`SELECT * FROM seasonal_entries WHERE status = 'published' ${where} ORDER BY month, niche`);
  const { results } = await (where ? stmt.bind(m) : stmt).all<Row>();
  return c.json({ items: await withPrograms(c.env.DB, results) });
});

studio.get("/seasonal/manage", editorOnly, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM seasonal_entries ORDER BY month, niche").all<Row>();
  return c.json({ items: await withPrograms(c.env.DB, results) });
});

studio.post("/seasonal", editorOnly, async (c) => {
  const p = seasonalEntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const d = p.data;
  const issues = seasonalIssues(d);
  if (issues.length) return c.json({ error: "invalid_metric", issues }, 422);
  if (!(await checkPrograms(c.env.DB, d.programIds))) return c.json({ error: "unknown_program" }, 422);
  const id = crypto.randomUUID();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO seasonal_entries (id, month, niche, note, metric_label, metric_value, source_url, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, d.month, d.niche, d.note ?? null, d.metricLabel?.trim() || null, d.metricValue?.trim() || null, d.sourceUrl ?? null, d.status, uid(c), t, t)
    .run();
  await savePrograms(c.env.DB, id, d.programIds);
  await audit(c.env.DB, uid(c), "seasonal.created", id, { month: d.month, niche: d.niche, status: d.status });
  return c.json({ ok: true, id }, 201);
});

studio.patch("/seasonal/:id", editorOnly, async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT * FROM seasonal_entries WHERE id = ?").bind(id).first<Row>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const p = seasonalEntryPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const d = p.data;
  const merged = {
    metricLabel: d.metricLabel !== undefined ? d.metricLabel : (cur.metric_label as string | null),
    metricValue: d.metricValue !== undefined ? d.metricValue : (cur.metric_value as string | null),
    sourceUrl: d.sourceUrl !== undefined ? d.sourceUrl : (cur.source_url as string | null),
  };
  const issues = seasonalIssues(merged);
  if (issues.length) return c.json({ error: "invalid_metric", issues }, 422);
  if (d.programIds && !(await checkPrograms(c.env.DB, d.programIds))) return c.json({ error: "unknown_program" }, 422);
  await c.env.DB.prepare(
    `UPDATE seasonal_entries SET month = ?, niche = ?, note = ?, metric_label = ?, metric_value = ?, source_url = ?, status = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      d.month ?? cur.month,
      d.niche ?? cur.niche,
      d.note !== undefined ? d.note : cur.note,
      merged.metricLabel?.trim() || null,
      merged.metricValue?.trim() || null,
      merged.sourceUrl ?? null,
      d.status ?? cur.status,
      now(),
      id,
    )
    .run();
  if (d.programIds) await savePrograms(c.env.DB, id, d.programIds);
  await audit(c.env.DB, uid(c), "seasonal.updated", id, { fields: Object.keys(d) });
  return c.json({ ok: true });
});

studio.delete("/seasonal/:id", editorOnly, async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM seasonal_entries WHERE id = ?").bind(c.req.param("id")).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  await audit(c.env.DB, uid(c), "seasonal.deleted", c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- Rascunhos de divulgação ----------

const adOut = (r: Row) => ({
  id: r.id,
  programId: r.program_id,
  programName: r.program_name,
  channel: r.channel,
  locale: r.locale,
  title: r.title,
  description: r.description,
  disclosure: r.disclosure,
  userLink: r.user_link,
  officialUrl: r.official_url,
  channelField: r.channel_field,
  channelCheck: r.channel_check,
  textSource: r.text_source,
  status: r.status,
  issues: adClaimIssues(`${r.title}\n${r.description}`),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Gera rascunhos em lote (até 10). Nada é publicado; cada um precisa de aprovação humana. */
studio.post("/ads/generate", async (c) => {
  const p = adGenerateSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  if (!(await allow(c.env.DB, `ads:${uid(c)}`, 10, 60))) return c.json({ error: "rate_limited" }, 429);
  const { programIds, channel, locale, withModel, userLink } = p.data;
  const stale = await staleDays(c.env.DB);
  const created: ReturnType<typeof adOut>[] = [];
  const skipped: Array<{ programId: string; reason: "not_found" | "not_active" }> = [];
  const ai: Array<{ programId: string; mode: string; reason: string | null }> = [];

  for (const programId of [...new Set(programIds)]) {
    const row = await c.env.DB.prepare(`${PROGRAM_SELECT} WHERE p.id = ?`).bind(programId).first<Row>();
    if (!row) {
      skipped.push({ programId, reason: "not_found" });
      continue;
    }
    if (row.lifecycle_status !== "active") {
      skipped.push({ programId, reason: "not_active" });
      continue;
    }
    const { docs, programs } = await docsFor(c.env.DB, [row], stale);
    const doc = docs[0]!;
    const program = programs[0]!;
    const copy = buildAdCopy({ name: program.name, description: (program as any).description }, doc.text, locale);
    const chk = channelCheck(channel, doc.text);
    let description = copy.description;
    let source: "catalog" | "model" = "catalog";
    if (withModel) {
      const g = await generate(c, "ad", `Write the promotional description of ${program.name} for a ${channel} audience.`, [doc], locale);
      ai.push({ programId, mode: g.mode, reason: g.reason });
      if (g.answer && adClaimIssues(g.answer).length === 0) {
        description = g.answer.slice(0, 1500);
        source = "model";
      }
    }
    const id = crypto.randomUUID();
    const t = now();
    const context = doc.text + (userLink ? `\nUSER LINK: ${userLink}` : "");
    await c.env.DB.prepare(
      `INSERT INTO ad_drafts (id, user_id, program_id, program_name, channel, locale, title, description, disclosure, user_link, official_url,
        channel_field, channel_check, text_source, context, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
      .bind(id, uid(c), programId, program.name, channel, locale, copy.title, description, copy.disclosure, userLink ?? null, copy.officialUrl, chk.field, chk.check, source, context, t, t)
      .run();
    created.push(adOut((await c.env.DB.prepare("SELECT * FROM ad_drafts WHERE id = ?").bind(id).first<Row>())!));
  }
  return c.json({ items: created, skipped, ai, publishedAnywhere: false }, 201);
});

studio.get("/ads", async (c) => {
  const s = c.req.query("status");
  const filter = s === "draft" || s === "approved" || s === "discarded" ? s : null;
  const stmt = c.env.DB.prepare(`SELECT * FROM ad_drafts WHERE user_id = ? ${filter ? "AND status = ?" : ""} ORDER BY created_at DESC LIMIT 200`);
  const { results } = await (filter ? stmt.bind(uid(c), filter) : stmt.bind(uid(c))).all<Row>();
  return c.json({ items: results.map(adOut) });
});

async function own(c: any): Promise<Row | null> {
  return c.env.DB.prepare("SELECT * FROM ad_drafts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first();
}

studio.patch("/ads/:id", async (c) => {
  const cur = await own(c);
  if (!cur) return c.json({ error: "not_found" }, 404);
  const p = adPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const d = p.data;
  const textChanged = (d.title !== undefined && d.title !== cur.title) || (d.description !== undefined && d.description !== cur.description);
  const linkChanged = d.userLink !== undefined && (d.userLink ?? null) !== cur.user_link;
  // Editar invalida a aprovação: o texto novo precisa ser conferido de novo.
  const status = (textChanged || linkChanged) && cur.status === "approved" ? "draft" : cur.status;
  let context = cur.context as string;
  if (linkChanged) {
    context = context.replace(/\nUSER LINK: .*$/m, "");
    if (d.userLink) context += `\nUSER LINK: ${d.userLink}`;
  }
  await c.env.DB.prepare(
    "UPDATE ad_drafts SET title = ?, description = ?, user_link = ?, context = ?, text_source = ?, status = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      d.title ?? cur.title,
      d.description ?? cur.description,
      d.userLink !== undefined ? (d.userLink ?? null) : cur.user_link,
      context,
      textChanged ? "user" : cur.text_source,
      status,
      now(),
      cur.id,
    )
    .run();
  return c.json({ item: adOut((await own(c))!) });
});

studio.post("/ads/:id/status", async (c) => {
  const cur = await own(c);
  if (!cur) return c.json({ error: "not_found" }, 404);
  const p = adStatusSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const to = p.data.status as AdStatus;
  if (!canAdTransition(cur.status as AdStatus, to)) return c.json({ error: "invalid_transition", from: cur.status, to }, 409);
  if (to === "approved") {
    // Aprovar é uma decisão humana, e só vale depois destas conferências.
    if (cur.channel_check === "blocked") return c.json({ error: "channel_blocked", field: cur.channel_field }, 422);
    if (cur.channel_check === "unverified" && !p.data.acknowledgeUnverified) return c.json({ error: "needs_acknowledgement", field: cur.channel_field }, 422);
    const issues = adApprovalIssues(`${cur.title}\n${cur.description}`, cur.context as string);
    if (issues.length) return c.json({ error: "text_issues", issues }, 422);
  }
  await c.env.DB.prepare("UPDATE ad_drafts SET status = ?, updated_at = ? WHERE id = ?").bind(to, now(), cur.id).run();
  if (to === "approved") await audit(c.env.DB, uid(c), "ad.approved", cur.id as string, { channel: cur.channel_check });
  return c.json({ item: adOut((await own(c))!) });
});

/** Texto pronto para copiar. Só de rascunho aprovado. Não publica em lugar nenhum. */
studio.get("/ads/:id/export", async (c) => {
  const cur = await own(c);
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status !== "approved") return c.json({ error: "not_approved" }, 409);
  return c.json({
    text: adExportText({ title: cur.title as string, description: cur.description as string, disclosure: cur.disclosure as string, link: (cur.user_link as string | null) ?? (cur.official_url as string | null) }),
    published: false,
  });
});

studio.delete("/ads/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM ad_drafts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
