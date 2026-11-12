import { Hono } from "hono";
import {
  FACT_FIELDS,
  aiConfigSchema,
  checkGrounding,
  chatInputSchema,
  estimateTokens,
  fitChecks,
  parseSearchQuery,
  programFactDoc,
  resolveAiConfig,
  systemPrompt,
  userPrompt,
  type AiConfig,
  type AiKind,
  type FactDoc,
  type FactSource,
  aiRequestSchema,
} from "@ai/shared";
import { audit } from "./audit";
import { PROGRAM_SELECT, ftsQuery, staleDays, toProgram, type Row } from "./catalog";
import { sha256Hex } from "./crypto";
import { loadProfile, scoreAll, scoringContext } from "./intel";
import { requireRole, requireUser } from "./middleware";
import { allow } from "./ratelimit";
import type { AppBindings, Env } from "./types";

export const ai = new Hono<AppBindings>();
ai.use("*", requireUser);

const DAY = 86_400_000;
const now = () => Date.now();
const uid = (c: any) => c.get("user").id as string;

export async function loadAiConfig(db: D1Database): Promise<AiConfig> {
  const r = await db.prepare("SELECT value FROM admin_settings WHERE key = 'ai_config'").first<{ value: string }>();
  if (!r) return resolveAiConfig(null);
  try {
    return resolveAiConfig(JSON.parse(r.value));
  } catch {
    return resolveAiConfig(null);
  }
}

const utcDayStart = (t: number) => t - (t % DAY);
const utcMonthStart = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

type Limit = "disabled" | "no_model" | "daily_requests" | "daily_tokens" | "monthly_global" | null;

/** Limites de custo: por usuário no dia e global no mês. Só chamadas reais ao modelo contam. */
async function budget(env: Env, cfg: AiConfig, userId: string): Promise<{ limit: Limit; usedToday: number; tokensToday: number }> {
  const t = now();
  const u = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens + output_tokens), 0) AS tok FROM ai_usage WHERE user_id = ? AND mode = 'llm' AND at >= ?",
  )
    .bind(userId, utcDayStart(t))
    .first<{ n: number; tok: number }>();
  const g = await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE mode = 'llm' AND at >= ?").bind(utcMonthStart(t)).first<{ n: number }>();
  let limit: Limit = null;
  if (!cfg.enabled) limit = "disabled";
  else if (!env.AI) limit = "no_model";
  else if ((u?.n ?? 0) >= cfg.dailyRequestsPerUser) limit = "daily_requests";
  else if ((u?.tok ?? 0) >= cfg.dailyTokensPerUser) limit = "daily_tokens";
  else if ((g?.n ?? 0) >= cfg.monthlyRequestsGlobal) limit = "monthly_global";
  return { limit, usedToday: u?.n ?? 0, tokensToday: u?.tok ?? 0 };
}

async function callModel(env: Env, cfg: AiConfig, system: string, user: string): Promise<string | null> {
  if (!env.AI) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = Promise.resolve().then(() =>
      env.AI!.run(cfg.model, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: cfg.maxOutputTokens }),
    );
    run.catch(() => {}); // erro depois do timeout não pode virar rejeição sem tratamento
    const res = (await Promise.race([run, new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("timeout")), 25_000)))])) as any;
    const text = typeof res === "string" ? res : (res?.response ?? res?.result?.response ?? null);
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface Generated {
  /** null = sem texto do modelo; a tela mostra só os fatos do sistema. */
  answer: string | null;
  mode: "llm" | "cached" | "facts_only";
  reason: Limit | "no_context" | "grounding_failed" | "model_error" | null;
  grounding: { ok: boolean; ungroundedNumbers: string[]; ungroundedUrls: string[] } | null;
}

/** Texto do modelo, sempre ancorado: sem contexto não chama; resposta com número/link fora do contexto é descartada. */
export async function generate(
  c: any,
  kind: AiKind,
  question: string,
  docs: FactDoc[],
  locale: string,
  extra?: string,
): Promise<Generated> {
  const env = c.env as Env;
  const userId = uid(c);
  if (docs.length === 0) return { answer: null, mode: "facts_only", reason: "no_context", grounding: null };
  const cfg = await loadAiConfig(env.DB);
  const system = systemPrompt(locale, kind);
  const user = userPrompt(question, docs, extra);
  const key = await sha256Hex(`${kind}|${cfg.model}|${locale}|${userId}|${system}|${user}`);

  if (cfg.cacheTtlHours > 0) {
    const hit = await env.DB.prepare("SELECT answer, created_at FROM ai_cache WHERE key = ? AND user_id = ?").bind(key, userId).first<Row>();
    if (hit && now() - (hit.created_at as number) < cfg.cacheTtlHours * 3_600_000) {
      await env.DB.prepare("INSERT INTO ai_usage (id, user_id, kind, mode, model, at) VALUES (?, ?, ?, 'cached', ?, ?)")
        .bind(crypto.randomUUID(), userId, kind, cfg.model, now())
        .run();
      return { answer: hit.answer as string, mode: "cached", reason: null, grounding: { ok: true, ungroundedNumbers: [], ungroundedUrls: [] } };
    }
  }
  const b = await budget(env, cfg, userId);
  if (b.limit) return { answer: null, mode: "facts_only", reason: b.limit, grounding: null };

  const text = await callModel(env, cfg, system, user);
  if (!text) return { answer: null, mode: "facts_only", reason: "model_error", grounding: null };
  const context = docs.map((d) => d.text).join("\n") + (extra ?? "");
  const g = checkGrounding(text, context);
  // A chamada custou, mesmo se a resposta for descartada.
  await env.DB.prepare(
    "INSERT INTO ai_usage (id, user_id, kind, mode, model, input_tokens, output_tokens, grounded, at) VALUES (?, ?, ?, 'llm', ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), userId, kind, cfg.model, estimateTokens(system + user), estimateTokens(text), g.ok ? 1 : 0, now())
    .run();
  if (!g.ok) return { answer: null, mode: "facts_only", reason: "grounding_failed", grounding: g };
  if (cfg.cacheTtlHours > 0) {
    await env.DB.prepare("INSERT OR REPLACE INTO ai_cache (key, user_id, answer, created_at) VALUES (?, ?, ?, ?)").bind(key, userId, text, now()).run();
  }
  return { answer: text, mode: "llm", reason: null, grounding: g };
}

// ---------- Recuperação (RAG sobre o catálogo) ----------

async function sourcesFor(db: D1Database, ids: string[]): Promise<Map<string, FactSource[]>> {
  const m = new Map<string, FactSource[]>();
  if (!ids.length) return m;
  const { results } = await db
    .prepare(`SELECT program_id, field, source_type, url, confirmed_at FROM program_sources WHERE program_id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<Row>();
  for (const r of results) {
    const l = m.get(r.program_id) ?? [];
    l.push({ field: r.field, sourceType: r.source_type, url: r.url, confirmedAt: r.confirmed_at });
    m.set(r.program_id, l);
  }
  return m;
}

export async function docsFor(db: D1Database, rows: Row[], stale: number): Promise<{ docs: FactDoc[]; programs: ReturnType<typeof toProgram>[] }> {
  const t = now();
  const programs = rows.map((r) => toProgram(r, stale, t));
  const src = await sourcesFor(db, programs.map((p) => p.id));
  return { docs: programs.map((p) => programFactDoc(p, src.get(p.id) ?? [])), programs };
}

const RECO = /recomend|recommend|melhor|best|indica|sugest|suggest|which program|qual programa|cual programa/i;

/** Busca estruturada: só filtros confirmados (yes) e FTS5; sempre programas ativos. */
async function searchRows(db: D1Database, q: string, limit: number): Promise<{ rows: Row[]; filters: ReturnType<typeof parseSearchQuery> }> {
  const f = parseSearchQuery(q);
  const where = ["p.lifecycle_status = 'active'"];
  const params: unknown[] = [];
  if (f.segment) (where.push("p.segment = ?"), params.push(f.segment));
  if (f.acceptsBrazil) where.push("p.accepts_brazil = 'yes'");
  if (f.isRecurring) where.push("p.is_recurring = 'yes'");
  if (f.acceptsPaidTraffic) where.push("p.accepts_paid_traffic = 'yes'");
  if (f.acceptsSocial) where.push("p.accepts_social = 'yes'");
  if (f.acceptsIndividuals) where.push("p.accepts_individuals = 'yes'");
  const fts = f.text ? ftsQuery(f.text) : null;
  if (fts) (where.push("p.id IN (SELECT program_id FROM program_search WHERE program_search MATCH ?)"), params.push(fts));
  const { results } = await db.prepare(`${PROGRAM_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.updated_at DESC LIMIT ?`).bind(...params, limit).all<Row>();
  return { rows: results, filters: f };
}

ai.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2 || q.length > 300) return c.json({ error: "invalid_input" }, 400);
  const stale = await staleDays(c.env.DB);
  const { rows, filters } = await searchRows(c.env.DB, q, 30);
  const t = now();
  return c.json({
    // Mostra como a pergunta foi entendida: nada é filtrado "por dedução".
    interpreted: filters,
    onlyConfirmed: true,
    items: rows.map((r) => toProgram(r, stale, t)),
  });
});

// ---------- Assistente ----------

const citationsOf = (docs: FactDoc[]) => docs.map((d) => ({ programId: d.id, name: d.name, sourceUrls: d.sourceUrls }));

ai.post("/chat", async (c) => {
  const parsed = chatInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const { message, programId, locale } = parsed.data;
  const cfg = await loadAiConfig(c.env.DB);
  if (message.length > cfg.maxQuestionChars) return c.json({ error: "question_too_long", max: cfg.maxQuestionChars }, 413);
  if (!(await allow(c.env.DB, `ai:${uid(c)}`, 20, 60))) return c.json({ error: "rate_limited" }, 429);

  const stale = await staleDays(c.env.DB);
  let rows: Row[] = [];
  let extra: string | undefined;
  if (programId) {
    const r = await c.env.DB.prepare(`${PROGRAM_SELECT} WHERE p.id = ?`).bind(programId).first<Row>();
    if (!r) return c.json({ error: "not_found" }, 404);
    rows = [r];
  } else if (RECO.test(message)) {
    const ctx = await scoringContext(c.env.DB, uid(c));
    const { results } = await c.env.DB.prepare(`${PROGRAM_SELECT} WHERE p.lifecycle_status = 'active' ORDER BY p.updated_at DESC LIMIT 300`).all<Row>();
    const ranked = scoreAll(results, ctx).filter((x) => x.score.attractiveness.score > 0).sort((a, b) => b.score.attractiveness.score - a.score.attractiveness.score);
    const byId = new Map(results.map((r) => [r.id as string, r]));
    rows = ranked.slice(0, cfg.maxContextPrograms).map((x) => byId.get(x.program.id)!);
    extra = ranked
      .slice(0, cfg.maxContextPrograms)
      .map((x) => `SYSTEM SCORE for ${x.program.name}: attractiveness ${x.score.attractiveness.score}/100 (${x.score.attractiveness.band}), data quality ${x.score.quality.score}/100, availability for this user: ${x.score.availability}`)
      .join("\n");
  } else {
    rows = (await searchRows(c.env.DB, message, cfg.maxContextPrograms)).rows;
  }
  const { docs } = await docsFor(c.env.DB, rows, stale);
  const gen = await generate(c, "chat", message, docs, locale, extra);
  return c.json({ ...gen, citations: citationsOf(docs) });
});

// ---------- Análise e estratégia por programa ----------

async function programContext(c: any, id: string) {
  const row = await c.env.DB.prepare(`${PROGRAM_SELECT} WHERE p.id = ?`).bind(id).first();
  if (!row) return null;
  const stale = await staleDays(c.env.DB);
  const { docs, programs } = await docsFor(c.env.DB, [row], stale);
  const ctx = await scoringContext(c.env.DB, uid(c));
  const [scored] = scoreAll([row], ctx);
  return { program: programs[0]!, doc: docs[0]!, score: scored!.score, profile: ctx.profile, row };
}

function factSummary(p: Record<string, any>, doc: FactDoc) {
  const confirmed: string[] = [];
  const missing: string[] = [];
  for (const [snake, camel] of FACT_FIELDS) {
    const v = p[camel];
    if (v === null || v === undefined || v === "unverified" || v === "unknown") missing.push(snake);
    else if (doc.text.includes(`- ${snake}: ${v} (confirmed by official source`)) confirmed.push(snake);
  }
  return { confirmed, missing };
}

ai.post("/programs/:id/analysis", async (c) => {
  const p = aiRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const x = await programContext(c, c.req.param("id"));
  if (!x) return c.json({ error: "not_found" }, 404);
  const sum = factSummary(x.program, x.doc);
  const gen = p.data.withModel
    ? await generate(c, "analysis", "Analyze this program: strengths, risks and what is still unknown.", [x.doc], p.data.locale)
    : ({ answer: null, mode: "facts_only", reason: "disabled", grounding: null } as Generated);
  return c.json({
    // Parte determinística: vem do sistema, não do modelo.
    score: x.score,
    confirmedFields: sum.confirmed,
    missingFields: sum.missing,
    verification: x.program.verification,
    lifecycleStatus: x.program.lifecycleStatus,
    narrative: gen,
    citations: citationsOf([x.doc]),
    note: "ai_never_changes_catalog",
  });
});

ai.post("/programs/:id/strategy", async (c) => {
  const p = aiRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const x = await programContext(c, c.req.param("id"));
  if (!x) return c.json({ error: "not_found" }, 404);
  const profile = await loadProfile(c.env.DB, uid(c));
  if (!profile?.country) return c.json({ error: "profile_required" }, 409);
  const fit = fitChecks(x.program, profile);
  const extra = [
    `USER PROFILE: country ${profile.country}; channels: ${profile.channels.join(", ") || "none"}; has website: ${profile.hasWebsite}; wants recurring: ${profile.wantsRecurring}; open to paid traffic: ${profile.acceptsPaidTraffic}`,
    ...fit.map((f) => `COMPATIBILITY ${f.id}: ${f.status} (field ${f.field})`),
  ].join("\n");
  const gen = p.data.withModel
    ? await generate(c, "strategy", "Suggest a promotion strategy for this user and this program.", [x.doc], p.data.locale, extra)
    : ({ answer: null, mode: "facts_only", reason: "disabled", grounding: null } as Generated);
  return c.json({ fit, narrative: gen, citations: citationsOf([x.doc]), suggestionOnly: true });
});

// ---------- Uso e custos ----------

ai.get("/status", async (c) => {
  const cfg = await loadAiConfig(c.env.DB);
  const b = await budget(c.env, cfg, uid(c));
  return c.json({
    enabled: cfg.enabled,
    modelAvailable: !!c.env.AI,
    // Se houver limite, a IA continua respondendo só com os fatos do sistema.
    limit: b.limit,
    usedToday: b.usedToday,
    tokensToday: b.tokensToday,
    dailyRequests: cfg.dailyRequestsPerUser,
    dailyTokens: cfg.dailyTokensPerUser,
  });
});

ai.get("/admin/config", requireRole("admin"), async (c) => c.json({ config: await loadAiConfig(c.env.DB), modelAvailable: !!c.env.AI }));

ai.put("/admin/config", requireRole("admin"), async (c) => {
  const parsed = aiConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  await c.env.DB.prepare(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES ('ai_config', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(parsed.data), now())
    .run();
  await audit(c.env.DB, uid(c), "ai.config_updated", "ai_config", parsed.data as unknown as Record<string, unknown>);
  return c.json({ ok: true });
});

/** Totais agregados. Não expõe pergunta nem resposta de ninguém. */
ai.get("/admin/usage", requireRole("admin"), async (c) => {
  const since = utcMonthStart(now());
  const [tot, byKind, byDay] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(mode='llm'),0) AS llm, COALESCE(SUM(mode='cached'),0) AS cached,
        COALESCE(SUM(input_tokens),0) AS inTok, COALESCE(SUM(output_tokens),0) AS outTok,
        COALESCE(SUM(mode='llm' AND grounded=0),0) AS discarded, COUNT(DISTINCT user_id) AS users
       FROM ai_usage WHERE at >= ?`,
    ).bind(since).first<Row>(),
    c.env.DB.prepare("SELECT kind, COUNT(*) AS n FROM ai_usage WHERE at >= ? GROUP BY kind").bind(since).all<Row>(),
    c.env.DB.prepare(
      "SELECT strftime('%Y-%m-%d', at/1000, 'unixepoch') AS day, COUNT(*) AS n, SUM(input_tokens + output_tokens) AS tokens FROM ai_usage WHERE at >= ? GROUP BY day ORDER BY day",
    ).bind(since).all<Row>(),
  ]);
  return c.json({ since, totals: tot, byKind: byKind.results, byDay: byDay.results, note: "tokens_are_estimates" });
});
