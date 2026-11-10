import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";

let counter = 0;
type Opts = { method?: string; body?: unknown; cookie?: string };
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.8.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const r = await app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.9.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.9.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

let admin = "", editor = "", user = "", other = "", advId = "";
const profileBody = (o = {}) => ({ displayName: "U", locale: "pt-BR", country: "BR", niches: ["saas"], channels: ["blog"], hasWebsite: true, wantsRecurring: true, acceptsPaidTraffic: false, ...o });

beforeAll(async () => {
  admin = await login("boss@example.com");
  editor = await login("ed@example.com");
  user = await login("plain@example.com");
  const users = await call("/api/admin/users", { cookie: admin });
  const ed = users.body.users.find((u: any) => u.email === "ed@example.com");
  await call(`/api/admin/users/${ed.id}/role`, { method: "PATCH", body: { role: "editor" }, cookie: admin });
  advId = (await call("/api/catalog/advertisers", { method: "POST", body: { name: "Ops Corp" }, cookie: editor })).body.id;
  other = await login("other@example.com");
  await call("/api/me/profile", { method: "PUT", body: profileBody(), cookie: user });
});


const mk = async (name: string) => (await call("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name, segment: "saas" } })).body.id as string;
const source = (id: string, field: string) =>
  call(`/api/catalog/programs/${id}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_docs", field, url: `https://docs.example.com/${field}` } });
/** Programa com campos confirmados por fonte oficial (nunca direto, sempre com fonte). */
async function withFacts(name: string, facts: Record<string, string>) {
  const id = await mk(name);
  const col: Record<string, string> = { allowsRedirect: "allows_redirect", acceptsPaidTraffic: "accepts_paid_traffic" };
  for (const k of Object.keys(facts)) await source(id, col[k]!);
  const r = await call(`/api/catalog/programs/${id}`, { method: "PATCH", body: facts, cookie: editor });
  expect(r.status).toBe(200);
  return id;
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const hit = (code: string, ua = UA, ip = "203.0.113.5") =>
  app.request(`/r/${code}`, { headers: { "user-agent": ua, "cf-connecting-ip": ip } }, env);

describe("acesso e isolamento", () => {
  it("exige login", async () => {
    for (const p of ["/api/ops/programs", "/api/ops/links", "/api/ops/campaigns", "/api/ops/commissions", "/api/ops/dashboard"]) {
      expect((await call(p)).status).toBe(401);
    }
  });
  it("um usuário não enxerga nem altera dados de outro", async () => {
    const pid = await mk("Isolamento");
    const up = (await call("/api/ops/programs", { method: "POST", body: { programId: pid }, cookie: user })).body.id;
    const cm = (await call("/api/ops/commissions", { method: "POST", body: { amount: 5, currency: "USD" }, cookie: user })).body.id;
    const lk = (await call("/api/ops/links", { method: "POST", body: { label: "x", url: "https://a.example.com/p" }, cookie: user })).body.id;
    expect((await call(`/api/ops/programs/${up}`, { cookie: other })).status).toBe(404);
    expect((await call(`/api/ops/programs/${up}`, { method: "PATCH", body: { notes: "x" }, cookie: other })).status).toBe(404);
    expect((await call(`/api/ops/commissions/${cm}/status`, { method: "POST", body: { status: "pending" }, cookie: other })).status).toBe(404);
    expect((await call(`/api/ops/links/${lk}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await call("/api/ops/links", { cookie: other })).body.items).toEqual([]);
  });
});

describe("programas do afiliado", () => {
  it("salva, não duplica, registra histórico e datas sem inventar", async () => {
    const pid = await mk("Meu Programa");
    const r = await call("/api/ops/programs", { method: "POST", body: { programId: pid }, cookie: user });
    expect(r.status).toBe(201);
    expect((await call("/api/ops/programs", { method: "POST", body: { programId: pid }, cookie: user })).status).toBe(409);
    expect((await call("/api/ops/programs", { method: "POST", body: { programId: "nope" }, cookie: user })).status).toBe(404);
    const id = r.body.id;
    await call(`/api/ops/programs/${id}`, { method: "PATCH", body: { status: "application_pending", affiliateId: "AF-1", nextAction: "Esperar", nextActionAt: 9_999_999_999_999 }, cookie: user });
    const d = await call(`/api/ops/programs/${id}`, { cookie: user });
    expect(d.body.item.status).toBe("application_pending");
    expect(d.body.item.appliedAt).toBeGreaterThan(0);
    expect(d.body.item.approvedAt).toBeNull();
    expect(d.body.item.affiliateId).toBe("AF-1");
    expect(d.body.history.map((h: any) => h.to)).toEqual(["application_pending", "saved"]);
    expect(d.body.item.signupUrlStatus).toBe("unverified");
  });
  it("documentos são só referências com link http(s)", async () => {
    const pid = await mk("Docs");
    const id = (await call("/api/ops/programs", { method: "POST", body: { programId: pid }, cookie: user })).body.id;
    expect((await call(`/api/ops/programs/${id}/docs`, { method: "POST", body: { title: "Termos", url: "javascript:alert(1)" }, cookie: user })).status).toBe(400);
    const ok = await call(`/api/ops/programs/${id}/docs`, { method: "POST", body: { title: "Termos", url: "https://x.example.com/t" }, cookie: user });
    expect(ok.status).toBe(201);
    expect((await call(`/api/ops/programs/${id}`, { cookie: user })).body.docs).toHaveLength(1);
  });
  it("programa encerrado não pode ser marcado como em andamento e aparece para revisão", async () => {
    const pid = await mk("Vai Fechar");
    const id = (await call("/api/ops/programs", { method: "POST", body: { programId: pid, status: "approved" }, cookie: user })).body.id;
    await call(`/api/catalog/programs/${pid}/status`, { method: "POST", body: { lifecycleStatus: "closed" }, cookie: editor });
    const list = await call("/api/ops/programs", { cookie: user });
    const it = list.body.items.find((x: any) => x.id === id);
    expect(it.catalogStatus).toBe("closed");
    expect(it.needsReview).toBe(true);
    expect((await call(`/api/ops/programs/${id}`, { method: "PATCH", body: { status: "active" }, cookie: user })).body.error).toBe("program_not_active");
    expect((await call(`/api/ops/programs/${id}`, { method: "PATCH", body: { status: "closed" }, cookie: user })).status).toBe(200);
    expect((await call("/api/ops/programs", { method: "POST", body: { programId: pid, status: "approved" }, cookie: other })).body.error).toBe("program_not_active");
  });
});

describe("links e redirecionamento próprio", () => {
  it("só ativa rastreamento próprio se o programa confirmou permitir redirecionamento", async () => {
    const unknown = await mk("Redirect Desconhecido");
    const body = { label: "L", url: "https://a.example.com/x?aff=1&sub=2", programId: unknown, trackingMode: "own_redirect" };
    expect((await call("/api/ops/links", { method: "POST", body, cookie: user })).body.error).toBe("redirect_not_allowed");
    expect((await call("/api/ops/links", { method: "POST", body: { ...body, programId: undefined }, cookie: user })).body.error).toBe("redirect_needs_program");
    const no = await withFacts("Proíbe", { allowsRedirect: "no" });
    expect((await call("/api/ops/links", { method: "POST", body: { ...body, programId: no }, cookie: user })).status).toBe(409);
    // Link simples (sem rastreamento próprio) é sempre permitido: é só um registro.
    expect((await call("/api/ops/links", { method: "POST", body: { ...body, trackingMode: "none" }, cookie: user })).status).toBe(201);
  });
  it("redireciona para a URL exata, conta cliques humanos e ignora robôs e repetidos", async () => {
    const pid = await withFacts("Permite", { allowsRedirect: "yes" });
    const url = "https://a.example.com/x?aff=ABC&sub=2#frag";
    const c = await call("/api/ops/links", { method: "POST", body: { label: "R", url, programId: pid, trackingMode: "own_redirect", channel: "blog" }, cookie: user });
    expect(c.status).toBe(201);
    const code = c.body.code;
    const r1 = await hit(code);
    expect(r1.status).toBe(302);
    expect(r1.headers.get("location")).toBe(url);
    await hit(code); // mesmo visitante em 30 min: não conta de novo
    await hit(code, "Googlebot/2.1 (+http://www.google.com/bot.html)", "198.51.100.1");
    await hit(code, "", "198.51.100.2");
    await hit(code, UA, "203.0.113.99"); // outro visitante
    const links = await call("/api/ops/links", { cookie: user });
    const l = links.body.items.find((x: any) => x.code === code);
    expect(l.clicks).toBe(2);
    expect(l.trackUrl).toContain(`/r/${code}`);
    expect(l.redirectAllowed).toBe(true);
    // Programa encerrado: o link deixa de redirecionar.
    await call(`/api/catalog/programs/${pid}/status`, { method: "POST", body: { lifecycleStatus: "closed" }, cookie: editor });
    expect((await hit(code, UA, "203.0.113.7")).status).toBe(410);
    expect((await hit("inexistente")).status).toBe(404);
  });
  it("link desativado não redireciona", async () => {
    const pid = await withFacts("Permite 2", { allowsRedirect: "yes" });
    const c = await call("/api/ops/links", { method: "POST", body: { label: "R", url: "https://a.example.com/y", programId: pid, trackingMode: "own_redirect" }, cookie: user });
    await call(`/api/ops/links/${c.body.id}`, { method: "PATCH", body: { active: false }, cookie: user });
    expect((await hit(c.body.code)).status).toBe(410);
  });
});

describe("campanhas e tráfego pago", () => {
  const camp = (programId: string | null, channel: string) =>
    call("/api/ops/campaigns", { method: "POST", cookie: user, body: { name: "C", channel, programId, budget: 100, currency: "USD" } });
  it("bloqueia tráfego pago sem permissão confirmada ou proibido; orgânico e permitido passam", async () => {
    const unknown = await mk("Pago Desconhecido");
    const no = await withFacts("Pago Proibido", { acceptsPaidTraffic: "no" });
    const yes = await withFacts("Pago Permitido", { acceptsPaidTraffic: "yes" });
    expect((await camp(unknown, "google_ads")).body.error).toBe("paid_traffic_not_confirmed");
    expect((await camp(no, "meta_ads")).body.error).toBe("paid_traffic_forbidden");
    expect((await camp(yes, "google_ads")).status).toBe(201);
    expect((await camp(unknown, "seo")).status).toBe(201);
    expect((await camp(null, "google_ads")).status).toBe(201);
  });
  it("política 'warn' avisa mas não bloqueia quando não confirmado (proibido segue bloqueado)", async () => {
    const cfg = await call("/api/intel/config", { cookie: admin });
    const cur = cfg.body.config;
    const put = await call("/api/intel/admin/scoring", { method: "PUT", body: { ...cur, paidTrafficPolicy: "warn" }, cookie: admin });
    expect(put.status).toBe(200);
    try {
      const unknown = await mk("Pago Aviso");
      const r = await camp(unknown, "tiktok_ads");
      expect(r.status).toBe(201);
      expect(r.body.warnings).toContain("paid_traffic_not_confirmed");
      const no = await withFacts("Pago Proibido 2", { acceptsPaidTraffic: "no" });
      expect((await camp(no, "tiktok_ads")).status).toBe(409);
    } finally {
      await call("/api/intel/admin/scoring", { method: "PUT", body: { ...cur, paidTrafficPolicy: "block" }, cookie: admin });
    }
  });
  it("edita campanha reavaliando a regra", async () => {
    const unknown = await mk("Pago Edit");
    const id = (await camp(unknown, "seo")).body.id;
    expect((await call(`/api/ops/campaigns/${id}`, { method: "PATCH", body: { channel: "linkedin_ads" }, cookie: user })).status).toBe(409);
    expect((await call(`/api/ops/campaigns/${id}`, { method: "PATCH", body: { keyword: "k", clicksReported: 10 }, cookie: user })).status).toBe(200);
    const list = await call("/api/ops/campaigns", { cookie: user });
    expect(list.body.items.find((c: any) => c.id === id).clicksReported).toBe(10);
  });
});

describe("comissões", () => {
  const mkc = async (extra = {}) => (await call("/api/ops/commissions", { method: "POST", cookie: user, body: { amount: 100, currency: "USD", externalRef: `R-${Math.random()}`, ...extra } })).body.id as string;
  const st = (id: string, status: string) => call(`/api/ops/commissions/${id}/status`, { method: "POST", body: { status }, cookie: user });
  it("nasce estimada e reportada; não pode nascer confirmada nem paga", async () => {
    const id = await mkc();
    const c = (await call("/api/ops/commissions", { cookie: user })).body.items.find((x: any) => x.id === id);
    expect(c.status).toBe("estimated");
    expect(c.conversionState).toBe("reported");
    expect(c.origin).toBe("manual");
    const bad = await call("/api/ops/commissions", { method: "POST", cookie: user, body: { amount: 1, currency: "USD", conversionState: "confirmed" } });
    expect(bad.body.error).toBe("confirmation_requires_network_report");
    const paid = await call("/api/ops/commissions", { method: "POST", cookie: user, body: { amount: 1, currency: "USD", status: "paid" } });
    expect(paid.status).toBe(201); // campo desconhecido é ignorado: continua estimada
    const p = (await call("/api/ops/commissions", { cookie: user })).body.items.find((x: any) => x.id === paid.body.id);
    expect(p.status).toBe("estimated");
  });
  it("segue o ciclo estimada → pendente → aprovada → paga e trava a paga", async () => {
    const id = await mkc();
    expect((await st(id, "paid")).status).toBe(409);
    expect((await st(id, "pending")).status).toBe(200);
    expect((await st(id, "paid")).status).toBe(409);
    expect((await st(id, "approved")).status).toBe(200);
    expect((await st(id, "paid")).status).toBe(200);
    expect((await st(id, "rejected")).status).toBe(409);
    expect((await call(`/api/ops/commissions/${id}`, { method: "PATCH", body: { amount: 1 }, cookie: user })).body.error).toBe("commission_paid_locked");
    const c = (await call("/api/ops/commissions", { cookie: user })).body.items.find((x: any) => x.id === id);
    expect(c.approvedAt).toBeGreaterThan(0);
    expect(c.paidAt).toBeGreaterThan(0);
  });
  it("reembolso, cancelamento e chargeback descontam do valor líquido", async () => {
    const id = await mkc();
    await call(`/api/ops/commissions/${id}/adjustments`, { method: "POST", body: { kind: "refund", amount: 30 }, cookie: user });
    await call(`/api/ops/commissions/${id}/adjustments`, { method: "POST", body: { kind: "chargeback", amount: -10 }, cookie: user });
    await call(`/api/ops/commissions/${id}/adjustments`, { method: "POST", body: { kind: "adjustment", amount: 5 }, cookie: user });
    const c = (await call("/api/ops/commissions", { cookie: user })).body.items.find((x: any) => x.id === id);
    expect(c.amount).toBe(100);
    expect(c.netAmount).toBe(65);
  });
  it("valida vínculos: link e campanha de outro usuário são recusados", async () => {
    const lk = (await call("/api/ops/links", { method: "POST", body: { label: "o", url: "https://a.example.com/o" }, cookie: other })).body.id;
    const r = await call("/api/ops/commissions", { method: "POST", cookie: user, body: { amount: 1, currency: "USD", linkId: lk } });
    expect(r.status).toBe(404);
  });
});

describe("importação de relatório e conciliação", () => {
  let pid = "";
  beforeAll(async () => {
    pid = await mk("Rede X");
  });
  const imp = (csv: string, dryRun = false, programId = pid) =>
    call("/api/ops/commissions/import", { method: "POST", cookie: user, body: { programId, csv, dryRun } });
  const csv1 = "external_ref,amount,currency,status,date,product\nA1,10.50,USD,approved,2026-05-01,Plano\nA2,20,USD,pending,2026-05-02,Plano\nA3,5,usd,algo novo,,\nA1,9,USD,approved,,\n,5,USD,pending,,\nA4,abc,USD,pending,,\nA5,5,,pending,,";

  it("simulação não grava; importação valida linha a linha e marca como confirmada pela rede", async () => {
    const dry = await imp(csv1, true);
    expect(dry.body.created).toBe(3);
    expect((await call(`/api/ops/commissions?programId=${pid}`, { cookie: user })).body.items).toHaveLength(0);
    const r = await imp(csv1);
    expect(r.body.created).toBe(3);
    expect(r.body.errors.map((e: any) => e.error)).toEqual(["duplicate_in_file", "external_ref_required", "invalid_amount", "currency_required"]);
    const items = (await call(`/api/ops/commissions?programId=${pid}`, { cookie: user })).body.items;
    expect(items).toHaveLength(3);
    expect(items.every((i: any) => i.origin === "csv" && i.conversionState === "confirmed")).toBe(true);
    // Status desconhecido nunca vira aprovado.
    expect(items.find((i: any) => i.externalRef === "A3").status).toBe("pending");
    expect(items.find((i: any) => i.externalRef === "A1").status).toBe("approved");
  });
  it("reimportar atualiza o que mudou e não duplica", async () => {
    const again = await imp("external_ref,amount,currency,status\nA1,10.50,USD,paid\nA2,20,USD,pending\nA9,1,USD,pending");
    expect(again.body).toMatchObject({ created: 1, updated: 1, unchanged: 1 });
    const items = (await call(`/api/ops/commissions?programId=${pid}`, { cookie: user })).body.items;
    expect(items.filter((i: any) => i.externalRef === "A1")).toHaveLength(1);
    expect(items.find((i: any) => i.externalRef === "A1").paidAt).toBeGreaterThan(0);
  });
  it("registro da rede não é editável à mão; faltando colunas e excesso de linhas são recusados", async () => {
    const id = (await call(`/api/ops/commissions?programId=${pid}`, { cookie: user })).body.items[0].id;
    expect((await call(`/api/ops/commissions/${id}`, { method: "PATCH", body: { notes: "x" }, cookie: user })).body.error).toBe("network_record_locked");
    expect((await imp("a,b\n1,2")).body.error).toBe("missing_columns");
    const big = "external_ref,amount,currency\n" + Array.from({ length: 201 }, (_, i) => `Z${i},1,USD`).join("\n");
    expect((await imp(big)).status).toBe(413);
  });
  it("concilia registros próprios com o relatório da rede", async () => {
    const mine = (ref: string | null, amount: number) =>
      call("/api/ops/commissions", { method: "POST", cookie: user, body: { programId: pid, amount, currency: "USD", externalRef: ref } });
    await mine("A2", 20); // igual ao relatório
    await mine("A9", 7); // valor diferente (relatório: 1)
    await mine("ZZ", 3); // rede não listou
    await mine(null, 4); // sem referência
    const r = await call(`/api/ops/reconciliation?programId=${pid}`, { cookie: user });
    expect(r.body.counts).toMatchObject({ amountDiff: 1, missingInReport: 1, unreferenced: 1 });
    expect(r.body.counts.statusDiff + r.body.counts.matched).toBe(1); // A2: estimada (própria) x pendente (rede)
    expect(r.body.missingInOwn.length).toBeGreaterThanOrEqual(2); // A1 e A3 só na rede
    expect((await call("/api/ops/reconciliation", { cookie: user })).status).toBe(400);
  });
});

describe("painel pessoal", () => {
  it("separa origens e moedas, e não trata clique como venda nem estimada como aprovada", async () => {
    const dashUser = await login("dash@example.com");
    const c = (path: string, body: unknown) => call(path, { method: "POST", body, cookie: dashUser });
    const pid = await withFacts("Dash Programa", { allowsRedirect: "yes" });
    await c("/api/ops/programs", { programId: pid, status: "application_pending" });
    const mk2 = async (amount: number, currency: string, status?: string) => {
      const id = (await c("/api/ops/commissions", { amount, currency, productName: "Plano A", channel: "blog" })).body.id;
      if (status) {
        for (const s of status === "paid" ? ["approved", "paid"] : [status]) await c(`/api/ops/commissions/${id}/status`, { status: s });
      }
    };
    await mk2(100, "USD");
    await mk2(50, "USD", "approved");
    await mk2(40, "BRL", "paid");
    const link = (await c("/api/ops/links", { label: "R", url: "https://a.example.com/d", programId: pid, trackingMode: "own_redirect", channel: "blog", productName: "Plano A" })).body;
    await hit(link.code, UA, "203.0.113.50");
    await c("/api/ops/campaigns", { name: "Camp", channel: "seo", clicksReported: 300, conversionsReported: 9 });
    const d = (await call("/api/ops/dashboard", { cookie: dashUser })).body;
    expect(d.programs.pendingApplications).toBe(1);
    expect(d.programs.saved).toBe(1);
    expect(d.commissionsByCurrency.USD).toMatchObject({ estimated: 100, approved: 50, paid: 0 });
    expect(d.commissionsByCurrency.BRL).toMatchObject({ paid: 40, approved: 0 });
    expect(d.clicks.ownTracking).toBe(1);
    expect(d.clicks.manualReported).toBe(300);
    expect(d.conversions.confirmedByNetwork).toBe(0);
    expect(d.conversions.reportedByUser).toBe(3);
    expect(d.commissionsByOrigin).toEqual({ manual: 3 });
    expect(d.productsPromoted).toBe(1);
    expect(d.linksRegistered).toBe(1);
    expect(d.byChannel.find((x: any) => x.name === "blog" && x.currency === "USD")).toMatchObject({ estimated: 100, approved: 50 });
  });
});

describe("privacidade", () => {
  it("exporta os dados operacionais e a exclusão da conta apaga tudo", async () => {
    const tmp = await login("gone@example.com");
    const pid = await withFacts("Gone Programa", { allowsRedirect: "yes" });
    const c = (path: string, body: unknown) => call(path, { method: "POST", body, cookie: tmp });
    await c("/api/ops/programs", { programId: pid });
    await c("/api/ops/commissions", { amount: 1, currency: "USD" });
    const lk = (await c("/api/ops/links", { label: "R", url: "https://a.example.com/g", programId: pid, trackingMode: "own_redirect" })).body;
    await hit(lk.code, UA, "203.0.113.77");
    const ex = (await call("/api/me/export", { cookie: tmp })).body;
    expect(ex.programs).toHaveLength(1);
    expect(ex.commissions).toHaveLength(1);
    expect(ex.links).toHaveLength(1);
    expect(ex.linkClicks).toHaveLength(1);
    // O clique guarda só um hash diário; nunca o IP.
    expect(JSON.stringify(ex.linkClicks)).not.toContain("203.0.113.77");
    expect((await call("/api/me", { method: "DELETE", cookie: tmp })).status).toBe(200);
    for (const t of ["user_programs", "commissions", "affiliate_links", "link_clicks"]) {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = (SELECT id FROM users WHERE email = 'gone@example.com')`).first<{ n: number }>();
      expect(n!.n).toBe(0);
    }
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM affiliate_links WHERE code = ?").bind(lk.code).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});
