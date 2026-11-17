import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signPayload } from "@ai/shared";
import { app } from "../src/app";
import { emit, notify, processDeliveries, runAlertsPass, runMonitor } from "../src/automation";
import { runScheduled } from "../src/index";

let counter = 0;
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.41.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.41.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}
const KEY = btoa("0123456789abcdef0123456789abcdef");
const menv = { ...env, CREDENTIALS_KEY: KEY, APP_URL: "https://app.example.com", CLICK_SALT: "salt-xyz", RESEND_API_KEY: "re_test", EMAIL_FROM: "x@example.com", AI: { run: async () => ({ response: "" }) } } as any;
type O = { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; csrf?: boolean };
const callE = async (path: string, o: O = {}) => {
  const res = await app.request(path, {
    method: o.method ?? "GET",
    headers: { "content-type": "application/json", ...(o.csrf === false ? {} : { "x-requested-with": "fetch" }), ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: "manual",
  } as any, menv);
  return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
};

type Hit = { url: string; init?: RequestInit };
let hits: Hit[] = [];
let hookStatus = 200;
let pages: Record<string, { status: number; body: string }> = {};
let mailOk = true;
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const u = new URL(String(input));
    hits.push({ url: String(input), init });
    if (u.hostname === "hook.example.com") return new Response("{}", { status: hookStatus });
    if (u.hostname === "api.resend.com") return new Response("{}", { status: mailOk ? 200 : 500 });
    if (u.hostname === "docs.example.com") { const p = pages[u.pathname] ?? { status: 404, body: "" }; return new Response(p.body, { status: p.status }); }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });
const hookHits = () => hits.filter((h) => h.url.startsWith("https://hook.example.com"));
const mails = () => hits.filter((h) => h.url.includes("api.resend.com"));

let admin = "", editor = "", me = "", other = "", meId = "", otherId = "";
let advId = "";
beforeAll(async () => {
  admin = await login("boss@example.com");
  editor = await login("ed@example.com");
  me = await login("auto@example.com");
  other = await login("auto-other@example.com");
  const users = await callE("/api/admin/users", { cookie: admin });
  const ed = users.body.users.find((u: any) => u.email === "ed@example.com");
  await callE(`/api/admin/users/${ed.id}/role`, { method: "PATCH", body: { role: "editor" }, cookie: admin });
  meId = (await callE("/api/me", { cookie: me })).body.user.id;
  otherId = (await callE("/api/me", { cookie: other })).body.user.id;
  advId = (await callE("/api/catalog/advertisers", { method: "POST", body: { name: "Auto Corp" }, cookie: editor })).body.id;
});

describe("webhooks de saída", () => {
  let ep = "";
  let secret = "";
  it("cria com segredo mostrado uma vez e recusa endereços inseguros", async () => {
    for (const url of ["http://hook.example.com/a", "https://localhost/a", "https://10.0.0.1/a", "https://intranet/a"])
      expect((await callE("/api/automation/webhooks", { method: "POST", cookie: me, body: { label: "x", url, events: ["order.new"] } })).status).toBe(422);
    expect((await callE("/api/automation/webhooks", { method: "POST", cookie: me, body: { label: "x", url: "https://hook.example.com/a", events: [] } })).status).toBe(400);
    const r = await callE("/api/automation/webhooks", { method: "POST", cookie: me, body: { label: "n8n", url: "https://hook.example.com/a", events: ["order.new", "test.ping"] } });
    expect(r.status).toBe(201);
    ep = r.body.item.id; secret = r.body.secret;
    expect(secret).toMatch(/^whsec_/);
    const list = await callE("/api/automation/webhooks", { cookie: me });
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(JSON.stringify(list.body)).not.toContain("secret");
    const row = await env.DB.prepare("SELECT secret_enc FROM webhook_endpoints WHERE id = ?").bind(ep).first<any>();
    expect(row.secret_enc).not.toContain(secret);
  });

  it("entrega assinado, só dos eventos assinados, e só para o dono", async () => {
    hits = [];
    await emit(menv, meId, "listing.published", { x: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries").first<any>()).toEqual({ n: 0 });
    await emit(menv, otherId, "order.new", { x: 1 });
    expect(await emit(menv, meId, "order.new", { orderSn: "S1", total: 10 })).toBe(1);
    expect(await processDeliveries(menv)).toMatchObject({ delivered: 1 });
    const h = hookHits()[0]!;
    const hd = h.init!.headers as Record<string, string>;
    expect(h.init!.redirect).toBe("manual");
    expect(hd["x-ai-event"]).toBe("order.new");
    expect(hd["x-ai-signature"]).toBe(await signPayload(secret, Number(hd["x-ai-timestamp"]), String(h.init!.body)));
    expect(JSON.parse(String(h.init!.body))).toMatchObject({ event: "order.new", data: { orderSn: "S1", total: 10 } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE user_id = ?").bind(otherId).first<any>()).toEqual({ n: 0 });
  });

  it("falha reenvia com espera crescente e depois desiste; o reservado não é enviado em dobro", async () => {
    hookStatus = 500; hits = [];
    await emit(menv, meId, "order.new", { orderSn: "S2" });
    await processDeliveries(menv);
    let d = await env.DB.prepare("SELECT * FROM webhook_deliveries WHERE status = 'pending'").first<any>();
    expect(d).toMatchObject({ attempts: 1, response_status: 500, error: "http_500" });
    expect(d.next_attempt_at).toBeGreaterThan(Date.now() + 30_000);
    expect(await processDeliveries(menv)).toEqual({ delivered: 0, retried: 0, dead: 0 }); // ainda não venceu
    for (let i = 0; i < 4; i++) {
      await env.DB.prepare("UPDATE webhook_deliveries SET next_attempt_at = 0 WHERE status = 'pending'").run();
      await processDeliveries(menv);
    }
    d = await env.DB.prepare("SELECT status, attempts FROM webhook_deliveries WHERE payload LIKE '%S2%'").first<any>();
    expect(d).toEqual({ status: "dead", attempts: 5 });
    expect(hookHits()).toHaveLength(5);
    const dl = await callE(`/api/automation/webhooks/${ep}/deliveries`, { cookie: me });
    expect(dl.body.items.some((i: any) => i.status === "dead" && i.error === "http_500")).toBe(true);
    hookStatus = 200;
  });

  it("desativa o endpoint depois de muitas falhas seguidas e avisa", async () => {
    await env.DB.prepare("UPDATE webhook_endpoints SET consecutive_dead = 9 WHERE id = ?").bind(ep).run();
    hookStatus = 500;
    await emit(menv, meId, "order.new", { orderSn: "S3" });
    for (let i = 0; i < 5; i++) { await env.DB.prepare("UPDATE webhook_deliveries SET next_attempt_at = 0 WHERE status = 'pending'").run(); await processDeliveries(menv); }
    hookStatus = 200;
    const e = (await callE("/api/automation/webhooks", { cookie: me })).body.items[0];
    expect(e.active).toBe(false);
    expect((await callE("/api/automation/notifications", { cookie: me })).body.items.some((n: any) => n.kind === "webhook.disabled")).toBe(true);
    const re = await callE(`/api/automation/webhooks/${ep}`, { method: "PATCH", cookie: me, body: { active: true } });
    expect(re.body.item).toMatchObject({ active: true, consecutiveDead: 0 });
  });

  it("teste manual envia test.ping; outro usuário não alcança o endpoint", async () => {
    hits = [];
    const t = await callE(`/api/automation/webhooks/${ep}/test`, { method: "POST", cookie: me });
    expect(t.body).toMatchObject({ status: "delivered", responseStatus: 200 });
    expect(JSON.parse(String(hookHits()[0]!.init!.body)).event).toBe("test.ping");
    for (const [m, p] of [["POST", `/test`], ["PATCH", ``], ["DELETE", ``], ["GET", `/deliveries`]] as const)
      expect((await callE(`/api/automation/webhooks/${ep}${p}`, { method: m, cookie: other, body: m === "PATCH" ? { active: false } : undefined })).status).toBe(404);
  });

  it("endereço que passou a ser inválido não é chamado", async () => {
    await env.DB.prepare("UPDATE webhook_endpoints SET url = 'https://127.0.0.1/x' WHERE id = ?").bind(ep).run();
    hits = [];
    await emit(menv, meId, "order.new", { orderSn: "S4" });
    await processDeliveries(menv);
    expect(hookHits()).toHaveLength(0);
    expect(hits.some((h) => h.url.includes("127.0.0.1"))).toBe(false);
    expect((await env.DB.prepare("SELECT status, error FROM webhook_deliveries WHERE payload LIKE '%S4%'").first<any>())).toEqual({ status: "dead", error: "endpoint_not_allowed" });
    await env.DB.prepare("UPDATE webhook_endpoints SET url = 'https://hook.example.com/a' WHERE id = ?").bind(ep).run();
  });
});

describe("gancho de entrada (n8n → sistema)", () => {
  let id = "", token = "";
  it("cria com token mostrado uma vez e guarda só o hash", async () => {
    const r = await callE("/api/automation/inbound", { method: "POST", cookie: me, body: { label: "n8n", actions: ["notify"] } });
    expect(r.status).toBe(201);
    id = r.body.item.id; token = r.body.token;
    expect(r.body.url).toBe(`https://app.example.com/api/hooks/in/${id}`);
    const row = await env.DB.prepare("SELECT token_hash FROM inbound_hooks WHERE id = ?").bind(id).first<any>();
    expect(row.token_hash).not.toBe(token);
    expect(JSON.stringify((await callE("/api/automation/inbound", { cookie: me })).body)).not.toContain(token);
  });
  it("aceita notify com o token, sem cookie nem cabeçalho CSRF; link externo é descartado", async () => {
    const ok = await callE(`/api/hooks/in/${id}`, { method: "POST", csrf: false, headers: { authorization: `Bearer ${token}` }, body: { action: "notify", title: "Fluxo rodou", body: "ok", link: "https://evil.example.com/x" } });
    expect(ok.status).toBe(200);
    const n = (await callE("/api/automation/notifications", { cookie: me })).body.items.find((i: any) => i.kind === "inbound.notify");
    expect(n).toMatchObject({ title: "Fluxo rodou", link: null });
    const ok2 = await callE(`/api/hooks/in/${id}`, { method: "POST", csrf: false, headers: { authorization: `Bearer ${token}` }, body: { action: "notify", title: "Interno", link: "/orders" } });
    expect(ok2.status).toBe(200);
    expect((await callE("/api/automation/notifications", { cookie: me })).body.items.find((i: any) => i.title === "Interno").link).toBe("/orders");
  });
  it("recusa token errado, sem token e gancho inexistente do mesmo jeito; recusa ação não liberada", async () => {
    const bad = { action: "notify", title: "x" };
    expect((await callE(`/api/hooks/in/${id}`, { method: "POST", csrf: false, headers: { authorization: "Bearer ihk_errado" }, body: bad })).status).toBe(401);
    expect((await callE(`/api/hooks/in/${id}`, { method: "POST", csrf: false, body: bad })).status).toBe(401);
    expect((await callE(`/api/hooks/in/naoexiste`, { method: "POST", csrf: false, headers: { authorization: `Bearer ${token}` }, body: bad })).status).toBe(401);
    expect((await callE(`/api/hooks/in/${id}`, { method: "POST", csrf: false, headers: { authorization: `Bearer ${token}` }, body: { action: "supplier.import", connectionId: "x", format: "csv", data: "a" } })).status).toBe(403);
    expect((await callE(`/api/hooks/in/${id}`, { method: "POST", csrf: false, headers: { authorization: `Bearer ${token}` }, body: { action: "delete_everything" } })).status).toBe(400);
  });
  it("supplier.import entra só na conta do dono e respeita a simulação", async () => {
    const h2 = await callE("/api/automation/inbound", { method: "POST", cookie: me, body: { label: "imp", actions: ["supplier.import"] } });
    const conn = await callE("/api/integrations/connections", { method: "POST", cookie: me, body: { provider: "supplier", label: "F" } });
    const data = "external_id,name,cost_price\nA1,Produto A,10";
    const hdr = { authorization: `Bearer ${h2.body.token}` };
    const dry = await callE(`/api/hooks/in/${h2.body.item.id}`, { method: "POST", csrf: false, headers: hdr, body: { action: "supplier.import", connectionId: conn.body.item.id, format: "csv", data, dryRun: true } });
    expect(dry.body).toMatchObject({ dryRun: true, valid: 1 });
    const real = await callE(`/api/hooks/in/${h2.body.item.id}`, { method: "POST", csrf: false, headers: hdr, body: { action: "supplier.import", connectionId: conn.body.item.id, format: "csv", data } });
    expect(real.body).toMatchObject({ created: 1 });
    expect((await callE(`/api/integrations/supplier/products?connectionId=${conn.body.item.id}`, { cookie: me })).body.items).toHaveLength(1);
    // conexão de outra pessoa não é alcançável pelo gancho
    const oc = await callE("/api/integrations/connections", { method: "POST", cookie: other, body: { provider: "supplier", label: "O" } });
    expect((await callE(`/api/hooks/in/${h2.body.item.id}`, { method: "POST", csrf: false, headers: hdr, body: { action: "supplier.import", connectionId: oc.body.item.id, format: "csv", data } })).status).toBe(404);
  });
  it("apagar o gancho invalida o token; outro usuário não apaga", async () => {
    expect((await callE(`/api/automation/inbound/${id}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await callE(`/api/automation/inbound/${id}`, { method: "DELETE", cookie: me })).status).toBe(200);
    expect((await callE(`/api/hooks/in/${id}`, { method: "POST", csrf: false, headers: { authorization: `Bearer ${token}` }, body: { action: "notify", title: "x" } })).status).toBe(401);
  });
});

describe("notificações", () => {
  it("lista, marca como lidas e isola por usuário", async () => {
    await notify(env.DB, meId, "t", "Para mim");
    await notify(env.DB, otherId, "t", "Para o outro");
    const l = await callE("/api/automation/notifications", { cookie: me });
    expect(l.body.items.every((n: any) => n.title !== "Para o outro")).toBe(true);
    expect(l.body.unread).toBeGreaterThan(0);
    await callE("/api/automation/notifications/read", { method: "POST", cookie: me, body: { ids: [l.body.items[0].id] } });
    expect((await callE("/api/automation/notifications", { cookie: me })).body.unread).toBe(l.body.unread - 1);
    await callE("/api/automation/notifications/read", { method: "POST", cookie: me, body: {} });
    expect((await callE("/api/automation/notifications", { cookie: me })).body.unread).toBe(0);
    expect((await callE("/api/automation/notifications", { cookie: other })).body.unread).toBeGreaterThan(0);
  });
});

describe("monitor de fontes oficiais", () => {
  let pid = "";
  const state = async () => await env.DB.prepare("SELECT * FROM source_checks").first<any>();
  beforeAll(async () => {
    pid = (await callE("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name: "Programa Monitorado", segment: "saas" } })).body.id;
    await callE(`/api/catalog/programs/${pid}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_page", field: "commission_percent", url: "https://docs.example.com/regras" } });
    await callE(`/api/catalog/programs/${pid}/sources`, { method: "POST", cookie: editor, body: { sourceType: "secondary_reliable", field: "cookie_days", url: "https://docs.example.com/blog" } });
    pages["/regras"] = { status: 200, body: "<html><script>var t=1</script><body><h1>Comissão 10%</h1></body></html>" };
    pages["/blog"] = { status: 200, body: "x" };
  });
  it("só olha fontes oficiais de programas que alguém segue", async () => {
    expect((await runMonitor(menv)).checked).toBe(0);
    await callE("/api/ops/programs", { method: "POST", cookie: me, body: { programId: pid } });
    hits = [];
    expect(await runMonitor(menv)).toEqual({ checked: 1, findings: 0 }); // 1ª leitura só cria a base
    expect(hits.some((h) => h.url.endsWith("/blog"))).toBe(false);
    expect((await state()).last_status).toBe(200);
    expect(await runMonitor(menv)).toEqual({ checked: 0, findings: 0 }); // no máximo 1 vez por dia
  });
  it("ruído (script, espaços) não é mudança; mudança de texto avisa só quem segue e não altera o catálogo", async () => {
    const before = await env.DB.prepare("SELECT * FROM affiliate_programs WHERE id = ?").bind(pid).first<any>();
    const histN = (await env.DB.prepare("SELECT COUNT(*) AS n FROM program_history WHERE program_id = ?").bind(pid).first<any>()).n;
    const old = () => env.DB.prepare("UPDATE source_checks SET last_checked_at = 0").run();
    pages["/regras"] = { status: 200, body: "<html><script>var t=999</script><body>\n<h1>Comissão   10%</h1>\n</body></html>" };
    await old();
    expect((await runMonitor(menv)).findings).toBe(0);
    pages["/regras"] = { status: 200, body: "<html><body><h1>Comissão 5%</h1></body></html>" };
    await old();
    expect(await runMonitor(menv)).toEqual({ checked: 1, findings: 1 });
    const n = (await callE("/api/automation/notifications", { cookie: me })).body.items.find((i: any) => i.kind === "monitor.source_changed");
    expect(n.title).toContain("Programa Monitorado");
    expect(n.link).toBe(`/programs/${pid}`);
    expect((await callE("/api/automation/notifications", { cookie: other })).body.items.some((i: any) => i.kind.startsWith("monitor."))).toBe(false);
    expect(await env.DB.prepare("SELECT * FROM affiliate_programs WHERE id = ?").bind(pid).first()).toEqual(before);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM program_history WHERE program_id = ?").bind(pid).first<any>()).n).toBe(histN);
  });
  it("falha isolada não alarma; a segunda seguida avisa; ao voltar, avisa de novo", async () => {
    const old = () => env.DB.prepare("UPDATE source_checks SET last_checked_at = 0").run();
    pages["/regras"] = { status: 503, body: "" };
    await old(); expect((await runMonitor(menv)).findings).toBe(0);
    await old(); expect((await runMonitor(menv)).findings).toBe(1);
    await old(); expect((await runMonitor(menv)).findings).toBe(0); // não repete enquanto segue fora
    pages["/regras"] = { status: 200, body: "<body>Comissão 5%</body>" };
    await old(); expect((await runMonitor(menv)).findings).toBe(1);
    const kinds = (await callE("/api/automation/notifications", { cookie: me })).body.items.map((i: any) => i.kind);
    expect(kinds).toContain("monitor.source_down");
    expect(kinds).toContain("monitor.source_back");
  });
  it("status do usuário e verificação manual limitados a programas seguidos", async () => {
    const st = await callE("/api/automation/monitor", { cookie: me });
    expect(st.body.items).toHaveLength(1);
    expect(st.body.items[0]).toMatchObject({ programName: "Programa Monitorado", lastStatus: 200 });
    expect((await callE("/api/automation/monitor", { cookie: other })).body.items).toEqual([]);
    expect((await callE(`/api/automation/monitor/check/${pid}`, { method: "POST", cookie: other })).status).toBe(404);
    expect((await callE(`/api/automation/monitor/check/${pid}`, { method: "POST", cookie: me })).body.checked).toBe(1);
  });
  it("monitor não segue redirecionamento para rede interna", async () => {
    const sid = (await env.DB.prepare("SELECT id FROM program_sources WHERE url LIKE '%/regras'").first<any>()).id;
    await env.DB.prepare("UPDATE program_sources SET url = 'https://127.0.0.1/x' WHERE id = ?").bind(sid).run();
    await env.DB.prepare("UPDATE source_checks SET last_checked_at = 0").run();
    hits = [];
    await runMonitor(menv);
    expect(hits.some((h) => h.url.includes("127.0.0.1"))).toBe(false);
    await env.DB.prepare("UPDATE program_sources SET url = 'https://docs.example.com/regras' WHERE id = ?").bind(sid).run();
  });
});

describe("resumo por e-mail e evento alert.new", () => {
  let pid = "";
  const addHistory = (field: string, at = Date.now()) => env.DB.prepare("INSERT INTO program_history (program_id, field, old_value, new_value, changed_by, changed_at) VALUES (?,?,?,?,?,?)").bind(pid, field, null, "yes", "test", at).run();
  beforeAll(async () => { pid = (await callE("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name: "Programa Novo", segment: "saas" } })).body.id; });

  it("e-mail é opt-in: nada é enviado enquanto não for ligado", async () => {
    await addHistory("created");
    hits = [];
    await runAlertsPass(menv);
    expect(mails()).toHaveLength(0);
    expect((await callE("/api/automation/notifications", { cookie: me })).body.prefs.emailEnabled).toBe(false);
  });
  it("liga, envia um resumo com a fonte e o link de cancelamento, e respeita a frequência", async () => {
    await callE("/api/automation/notifications/prefs", { method: "PUT", cookie: me, body: { emailEnabled: true } });
    // ao ligar, a base é "agora": o 1º resumo só sai depois do intervalo da frequência (não manda histórico antigo)
    expect((await env.DB.prepare("SELECT last_digest_at FROM alert_prefs WHERE user_id = ?").bind(meId).first<any>()).last_digest_at).toBeGreaterThan(Date.now() - 5000);
    hits = [];
    expect((await runAlertsPass(menv)).emails).toBe(0);
    await env.DB.prepare("UPDATE alert_prefs SET last_digest_at = ? WHERE user_id = ?").bind(Date.now() - 2 * 86_400_000, meId).run();
    await addHistory("created", Date.now() + 5);
    hits = []; mailOk = true;
    expect(await runAlertsPass(menv, Date.now() + 10)).toMatchObject({ emails: 1 });
    const m = mails()[0]!;
    const b = JSON.parse(String(m.init!.body));
    expect(b.to).toBe("auto@example.com");
    expect(b.text).toContain("Programa Novo");
    expect(b.text).toMatch(/https:\/\/app\.example\.com\/api\/unsubscribe\?u=.+&sig=/);
    expect(b.text).toContain("Fonte oficial não registrada");
    hits = [];
    await addHistory("created", Date.now() + 20);
    expect(await runAlertsPass(menv, Date.now() + 30)).toMatchObject({ emails: 0 }); // diário: ainda não passou 1 dia
  });
  it("se o provedor recusar, não marca como enviado e tenta de novo", async () => {
    await env.DB.prepare("UPDATE alert_prefs SET last_digest_at = 0 WHERE user_id = ?").bind(meId).run();
    hits = []; mailOk = false;
    expect((await runAlertsPass(menv)).emails).toBe(0);
    expect((await env.DB.prepare("SELECT last_digest_at FROM alert_prefs WHERE user_id = ?").bind(meId).first<any>()).last_digest_at).toBe(0);
    mailOk = true;
    expect((await runAlertsPass(menv)).emails).toBe(1);
  });
  it("cancelar com um clique desliga o e-mail; assinatura errada é recusada", async () => {
    const link = JSON.parse(String(mails().at(-1)!.init!.body)).text.match(/https:\/\/app\.example\.com(\/api\/unsubscribe\?[^\s]+)/)[1];
    expect((await callE(link.replace(/sig=.*/, "sig=errada"))).status).toBe(400);
    expect((await callE(link)).status).toBe(200);
    expect((await callE("/api/automation/notifications", { cookie: me })).body.prefs.emailEnabled).toBe(false);
  });
  it("alert.new: a 1ª passada só marca o ponto de partida; depois vai um lote com o que é novo", async () => {
    const e = await callE("/api/automation/webhooks", { method: "POST", cookie: other, body: { label: "alertas", url: "https://hook.example.com/alerts", events: ["alert.new"] } });
    expect(e.status).toBe(201);
    const t0 = Date.now() + 1000;
    await runAlertsPass(menv, t0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE user_id = ? AND event = 'alert.new'").bind(otherId).first<any>()).n).toBe(0);
    await addHistory("created", t0 + 500);
    expect((await runAlertsPass(menv, t0 + 1000)).events).toBe(1);
    const d = await env.DB.prepare("SELECT payload FROM webhook_deliveries WHERE user_id = ? AND event = 'alert.new'").bind(otherId).first<any>();
    expect(JSON.parse(d.payload).data.alerts[0]).toMatchObject({ programName: "Programa Novo", category: "new_programs" });
    expect((await runAlertsPass(menv, t0 + 2000)).events).toBe(0);
  });
});

describe("agendador, exportação e exclusão", () => {
  it("runScheduled roda todas as tarefas dentro do orçamento; limpeza só na janela das 03h UTC", async () => {
    const r = await runScheduled(menv, new Date(Date.UTC(2026, 10, 12, 3, 7)));
    expect(Object.keys(r).sort()).toEqual(["alerts", "autoStock", "billing", "d1", "deliveries", "fetch", "monitor", "purge"]);
    expect(r.d1 as number).toBeLessThanOrEqual(45);
    expect(r.fetch as number).toBeLessThanOrEqual(45);
    const r2 = await runScheduled(menv, new Date(Date.UTC(2026, 10, 12, 6, 7)));
    expect(Object.keys(r2).sort()).toEqual(["alerts", "autoStock", "billing", "d1", "deliveries", "fetch", "monitor"]);
    await env.DB.prepare("INSERT INTO notifications (id, user_id, kind, title, created_at, read_at) VALUES ('old1', ?, 'k', 't', 1, 2)").bind(meId).run();
    await runScheduled(menv, new Date(Date.UTC(2026, 10, 12, 3, 7)));
    expect(await env.DB.prepare("SELECT id FROM notifications WHERE id = 'old1'").first()).toBeNull();
  });
  it("exportação inclui as automações sem segredos; apagar a conta apaga tudo", async () => {
    await callE("/api/automation/inbound", { method: "POST", cookie: me, body: { label: "e", actions: ["notify"] } });
    const exp = await callE("/api/me/export", { cookie: me });
    expect(exp.body.webhooks.length).toBeGreaterThan(0);
    expect(exp.body.inboundHooks.length).toBeGreaterThan(0);
    expect(exp.body.notifications.length).toBeGreaterThan(0);
    const s = JSON.stringify(exp.body);
    expect(s).not.toMatch(/whsec_|ihk_|token_hash|secret_enc/);
    await callE("/api/me", { method: "DELETE", cookie: me });
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM webhook_endpoints WHERE user_id = ?1) AS w, (SELECT COUNT(*) FROM webhook_deliveries WHERE user_id = ?1) AS d, (SELECT COUNT(*) FROM inbound_hooks WHERE user_id = ?1) AS i, (SELECT COUNT(*) FROM notifications WHERE user_id = ?1) AS n").bind(meId).first<any>();
    expect(left).toEqual({ w: 0, d: 0, i: 0, n: 0 });
  });
});
