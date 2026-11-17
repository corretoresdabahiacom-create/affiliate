import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { runBilling } from "../src/billing";

let counter = 0;
type Opts = { method?: string; body?: unknown; cookie?: string };
async function raw(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.30.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  return app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
}
async function call(path: string, o: Opts = {}) {
  const r = await raw(path, o);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.31.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.31.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

const DAY = 86_400_000;
let admin = "", ana = "", bob = "", cleo = "", dan = "";
const ids = {} as Record<string, string>;

beforeAll(async () => {
  admin = await login("boss@example.com");
  // o primeiro usuário vira admin via ADMIN_EMAILS nos testes? garante pelo painel
  ana = await login("ana-b@example.com");
  bob = await login("bob-b@example.com");
  cleo = await login("cleo-b@example.com");
  dan = await login("dan-b@example.com");
  const users = (await call("/api/admin/users?limit=200", { cookie: admin })).body.users as any[];
  for (const u of users) ids[u.email.split("-")[0]] = u.id;
});

const setPlan = (id: string, body: unknown) => call(`/api/admin/plans/${id}`, { method: "PUT", cookie: admin, body });
const pay = (userId: string, extra: Record<string, unknown> = {}) =>
  call("/api/admin/billing/payments", { method: "POST", cookie: admin, body: { userId, planId: "pro", amountCents: 4900, currency: "USD", ...extra } });

describe("limites por plano", () => {
  it("o plano Free bloqueia além do limite e o administrador edita o limite", async () => {
    await setPlan("free", { limits: { links: 2, savedPrograms: 15, campaigns: 3, aiRequestsMonthly: 20, reports: 0 } });
    const mk = () => call("/api/ops/links", { method: "POST", cookie: ana, body: { label: "L", url: "https://a.example.com/x" } });
    expect((await mk()).status).toBe(201);
    expect((await mk()).status).toBe(201);
    const third = await mk();
    expect(third.status).toBe(402);
    expect(third.body).toMatchObject({ error: "plan_limit", key: "links", limit: 2, used: 2, planId: "free" });
    // Outro usuário tem a própria contagem.
    expect((await call("/api/ops/links", { method: "POST", cookie: bob, body: { label: "L", url: "https://a.example.com/x" } })).status).toBe(201);
    await setPlan("free", { limits: { links: 3, savedPrograms: 15, campaigns: 3, aiRequestsMonthly: 20, reports: 0 } });
    expect((await mk()).status).toBe(201);
  });
  it("limite 0 desliga o recurso e chave ausente é ilimitada", async () => {
    await setPlan("free", { limits: { campaigns: 0 } });
    const r = await call("/api/ops/campaigns", { method: "POST", cookie: ana, body: { name: "C", channel: "blog" } });
    expect(r.status).toBe(402);
    // links sem chave: ilimitado
    for (let i = 0; i < 5; i++) expect((await call("/api/ops/links", { method: "POST", cookie: bob, body: { label: "L", url: "https://a.example.com/x" } })).status).toBe(201);
    await setPlan("free", { limits: { savedPrograms: 15, links: 10, campaigns: 3, aiRequestsMonthly: 20, reports: 0 } });
  });
  it("o administrador não tem limite", async () => {
    await setPlan("free", { limits: { campaigns: 0 } });
    expect((await call("/api/ops/campaigns", { method: "POST", cookie: admin, body: { name: "C", channel: "blog" } })).status).toBe(201);
    await setPlan("free", { limits: { savedPrograms: 15, links: 10, campaigns: 3, aiRequestsMonthly: 20, reports: 0 } });
  });
});

describe("assinatura e pagamento", () => {
  it("sem preço configurado não há assinatura; o preço vem do administrador", async () => {
    await setPlan("pro", { monthlyPriceCents: null });
    expect((await call("/api/billing/subscribe", { method: "POST", cookie: ana, body: { planId: "pro" } })).body.error).toBe("price_not_set");
    expect((await call("/api/billing/subscribe", { method: "POST", cookie: ana, body: { planId: "free" } })).body.error).toBe("use_cancel");
    expect((await call("/api/billing/subscribe", { method: "POST", cookie: ana, body: { planId: "nope" } })).status).toBe(404);
    await setPlan("pro", { monthlyPriceCents: 4900, currency: "USD" });
  });
  it("assinar sem teste cria pendência e não muda o plano até o pagamento ser registrado", async () => {
    const s = await call("/api/billing/subscribe", { method: "POST", cookie: ana, body: { planId: "pro" } });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ status: "incomplete", amountCents: 4900, currency: "USD" });
    const b = (await call("/api/billing", { cookie: ana })).body;
    expect(b.plan.id).toBe("free");
    expect(b.subscription.status).toBe("incomplete");
    expect(b.payments[0]).toMatchObject({ status: "pending", amountCents: 4900 });
    expect(b.paymentMode).toBe("manual");
  });
  it("o pagamento registrado ativa o plano por um mês e é idempotente", async () => {
    const t = Date.UTC(2026, 0, 31, 12);
    const r = await pay(ids.ana!, { providerRef: "PIX-1", paidAt: t });
    expect(r.status).toBe(201);
    expect(new Date(r.body.periodEnd).toISOString().slice(0, 10)).toBe("2026-02-28");
    const again = await pay(ids.ana!, { providerRef: "PIX-1", paidAt: t });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    const b = (await call("/api/billing", { cookie: ana })).body;
    expect(b.plan.id).toBe("pro");
    expect(b.subscription.status).toBe("active");
    expect(b.payments.filter((p: any) => p.status === "paid")).toHaveLength(1);
    expect(b.payments.some((p: any) => p.status === "pending")).toBe(false); // pendência foi quitada/encerrada
  });
  it("rejeita moeda diferente da do plano, plano free e usuário inexistente", async () => {
    expect((await pay(ids.bob!, { currency: "BRL" })).body.error).toBe("currency_mismatch");
    expect((await pay(ids.bob!, { planId: "free" })).body.error).toBe("plan_is_free");
    expect((await pay("nao-existe")).status).toBe(404);
  });
  it("só o administrador mexe em pagamentos e receita", async () => {
    expect((await call("/api/admin/billing/payments", { method: "POST", cookie: ana, body: {} })).status).toBe(403);
    expect((await call("/api/admin/billing/overview", { cookie: ana })).status).toBe(403);
    expect((await call("/api/billing")).status).toBe(401);
  });
  it("o ciclo: vence, fica inadimplente com carência, expira para Free; novo pagamento restaura", async () => {
    const sub = await env.DB.prepare("SELECT current_period_end AS e FROM subscriptions WHERE user_id = ?").bind(ids.ana!).first<{ e: number }>();
    const end = sub!.e;
    expect(await runBilling(env, end - 1)).toMatchObject({ pastDue: 0 });
    expect((await runBilling(env, end + 1000)).pastDue).toBe(1);
    let b = (await call("/api/billing", { cookie: ana })).body;
    expect(b.subscription.status).toBe("past_due");
    expect(b.plan.id).toBe("pro"); // durante a carência o acesso continua
    expect(b.subscription.graceUntil).toBe(end + 1000 + 7 * DAY);
    // uma segunda passagem não repete a mudança
    expect((await runBilling(env, end + 2000)).pastDue).toBe(0);
    const out = await runBilling(env, end + 1000 + 8 * DAY);
    expect(out.expired).toBe(1);
    b = (await call("/api/billing", { cookie: ana })).body;
    expect(b.subscription.status).toBe("expired");
    expect(b.plan.id).toBe("free");
    const notes = (await call("/api/automation/notifications", { cookie: ana })).body.items.map((n: any) => n.kind);
    expect(notes).toEqual(expect.arrayContaining(["billing.paid", "billing.past_due", "billing.expired"]));
    // volta a pagar
    expect((await pay(ids.ana!, { providerRef: "PIX-2" })).status).toBe(201);
    expect((await call("/api/billing", { cookie: ana })).body.plan.id).toBe("pro");
  });
  it("cancelar ativa agenda o fim do período; retomar desfaz", async () => {
    await pay(ids.bob!, { providerRef: "B-1", paidAt: Date.UTC(2026, 0, 10) });
    expect((await call("/api/billing/cancel", { method: "POST", cookie: bob })).body.effective).toBe("period_end");
    expect((await call("/api/billing", { cookie: bob })).body.subscription.cancelAtPeriodEnd).toBe(true);
    expect((await call("/api/billing/resume", { method: "POST", cookie: bob })).status).toBe(200);
    expect((await call("/api/billing/resume", { method: "POST", cookie: bob })).status).toBe(409);
    await call("/api/billing/cancel", { method: "POST", cookie: bob });
    const e = (await env.DB.prepare("SELECT current_period_end AS e FROM subscriptions WHERE user_id = ?").bind(ids.bob!).first<{ e: number }>())!.e;
    expect((await runBilling(env, e + 1)).canceled).toBe(1);
    const b = (await call("/api/billing", { cookie: bob })).body;
    expect(b.subscription.status).toBe("canceled");
    expect(b.plan.id).toBe("free");
  });
  it("teste gratuito: uma vez por usuário, expira sem pagamento", async () => {
    expect((await call("/api/admin/billing/settings", { method: "PUT", cookie: admin, body: { trialDays: 3 } })).body.trialDays).toBe(3);
    const s = await call("/api/billing/subscribe", { method: "POST", cookie: cleo, body: { planId: "pro" } });
    expect(s.body.status).toBe("trialing");
    expect((await call("/api/billing", { cookie: cleo })).body.plan.id).toBe("pro");
    expect((await call("/api/billing/subscribe", { method: "POST", cookie: cleo, body: { planId: "pro" } })).body.error).toBe("change_blocked");
    expect((await runBilling(env, Date.now() + 2 * DAY)).trialEnded).toBe(0);
    expect((await runBilling(env, Date.now() + 4 * DAY)).trialEnded).toBe(1);
    const b = (await call("/api/billing", { cookie: cleo })).body;
    expect(b.plan.id).toBe("free");
    expect(b.trialAvailable).toBe(false);
    const again = await call("/api/billing/subscribe", { method: "POST", cookie: cleo, body: { planId: "pro" } });
    expect(again.body.status).toBe("incomplete"); // sem segundo teste
    await call("/api/admin/billing/settings", { method: "PUT", cookie: admin, body: { trialDays: 0 } });
  });
  it("reembolso do período vigente encerra o acesso pago", async () => {
    await pay(ids.dan!, { providerRef: "D-1" });
    const pid = (await call("/api/billing", { cookie: dan })).body.payments[0].id;
    const r = await call(`/api/admin/billing/payments/${pid}/refund`, { method: "POST", cookie: admin });
    expect(r.body).toMatchObject({ ok: true, subscriptionEnded: true });
    expect((await call("/api/billing", { cookie: dan })).body.plan.id).toBe("free");
    expect((await call(`/api/admin/billing/payments/${pid}/refund`, { method: "POST", cookie: admin })).status).toBe(409);
  });
  it("cortesia dá o plano sem valor e aparece como tal; visão de receita separa moedas", async () => {
    expect((await call("/api/admin/billing/grant", { method: "POST", cookie: admin, body: { userId: ids.dan!, planId: "pro", months: 2 } })).status).toBe(201);
    expect((await call("/api/billing", { cookie: dan })).body.plan.id).toBe("pro");
    const o = (await call("/api/admin/billing/overview", { cookie: admin })).body;
    expect(o.subscriptionsByStatus.active).toBeGreaterThanOrEqual(2);
    expect(o.mrrByCurrency[0].currency).toBe("USD");
    expect(o.note).toMatch(/manual/i);
    const subs = (await call("/api/admin/billing/subscriptions?status=active", { cookie: admin })).body.items;
    expect(subs.find((s: any) => s.email === "dan-b@example.com").provider).toBe("grant");
  });
});

describe("rentabilidade", () => {
  it("ROI realizado exclui pendente/estimada, moedas não se misturam e sem base é null", async () => {
    const cid = (await call("/api/ops/campaigns", { method: "POST", cookie: dan, body: { name: "Ads", channel: "blog", adSpend: 100, currency: "BRL" } })).body.id;
    const idle = (await call("/api/ops/campaigns", { method: "POST", cookie: dan, body: { name: "Sem custo", channel: "blog", currency: "BRL" } })).body.id;
    const mk = async (amount: number, currency: string, status: string, campaignId = cid, confirmed = false) => {
      const id = (await call("/api/ops/commissions", { method: "POST", cookie: dan, body: { amount, currency, campaignId, conversionState: confirmed ? "confirmed" : "reported" } })).body.id;
      if (status !== "estimated") await call(`/api/ops/commissions/${id}/status`, { method: "POST", cookie: dan, body: { status } });
      return id;
    };
    await mk(150, "BRL", "approved");
    await mk(50, "BRL", "pending");
    await mk(10, "USD", "approved");
    await mk(40, "BRL", "estimated", idle);
    // 20 cliques próprios na campanha com custo (inserção direta: o redirecionamento é testado em ops.test)
    const link = (await call("/api/ops/links", { method: "POST", cookie: admin, body: { label: "x", url: "https://a.example.com/x", campaignId: undefined } }));
    expect(link.status).toBe(201);
    const l = (await call("/api/ops/links", { method: "POST", cookie: dan, body: { label: "k", url: "https://a.example.com/k", campaignId: cid } })).body.id;
    const now = Date.now();
    await env.DB.batch(Array.from({ length: 20 }, (_, i) => env.DB.prepare("INSERT INTO link_clicks (id, link_id, user_id, at, visitor_hash) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), l, ids.dan!, now - 1000 - i, `h${i}`)));

    const r = (await call("/api/analytics/profitability", { cookie: dan })).body;
    const a = r.campaigns.find((x: any) => x.id === cid);
    expect(a.realized).toBe(150);
    expect(a.projected).toBe(200);
    expect(a.roiRealized).toBe(0.5);
    expect(a.roiProjected).toBe(1);
    expect(a.otherCurrencies).toEqual(["USD"]);
    expect(a.clicksOwnTracking).toBe(20);
    expect(a.epcRealized).toBe(7.5);
    const b = r.campaigns.find((x: any) => x.id === idle);
    expect(b.roiRealized).toBeNull();
    expect(b.epcRealized).toBeNull();
    expect(b.projected).toBe(40);
    const brl = r.totalsByCurrency.find((x: any) => x.currency === "BRL");
    const usd = r.totalsByCurrency.find((x: any) => x.currency === "USD");
    expect(brl).toMatchObject({ spend: 100, realized: 150, projected: 240 });
    expect(usd.roiRealized).toBeNull(); // sem custo em USD
    // outro usuário não vê nada disso
    expect((await call("/api/analytics/profitability", { cookie: ana })).body.campaigns).toEqual([]);
    expect((await call("/api/analytics/profitability?from=10&to=5", { cookie: dan })).status).toBe(400);
  });
  it("estornos entram líquidos no resultado", async () => {
    const cid = (await call("/api/ops/campaigns", { method: "POST", cookie: dan, body: { name: "Estorno", channel: "blog", adSpend: 100, currency: "BRL" } })).body.id;
    const id = (await call("/api/ops/commissions", { method: "POST", cookie: dan, body: { amount: 200, currency: "BRL", campaignId: cid } })).body.id;
    await call(`/api/ops/commissions/${id}/status`, { method: "POST", cookie: dan, body: { status: "approved" } });
    await call(`/api/ops/commissions/${id}/adjustments`, { method: "POST", cookie: dan, body: { kind: "refund", amount: 50 } });
    const a = (await call("/api/analytics/profitability", { cookie: dan })).body.campaigns.find((x: any) => x.id === cid);
    expect(a.realized).toBe(150);
  });
});

describe("relatórios", () => {
  it("exigem recurso do plano e exportam CSV seguro", async () => {
    // dan está no plano pro (cortesia) com reports=1; ana está em pro também, cleo em free (reports=0)
    expect((await call("/api/analytics/report", { cookie: cleo })).status).toBe(402);
    const r = await call("/api/analytics/report?groupBy=month", { cookie: dan });
    expect(r.status).toBe(200);
    expect(r.body.commissions.length).toBeGreaterThan(0);
    expect(r.body.aging.every((x: any) => ["estimated", "pending"].includes(x.status))).toBe(true);
    await call("/api/ops/commissions", { method: "POST", cookie: dan, body: { amount: 1, currency: "BRL", productName: "=CMD()" } });
    const prog = await raw("/api/analytics/report?format=csv&section=programs", { cookie: dan });
    expect(prog.status).toBe(200);
    expect(prog.headers.get("content-type")).toContain("text/csv");
    const series = await (await raw("/api/analytics/report?format=csv", { cookie: dan })).text();
    expect(series.split("\r\n")[0]).toBe("period,metric,status,currency,value");
    expect((await call("/api/analytics/report?groupBy=year", { cookie: dan })).status).toBe(400);
  });
});

describe("exportação LGPD", () => {
  it("inclui assinatura e pagamentos do próprio usuário", async () => {
    const x = (await call("/api/me/export", { cookie: dan })).body;
    expect(x.subscription.plan_id).toBe("pro");
    expect(x.payments.length).toBeGreaterThan(0);
    expect(JSON.stringify(x)).not.toContain("ana-b@example.com");
  });
});
