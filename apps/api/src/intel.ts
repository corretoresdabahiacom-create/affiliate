import { Hono } from "hono";
import {
  ALERT_CATEGORIES,
  alertPrefsSchema,
  resolveScoringConfig,
  scoreProgram,
  scoringConfigSchema,
  type AlertCategory,
  type ProfileLike,
  type ScoringConfig,
} from "@ai/shared";
import { audit } from "./audit";
import { PROGRAM_SELECT, staleDays, toProgram, type Row } from "./catalog";
import { requireRole, requireUser } from "./middleware";
import type { AppBindings } from "./types";

export const intel = new Hono<AppBindings>();
intel.use("*", requireUser);

const OFFICIAL = "('official_docs','official_page','official_api','official_communication')";
const DAY = 86_400_000;

export async function loadConfig(db: D1Database): Promise<ScoringConfig> {
  const r = await db.prepare("SELECT value FROM admin_settings WHERE key = 'scoring_config'").first<{ value: string }>();
  if (!r) return resolveScoringConfig(null);
  try {
    return resolveScoringConfig(JSON.parse(r.value));
  } catch {
    return resolveScoringConfig(null);
  }
}

export async function loadProfile(db: D1Database, userId: string): Promise<ProfileLike | null> {
  const r = await db
    .prepare("SELECT country, niches, channels, has_website, wants_recurring, accepts_paid_traffic FROM user_profiles WHERE user_id = ?")
    .bind(userId)
    .first<Row>();
  if (!r) return null;
  return {
    country: r.country,
    niches: JSON.parse(r.niches),
    channels: JSON.parse(r.channels),
    hasWebsite: !!r.has_website,
    wantsRecurring: !!r.wants_recurring,
    acceptsPaidTraffic: !!r.accepts_paid_traffic,
  };
}

async function officialCounts(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(`SELECT program_id, COUNT(*) AS n FROM program_sources WHERE source_type IN ${OFFICIAL} GROUP BY program_id`)
    .all<{ program_id: string; n: number }>();
  return new Map(results.map((r) => [r.program_id, r.n]));
}

export const scoreAll = (rows: Row[], ctx: { profile: ProfileLike | null; cfg: ScoringConfig; counts: Map<string, number>; stale: number }) => {
  const now = Date.now();
  return rows.map((r) => {
    const program = toProgram(r, ctx.stale, now);
    const score = scoreProgram(program, ctx.profile, ctx.cfg, {
      officialSources: ctx.counts.get(program.id) ?? 0,
      now,
      staleDays: ctx.stale,
    });
    return { program, score };
  });
};

export async function scoringContext(db: D1Database, userId: string) {
  const [cfg, profile, counts, stale] = await Promise.all([loadConfig(db), loadProfile(db, userId), officialCounts(db), staleDays(db)]);
  return { cfg, profile, counts, stale };
}

intel.get("/config", async (c) => c.json({ config: await loadConfig(c.env.DB) }));

intel.get("/programs/:id/score", async (c) => {
  const row = await c.env.DB.prepare(`${PROGRAM_SELECT} WHERE p.id = ?`).bind(c.req.param("id")).first<Row>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const ctx = await scoringContext(c.env.DB, c.get("user").id);
  const [r] = scoreAll([row], ctx);
  return c.json({ score: r!.score, profileMissing: !ctx.profile?.country });
});

intel.get("/compare", async (c) => {
  const ids = [...new Set((c.req.query("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length < 2 || ids.length > 4) return c.json({ error: "invalid_input", hint: "2_to_4_ids" }, 400);
  const { results } = await c.env.DB.prepare(`${PROGRAM_SELECT} WHERE p.id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<Row>();
  const ctx = await scoringContext(c.env.DB, c.get("user").id);
  const byId = new Map(scoreAll(results, ctx).map((x) => [x.program.id, x]));
  // Mantém a ordem pedida e ignora ids inexistentes.
  const items = ids.map((id) => byId.get(id)).filter(Boolean);
  if (items.length < 2) return c.json({ error: "not_found" }, 404);
  return c.json({ items, profileMissing: !ctx.profile?.country });
});

intel.get("/recommendations", async (c) => {
  const user = c.get("user");
  const ctx = await scoringContext(c.env.DB, user.id);
  const { results } = await c.env.DB.prepare(`${PROGRAM_SELECT} WHERE p.lifecycle_status = 'active' ORDER BY p.updated_at DESC LIMIT 300`).all<Row>();
  const all = scoreAll(results, ctx);
  const byScore = (a: (typeof all)[number], b: (typeof all)[number]) =>
    b.score.attractiveness.score - a.score.attractiveness.score || b.score.quality.score - a.score.quality.score;

  // "Recomendado" = disponibilidade CONFIRMADA e nota pelo menos moderada. Não verificado nunca entra aqui.
  const recommended = all
    .filter((x) => x.score.availability === "confirmed" && x.score.attractiveness.score >= ctx.cfg.bands.moderate)
    .sort(byScore)
    .slice(0, 20);
  const toVerify = all.filter((x) => x.score.availability === "unverified" && x.score.attractiveness.score > 0).sort(byScore).slice(0, 20);
  return c.json({
    recommended,
    toVerify,
    excludedDenied: all.filter((x) => x.score.availability === "denied").length,
    evaluated: all.length,
    profileMissing: !ctx.profile?.country,
    country: ctx.profile?.country ?? null,
  });
});

// ---------- Alertas ----------

const DEFAULT_PREFS = { categories: [...ALERT_CATEGORIES], frequency: "daily" as const };

async function loadPrefs(db: D1Database, userId: string) {
  const r = await db.prepare("SELECT categories, frequency, seen_at FROM alert_prefs WHERE user_id = ?").bind(userId).first<Row>();
  if (!r) return { ...DEFAULT_PREFS, seenAt: 0 };
  return { categories: JSON.parse(r.categories) as AlertCategory[], frequency: r.frequency as "instant" | "daily" | "weekly", seenAt: r.seen_at as number };
}

const CATEGORY_SQL: Record<Exclude<AlertCategory, "outdated">, string> = {
  new_programs: "h.field = 'created'",
  new_products: "h.field = 'products_added'",
  discontinued_products: "h.field = 'products_removed'",
  commission_changes: "h.field IN ('commission_percent','commission_fixed','commission_type')",
  rule_changes:
    "h.field IN ('accepts_individuals','requires_company','requires_website','accepts_social','accepts_paid_traffic','accepts_organic','cookie_days','validation_days','min_payout','payout_frequency')",
  recurring: "(h.field = 'is_recurring' AND h.new_value = 'yes')",
  now_accepts_brazil: "(h.field = 'accepts_brazil' AND h.new_value = 'yes')",
  closed: "(h.field = 'lifecycle_status' AND h.new_value IN ('closed','suspended','unavailable'))",
  broken_links: "(h.field = 'signup_url_status' AND h.new_value = 'unavailable')",
};

function categoryOf(field: string, newValue: string | null): AlertCategory | null {
  if (field === "created") return "new_programs";
  if (field === "products_added") return "new_products";
  if (field === "products_removed") return "discontinued_products";
  if (["commission_percent", "commission_fixed", "commission_type"].includes(field)) return "commission_changes";
  if (field === "is_recurring" && newValue === "yes") return "recurring";
  if (field === "accepts_brazil" && newValue === "yes") return "now_accepts_brazil";
  if (field === "lifecycle_status" && ["closed", "suspended", "unavailable"].includes(newValue ?? "")) return "closed";
  if (field === "signup_url_status" && newValue === "unavailable") return "broken_links";
  if (CATEGORY_SQL.rule_changes.includes(`'${field}'`)) return "rule_changes";
  return null;
}

intel.get("/alerts/prefs", async (c) => {
  const { seenAt: _s, ...prefs } = await loadPrefs(c.env.DB, c.get("user").id);
  return c.json({ prefs });
});

intel.put("/alerts/prefs", async (c) => {
  const parsed = alertPrefsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO alert_prefs (user_id, categories, frequency, seen_at, updated_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET categories = excluded.categories, frequency = excluded.frequency, updated_at = excluded.updated_at`,
  )
    .bind(c.get("user").id, JSON.stringify([...new Set(parsed.data.categories)]), parsed.data.frequency, Date.now())
    .run();
  return c.json({ ok: true });
});

intel.post("/alerts/seen", async (c) => {
  const now = Date.now();
  const prefs = await loadPrefs(c.env.DB, c.get("user").id);
  await c.env.DB.prepare(
    `INSERT INTO alert_prefs (user_id, categories, frequency, seen_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at`,
  )
    .bind(c.get("user").id, JSON.stringify(prefs.categories), prefs.frequency, now, now)
    .run();
  return c.json({ ok: true });
});

/**
 * Feed derivado do histórico imutável. Cada alerta traz o programa, a fonte oficial mais relevante
 * (quando existe) e a data da última verificação; sem fonte registrada, o front avisa.
 */
intel.get("/alerts", async (c) => {
  const user = c.get("user");
  const prefs = await loadPrefs(c.env.DB, user.id);
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 90);
  const now = Date.now();
  const since = now - days * DAY;
  const enabled = prefs.categories.filter((k): k is Exclude<AlertCategory, "outdated"> => k !== "outdated" && k in CATEGORY_SQL);

  type Alert = {
    id: string;
    category: AlertCategory;
    programId: string;
    programName: string;
    advertiser: string;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    at: number;
    lastVerifiedAt: number | null;
    sourceUrl: string | null;
    unread: boolean;
  };
  const alerts: Alert[] = [];

  if (enabled.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT h.id, h.program_id, h.field, h.old_value, h.new_value, h.changed_at, p.name, p.last_verified_at, a.name AS adv,
         (SELECT s.url FROM program_sources s WHERE s.program_id = h.program_id AND s.source_type IN ${OFFICIAL}
            ORDER BY (s.field = h.field) DESC, s.created_at DESC LIMIT 1) AS source_url
       FROM program_history h
       JOIN affiliate_programs p ON p.id = h.program_id
       JOIN advertisers a ON a.id = p.advertiser_id
       WHERE h.changed_at >= ? AND (${enabled.map((k) => CATEGORY_SQL[k]).join(" OR ")})
       ORDER BY h.id DESC LIMIT 100`,
    )
      .bind(since)
      .all<Row>();
    for (const r of results) {
      const category = categoryOf(r.field, r.new_value);
      if (!category || !prefs.categories.includes(category)) continue;
      alerts.push({
        id: `h${r.id}`,
        category,
        programId: r.program_id,
        programName: r.name,
        advertiser: r.adv,
        field: r.field,
        oldValue: r.old_value,
        newValue: r.new_value,
        at: r.changed_at,
        lastVerifiedAt: r.last_verified_at,
        sourceUrl: r.source_url,
        unread: r.changed_at > prefs.seenAt,
      });
    }
  }

  if (prefs.categories.includes("outdated")) {
    const stale = await staleDays(c.env.DB);
    const limit = now - stale * DAY;
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name, p.last_verified_at, a.name AS adv,
         (SELECT s.url FROM program_sources s WHERE s.program_id = p.id AND s.source_type IN ${OFFICIAL} ORDER BY s.created_at DESC LIMIT 1) AS source_url
       FROM affiliate_programs p JOIN advertisers a ON a.id = p.advertiser_id
       WHERE p.lifecycle_status = 'active' AND p.last_verified_at IS NOT NULL AND p.last_verified_at < ?
       ORDER BY p.last_verified_at ASC LIMIT 50`,
    )
      .bind(limit)
      .all<Row>();
    for (const r of results) {
      alerts.push({
        id: `o${r.id}`,
        category: "outdated",
        programId: r.id,
        programName: r.name,
        advertiser: r.adv,
        field: null,
        oldValue: null,
        newValue: null,
        at: r.last_verified_at + stale * DAY,
        lastVerifiedAt: r.last_verified_at,
        sourceUrl: r.source_url,
        unread: r.last_verified_at + stale * DAY > prefs.seenAt,
      });
    }
  }
  alerts.sort((a, b) => b.at - a.at);
  return c.json({ alerts, unread: alerts.filter((a) => a.unread).length });
});

// ---------- Configuração de pontuação (administrador) ----------

intel.get("/admin/scoring", requireRole("admin"), async (c) => c.json({ config: await loadConfig(c.env.DB) }));

intel.put("/admin/scoring", requireRole("admin"), async (c) => {
  const parsed = scoringConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  await c.env.DB.prepare(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES ('scoring_config', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(parsed.data), Date.now())
    .run();
  await audit(c.env.DB, c.get("user").id, "scoring.updated", "scoring_config", parsed.data as unknown as Record<string, unknown>);
  return c.json({ ok: true });
});
