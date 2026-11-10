import { Hono } from "hono";
import {
  NETWORK_ORIGINS,
  adjustmentSchema,
  campaignPatchSchema,
  campaignSchema,
  canTransition,
  commissionImportSchema,
  commissionPatchSchema,
  commissionSchema,
  commissionStatusSchema,
  isPaidChannel,
  linkPatchSchema,
  linkSchema,
  mapNetworkStatus,
  netAmount,
  reconcile,
  signedAdjustment,
  userDocSchema,
  userProgramCreateSchema,
  userProgramPatchSchema,
  type CommissionStatus,
  type ReconRow,
} from "@ai/shared";
import { audit } from "./audit";
import { parseCsv, type Row } from "./catalog";
import { loadConfig } from "./intel";
import { requireUser } from "./middleware";
import type { AppBindings } from "./types";

export const ops = new Hono<AppBindings>();
ops.use("*", requireUser);

const json = (c: any) => c.req.json().catch(() => null);
const invalid = (c: any, issues: unknown) => c.json({ error: "invalid_input", issues }, 400);
const uid = (c: any) => c.get("user").id as string;
const now = () => Date.now();

/** Atualiza só as colunas informadas (patch parcial). Chaves vêm do código, nunca do usuário. */
function buildSet(map: Record<string, string>, body: Record<string, unknown>, conv: (k: string, v: unknown) => unknown = (_k, v) => v) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of Object.entries(map)) {
    if (body[k] === undefined) continue;
    cols.push(`${col} = ?`);
    const v = conv(k, body[k]);
    vals.push(v === undefined ? null : v);
  }
  return { cols, vals };
}

// ---------- Programas do usuário ----------

const ACTIVE_APPLICATION = new Set(["application_pending", "approved", "active"]);

const UP_SELECT = `SELECT up.*, p.name AS program_name, p.lifecycle_status, p.signup_url, p.signup_url_status,
    p.official_url, a.name AS advertiser_name, n.name AS network_name
  FROM user_programs up
  JOIN affiliate_programs p ON p.id = up.program_id
  JOIN advertisers a ON a.id = p.advertiser_id
  LEFT JOIN affiliate_networks n ON n.id = p.network_id`;

const toUp = (r: Row) => ({
  id: r.id as string,
  programId: r.program_id as string,
  programName: r.program_name as string,
  advertiser: r.advertiser_name as string,
  network: (r.network_name as string | null) ?? null,
  status: r.status as string,
  appliedAt: r.applied_at as number | null,
  approvedAt: r.approved_at as number | null,
  affiliateId: r.affiliate_id as string | null,
  acceptedTerms: r.accepted_terms as string | null,
  notes: r.notes as string | null,
  nextAction: r.next_action as string | null,
  nextActionAt: r.next_action_at as number | null,
  catalogStatus: r.lifecycle_status as string,
  /** Programa encerrado/suspenso no catálogo mas ainda "em andamento" para o usuário: precisa de revisão. */
  needsReview: r.lifecycle_status !== "active" && ACTIVE_APPLICATION.has(r.status as string),
  // Link oficial de inscrição: o usuário se cadastra direto no site do programa.
  signupUrl: r.signup_url as string | null,
  signupUrlStatus: r.signup_url_status as string,
  officialUrl: r.official_url as string | null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

ops.get("/programs", async (c) => {
  const { results } = await c.env.DB.prepare(`${UP_SELECT} WHERE up.user_id = ? ORDER BY up.updated_at DESC`).bind(uid(c)).all<Row>();
  return c.json({ items: results.map(toUp) });
});

ops.post("/programs", async (c) => {
  const parsed = userProgramCreateSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { programId, status } = parsed.data;
  const prog = await c.env.DB.prepare("SELECT lifecycle_status FROM affiliate_programs WHERE id = ?").bind(programId).first<Row>();
  if (!prog) return c.json({ error: "program_not_found" }, 404);
  if (prog.lifecycle_status !== "active" && ACTIVE_APPLICATION.has(status)) return c.json({ error: "program_not_active" }, 409);
  const exists = await c.env.DB.prepare("SELECT id FROM user_programs WHERE user_id = ? AND program_id = ?").bind(uid(c), programId).first();
  if (exists) return c.json({ error: "already_saved", id: (exists as Row).id }, 409);
  const id = crypto.randomUUID();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO user_programs (id, user_id, program_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, uid(c), programId, status, t, t),
    c.env.DB.prepare(
      "INSERT INTO user_program_history (id, user_program_id, user_id, from_status, to_status, at) VALUES (?, ?, ?, NULL, ?, ?)",
    ).bind(crypto.randomUUID(), id, uid(c), status, t),
  ]);
  return c.json({ ok: true, id }, 201);
});

ops.get("/programs/:id", async (c) => {
  const row = await c.env.DB.prepare(`${UP_SELECT} WHERE up.id = ? AND up.user_id = ?`).bind(c.req.param("id"), uid(c)).first<Row>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const [hist, docs] = await Promise.all([
    c.env.DB.prepare("SELECT from_status, to_status, note, at FROM user_program_history WHERE user_program_id = ? AND user_id = ? ORDER BY at DESC, rowid DESC")
      .bind(row.id, uid(c))
      .all<Row>(),
    c.env.DB.prepare("SELECT id, title, url, created_at FROM user_program_docs WHERE user_program_id = ? AND user_id = ? ORDER BY created_at")
      .bind(row.id, uid(c))
      .all<Row>(),
  ]);
  return c.json({
    item: toUp(row),
    history: hist.results.map((h) => ({ from: h.from_status, to: h.to_status, note: h.note, at: h.at })),
    docs: docs.results.map((d) => ({ id: d.id, title: d.title, url: d.url, createdAt: d.created_at })),
  });
});

ops.patch("/programs/:id", async (c) => {
  const parsed = userProgramPatchSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const body = parsed.data;
  const row = await c.env.DB.prepare(`${UP_SELECT} WHERE up.id = ? AND up.user_id = ?`).bind(c.req.param("id"), uid(c)).first<Row>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (body.status && body.status !== row.status && row.lifecycle_status !== "active" && ACTIVE_APPLICATION.has(body.status)) {
    return c.json({ error: "program_not_active" }, 409);
  }
  const t = now();
  const { cols, vals } = buildSet(
    {
      status: "status",
      appliedAt: "applied_at",
      approvedAt: "approved_at",
      affiliateId: "affiliate_id",
      acceptedTerms: "accepted_terms",
      notes: "notes",
      nextAction: "next_action",
      nextActionAt: "next_action_at",
    },
    body as Record<string, unknown>,
  );
  const stmts: D1PreparedStatement[] = [];
  // Datas de inscrição/aprovação são registradas na primeira vez que o status as implica, sem inventar.
  if (body.status === "application_pending" && row.applied_at === null && body.appliedAt === undefined) {
    cols.push("applied_at = ?");
    vals.push(t);
  }
  if (body.status === "approved" && row.approved_at === null && body.approvedAt === undefined) {
    cols.push("approved_at = ?");
    vals.push(t);
  }
  cols.push("updated_at = ?");
  vals.push(t);
  stmts.push(c.env.DB.prepare(`UPDATE user_programs SET ${cols.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals, row.id, uid(c)));
  if (body.status && body.status !== row.status) {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO user_program_history (id, user_program_id, user_id, from_status, to_status, at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), row.id, uid(c), row.status, body.status, t),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

ops.delete("/programs/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM user_programs WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

ops.post("/programs/:id/docs", async (c) => {
  const parsed = userDocSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const up = await c.env.DB.prepare("SELECT id FROM user_programs WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first();
  if (!up) return c.json({ error: "not_found" }, 404);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM user_program_docs WHERE user_program_id = ?").bind(c.req.param("id")).first<{ n: number }>();
  if ((count?.n ?? 0) >= 30) return c.json({ error: "too_many_docs" }, 409);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO user_program_docs (id, user_program_id, user_id, title, url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, c.req.param("id"), uid(c), parsed.data.title, parsed.data.url, now())
    .run();
  return c.json({ ok: true, id }, 201);
});

ops.delete("/programs/:id/docs/:docId", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM user_program_docs WHERE id = ? AND user_program_id = ? AND user_id = ?")
    .bind(c.req.param("docId"), c.req.param("id"), uid(c))
    .run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// ---------- Verificação de posse (tudo é filtrado por usuário) ----------

async function ownsProgramRef(c: any, table: "campaigns" | "affiliate_links", id: string | null | undefined) {
  if (!id) return true;
  return !!(await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`).bind(id, uid(c)).first());
}

// ---------- Campanhas ----------

const CAMPAIGN_COLS = {
  name: "name",
  programId: "program_id",
  productName: "product_name",
  channel: "channel",
  keyword: "keyword",
  audience: "audience",
  budget: "budget",
  adSpend: "ad_spend",
  currency: "currency",
  status: "status",
  startsAt: "starts_at",
  endsAt: "ends_at",
  clicksReported: "clicks_reported",
  conversionsReported: "conversions_reported",
  notes: "notes",
};

const toCampaign = (r: Row) => ({
  id: r.id as string,
  name: r.name as string,
  programId: r.program_id as string | null,
  programName: (r.program_name as string | null) ?? null,
  productName: r.product_name as string | null,
  channel: r.channel as string,
  keyword: r.keyword as string | null,
  audience: r.audience as string | null,
  budget: r.budget as number | null,
  adSpend: r.ad_spend as number | null,
  currency: r.currency as string,
  status: r.status as string,
  startsAt: r.starts_at as number | null,
  endsAt: r.ends_at as number | null,
  /** Números digitados pelo usuário (origem: manual). Não são confirmação da rede. */
  clicksReported: r.clicks_reported as number | null,
  conversionsReported: r.conversions_reported as number | null,
  notes: r.notes as string | null,
  paid: isPaidChannel(r.channel as string),
});

/** Tráfego pago: confere a regra do programa antes. Proibido sempre bloqueia; não confirmado segue a política. */
async function paidTrafficCheck(c: any, channel: string, programId: string | null | undefined) {
  if (!isPaidChannel(channel) || !programId) return { block: false, warnings: [] as string[] };
  const p = await c.env.DB.prepare("SELECT accepts_paid_traffic FROM affiliate_programs WHERE id = ?").bind(programId).first();
  if (!p) return { block: false, warnings: [] as string[] };
  const v = (p as Row).accepts_paid_traffic as string;
  if (v === "yes") return { block: false, warnings: [] as string[] };
  if (v === "no") return { block: true, code: "paid_traffic_forbidden", warnings: [] as string[] };
  const cfg = await loadConfig(c.env.DB);
  return cfg.paidTrafficPolicy === "block"
    ? { block: true, code: "paid_traffic_not_confirmed", warnings: [] as string[] }
    : { block: false, warnings: ["paid_traffic_not_confirmed"] };
}

async function programExists(c: any, id: string | null | undefined) {
  if (!id) return true;
  return !!(await c.env.DB.prepare("SELECT id FROM affiliate_programs WHERE id = ?").bind(id).first());
}

ops.get("/campaigns", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, p.name AS program_name FROM campaigns c LEFT JOIN affiliate_programs p ON p.id = c.program_id
     WHERE c.user_id = ? ORDER BY c.created_at DESC`,
  )
    .bind(uid(c))
    .all<Row>();
  return c.json({ items: results.map(toCampaign) });
});

ops.post("/campaigns", async (c) => {
  const parsed = campaignSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  if (!(await programExists(c, b.programId))) return c.json({ error: "program_not_found" }, 404);
  const chk = await paidTrafficCheck(c, b.channel, b.programId);
  if (chk.block) return c.json({ error: chk.code }, 409);
  const id = crypto.randomUUID();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, user_id, name, program_id, product_name, channel, keyword, audience, budget, ad_spend, currency,
       status, starts_at, ends_at, clicks_reported, conversions_reported, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, uid(c), b.name, b.programId ?? null, b.productName ?? null, b.channel, b.keyword ?? null, b.audience ?? null,
      b.budget ?? null, b.adSpend ?? null, b.currency, b.status, b.startsAt ?? null, b.endsAt ?? null,
      b.clicksReported ?? null, b.conversionsReported ?? null, b.notes ?? null, t, t,
    )
    .run();
  return c.json({ ok: true, id, warnings: chk.warnings }, 201);
});

ops.patch("/campaigns/:id", async (c) => {
  const parsed = campaignPatchSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const cur = await c.env.DB.prepare("SELECT * FROM campaigns WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first<Row>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const programId = b.programId === undefined ? (cur.program_id as string | null) : b.programId;
  const channel = b.channel ?? (cur.channel as string);
  if (b.programId && !(await programExists(c, b.programId))) return c.json({ error: "program_not_found" }, 404);
  const chk = await paidTrafficCheck(c, channel, programId);
  if (chk.block) return c.json({ error: chk.code }, 409);
  const { cols, vals } = buildSet(CAMPAIGN_COLS, b as Record<string, unknown>);
  cols.push("updated_at = ?");
  vals.push(now());
  await c.env.DB.prepare(`UPDATE campaigns SET ${cols.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals, cur.id, uid(c)).run();
  return c.json({ ok: true, warnings: chk.warnings });
});

ops.delete("/campaigns/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM campaigns WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// ---------- Links ----------

const LINK_COLS = {
  label: "label",
  url: "url",
  programId: "program_id",
  productId: "product_id",
  productName: "product_name",
  campaignId: "campaign_id",
  channel: "channel",
  campaignTag: "campaign_tag",
  trackingMode: "tracking_mode",
  active: "active",
};

const LINK_SELECT = `SELECT l.*, p.name AS program_name, p.allows_redirect, p.lifecycle_status,
    (SELECT COUNT(*) FROM link_clicks k WHERE k.link_id = l.id) AS clicks,
    (SELECT COUNT(*) FROM link_clicks k WHERE k.link_id = l.id AND k.at > ?) AS clicks_30d
  FROM affiliate_links l LEFT JOIN affiliate_programs p ON p.id = l.program_id`;

const toLink = (r: Row, origin: string) => ({
  id: r.id as string,
  code: r.code as string,
  label: r.label as string,
  url: r.url as string,
  programId: r.program_id as string | null,
  programName: (r.program_name as string | null) ?? null,
  productId: r.product_id as string | null,
  productName: r.product_name as string | null,
  campaignId: r.campaign_id as string | null,
  channel: r.channel as string,
  campaignTag: r.campaign_tag as string | null,
  trackingMode: r.tracking_mode as string,
  active: !!r.active,
  /** Só há link rastreável próprio se o programa confirmou que permite. */
  redirectAllowed: r.allows_redirect === "yes" && r.lifecycle_status === "active",
  trackUrl: r.tracking_mode === "own_redirect" ? `${origin}/r/${r.code}` : null,
  /** Cliques contados pelo redirecionamento próprio. Clique não é venda. */
  clicks: r.clicks as number,
  clicks30d: r.clicks_30d as number,
});

async function checkRedirect(c: any, programId: string | null | undefined) {
  if (!programId) return "redirect_needs_program";
  const p = await c.env.DB.prepare("SELECT allows_redirect, lifecycle_status FROM affiliate_programs WHERE id = ?").bind(programId).first();
  if (!p) return "program_not_found";
  if ((p as Row).allows_redirect !== "yes") return "redirect_not_allowed";
  if ((p as Row).lifecycle_status !== "active") return "program_not_active";
  return null;
}

const appOrigin = (c: any) => new URL(c.env.APP_URL).origin;

ops.get("/links", async (c) => {
  const { results } = await c.env.DB.prepare(`${LINK_SELECT} WHERE l.user_id = ? ORDER BY l.created_at DESC`)
    .bind(now() - 30 * 86_400_000, uid(c))
    .all<Row>();
  return c.json({ items: results.map((r) => toLink(r, appOrigin(c))) });
});

ops.post("/links", async (c) => {
  const parsed = linkSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  if (b.programId && !(await programExists(c, b.programId))) return c.json({ error: "program_not_found" }, 404);
  if (!(await ownsProgramRef(c, "campaigns", b.campaignId))) return c.json({ error: "campaign_not_found" }, 404);
  if (b.trackingMode === "own_redirect") {
    const err = await checkRedirect(c, b.programId);
    if (err) return c.json({ error: err }, err === "program_not_found" ? 404 : 409);
  }
  const id = crypto.randomUUID();
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO affiliate_links (id, user_id, code, label, url, program_id, product_id, product_name, campaign_id, channel,
       campaign_tag, tracking_mode, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, uid(c), code, b.label, b.url, b.programId ?? null, b.productId ?? null, b.productName ?? null, b.campaignId ?? null,
      b.channel, b.campaignTag ?? null, b.trackingMode, b.active ? 1 : 0, t, t)
    .run();
  return c.json({ ok: true, id, code }, 201);
});

ops.patch("/links/:id", async (c) => {
  const parsed = linkPatchSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const cur = await c.env.DB.prepare("SELECT * FROM affiliate_links WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first<Row>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (b.programId && !(await programExists(c, b.programId))) return c.json({ error: "program_not_found" }, 404);
  if (b.campaignId !== undefined && !(await ownsProgramRef(c, "campaigns", b.campaignId))) return c.json({ error: "campaign_not_found" }, 404);
  const mode = b.trackingMode ?? (cur.tracking_mode as string);
  const programId = b.programId === undefined ? (cur.program_id as string | null) : b.programId;
  if (mode === "own_redirect") {
    const err = await checkRedirect(c, programId);
    if (err) return c.json({ error: err }, err === "program_not_found" ? 404 : 409);
  }
  const { cols, vals } = buildSet(LINK_COLS, b as Record<string, unknown>, (k, v) => (k === "active" ? (v ? 1 : 0) : v));
  cols.push("updated_at = ?");
  vals.push(now());
  await c.env.DB.prepare(`UPDATE affiliate_links SET ${cols.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals, cur.id, uid(c)).run();
  return c.json({ ok: true });
});

ops.delete("/links/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM affiliate_links WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// ---------- Comissões ----------

const COMM_SELECT = `SELECT m.*, p.name AS program_name,
    COALESCE((SELECT SUM(amount) FROM commission_adjustments x WHERE x.commission_id = m.id), 0) AS adj
  FROM commissions m LEFT JOIN affiliate_programs p ON p.id = m.program_id`;

const toCommission = (r: Row) => ({
  id: r.id as string,
  programId: r.program_id as string | null,
  programName: (r.program_name as string | null) ?? null,
  linkId: r.link_id as string | null,
  campaignId: r.campaign_id as string | null,
  productName: r.product_name as string | null,
  channel: r.channel as string | null,
  amount: r.amount as number,
  adjustments: r.adj as number,
  netAmount: netAmount(r.amount as number, [r.adj as number]),
  currency: r.currency as string,
  status: r.status as CommissionStatus,
  conversionState: r.conversion_state as string,
  occurredAt: r.occurred_at as number,
  approvedAt: r.approved_at as number | null,
  paidAt: r.paid_at as number | null,
  origin: r.origin as string,
  externalRef: r.external_ref as string | null,
  notes: r.notes as string | null,
});

ops.get("/commissions", async (c) => {
  const where = ["m.user_id = ?"];
  const args: unknown[] = [uid(c)];
  for (const [q, col] of [["status", "m.status"], ["origin", "m.origin"], ["programId", "m.program_id"], ["currency", "m.currency"]] as const) {
    const v = c.req.query(q);
    if (v) {
      where.push(`${col} = ?`);
      args.push(v);
    }
  }
  const { results } = await c.env.DB.prepare(`${COMM_SELECT} WHERE ${where.join(" AND ")} ORDER BY m.occurred_at DESC LIMIT 500`).bind(...args).all<Row>();
  return c.json({ items: results.map(toCommission) });
});

async function checkCommissionRefs(c: any, b: { programId?: string | null; linkId?: string | null; campaignId?: string | null }) {
  if (!(await programExists(c, b.programId))) return "program_not_found";
  if (!(await ownsProgramRef(c, "affiliate_links", b.linkId))) return "link_not_found";
  if (!(await ownsProgramRef(c, "campaigns", b.campaignId))) return "campaign_not_found";
  return null;
}

ops.post("/commissions", async (c) => {
  const parsed = commissionSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  // Registro próprio nunca confirma venda: só o relatório da rede (importação) confirma.
  if (b.conversionState === "confirmed") return c.json({ error: "confirmation_requires_network_report" }, 400);
  const err = await checkCommissionRefs(c, b);
  if (err) return c.json({ error: err }, 404);
  const id = crypto.randomUUID();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO commissions (id, user_id, program_id, link_id, campaign_id, product_name, channel, amount, currency, status,
       conversion_state, occurred_at, origin, external_ref, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'estimated', 'reported', ?, 'manual', ?, ?, ?, ?)`,
  )
    .bind(id, uid(c), b.programId ?? null, b.linkId ?? null, b.campaignId ?? null, b.productName ?? null, b.channel ?? null,
      b.amount, b.currency, b.occurredAt ?? t, b.externalRef ?? null, b.notes ?? null, t, t)
    .run();
  return c.json({ ok: true, id }, 201);
});

ops.patch("/commissions/:id", async (c) => {
  const parsed = commissionPatchSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const cur = await c.env.DB.prepare("SELECT * FROM commissions WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first<Row>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status === "paid") return c.json({ error: "commission_paid_locked" }, 409);
  // Registros vindos da rede (csv/api) só mudam por nova importação; a origem não pode ser trocada.
  if (cur.origin !== "manual" && cur.origin !== "own_tracking") return c.json({ error: "network_record_locked" }, 409);
  if (b.conversionState === "confirmed") return c.json({ error: "confirmation_requires_network_report" }, 400);
  const err = await checkCommissionRefs(c, b);
  if (err) return c.json({ error: err }, 404);
  const { cols, vals } = buildSet(
    {
      programId: "program_id", linkId: "link_id", campaignId: "campaign_id", productName: "product_name", channel: "channel",
      amount: "amount", currency: "currency", occurredAt: "occurred_at", externalRef: "external_ref", notes: "notes",
    },
    b as Record<string, unknown>,
  );
  if (!cols.length) return c.json({ ok: true });
  cols.push("updated_at = ?");
  vals.push(now());
  await c.env.DB.prepare(`UPDATE commissions SET ${cols.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals, cur.id, uid(c)).run();
  return c.json({ ok: true });
});

ops.post("/commissions/:id/status", async (c) => {
  const parsed = commissionStatusSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const cur = await c.env.DB.prepare("SELECT status FROM commissions WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first<Row>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const to = parsed.data.status;
  if (!canTransition(cur.status as CommissionStatus, to)) return c.json({ error: "invalid_transition", from: cur.status, to }, 409);
  const t = now();
  const sets = ["status = ?", "updated_at = ?"];
  const vals: unknown[] = [to, t];
  if (to === "approved") (sets.push("approved_at = ?"), vals.push(t));
  if (to === "paid") (sets.push("paid_at = ?"), vals.push(t));
  await c.env.DB.prepare(`UPDATE commissions SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...vals, c.req.param("id"), uid(c)).run();
  await audit(c.env.DB, uid(c), "commission.status", c.req.param("id"), { from: cur.status, to });
  return c.json({ ok: true });
});

ops.post("/commissions/:id/adjustments", async (c) => {
  const parsed = adjustmentSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const cur = await c.env.DB.prepare("SELECT id FROM commissions WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO commission_adjustments (id, commission_id, user_id, kind, amount, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, c.req.param("id"), uid(c), parsed.data.kind, signedAdjustment(parsed.data.kind, parsed.data.amount), parsed.data.note ?? null, now())
    .run();
  return c.json({ ok: true, id }, 201);
});

ops.get("/commissions/:id/adjustments", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, kind, amount, note, at FROM commission_adjustments WHERE commission_id = ? AND user_id = ? ORDER BY at",
  )
    .bind(c.req.param("id"), uid(c))
    .all<Row>();
  return c.json({ items: results });
});

ops.delete("/commissions/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM commissions WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// ---------- Importação de relatório da rede (CSV) ----------

const MAX_IMPORT = 200;

ops.post("/commissions/import", async (c) => {
  const parsed = commissionImportSchema.safeParse(await json(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { programId, csv, dryRun } = parsed.data;
  const prog = await c.env.DB.prepare("SELECT currency FROM affiliate_programs WHERE id = ?").bind(programId).first<Row>();
  if (!prog) return c.json({ error: "program_not_found" }, 404);
  const table = parseCsv(csv);
  const header = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
  const need = ["external_ref", "amount"];
  if (need.some((h) => !header.includes(h))) return c.json({ error: "missing_columns", required: need }, 400);
  if (table.length > MAX_IMPORT) return c.json({ error: "too_many_rows", max: MAX_IMPORT }, 413);
  const col = (r: string[], n: string) => (header.includes(n) ? (r[header.indexOf(n)] ?? "").trim() : "");

  const { results: existing } = await c.env.DB.prepare(
    "SELECT id, external_ref, amount, status FROM commissions WHERE user_id = ? AND program_id = ? AND origin = 'csv'",
  )
    .bind(uid(c), programId)
    .all<Row>();
  const byRef = new Map(existing.map((e) => [String(e.external_ref).toLowerCase(), e]));
  const seen = new Set<string>();

  const report = { created: 0, updated: 0, unchanged: 0, errors: [] as Array<{ line: number; error: string }>, dryRun };
  const stmts: D1PreparedStatement[] = [];
  const t = now();
  table.forEach((r, i) => {
    const line = i + 2;
    const ref = col(r, "external_ref");
    const amount = Number(col(r, "amount").replace(",", "."));
    const cur = (col(r, "currency") || (prog.currency as string | null) || "").toUpperCase();
    if (!ref) return report.errors.push({ line, error: "external_ref_required" });
    if (!Number.isFinite(amount) || amount < 0) return report.errors.push({ line, error: "invalid_amount" });
    if (!/^[A-Z]{3}$/.test(cur)) return report.errors.push({ line, error: "currency_required" });
    const key = ref.toLowerCase();
    if (seen.has(key)) return report.errors.push({ line, error: "duplicate_in_file" });
    seen.add(key);
    const status = mapNetworkStatus(col(r, "status"));
    const dateRaw = col(r, "date");
    const occurred = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? Date.parse(dateRaw) : t;
    const product = col(r, "product") || null;
    const prev = byRef.get(key);
    if (prev) {
      if (prev.amount === amount && prev.status === status) return void report.unchanged++;
      report.updated++;
      stmts.push(
        c.env.DB.prepare(
          `UPDATE commissions SET amount = ?, currency = ?, status = ?, updated_at = ?,
             approved_at = CASE WHEN ? IN ('approved','paid') AND approved_at IS NULL THEN ? ELSE approved_at END,
             paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN ? ELSE paid_at END
           WHERE id = ? AND user_id = ?`,
        ).bind(amount, cur, status, t, status, t, status, t, prev.id, uid(c)),
      );
      return;
    }
    report.created++;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO commissions (id, user_id, program_id, product_name, amount, currency, status, conversion_state, occurred_at,
           approved_at, paid_at, origin, external_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, 'csv', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), uid(c), programId, product, amount, cur, status, occurred,
        status === "approved" || status === "paid" ? t : null, status === "paid" ? t : null, ref, t, t),
    );
  });
  if (!dryRun && stmts.length) await c.env.DB.batch(stmts);
  return c.json(report);
});

// ---------- Conciliação ----------

ops.get("/reconciliation", async (c) => {
  const programId = c.req.query("programId");
  if (!programId) return c.json({ error: "invalid_input", hint: "programId" }, 400);
  const { results } = await c.env.DB.prepare(
    "SELECT id, external_ref, amount, currency, status, origin FROM commissions WHERE user_id = ? AND program_id = ?",
  )
    .bind(uid(c), programId)
    .all<Row>();
  const toRow = (r: Row): ReconRow => ({ id: r.id, externalRef: r.external_ref, amount: r.amount, currency: r.currency, status: r.status });
  const ownRows = results.filter((r) => !NETWORK_ORIGINS.includes(r.origin)).map(toRow);
  const reportRows = results.filter((r) => NETWORK_ORIGINS.includes(r.origin)).map(toRow);
  const r = reconcile(ownRows, reportRows);
  return c.json({
    counts: {
      own: ownRows.length,
      report: reportRows.length,
      matched: r.matched.length,
      amountDiff: r.amountDiff.length,
      currencyDiff: r.currencyDiff.length,
      statusDiff: r.statusDiff.length,
      missingInReport: r.missingInReport.length,
      unreferenced: r.unreferenced.length,
      missingInOwn: r.missingInOwn.length,
    },
    ...r,
  });
});

// ---------- Painel pessoal ----------

type Money = { estimated: number; pending: number; approved: number; paid: number };
const zero = (): Money => ({ estimated: 0, pending: 0, approved: 0, paid: 0 });

ops.get("/dashboard", async (c) => {
  const u = uid(c);
  const db = c.env.DB;
  const [catalogN, ups, links, clicks, camp, comm, next, clicksByChannel] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM affiliate_programs").first<{ n: number }>(),
    db.prepare("SELECT status, COUNT(*) AS n FROM user_programs WHERE user_id = ? GROUP BY status").bind(u).all<Row>(),
    db.prepare("SELECT COUNT(*) AS n FROM affiliate_links WHERE user_id = ?").bind(u).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM link_clicks WHERE user_id = ?").bind(u).first<{ n: number }>(),
    db.prepare("SELECT channel, product_name, COALESCE(clicks_reported,0) AS cl, COALESCE(conversions_reported,0) AS cv FROM campaigns WHERE user_id = ?").bind(u).all<Row>(),
    db.prepare(
      `SELECT m.status, m.currency, m.origin, m.conversion_state, m.channel, m.product_name, cat.slug AS category,
         m.amount + COALESCE((SELECT SUM(amount) FROM commission_adjustments x WHERE x.commission_id = m.id), 0) AS net
       FROM commissions m LEFT JOIN affiliate_programs p ON p.id = m.program_id LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE m.user_id = ?`,
    ).bind(u).all<Row>(),
    db.prepare(
      `SELECT up.id, up.program_id, p.name AS program_name, up.next_action, up.next_action_at FROM user_programs up
       JOIN affiliate_programs p ON p.id = up.program_id
       WHERE up.user_id = ? AND up.next_action_at IS NOT NULL ORDER BY up.next_action_at LIMIT 10`,
    ).bind(u).all<Row>(),
    db.prepare(
      "SELECT l.channel, COUNT(*) AS n FROM link_clicks k JOIN affiliate_links l ON l.id = k.link_id WHERE k.user_id = ? GROUP BY l.channel",
    ).bind(u).all<Row>(),
  ]);

  const st = Object.fromEntries(ups.results.map((r) => [r.status as string, r.n as number]));
  const products = new Set<string>();
  const [lp, cp] = await Promise.all([
    db.prepare("SELECT DISTINCT lower(product_name) AS n FROM affiliate_links WHERE user_id = ? AND product_name IS NOT NULL").bind(u).all<Row>(),
    db.prepare("SELECT DISTINCT lower(product_name) AS n FROM campaigns WHERE user_id = ? AND product_name IS NOT NULL").bind(u).all<Row>(),
  ]);
  [...lp.results, ...cp.results].forEach((r) => products.add(r.n));

  // Nunca soma moedas diferentes nem junta status: cada moeda tem seus próprios totais.
  const byCurrency: Record<string, Money & { rejected: number }> = {};
  const byOrigin: Record<string, number> = {};
  const group = (key: "channel" | "product_name" | "category") => {
    const m = new Map<string, Money>();
    for (const r of comm.results) {
      if (r.status === "rejected") continue;
      const k = `${r[key] ?? "—"}|${r.currency}`;
      const o = m.get(k) ?? zero();
      o[r.status as keyof Money] += r.net;
      m.set(k, o);
    }
    return [...m].map(([k, v]) => {
      const [name, currency] = k.split("|");
      return { name, currency, ...v };
    });
  };
  let confirmed = 0;
  let reported = 0;
  for (const r of comm.results) {
    const cur = (byCurrency[r.currency] ??= { ...zero(), rejected: 0 });
    cur[r.status as keyof Money | "rejected"] += r.net;
    byOrigin[r.origin] = (byOrigin[r.origin] ?? 0) + 1;
    if (r.conversion_state === "confirmed") confirmed++;
    else reported++;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const v of Object.values(byCurrency)) for (const k of Object.keys(v) as Array<keyof typeof v>) v[k] = r2(v[k]);

  return c.json({
    programs: {
      discoveredInCatalog: catalogN?.n ?? 0,
      saved: ups.results.reduce((a, r) => a + (r.n as number), 0),
      interested: st.interested ?? 0,
      pendingApplications: st.application_pending ?? 0,
      approved: st.approved ?? 0,
      active: st.active ?? 0,
      rejected: st.rejected ?? 0,
      byStatus: st,
    },
    productsPromoted: products.size,
    linksRegistered: links?.n ?? 0,
    // Cliques separados por origem: só o redirecionamento próprio é medido aqui.
    clicks: {
      ownTracking: clicks?.n ?? 0,
      manualReported: camp.results.reduce((a, r) => a + (r.cl as number), 0),
      ownTrackingByChannel: clicksByChannel.results.map((r) => ({ channel: r.channel, clicks: r.n })),
    },
    conversions: {
      confirmedByNetwork: confirmed,
      reportedByUser: reported,
      manualReportedInCampaigns: camp.results.reduce((a, r) => a + (r.cv as number), 0),
    },
    commissionsByCurrency: byCurrency,
    commissionsByOrigin: byOrigin,
    byProduct: group("product_name"),
    byCategory: group("category"),
    byChannel: group("channel"),
    nextActions: next.results.map((r) => ({
      id: r.id, programId: r.program_id, programName: r.program_name, nextAction: r.next_action, at: r.next_action_at,
    })),
  });
});
