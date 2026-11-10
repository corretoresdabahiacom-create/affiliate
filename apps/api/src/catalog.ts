import { Hono } from "hono";
import {
  DEFAULT_STALE_DAYS,
  SEGMENTS,
  advertiserSchema,
  categorySchema,
  dedupeKey,
  isOfficialSource,
  networkSchema,
  normalizeName,
  offerSchema,
  productSchema,
  programPatchSchema,
  programSchema,
  sourceSchema,
  statusChangeSchema,
  verificationState,
  verifyActionSchema,
  type LifecycleStatus,
  type ProgramInput,
} from "@ai/shared";
import { audit } from "./audit";
import { requireRole, requireUser } from "./middleware";
import type { AppBindings, SessionUser } from "./types";

export const catalog = new Hono<AppBindings>();
catalog.use("*", requireUser);

const editor = requireRole("editor", "admin");
const json = (c: any) => c.req.json().catch(() => null);

// ---------- Mapeamento de campos ----------

/** Campo da API (camelCase) -> coluna. */
const COLS: Record<keyof ProgramInput, string> = {
  advertiserId: "advertiser_id",
  networkId: "network_id",
  categoryId: "category_id",
  name: "name",
  segment: "segment",
  description: "description",
  acceptsBrazil: "accepts_brazil",
  acceptsIndividuals: "accepts_individuals",
  requiresCompany: "requires_company",
  requiresWebsite: "requires_website",
  acceptsSocial: "accepts_social",
  acceptsPaidTraffic: "accepts_paid_traffic",
  acceptsOrganic: "accepts_organic",
  commissionType: "commission_type",
  commissionPercent: "commission_percent",
  commissionFixed: "commission_fixed",
  currency: "currency",
  isRecurring: "is_recurring",
  recurringDurationMonths: "recurring_duration_months",
  cookieDays: "cookie_days",
  attributionModel: "attribution_model",
  minPayout: "min_payout",
  payoutCurrency: "payout_currency",
  payoutFrequency: "payout_frequency",
  payoutMethods: "payout_methods",
  validationDays: "validation_days",
  refundPolicy: "refund_policy",
  approvalRequirements: "approval_requirements",
  promoRestrictions: "promo_restrictions",
  officialUrl: "official_url",
  signupUrl: "signup_url",
  signupUrlStatus: "signup_url_status",
  docsUrl: "docs_url",
  lifecycleStatus: "lifecycle_status",
};

const TRI_COLS = new Set([
  "accepts_brazil",
  "accepts_individuals",
  "requires_company",
  "requires_website",
  "accepts_social",
  "accepts_paid_traffic",
  "accepts_organic",
  "is_recurring",
]);
/** Colunas numéricas/enum cujo valor "afirmativo" é um fato comercial e exige fonte oficial. */
const FACT_COLS = new Set([
  "commission_percent",
  "commission_fixed",
  "cookie_days",
  "min_payout",
  "validation_days",
]);

export type Row = Record<string, any>;

const serialize = (col: string, v: unknown): unknown => {
  if (col === "payout_methods") return JSON.stringify(v ?? []);
  return v === undefined ? null : v;
};

/**
 * Qual "campo coberto" uma mudança exige. Devolve null se a mudança não exige fonte
 * (por exemplo: voltar para "não verificado", limpar um valor, encerrar um programa).
 */
function requiredSourceField(col: string, oldV: unknown, newV: unknown): string | null {
  if (TRI_COLS.has(col)) return newV === "yes" || newV === "no" ? col : null;
  if (FACT_COLS.has(col)) return newV !== null && newV !== undefined ? col : null;
  if (col === "commission_type") return newV !== "unknown" ? col : null;
  if (col === "payout_frequency") return newV !== "unknown" ? col : null;
  if (col === "signup_url_status") return newV === "verified" ? "signup_url" : null;
  if (col === "lifecycle_status") return newV === "active" && oldV !== "active" ? col : null;
  return null;
}

// ---------- Acesso a dados ----------

export async function staleDays(db: D1Database): Promise<number> {
  const r = await db
    .prepare("SELECT value FROM admin_settings WHERE key = 'stale_after_days'")
    .first<{ value: string }>();
  const n = Number(r?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_DAYS;
}

const reindexStatements = (db: D1Database, id: string) => [
  db.prepare("DELETE FROM program_search WHERE program_id = ?").bind(id),
  db
    .prepare(
      `INSERT INTO program_search (program_id, content)
       SELECT p.id,
         p.name || ' ' || a.name || ' ' || COALESCE(p.description, '') || ' ' ||
         COALESCE(n.name, '') || ' ' || COALESCE(c.name_pt || ' ' || c.name_en || ' ' || c.name_es, '')
       FROM affiliate_programs p
       JOIN advertisers a ON a.id = p.advertiser_id
       LEFT JOIN affiliate_networks n ON n.id = p.network_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ?`,
    )
    .bind(id),
];

const historyStmt = (
  db: D1Database,
  programId: string,
  field: string,
  oldV: unknown,
  newV: unknown,
  user: SessionUser | null,
  note?: string | null,
) =>
  db
    .prepare(
      "INSERT INTO program_history (program_id, field, old_value, new_value, changed_by, note, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      programId,
      field,
      oldV === null || oldV === undefined ? null : String(oldV),
      newV === null || newV === undefined ? null : String(newV),
      user?.id ?? null,
      note ?? null,
      Date.now(),
    );

export function toProgram(r: Row, stale: number, now: number) {
  return {
    id: r.id as string,
    name: r.name as string,
    segment: r.segment as string,
    description: r.description as string | null,
    advertiser: { id: r.advertiser_id as string, name: r.advertiser_name as string },
    network: r.network_id ? { id: r.network_id as string, name: r.network_name as string } : null,
    category: r.category_id ? { id: r.category_id as string, slug: r.category_slug as string } : null,
    acceptsBrazil: r.accepts_brazil,
    acceptsIndividuals: r.accepts_individuals,
    requiresCompany: r.requires_company,
    requiresWebsite: r.requires_website,
    acceptsSocial: r.accepts_social,
    acceptsPaidTraffic: r.accepts_paid_traffic,
    acceptsOrganic: r.accepts_organic,
    commissionType: r.commission_type,
    commissionPercent: r.commission_percent,
    commissionFixed: r.commission_fixed,
    currency: r.currency,
    isRecurring: r.is_recurring,
    recurringDurationMonths: r.recurring_duration_months,
    cookieDays: r.cookie_days,
    attributionModel: r.attribution_model,
    minPayout: r.min_payout,
    payoutCurrency: r.payout_currency,
    payoutFrequency: r.payout_frequency,
    payoutMethods: JSON.parse(r.payout_methods ?? "[]") as string[],
    validationDays: r.validation_days,
    refundPolicy: r.refund_policy,
    approvalRequirements: r.approval_requirements,
    promoRestrictions: r.promo_restrictions,
    officialUrl: r.official_url,
    signupUrl: r.signup_url,
    signupUrlStatus: r.signup_url_status,
    docsUrl: r.docs_url,
    lifecycleStatus: r.lifecycle_status as LifecycleStatus,
    verificationFlag: r.verification_flag,
    lastVerifiedAt: r.last_verified_at as number | null,
    verification: verificationState(
      {
        lifecycleStatus: r.lifecycle_status,
        verificationFlag: r.verification_flag,
        lastVerifiedAt: r.last_verified_at,
      },
      now,
      stale,
    ),
    updatedAt: r.updated_at as number,
  };
}

export const PROGRAM_SELECT = `SELECT p.*, a.name AS advertiser_name, n.name AS network_name, c.slug AS category_slug
  FROM affiliate_programs p
  JOIN advertisers a ON a.id = p.advertiser_id
  LEFT JOIN affiliate_networks n ON n.id = p.network_id
  LEFT JOIN categories c ON c.id = p.category_id`;

async function loadProgram(db: D1Database, id: string) {
  return db.prepare(`${PROGRAM_SELECT} WHERE p.id = ?`).bind(id).first<Row>();
}

/** Monta uma consulta MATCH segura do FTS5 a partir do texto do usuário. */
export function ftsQuery(q: string): string | null {
  const tokens = normalizeName(q)
    .split(" ")
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

// ---------- Leitura (qualquer usuário autenticado) ----------

catalog.get("/meta", async (c) => {
  const [networks, categories] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, name, kind, website_url AS websiteUrl, website_url_status AS websiteUrlStatus, operational_status AS operationalStatus, notes FROM affiliate_networks ORDER BY name",
    ).all(),
    c.env.DB.prepare(
      "SELECT id, slug, segment, name_pt AS namePt, name_en AS nameEn, name_es AS nameEs FROM categories ORDER BY segment, name_pt",
    ).all(),
  ]);
  return c.json({
    segments: SEGMENTS,
    networks: networks.results,
    categories: categories.results,
    staleAfterDays: await staleDays(c.env.DB),
  });
});

catalog.get("/programs", async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const where: string[] = [];
  const params: unknown[] = [];

  // Encerrados/suspensos/indisponíveis só aparecem para quem edita e pediu explicitamente.
  const canSeeInactive = user.role === "editor" || user.role === "admin";
  if (canSeeInactive && q.lifecycle && ["active", "closed", "suspended", "unavailable", "all"].includes(q.lifecycle)) {
    if (q.lifecycle !== "all") {
      where.push("p.lifecycle_status = ?");
      params.push(q.lifecycle);
    }
  } else {
    where.push("p.lifecycle_status = 'active'");
  }

  const match = q.q ? ftsQuery(q.q) : null;
  if (q.q && !match) return c.json({ items: [], total: 0 });
  if (match) {
    where.push("p.id IN (SELECT program_id FROM program_search WHERE program_search MATCH ?)");
    params.push(match);
  }
  if (q.segment && (SEGMENTS as readonly string[]).includes(q.segment)) {
    where.push("p.segment = ?");
    params.push(q.segment);
  }
  if (q.category) {
    where.push("c.slug = ?");
    params.push(q.category);
  }
  if (q.network) {
    where.push("p.network_id = ?");
    params.push(q.network);
  }
  if (q.advertiser) {
    where.push("p.advertiser_id = ?");
    params.push(q.advertiser);
  }
  // Filtros de aceitação: "yes" devolve só o que está CONFIRMADO. "unverified" nunca vira "yes".
  const triFilters: Array<[string, string]> = [
    ["accepts_brazil", "accepts_brazil"],
    ["recurring", "is_recurring"],
    ["individuals", "accepts_individuals"],
    ["requires_company", "requires_company"],
    ["requires_website", "requires_website"],
  ];
  for (const [param, col] of triFilters) {
    const v = q[param];
    if (v === "yes" || v === "no" || v === "unverified") {
      where.push(`p.${col} = ?`);
      params.push(v);
    }
  }
  if (q.traffic === "paid") where.push("p.accepts_paid_traffic = 'yes'");
  if (q.traffic === "organic") where.push("p.accepts_organic = 'yes'");
  if (q.traffic === "social") where.push("p.accepts_social = 'yes'");
  if (q.payout_currency && /^[A-Za-z]{3}$/.test(q.payout_currency)) {
    where.push("p.payout_currency = ?");
    params.push(q.payout_currency.toUpperCase());
  }
  if (q.verified === "1") where.push("p.last_verified_at IS NOT NULL AND p.verification_flag = 'none'");

  const order =
    q.sort === "verified"
      ? "p.last_verified_at DESC NULLS LAST, p.name"
      : q.sort === "updated"
        ? "p.updated_at DESC"
        : "a.name, p.name";
  const limit = Math.min(Number(q.limit ?? 25) || 25, 100);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, total, stale] = await Promise.all([
    c.env.DB.prepare(`${PROGRAM_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all<Row>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_programs p JOIN advertisers a ON a.id = p.advertiser_id
       LEFT JOIN categories c ON c.id = p.category_id ${clause}`,
    )
      .bind(...params)
      .first<{ n: number }>(),
    staleDays(c.env.DB),
  ]);
  const now = Date.now();
  return c.json({ items: rows.results.map((r) => toProgram(r, stale, now)), total: total?.n ?? 0 });
});

catalog.get("/programs/:id", async (c) => {
  const id = c.req.param("id");
  const row = await loadProgram(c.env.DB, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const [sources, history, products, offers, stale] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, source_type AS sourceType, field, url, note, consulted_at AS consultedAt, confirmed_at AS confirmedAt, recorded_by AS recordedBy
       FROM program_sources WHERE program_id = ? ORDER BY created_at DESC`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      `SELECT id, field, old_value AS oldValue, new_value AS newValue, changed_by AS changedBy, note, changed_at AS changedAt
       FROM program_history WHERE program_id = ? ORDER BY id DESC LIMIT 100`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare("SELECT id, name, url, description FROM products WHERE program_id = ? ORDER BY name")
      .bind(id)
      .all(),
    c.env.DB.prepare(
      "SELECT id, title, details, url, starts_at AS startsAt, ends_at AS endsAt FROM offers WHERE program_id = ? ORDER BY created_at DESC",
    )
      .bind(id)
      .all(),
    staleDays(c.env.DB),
  ]);
  return c.json({
    program: toProgram(row, stale, Date.now()),
    sources: sources.results,
    history: history.results,
    products: products.results,
    offers: offers.results,
  });
});

// ---------- Gestão: redes, anunciantes, categorias (editor/admin) ----------

catalog.get("/advertisers", async (c) => {
  const term = normalizeName(c.req.query("q") ?? "");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, website_url AS websiteUrl, country, notes FROM advertisers WHERE name_key LIKE ? ORDER BY name LIMIT 50",
  )
    .bind(`%${term}%`)
    .all();
  return c.json({ advertisers: results });
});

catalog.post("/networks", editor, async (c) => {
  const parsed = networkSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const n = parsed.data;
  const user = c.get("user");
  // Link só pode ser "verified" com fonte oficial; rede não tem tabela de fontes, então exigimos "unverified".
  if (n.websiteUrlStatus === "verified") return c.json({ error: "official_source_required" }, 422);
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await c.env.DB.prepare(
      `INSERT INTO affiliate_networks (id, name, name_key, kind, website_url, website_url_status, operational_status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, n.name, normalizeName(n.name), n.kind, n.websiteUrl ?? null, n.websiteUrlStatus, n.operationalStatus, n.notes ?? null, now, now)
      .run();
  } catch {
    return c.json({ error: "duplicate_network" }, 409);
  }
  await audit(c.env.DB, user.id, "network.created", id, { name: n.name });
  return c.json({ ok: true, id }, 201);
});

catalog.put("/networks/:id", editor, async (c) => {
  const parsed = networkSchema.partial().safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const n = parsed.data;
  if (n.websiteUrlStatus === "verified") return c.json({ error: "official_source_required" }, 422);
  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    `UPDATE affiliate_networks SET
       name = COALESCE(?, name), name_key = COALESCE(?, name_key), kind = COALESCE(?, kind),
       website_url = CASE WHEN ? = 1 THEN ? ELSE website_url END,
       website_url_status = CASE WHEN ? = 1 THEN 'unverified' ELSE COALESCE(?, website_url_status) END,
       operational_status = COALESCE(?, operational_status),
       notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
       updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      n.name ?? null,
      n.name ? normalizeName(n.name) : null,
      n.kind ?? null,
      n.websiteUrl === undefined ? 0 : 1,
      n.websiteUrl ?? null,
      n.websiteUrl === undefined ? 0 : 1, // trocar a URL derruba o status "verified"
      n.websiteUrlStatus ?? null,
      n.operationalStatus ?? null,
      n.notes === undefined ? 0 : 1,
      n.notes ?? null,
      Date.now(),
      id,
    )
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "not_found" }, 404);
  await audit(c.env.DB, c.get("user").id, "network.updated", id, n as Record<string, unknown>);
  return c.json({ ok: true });
});

catalog.post("/advertisers", editor, async (c) => {
  const parsed = advertiserSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const a = parsed.data;
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await c.env.DB.prepare(
      "INSERT INTO advertisers (id, name, name_key, website_url, country, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, a.name, normalizeName(a.name), a.websiteUrl ?? null, a.country ?? null, a.notes ?? null, now, now)
      .run();
  } catch {
    return c.json({ error: "duplicate_advertiser" }, 409);
  }
  await audit(c.env.DB, c.get("user").id, "advertiser.created", id, { name: a.name });
  return c.json({ ok: true, id }, 201);
});

catalog.put("/advertisers/:id", editor, async (c) => {
  const parsed = advertiserSchema.partial().safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const a = parsed.data;
  const id = c.req.param("id");
  try {
    const res = await c.env.DB.prepare(
      `UPDATE advertisers SET
         name = COALESCE(?, name), name_key = COALESCE(?, name_key),
         website_url = CASE WHEN ? = 1 THEN ? ELSE website_url END,
         country = CASE WHEN ? = 1 THEN ? ELSE country END,
         notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
         updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        a.name ?? null,
        a.name ? normalizeName(a.name) : null,
        a.websiteUrl === undefined ? 0 : 1,
        a.websiteUrl ?? null,
        a.country === undefined ? 0 : 1,
        a.country ?? null,
        a.notes === undefined ? 0 : 1,
        a.notes ?? null,
        Date.now(),
        id,
      )
      .run();
    if (res.meta.changes !== 1) return c.json({ error: "not_found" }, 404);
  } catch {
    return c.json({ error: "duplicate_advertiser" }, 409);
  }
  // O nome do anunciante entra na busca dos programas dele.
  const { results } = await c.env.DB.prepare("SELECT id FROM affiliate_programs WHERE advertiser_id = ? LIMIT 40")
    .bind(id)
    .all<{ id: string }>();
  if (results.length) await c.env.DB.batch(results.flatMap((r) => reindexStatements(c.env.DB, r.id)));
  await audit(c.env.DB, c.get("user").id, "advertiser.updated", id, a as Record<string, unknown>);
  return c.json({ ok: true });
});

catalog.post("/categories", editor, async (c) => {
  const parsed = categorySchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const k = parsed.data;
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      "INSERT INTO categories (id, slug, segment, name_pt, name_en, name_es) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, k.slug, k.segment, k.namePt, k.nameEn, k.nameEs)
      .run();
  } catch {
    return c.json({ error: "duplicate_category" }, 409);
  }
  await audit(c.env.DB, c.get("user").id, "category.created", id, { slug: k.slug });
  return c.json({ ok: true, id }, 201);
});

// ---------- Gestão: programas ----------

/**
 * Aplica uma alteração a um programa respeitando as regras de integridade:
 * - "sim"/"não", valores comerciais e link "verificado" exigem fonte oficial que cubra o campo;
 * - trocar o link de inscrição derruba o status "verificado";
 * - cada mudança vai para o histórico.
 */
async function applyChanges(
  db: D1Database,
  row: Row,
  patch: Partial<ProgramInput>,
  user: SessionUser,
  note?: string | null,
): Promise<{ ok: true; changed: string[] } | { ok: false; status: 404 | 409 | 422; body: Record<string, unknown> }> {
  const changes: Array<{ col: string; oldV: unknown; newV: unknown }> = [];
  for (const [key, raw] of Object.entries(patch) as Array<[keyof ProgramInput, unknown]>) {
    if (raw === undefined) continue;
    const col = COLS[key];
    const newV = serialize(col, raw);
    const oldV = row[col] ?? null;
    if (String(oldV) === String(newV)) continue;
    changes.push({ col, oldV, newV });
  }
  // Trocar o link de inscrição desfaz a verificação do link, salvo se a mesma chamada a refizer.
  const urlChanged = changes.some((x) => x.col === "signup_url");
  const statusInPatch = changes.some((x) => x.col === "signup_url_status");
  if (urlChanged && !statusInPatch && row.signup_url_status === "verified") {
    changes.push({ col: "signup_url_status", oldV: "verified", newV: "unverified" });
  }
  if (changes.length === 0) return { ok: true, changed: [] };

  const needed = new Set<string>();
  for (const ch of changes) {
    const f = requiredSourceField(ch.col, ch.oldV, ch.newV);
    if (f) needed.add(f);
  }
  if (needed.size) {
    const { results } = await db
      .prepare(
        "SELECT DISTINCT field FROM program_sources WHERE program_id = ? AND field IS NOT NULL AND source_type IN ('official_docs','official_page','official_api','official_communication')",
      )
      .bind(row.id)
      .all<{ field: string }>();
    const covered = new Set(results.map((r) => r.field));
    const missing = [...needed].filter((f) => !covered.has(f));
    if (missing.length) return { ok: false, status: 422, body: { error: "official_source_required", fields: missing } };
  }

  const next = { ...row };
  for (const ch of changes) next[ch.col] = ch.newV;
  const key = dedupeKey(next.advertiser_id, next.network_id ?? null, next.name);

  const sets = changes.map((x) => `${x.col} = ?`);
  const values = changes.map((x) => x.newV);
  const now = Date.now();
  try {
    await db.batch([
      db
        .prepare(`UPDATE affiliate_programs SET ${sets.join(", ")}, dedupe_key = ?, updated_at = ? WHERE id = ?`)
        .bind(...values, key, now, row.id),
      ...changes.map((x) => historyStmt(db, row.id, x.col, x.oldV, x.newV, user, note)),
      ...reindexStatements(db, row.id),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE")) return { ok: false, status: 409, body: { error: "duplicate_program" } };
    throw e;
  }
  return { ok: true, changed: changes.map((x) => x.col) };
}

const NO_FACTS_ON_CREATE = [
  "acceptsBrazil",
  "acceptsIndividuals",
  "requiresCompany",
  "requiresWebsite",
  "acceptsSocial",
  "acceptsPaidTraffic",
  "acceptsOrganic",
  "isRecurring",
] as const;

catalog.post("/programs", editor, async (c) => {
  const parsed = programSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const user = c.get("user");

  // Um programa novo ainda não tem fontes: nenhum fato pode nascer "confirmado".
  const claimed: string[] = [];
  for (const k of NO_FACTS_ON_CREATE) if (p[k] !== "unverified") claimed.push(k);
  if (p.signupUrlStatus === "verified") claimed.push("signupUrlStatus");
  if (p.commissionType !== "unknown") claimed.push("commissionType");
  for (const k of ["commissionPercent", "commissionFixed", "cookieDays", "minPayout", "validationDays"] as const) {
    if (p[k] !== undefined && p[k] !== null) claimed.push(k);
  }
  if (p.payoutFrequency !== "unknown") claimed.push("payoutFrequency");
  if (claimed.length) {
    return c.json({ error: "official_source_required", fields: claimed, hint: "create_then_add_source" }, 422);
  }

  const adv = await c.env.DB.prepare("SELECT 1 AS ok FROM advertisers WHERE id = ?").bind(p.advertiserId).first();
  if (!adv) return c.json({ error: "advertiser_not_found" }, 422);
  if (p.networkId) {
    const n = await c.env.DB.prepare("SELECT 1 AS ok FROM affiliate_networks WHERE id = ?").bind(p.networkId).first();
    if (!n) return c.json({ error: "network_not_found" }, 422);
  }
  if (p.categoryId) {
    const k = await c.env.DB.prepare("SELECT 1 AS ok FROM categories WHERE id = ?").bind(p.categoryId).first();
    if (!k) return c.json({ error: "category_not_found" }, 422);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO affiliate_programs (id, advertiser_id, network_id, category_id, name, segment, description,
           currency, recurring_duration_months, attribution_model, payout_currency, payout_methods,
           refund_policy, approval_requirements, promo_restrictions, official_url, signup_url, docs_url,
           lifecycle_status, dedupe_key, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        p.advertiserId,
        p.networkId ?? null,
        p.categoryId ?? null,
        p.name,
        p.segment,
        p.description ?? null,
        p.currency ?? null,
        p.recurringDurationMonths ?? null,
        p.attributionModel ?? null,
        p.payoutCurrency ?? null,
        JSON.stringify(p.payoutMethods),
        p.refundPolicy ?? null,
        p.approvalRequirements ?? null,
        p.promoRestrictions ?? null,
        p.officialUrl ?? null,
        p.signupUrl ?? null,
        p.docsUrl ?? null,
        p.lifecycleStatus,
        dedupeKey(p.advertiserId, p.networkId ?? null, p.name),
        user.id,
        now,
        now,
      ),
      historyStmt(c.env.DB, id, "created", null, p.name, user),
      ...reindexStatements(c.env.DB, id),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE")) return c.json({ error: "duplicate_program" }, 409);
    throw e;
  }
  return c.json({ ok: true, id }, 201);
});

catalog.patch("/programs/:id", editor, async (c) => {
  const parsed = programPatchSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const row = await loadProgram(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const res = await applyChanges(c.env.DB, row, parsed.data, c.get("user"));
  if (!res.ok) return c.json(res.body, res.status);
  return c.json({ ok: true, changed: res.changed });
});

catalog.post("/programs/:id/status", editor, async (c) => {
  const parsed = statusChangeSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const row = await loadProgram(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const res = await applyChanges(
    c.env.DB,
    row,
    { lifecycleStatus: parsed.data.lifecycleStatus },
    c.get("user"),
    parsed.data.note,
  );
  if (!res.ok) return c.json(res.body, res.status);
  return c.json({ ok: true, changed: res.changed });
});

// ---------- Fontes e verificação ----------

catalog.post("/programs/:id/sources", editor, async (c) => {
  const parsed = sourceSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const s = parsed.data;
  const id = c.req.param("id");
  const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM affiliate_programs WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "not_found" }, 404);
  // Fonte não oficial pode ser registrada, mas nunca "confirma" nada.
  if (s.confirmedAt && !isOfficialSource(s.sourceType)) {
    return c.json({ error: "unofficial_source_cannot_confirm" }, 422);
  }
  const user = c.get("user");
  const now = Date.now();
  const sourceId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO program_sources (id, program_id, source_type, field, url, note, consulted_at, confirmed_at, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(sourceId, id, s.sourceType, s.field ?? null, s.url, s.note ?? null, s.consultedAt ?? now, s.confirmedAt ?? null, user.id, now),
    historyStmt(c.env.DB, id, "source_added", null, `${s.sourceType}${s.field ? `:${s.field}` : ""} ${s.url}`, user),
  ]);
  return c.json({ ok: true, id: sourceId }, 201);
});

catalog.post("/programs/:id/verify", editor, async (c) => {
  const parsed = verifyActionSchema.safeParse(await json(c));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const id = c.req.param("id");
  const row = await loadProgram(c.env.DB, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const user = c.get("user");
  const now = Date.now();
  const { action, note } = parsed.data;

  if (action === "verify") {
    const official = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM program_sources WHERE program_id = ? AND source_type IN ('official_docs','official_page','official_api','official_communication')",
    )
      .bind(id)
      .first<{ n: number }>();
    if (!official || official.n < 1) return c.json({ error: "official_source_required" }, 422);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE affiliate_programs SET last_verified_at = ?, last_verified_by = ?, verification_flag = 'none', updated_at = ? WHERE id = ?",
      ).bind(now, user.id, now, id),
      historyStmt(c.env.DB, id, "verified", row.last_verified_at, now, user, note),
    ]);
    return c.json({ ok: true });
  }

  const flag = action === "flag_divergent" ? "divergent" : action === "flag_awaiting" ? "awaiting_update" : "none";
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE affiliate_programs SET verification_flag = ?, updated_at = ? WHERE id = ?").bind(flag, now, id),
    historyStmt(c.env.DB, id, "verification_flag", row.verification_flag, flag, user, note),
  ]);
  return c.json({ ok: true });
});

// ---------- Produtos e ofertas ----------

for (const [path, table, schema] of [
  ["products", "products", productSchema],
  ["offers", "offers", offerSchema],
] as const) {
  catalog.post(`/programs/:id/${path}`, editor, async (c) => {
    const parsed = schema.safeParse(await json(c));
    if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
    const id = c.req.param("id");
    const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM affiliate_programs WHERE id = ?").bind(id).first();
    if (!exists) return c.json({ error: "not_found" }, 404);
    const rowId = crypto.randomUUID();
    const d = parsed.data as any;
    const stmt =
      table === "products"
        ? c.env.DB.prepare(
            "INSERT INTO products (id, program_id, name, url, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(rowId, id, d.name, d.url ?? null, d.description ?? null, Date.now())
        : c.env.DB.prepare(
            "INSERT INTO offers (id, program_id, title, details, url, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ).bind(rowId, id, d.title, d.details ?? null, d.url ?? null, d.startsAt ?? null, d.endsAt ?? null, Date.now());
    await c.env.DB.batch([
      stmt,
      historyStmt(c.env.DB, id, `${table}_added`, null, d.name ?? d.title, c.get("user")),
    ]);
    return c.json({ ok: true, id: rowId }, 201);
  });

  catalog.delete(`/${path}/:id`, editor, async (c) => {
    const rowId = c.req.param("id");
    const row = await c.env.DB.prepare(`SELECT program_id FROM ${table} WHERE id = ?`)
      .bind(rowId)
      .first<{ program_id: string }>();
    if (!row) return c.json({ error: "not_found" }, 404);
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(rowId),
      historyStmt(c.env.DB, row.program_id, `${table}_removed`, rowId, null, c.get("user")),
    ]);
    return c.json({ ok: true });
  });
}

// ---------- Importação CSV ----------

/** Leitor CSV mínimo (RFC 4180): aspas, vírgulas e quebras de linha dentro de aspas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const MAX_IMPORT_ROWS = 100;

catalog.post("/import", editor, async (c) => {
  const body = (await json(c)) as { csv?: unknown; dryRun?: unknown } | null;
  if (!body || typeof body.csv !== "string" || body.csv.length > 500_000) return c.json({ error: "invalid_input" }, 400);
  const dryRun = body.dryRun === true;
  const user = c.get("user");

  const table = parseCsv(body.csv);
  const header = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
  const need = ["advertiser", "program", "segment"];
  if (need.some((h) => !header.includes(h))) return c.json({ error: "missing_columns", required: need }, 400);
  if (table.length > MAX_IMPORT_ROWS) return c.json({ error: "too_many_rows", max: MAX_IMPORT_ROWS }, 413);

  const [nets, cats, advs, keys] = await Promise.all([
    c.env.DB.prepare("SELECT id, name_key FROM affiliate_networks").all<{ id: string; name_key: string }>(),
    c.env.DB.prepare("SELECT id, slug FROM categories").all<{ id: string; slug: string }>(),
    c.env.DB.prepare("SELECT id, name_key FROM advertisers").all<{ id: string; name_key: string }>(),
    c.env.DB.prepare("SELECT dedupe_key FROM affiliate_programs").all<{ dedupe_key: string }>(),
  ]);
  const netByKey = new Map(nets.results.map((n) => [n.name_key, n.id]));
  const catBySlug = new Map(cats.results.map((k) => [k.slug, k.id]));
  const advByKey = new Map(advs.results.map((a) => [a.name_key, a.id]));
  const seen = new Set(keys.results.map((k) => k.dedupe_key));

  const report = {
    created: 0,
    duplicates: [] as Array<{ line: number; reason: string }>,
    errors: [] as Array<{ line: number; error: string }>,
    dryRun,
  };
  const stmts: D1PreparedStatement[] = [];
  const now = Date.now();
  const ids: string[] = [];
  const pendingAdv = new Map<string, string>();

  table.forEach((cells, idx) => {
    const line = idx + 2;
    const get = (name: string) => (cells[header.indexOf(name)] ?? "").trim();
    const parsedSeg = programSchema.shape.segment.safeParse(get("segment"));
    const advName = get("advertiser");
    const progName = get("program");
    if (!advName || !progName || !parsedSeg.success) {
      report.errors.push({ line, error: "invalid_row" });
      return;
    }
    const urls: Record<string, string | null> = {};
    for (const col of ["official_url", "signup_url", "docs_url", "advertiser_url"]) {
      const v = get(col);
      if (!v) {
        urls[col] = null;
        continue;
      }
      if (!/^https?:\/\/\S+$/i.test(v)) {
        report.errors.push({ line, error: `invalid_${col}` });
        return;
      }
      urls[col] = v;
    }
    let networkId: string | null = null;
    if (get("network")) {
      networkId = netByKey.get(normalizeName(get("network"))) ?? null;
      if (!networkId) {
        report.errors.push({ line, error: "unknown_network" });
        return;
      }
    }
    let categoryId: string | null = null;
    if (get("category")) {
      categoryId = catBySlug.get(get("category").toLowerCase()) ?? null;
      if (!categoryId) {
        report.errors.push({ line, error: "unknown_category" });
        return;
      }
    }
    const advKey = normalizeName(advName);
    let advId = advByKey.get(advKey) ?? pendingAdv.get(advKey);
    const isNewAdvertiser = !advId;
    if (!advId) advId = crypto.randomUUID();
    const key = dedupeKey(advId, networkId, progName);
    if (seen.has(key)) {
      report.duplicates.push({ line, reason: "already_exists" });
      return;
    }
    seen.add(key);
    if (isNewAdvertiser) {
      pendingAdv.set(advKey, advId);
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO advertisers (id, name, name_key, website_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(advId, advName, advKey, urls.advertiser_url, now, now),
      );
    }
    const id = crypto.randomUUID();
    ids.push(id);
    // Programas importados nascem sem nenhum fato confirmado e sem fontes.
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO affiliate_programs (id, advertiser_id, network_id, category_id, name, segment, official_url, signup_url, docs_url, dedupe_key, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, advId, networkId, categoryId, progName, parsedSeg.data, urls.official_url, urls.signup_url, urls.docs_url, dedupeKey(advId, networkId, progName), user.id, now, now),
      historyStmt(c.env.DB, id, "created", null, progName, user, "csv_import"),
    );
    report.created++;
  });

  if (!dryRun && stmts.length) {
    await c.env.DB.batch(stmts);
    for (let i = 0; i < ids.length; i += 20) {
      await c.env.DB.batch(ids.slice(i, i + 20).flatMap((id) => reindexStatements(c.env.DB, id)));
    }
    await audit(c.env.DB, user.id, "catalog.import", undefined, {
      created: report.created,
      duplicates: report.duplicates.length,
      errors: report.errors.length,
    });
  }
  return c.json(report);
});
