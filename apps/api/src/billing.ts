import { Hono } from "hono";
import { z } from "zod";
import { addMonths, planLimit, withinLimit, type PlanLimitKey } from "@ai/shared";
import { audit, auditStmt } from "./audit";
import { notifyStmt } from "./automation";
import type { Budget } from "./budget";
import { requireRole, requireUser } from "./middleware";
import type { AppBindings, Env } from "./types";

/**
 * Planos, assinaturas e pagamentos (Fase 8).
 * - Preços e limites vêm do banco (Admin > Planos); nada fixo no código.
 * - Nenhum gateway é integrado sem aprovação explícita (análise de custos, requisitos legais e disponibilidade).
 *   Por ora há dois provedores: "manual" (o administrador registra o pagamento que recebeu) e "grant" (cortesia).
 * - Assinatura ativa sem pagamento registrado não existe: renovar = registrar pagamento. Sem pagamento, o ciclo
 *   segue: período vencido -> inadimplente (carência) -> expirada -> plano Free.
 */

const DAY = 86_400_000;
type Row = Record<string, any>;
const json = (c: any) => c.req.json().catch(() => null);
const uid = (c: any) => c.get("user").id as string;

export const DEFAULT_TRIAL_DAYS = 0;
export const DEFAULT_GRACE_DAYS = 7;

export async function billingSettings(db: D1Database) {
  const { results } = await db.prepare("SELECT key, value FROM admin_settings WHERE key IN ('billing.trialDays','billing.graceDays')").all<Row>();
  const m = Object.fromEntries(results.map((r) => [r.key, Number(r.value)]));
  const ok = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
  return { trialDays: ok(m["billing.trialDays"], DEFAULT_TRIAL_DAYS), graceDays: ok(m["billing.graceDays"], DEFAULT_GRACE_DAYS) };
}

const parseLimits = (s: string | null): Record<string, number> => {
  try { const v = JSON.parse(s ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};

export async function planOf(db: D1Database, planId: string) {
  const p = await db.prepare("SELECT id, name, monthly_price_cents, currency, limits, active FROM plans WHERE id = ?").bind(planId).first<Row>();
  return p ? { id: p.id as string, name: p.name as string, priceCents: p.monthly_price_cents as number | null, currency: p.currency as string, limits: parseLimits(p.limits), active: !!p.active } : null;
}

const utcMonthStart = (t: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

const COUNTERS: Record<Exclude<PlanLimitKey, "reports">, (u: string, t: number) => [string, unknown[]]> = {
  savedPrograms: (u) => ["SELECT COUNT(*) AS n FROM user_programs WHERE user_id = ?", [u]],
  links: (u) => ["SELECT COUNT(*) AS n FROM affiliate_links WHERE user_id = ?", [u]],
  campaigns: (u) => ["SELECT COUNT(*) AS n FROM campaigns WHERE user_id = ?", [u]],
  aiRequestsMonthly: (u, t) => ["SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND mode = 'llm' AND at >= ?", [u, utcMonthStart(t)]],
};

export async function usageOf(db: D1Database, userId: string, at = Date.now()) {
  const keys = Object.keys(COUNTERS) as Array<keyof typeof COUNTERS>;
  const rows = await db.batch(keys.map((k) => { const [sql, args] = COUNTERS[k](userId, at); return db.prepare(sql).bind(...args); }));
  return Object.fromEntries(keys.map((k, i) => [k, ((rows[i]!.results[0] as Row)?.n as number) ?? 0])) as Record<keyof typeof COUNTERS, number>;
}

/**
 * Verifica o limite do plano do usuário antes de criar algo. Retorna a resposta 402 pronta, ou null se pode seguir.
 * Administradores não têm limite. Chave ausente no plano = ilimitado; 0 = recurso desligado.
 */
export async function checkPlanLimit(c: any, key: PlanLimitKey): Promise<Response | null> {
  const user = c.get("user") as { id: string; role: string; planId: string };
  if (user.role === "admin") return null;
  const plan = await planOf(c.env.DB, user.planId);
  const limit = planLimit(plan?.limits, key);
  if (limit === null) return null;
  const used = key === "reports" ? 0 : ((await usageOf(c.env.DB, user.id))[key] ?? 0);
  if (withinLimit(limit, used)) return null;
  return c.json({ error: "plan_limit", key, limit, used, planId: user.planId }, 402);
}

// ---------- Ciclo de vida ----------

type Sub = { id: string; user_id: string; plan_id: string; status: string; trial_ends_at: number | null; trial_used: number; current_period_start: number | null; current_period_end: number | null; cancel_at_period_end: number; grace_until: number | null };
const getSub = (db: D1Database, userId: string) => db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").bind(userId).first<Sub>();

export interface PaymentInput { userId: string; planId: string; amountCents: number; currency: string; providerRef?: string | null; paidAt?: number; note?: string | null; by: string; provider?: "manual" | "grant" }

/** Registra um pagamento recebido e estende a assinatura em um mês. Idempotente por (provedor, comprovante). */
export async function recordPayment(db: D1Database, p: PaymentInput, at = Date.now()): Promise<{ ok: true; duplicate: boolean; periodEnd?: number } | { ok: false; error: string }> {
  const plan = await planOf(db, p.planId);
  if (!plan) return { ok: false, error: "plan_not_found" };
  if (p.planId === "free") return { ok: false, error: "plan_is_free" };
  if (p.currency !== plan.currency) return { ok: false, error: "currency_mismatch" };
  const u = await db.prepare("SELECT id FROM users WHERE id = ?").bind(p.userId).first();
  if (!u) return { ok: false, error: "user_not_found" };
  const provider = p.provider ?? "manual";
  if (p.providerRef) {
    const dup = await db.prepare("SELECT id FROM payments WHERE provider = ? AND provider_ref = ?").bind(provider, p.providerRef).first();
    if (dup) return { ok: true, duplicate: true };
  }
  const paidAt = p.paidAt ?? at;
  const sub = await getSub(db, p.userId);
  // Renovação antecipada empilha no fim do período; vencida ou nova começa no dia do pagamento.
  const start = sub && sub.status === "active" && sub.plan_id === p.planId && sub.current_period_end && sub.current_period_end > paidAt ? sub.current_period_end : paidAt;
  const end = addMonths(start, 1);
  const subId = sub?.id ?? crypto.randomUUID();
  const payId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, trial_used, current_period_start, current_period_end, provider, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 0, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = 'active', current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end, cancel_at_period_end = 0, grace_until = NULL, canceled_at = NULL,
         provider = excluded.provider, updated_at = excluded.updated_at`,
    ).bind(subId, p.userId, p.planId, start, end, provider, at, at),
    db.prepare(
      `INSERT INTO payments (id, user_id, subscription_id, plan_id, amount_cents, currency, status, provider, provider_ref, period_start, period_end, paid_at, note, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(payId, p.userId, subId, p.planId, p.amountCents, p.currency, provider, p.providerRef ?? null, start, end, paidAt, p.note ?? null, p.by, at),
    db.prepare("UPDATE payments SET status = 'failed' WHERE user_id = ? AND status = 'pending' AND id != ?").bind(p.userId, payId),
    db.prepare("UPDATE users SET plan_id = ? WHERE id = ?").bind(p.planId, p.userId),
    notifyStmt(db, p.userId, "billing.paid", `Pagamento registrado — plano ${plan.name}`, `Válido até ${new Date(end).toISOString().slice(0, 10)}.`, "/billing", { plan: plan.name, until: new Date(end).toISOString().slice(0, 10) }),
    auditStmt(db, p.by, p.provider === "grant" ? "billing.granted" : "billing.payment_recorded", p.userId, { planId: p.planId, amountCents: p.amountCents, currency: p.currency, providerRef: p.providerRef ?? null }),
  ]);
  return { ok: true, duplicate: false, periodEnd: end };
}

/**
 * Passo do agendador: trial acabou, período venceu, carência acabou. Só mexe em assinaturas vencidas
 * (consulta indexada), em fatias, e usa batch. Retorna quantas mudaram de estado.
 */
export async function runBilling(env: Env, at: number, budget?: Budget): Promise<{ trialEnded: number; pastDue: number; expired: number; canceled: number }> {
  const out = { trialEnded: 0, pastDue: 0, expired: 0, canceled: 0 };
  if (budget && !budget.can(4)) return out;
  const db = env.DB;
  const { graceDays } = await billingSettings(db);
  const { results } = await db.prepare(
    `SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE (s.status = 'trialing' AND s.trial_ends_at <= ?1)
        OR (s.status = 'active' AND s.current_period_end <= ?1)
        OR (s.status = 'past_due' AND s.grace_until <= ?1)
     ORDER BY COALESCE(s.current_period_end, s.trial_ends_at) LIMIT 40`,
  ).bind(at).all<Sub & { plan_name: string }>();
  if (!results.length) return out;
  const stmts: D1PreparedStatement[] = [];
  const toFree = (s: Sub, status: "expired" | "canceled", kind: string, title: string, body: string) => {
    stmts.push(
      db.prepare("UPDATE subscriptions SET status = ?, canceled_at = ?, grace_until = NULL, updated_at = ? WHERE id = ? AND status != ?").bind(status, at, at, s.id, status),
      db.prepare("UPDATE users SET plan_id = 'free' WHERE id = ?").bind(s.user_id),
      notifyStmt(db, s.user_id, kind, title, body, "/billing", { plan: (s as any).plan_name }),
      auditStmt(db, null, `billing.${status}`, s.user_id, { planId: s.plan_id }),
    );
  };
  for (const s of results) {
    if (s.status === "trialing") {
      out.trialEnded++;
      toFree(s, "expired", "billing.trial_ended", `Teste do plano ${(s as any).plan_name} terminou`, "Você voltou ao plano Free. Seus dados foram mantidos.");
    } else if (s.status === "active") {
      if (s.cancel_at_period_end) {
        out.canceled++;
        toFree(s, "canceled", "billing.canceled", `Assinatura do plano ${(s as any).plan_name} encerrada`, "Você voltou ao plano Free. Seus dados foram mantidos.");
      } else {
        out.pastDue++;
        const until = at + graceDays * DAY;
        stmts.push(
          db.prepare("UPDATE subscriptions SET status = 'past_due', grace_until = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(until, at, s.id),
          notifyStmt(db, s.user_id, "billing.past_due", `Pagamento do plano ${(s as any).plan_name} pendente`, `Registre o pagamento até ${new Date(until).toISOString().slice(0, 10)} para manter o plano.`, "/billing", { plan: (s as any).plan_name, until: new Date(until).toISOString().slice(0, 10) }),
        );
      }
    } else {
      out.expired++;
      toFree(s, "expired", "billing.expired", `Plano ${(s as any).plan_name} expirou`, "Sem pagamento dentro da carência, você voltou ao plano Free. Seus dados foram mantidos.");
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return out;
}

// ---------- Rotas do usuário ----------

export const billing = new Hono<AppBindings>();
billing.use("*", requireUser);

const toSub = (s: Sub | null) =>
  s ? { planId: s.plan_id, status: s.status, trialEndsAt: s.trial_ends_at, currentPeriodStart: s.current_period_start, currentPeriodEnd: s.current_period_end, cancelAtPeriodEnd: !!s.cancel_at_period_end, graceUntil: s.grace_until } : null;

billing.get("/", async (c) => {
  const u = c.get("user");
  const [plan, plans, sub, pays, usage, settings] = await Promise.all([
    planOf(c.env.DB, u.planId),
    c.env.DB.prepare("SELECT id, name, monthly_price_cents, currency, limits FROM plans WHERE active = 1 ORDER BY sort_order").all<Row>(),
    getSub(c.env.DB, u.id),
    c.env.DB.prepare("SELECT id, plan_id, amount_cents, currency, status, provider, period_start, period_end, paid_at, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20").bind(u.id).all<Row>(),
    usageOf(c.env.DB, u.id),
    billingSettings(c.env.DB),
  ]);
  return c.json({
    plan: plan && { id: plan.id, name: plan.name, limits: plan.limits },
    usage,
    subscription: toSub(sub),
    plans: plans.results.map((p) => ({ id: p.id, name: p.name, priceCents: p.monthly_price_cents, currency: p.currency, limits: parseLimits(p.limits) })),
    payments: pays.results.map((p) => ({ id: p.id, planId: p.plan_id, amountCents: p.amount_cents, currency: p.currency, status: p.status, provider: p.provider, periodStart: p.period_start, periodEnd: p.period_end, paidAt: p.paid_at })),
    trialDays: settings.trialDays,
    trialAvailable: settings.trialDays > 0 && !sub?.trial_used,
    // Sem gateway: o pagamento é registrado pelo administrador depois de recebido.
    paymentMode: "manual",
  });
});

billing.post("/subscribe", async (c) => {
  const p = z.object({ planId: z.string().min(1).max(40) }).safeParse(await json(c));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const u = c.get("user");
  const plan = await planOf(c.env.DB, p.data.planId);
  if (!plan || !plan.active) return c.json({ error: "plan_not_found" }, 404);
  if (plan.id === "free") return c.json({ error: "use_cancel" }, 400);
  if (plan.priceCents == null) return c.json({ error: "price_not_set" }, 409);
  const sub = await getSub(c.env.DB, u.id);
  if (sub && ["active", "trialing", "past_due"].includes(sub.status)) return c.json({ error: "change_blocked" }, 409);
  const t = Date.now();
  const { trialDays } = await billingSettings(c.env.DB);
  const trial = trialDays > 0 && !sub?.trial_used;
  const id = sub?.id ?? crypto.randomUUID();
  const trialEnd = trial ? t + trialDays * DAY : null;
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, trial_ends_at, trial_used, current_period_start, current_period_end, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'manual', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status, trial_ends_at = excluded.trial_ends_at,
         trial_used = MAX(subscriptions.trial_used, excluded.trial_used), current_period_start = NULL, current_period_end = NULL,
         cancel_at_period_end = 0, grace_until = NULL, canceled_at = NULL, updated_at = excluded.updated_at`,
    ).bind(id, u.id, plan.id, trial ? "trialing" : "incomplete", trialEnd, trial ? 1 : 0, t, t),
    c.env.DB.prepare("UPDATE payments SET status = 'failed' WHERE user_id = ? AND status = 'pending'").bind(u.id),
    auditStmt(c.env.DB, u.id, trial ? "billing.trial_started" : "billing.subscribe_requested", plan.id),
  ];
  if (trial) stmts.push(c.env.DB.prepare("UPDATE users SET plan_id = ? WHERE id = ?").bind(plan.id, u.id));
  else
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO payments (id, user_id, subscription_id, plan_id, amount_cents, currency, status, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'manual', ?)",
      ).bind(crypto.randomUUID(), u.id, id, plan.id, plan.priceCents, plan.currency, t),
    );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, status: trial ? "trialing" : "incomplete", trialEndsAt: trialEnd, amountCents: trial ? null : plan.priceCents, currency: plan.currency }, 201);
});

billing.post("/cancel", async (c) => {
  const u = c.get("user");
  const sub = await getSub(c.env.DB, u.id);
  if (!sub || !["incomplete", "trialing", "active", "past_due"].includes(sub.status)) return c.json({ error: "no_subscription" }, 404);
  const t = Date.now();
  if (sub.status === "active") {
    await c.env.DB.batch([c.env.DB.prepare("UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?").bind(t, sub.id), auditStmt(c.env.DB, u.id, "billing.cancel_scheduled", sub.plan_id)]);
    return c.json({ ok: true, effective: "period_end", at: sub.current_period_end });
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE subscriptions SET status = 'canceled', canceled_at = ?, grace_until = NULL, updated_at = ? WHERE id = ?").bind(t, t, sub.id),
    c.env.DB.prepare("UPDATE payments SET status = 'failed' WHERE user_id = ? AND status = 'pending'").bind(u.id),
    c.env.DB.prepare("UPDATE users SET plan_id = 'free' WHERE id = ?").bind(u.id),
    auditStmt(c.env.DB, u.id, "billing.canceled", sub.plan_id),
  ]);
  return c.json({ ok: true, effective: "now" });
});

billing.post("/resume", async (c) => {
  const u = c.get("user");
  const r = await c.env.DB.prepare("UPDATE subscriptions SET cancel_at_period_end = 0, updated_at = ? WHERE user_id = ? AND status = 'active' AND cancel_at_period_end = 1").bind(Date.now(), u.id).run();
  if (r.meta.changes !== 1) return c.json({ error: "nothing_to_resume" }, 409);
  return c.json({ ok: true });
});

// ---------- Rotas do administrador ----------

export const adminBilling = new Hono<AppBindings>();
adminBilling.use("*", requireUser, requireRole("admin"));

adminBilling.get("/overview", async (c) => {
  const db = c.env.DB;
  const t = Date.now();
  const [subs, mrr, rev, months, canceled, settings, refunds] = await Promise.all([
    db.prepare("SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status").all<Row>(),
    // Receita recorrente mensal: preço de tabela dos planos das assinaturas ativas. Não inclui teste nem inadimplentes.
    db.prepare(`SELECT p.currency, SUM(p.monthly_price_cents) AS cents, COUNT(*) AS n FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                WHERE s.status = 'active' AND p.monthly_price_cents IS NOT NULL GROUP BY p.currency`).all<Row>(),
    db.prepare("SELECT currency, SUM(amount_cents) AS cents, COUNT(*) AS n FROM payments WHERE status = 'paid' AND paid_at >= ? GROUP BY currency").bind(t - 30 * DAY).all<Row>(),
    db.prepare(`SELECT strftime('%Y-%m', paid_at/1000, 'unixepoch') AS month, currency, SUM(amount_cents) AS cents FROM payments
                WHERE status = 'paid' AND paid_at >= ? GROUP BY month, currency ORDER BY month`).bind(t - 190 * DAY).all<Row>(),
    db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE canceled_at >= ?").bind(t - 30 * DAY).first<Row>(),
    billingSettings(db),
    db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'refunded' AND created_at >= ?").bind(t - 30 * DAY).first<Row>(),
  ]);
  return c.json({
    subscriptionsByStatus: Object.fromEntries(subs.results.map((r) => [r.status, r.n])),
    mrrByCurrency: mrr.results.map((r) => ({ currency: r.currency, cents: r.cents, subscriptions: r.n })),
    paidLast30dByCurrency: rev.results.map((r) => ({ currency: r.currency, cents: r.cents, payments: r.n })),
    paidByMonth: months.results.map((r) => ({ month: r.month, currency: r.currency, cents: r.cents })),
    endedLast30d: canceled?.n ?? 0,
    refundedLast30d: refunds?.n ?? 0,
    settings,
    note: "Valores registrados manualmente; não há gateway de pagamento conectado.",
  });
});

adminBilling.get("/subscriptions", async (c) => {
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, u.email FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE (?1 IS NULL OR s.status = ?1) ORDER BY s.updated_at DESC LIMIT ?2`,
  ).bind(status ?? null, limit).all<Row>();
  return c.json({ items: results.map((r) => ({ userId: r.user_id, email: r.email, ...toSub(r as Sub), provider: r.provider })) });
});

adminBilling.get("/payments", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 30) || 30, 100);
  const { results } = await c.env.DB.prepare(
    `SELECT y.id, y.user_id, u.email, y.plan_id, y.amount_cents, y.currency, y.status, y.provider, y.provider_ref, y.paid_at, y.created_at, y.note
     FROM payments y JOIN users u ON u.id = y.user_id ORDER BY y.created_at DESC LIMIT ?`,
  ).bind(limit).all<Row>();
  return c.json({ items: results.map((r) => ({ id: r.id, userId: r.user_id, email: r.email, planId: r.plan_id, amountCents: r.amount_cents, currency: r.currency, status: r.status, provider: r.provider, providerRef: r.provider_ref, paidAt: r.paid_at, createdAt: r.created_at, note: r.note })) });
});

const paymentSchema = z.object({
  userId: z.string().min(1).max(64),
  planId: z.string().min(1).max(40),
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase(),
  providerRef: z.string().trim().min(1).max(120).optional(),
  paidAt: z.number().int().positive().optional(),
  note: z.string().trim().max(300).optional(),
});

adminBilling.post("/payments", async (c) => {
  const p = paymentSchema.safeParse(await json(c));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const r = await recordPayment(c.env.DB, { ...p.data, by: uid(c) });
  if (!r.ok) return c.json({ error: r.error }, r.error.endsWith("not_found") ? 404 : 409);
  return c.json(r, r.duplicate ? 200 : 201);
});

adminBilling.post("/grant", async (c) => {
  const p = z.object({ userId: z.string().min(1).max(64), planId: z.string().min(1).max(40), months: z.number().int().min(1).max(24).default(1), note: z.string().trim().max(300).optional() }).safeParse(await json(c));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const plan = await planOf(c.env.DB, p.data.planId);
  if (!plan) return c.json({ error: "plan_not_found" }, 404);
  let last: Awaited<ReturnType<typeof recordPayment>> | undefined;
  for (let i = 0; i < p.data.months; i++) {
    last = await recordPayment(c.env.DB, { userId: p.data.userId, planId: p.data.planId, amountCents: 0, currency: plan.currency, note: p.data.note ?? "cortesia", by: uid(c), provider: "grant" });
    if (!last.ok) return c.json({ error: last.error }, last.error.endsWith("not_found") ? 404 : 409);
  }
  return c.json(last, 201);
});

adminBilling.post("/payments/:id/refund", async (c) => {
  const pay = await c.env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!pay) return c.json({ error: "not_found" }, 404);
  if (pay.status !== "paid") return c.json({ error: "not_paid" }, 409);
  const t = Date.now();
  const sub = await getSub(c.env.DB, pay.user_id);
  const stmts = [
    c.env.DB.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").bind(pay.id),
    auditStmt(c.env.DB, uid(c), "billing.refunded", pay.user_id, { paymentId: pay.id, amountCents: pay.amount_cents }),
  ];
  // Reembolso do período vigente encerra o acesso pago; de período já vencido não muda nada.
  const ends = sub && sub.status === "active" && sub.current_period_end === pay.period_end;
  if (ends) {
    stmts.push(
      c.env.DB.prepare("UPDATE subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?").bind(t, t, sub!.id),
      c.env.DB.prepare("UPDATE users SET plan_id = 'free' WHERE id = ?").bind(pay.user_id),
      notifyStmt(c.env.DB, pay.user_id, "billing.refunded", "Pagamento reembolsado", "O plano pago foi encerrado e você voltou ao plano Free.", "/billing", { refund: 1 }),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, subscriptionEnded: !!ends });
});

adminBilling.put("/settings", async (c) => {
  const p = z.object({ trialDays: z.number().int().min(0).max(90).optional(), graceDays: z.number().int().min(0).max(60).optional() }).safeParse(await json(c));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const t = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const [k, v] of Object.entries(p.data)) stmts.push(c.env.DB.prepare("INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(`billing.${k}`, String(v), t));
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env.DB, uid(c), "billing.settings_updated", undefined, p.data as Record<string, unknown>);
  return c.json({ ok: true, ...(await billingSettings(c.env.DB)) });
});


