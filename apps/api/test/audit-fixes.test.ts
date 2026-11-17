import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signPayload } from "@ai/shared";
import { app } from "../src/app";
import { emit, notify, processDeliveries, runAlertsPass, runMonitor } from "../src/automation";
import { runScheduled } from "../src/index";
import { metered, share } from "../src/budget";

let counter = 0;
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.61.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.61.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
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
  editor = await login("ed-fix@example.com");
  me = await login("fix@example.com");
  other = await login("fix-other@example.com");
  const users = await callE("/api/admin/users", { cookie: admin });
  const ed = users.body.users.find((u: any) => u.email === "ed-fix@example.com");
  await callE(`/api/admin/users/${ed.id}/role`, { method: "PATCH", body: { role: "editor" }, cookie: admin });
  meId = (await callE("/api/me", { cookie: me })).body.user.id;
  otherId = (await callE("/api/me", { cookie: other })).body.user.id;
  advId = (await callE("/api/catalog/advertisers", { method: "POST", body: { name: "Fix Corp" }, cookie: editor })).body.id;
});


const mkHook = async (cookie: string, events: string[], url = "https://hook.example.com/a") => (await callE("/api/automation/webhooks", { method: "POST", cookie, body: { label: "h", url, events } })).body.item.id as string;
const pendingOf = (ep: string) => env.DB.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE endpoint_id = ? AND status = 'pending'").bind(ep).first<any>().then((r) => r.n as number);

describe("correções da auditoria: webhooks", () => {
  it("desligar à mão tira a fila, não conta como falha e não gera aviso de 'desativado por falhas'", async () => {
    const ep = await mkHook(me, ["order.new"]);
    hookStatus = 500;
    for (let i = 0; i < 3; i++) await emit(menv, meId, "order.new", { i });
    expect(await pendingOf(ep)).toBe(3);
    await callE(`/api/automation/webhooks/${ep}`, { method: "PATCH", cookie: me, body: { active: false } });
    expect(await pendingOf(ep)).toBe(0);
    hits = [];
    await processDeliveries(menv);
    expect(hookHits()).toHaveLength(0);
    const n = (await callE("/api/automation/notifications", { cookie: me })).body.items.filter((x: any) => x.kind === "webhook.disabled");
    expect(n).toHaveLength(0);
    expect((await callE(`/api/automation/webhooks/${ep}/test`, { method: "POST", cookie: me })).status).toBe(409);
    hookStatus = 200;
    await callE(`/api/automation/webhooks/${ep}`, { method: "DELETE", cookie: me });
  });

  it("desativação automática avisa uma vez só, mesmo com várias entregas na fila", async () => {
    const ep = await mkHook(me, ["order.new"]);
    await env.DB.prepare("UPDATE webhook_endpoints SET consecutive_dead = 9 WHERE id = ?").bind(ep).run();
    hookStatus = 500;
    for (let i = 0; i < 4; i++) await emit(menv, meId, "order.new", { i });
    for (let k = 0; k < 6; k++) { await env.DB.prepare("UPDATE webhook_deliveries SET next_attempt_at = 0 WHERE status = 'pending'").run(); await processDeliveries(menv); }
    hookStatus = 200;
    const n = (await callE("/api/automation/notifications", { cookie: me })).body.items.filter((x: any) => x.kind === "webhook.disabled");
    expect(n).toHaveLength(1);
    expect(await pendingOf(ep)).toBe(0);
    await callE(`/api/automation/webhooks/${ep}`, { method: "DELETE", cookie: me });
  });

  it("o teste manual responde pelo próprio ping, mesmo com entregas antigas na fila", async () => {
    const ep = await mkHook(me, ["order.new", "test.ping"]);
    hookStatus = 500;
    for (let i = 0; i < 6; i++) await emit(menv, meId, "order.new", { i });
    await env.DB.prepare("UPDATE webhook_deliveries SET next_attempt_at = 1 WHERE endpoint_id = ? AND status = 'pending'").bind(ep).run();
    hookStatus = 200;
    hits = [];
    const t = await callE(`/api/automation/webhooks/${ep}/test`, { method: "POST", cookie: me });
    expect(t.body).toMatchObject({ status: "delivered", responseStatus: 200 });
    expect(hookHits()).toHaveLength(1);
    expect(JSON.parse(String(hookHits()[0]!.init!.body)).event).toBe("test.ping");
    await callE(`/api/automation/webhooks/${ep}`, { method: "DELETE", cookie: me });
  });
});

describe("correções da auditoria: gancho de entrada", () => {
  it("id fora do formato e token errado respondem 401; falhas repetidas do mesmo IP são limitadas sem afetar o dono", async () => {
    const r = await callE("/api/automation/inbound", { method: "POST", cookie: me, body: { label: "x", actions: ["notify"] } });
    const bad = { action: "notify", title: "x" };
    expect((await callE("/api/hooks/in/naoexiste", { method: "POST", csrf: false, headers: { authorization: "Bearer x" }, body: bad })).status).toBe(401);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await callE(`/api/hooks/in/${r.body.item.id}`, { method: "POST", csrf: false, headers: { authorization: "Bearer errado", "cf-connecting-ip": "203.0.113.9" }, body: bad })).status;
    expect(last).toBe(429);
    const ok = await callE(`/api/hooks/in/${r.body.item.id}`, { method: "POST", csrf: false, headers: { authorization: `Bearer ${r.body.token}`, "cf-connecting-ip": "198.51.100.7" }, body: bad });
    expect(ok.status).toBe(200);
  });
});

describe("correções da auditoria: monitor", () => {
  it("a mesma página cadastrada para vários campos é verificada e avisada uma vez só", async () => {
    const pid = (await callE("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name: "Prog Duplo", segment: "saas" } })).body.id;
    for (const field of ["commission_percent", "cookie_days", "min_payout"])
      await callE(`/api/catalog/programs/${pid}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_page", field, url: "https://docs.example.com/duplo" } });
    await callE("/api/ops/programs", { method: "POST", cookie: me, body: { programId: pid } });
    pages["/duplo"] = { status: 200, body: "<p>v1</p>" };
    hits = [];
    await runMonitor(menv);
    expect(hits.filter((h) => h.url.endsWith("/duplo"))).toHaveLength(1);
    pages["/duplo"] = { status: 200, body: "<p>v2</p>" };
    await env.DB.prepare("UPDATE source_checks SET last_checked_at = 0").run();
    hits = [];
    await runMonitor(menv);
    expect(hits.filter((h) => h.url.endsWith("/duplo"))).toHaveLength(1);
    const n = (await callE("/api/automation/notifications", { cookie: me })).body.items.filter((x: any) => x.kind === "monitor.source_changed" && x.title.includes("Prog Duplo"));
    expect(n).toHaveLength(1);
    expect((await callE("/api/automation/monitor", { cookie: me })).body.items.filter((i: any) => i.programName === "Prog Duplo")).toHaveLength(1);
  });

  it("página enorme é lida só até 1 MB", async () => {
    const pid = (await callE("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name: "Prog Grande", segment: "saas" } })).body.id;
    await callE(`/api/catalog/programs/${pid}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_page", field: "commission_percent", url: "https://docs.example.com/grande" } });
    await callE("/api/ops/programs", { method: "POST", cookie: me, body: { programId: pid } });
    pages["/grande"] = { status: 200, body: "a".repeat(3_000_000) };
    const st = await callE(`/api/automation/monitor/check/${pid}`, { method: "POST", cookie: me });
    expect(st.status).toBe(200);
    expect(st.body.checked).toBe(1);
  });
});

describe("correções da auditoria: alertas", () => {
  let pid = "";
  const addHistory = (at: number) => env.DB.prepare("INSERT INTO program_history (program_id, field, old_value, new_value, changed_by, changed_at) VALUES (?,?,?,?,?,?)").bind(pid, "created", null, "yes", "test", at).run();
  beforeAll(async () => { pid = (await callE("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name: "Prog Relogio", segment: "saas" } })).body.id; });

  it("o que é registrado depois do relógio da passada sai na passada seguinte, uma vez só; o lote informa o total", async () => {
    const ep = await mkHook(other, ["alert.new"], "https://hook.example.com/relogio");
    const t0 = Date.now() + 10_000;
    await runAlertsPass(menv, t0); // marca o início
    for (let i = 0; i < 25; i++) await addHistory(t0 + 100 + i);
    await addHistory(t0 + 5_000); // depois do relógio da próxima passada
    await runAlertsPass(menv, t0 + 1_000);
    const p1 = await env.DB.prepare("SELECT payload FROM webhook_deliveries WHERE endpoint_id = ? ORDER BY created_at").bind(ep).all<any>();
    expect(p1.results).toHaveLength(1);
    const d1 = JSON.parse(p1.results[0].payload).data;
    expect(d1).toMatchObject({ total: 25, truncated: true });
    expect(d1.alerts).toHaveLength(20);
    await runAlertsPass(menv, t0 + 6_000);
    const p2 = await env.DB.prepare("SELECT payload FROM webhook_deliveries WHERE endpoint_id = ? ORDER BY created_at").bind(ep).all<any>();
    expect(p2.results).toHaveLength(2);
    expect(JSON.parse(p2.results[1].payload).data).toMatchObject({ total: 1, truncated: false });
    await runAlertsPass(menv, t0 + 7_000);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE endpoint_id = ?").bind(ep).first<any>()).n).toBe(2);
    await callE(`/api/automation/webhooks/${ep}`, { method: "DELETE", cookie: other });
  });

  it("rodízio: com orçamento curto, cada passada atende quem foi visto há mais tempo", async () => {
    const cookies = await Promise.all([1, 2, 3].map((i) => login(`roda${i}@example.com`)));
    for (const ck of cookies) await mkHook(ck, ["alert.new"], "https://hook.example.com/roda");
    const seen = new Set<number>();
    for (let k = 0; k < 4; k++) {
      const m = metered(env.DB);
      const small = share(m.budget, 10, 10); // cabe 1 usuário por passada
      const r = await runAlertsPass({ ...menv, DB: m.db }, Date.now() + 20_000 + k, small);
      expect(r.users).toBeLessThanOrEqual(1);
      expect(m.budget.d1Used()).toBeLessThanOrEqual(12);
      const { results } = await env.DB.prepare("SELECT a.pass_at FROM alert_prefs a JOIN users u ON u.id = a.user_id WHERE u.email LIKE 'roda%'").all<any>();
      seen.add(results.filter((x: any) => x.pass_at > 0).length);
    }
    expect(Math.max(...seen)).toBe(3);
  });
});

describe("correções da auditoria: orçamento do agendador", () => {
  it("com muita coisa acumulada, cada execução fica no orçamento e avança", async () => {
    const ep = await mkHook(me, ["order.new"], "https://hook.example.com/muito");
    for (let i = 0; i < 60; i++) await emit(menv, meId, "order.new", { i });
    const before = await pendingOf(ep);
    expect(before).toBe(60);
    const r = await runScheduled(menv, new Date(Date.UTC(2026, 10, 12, 8, 0)));
    expect(r.d1 as number).toBeLessThanOrEqual(45);
    expect(r.fetch as number).toBeLessThanOrEqual(45);
    const after = await pendingOf(ep);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it("notificação guarda os valores para o front traduzir", async () => {
    const row = await env.DB.prepare("SELECT data FROM notifications WHERE kind = 'monitor.source_changed' LIMIT 1").first<any>();
    expect(JSON.parse(row.data)).toHaveProperty("program");
  });
});
