import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { purgeOld } from "../src/automation";

let counter = 0;
type Opts = { method?: string; body?: unknown; cookie?: string; raw?: string; headers?: Record<string, string> };
async function raw(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.40.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch", ...(o.headers ?? {}) };
  if (o.body !== undefined || o.raw !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  return app.request(path, { method: o.method ?? "GET", headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) }, env);
}
const call = async (path: string, o: Opts = {}) => { const r = await raw(path, o); return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers }; };
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.41.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.41.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

let admin = "", user = "";
beforeAll(async () => { admin = await login("boss@example.com"); user = await login("sec-user@example.com"); });

// Rotas que, por desenho, não exigem sessão (cada uma tem a própria proteção).
const PUBLIC = new Set([
  "GET /api/health", "GET /api/legal", "POST /api/auth/login", "POST /api/auth/verify",
  "POST /api/hooks/in/:id", // token Bearer próprio
  "GET /api/unsubscribe", "POST /api/unsubscribe", // assinatura HMAC no link
]);

const concrete = (p: string) => p.replace(/:[A-Za-z]+/g, "x").replace(/\{[^}]+\}/g, "x");
const routes = () => {
  const seen = new Set<string>();
  return app.routes.filter((r) => r.method !== "ALL" && r.path.startsWith("/api/")).filter((r) => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

describe("inventário de rotas", () => {
  it("toda rota da API exige sessão, exceto as públicas listadas", async () => {
    const open: string[] = [];
    const all = routes();
    expect(all.length).toBeGreaterThan(120); // garante que o inventário não está vazio
    for (const r of all) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const res = await raw(concrete(r.path), { method: r.method, body: r.method === "GET" || r.method === "DELETE" ? undefined : {} });
      if (res.status !== 401) open.push(`${key} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });
  it("toda rota /api/admin* é proibida para usuário comum", async () => {
    const bad: string[] = [];
    const adm = routes().filter((r) => r.path.startsWith("/api/admin"));
    expect(adm.length).toBeGreaterThan(8);
    for (const r of adm) {
      const res = await raw(concrete(r.path), { method: r.method, cookie: user, body: r.method === "GET" || r.method === "DELETE" ? undefined : {} });
      if (res.status !== 403) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
  it("métodos que alteram dados exigem o cabeçalho anti-CSRF e a origem do app", async () => {
    const noHeader = await app.request("/api/me/profile", { method: "PUT", headers: { cookie: user, "content-type": "application/json" }, body: "{}" }, env);
    expect(noHeader.status).toBe(403);
    const badOrigin = await raw("/api/me/profile", { method: "PUT", cookie: user, body: {}, headers: { origin: "https://evil.example" } });
    expect(badOrigin.status).toBe(403);
  });
});

describe("cabeçalhos e limites", () => {
  it("respostas da API não têm conteúdo ativo, nem cache compartilhado", async () => {
    const r = await call("/api/health");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-frame-options")).toBeTruthy();
  });
  it("corpo acima de 2 MB é recusado antes de validar", async () => {
    const big = JSON.stringify({ csv: "a".repeat(2 * 1024 * 1024 + 10) });
    const r = await call("/api/ops/commissions/import", { method: "POST", cookie: user, raw: big });
    expect(r.status).toBe(413);
    expect(r.body.error).toBe("payload_too_large");
    // 500 mil caracteres (limite legítimo da importação) continua passando do limite de corpo
    const ok = await call("/api/ops/commissions/import", { method: "POST", cookie: user, raw: JSON.stringify({ programId: "x", csv: "a".repeat(400_000) }) });
    expect(ok.status).not.toBe(413);
  });
  it("/api/health confere o banco", async () => {
    const r = await call("/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, db: true });
    expect(JSON.stringify(r.body)).not.toMatch(/secret|key|token/i);
  });
});

describe("sessão", () => {
  it("o cookie é HttpOnly, SameSite=Lax e a saída invalida o token", async () => {
    const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
    const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.42.0.${++counter % 250}`), body: JSON.stringify({ email: "cookie-test@example.com" }) }, env);
    const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
    const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.42.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
    const sc = r2.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    const cookie = sc.split(";")[0]!;
    expect((await call("/api/me", { cookie })).status).toBe(200);
    await call("/api/auth/logout", { method: "POST", cookie });
    expect((await call("/api/me", { cookie })).status).toBe(401);
    // o mesmo link não vale duas vezes
    const again = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.42.2.${counter % 250}`), body: JSON.stringify({ token }) }, env);
    expect(again.status).toBe(400);
  });
  it("o login não revela se a conta existe", async () => {
    const a = await call("/api/auth/login", { method: "POST", body: { email: "sec-user@example.com" } });
    const b = await call("/api/auth/login", { method: "POST", body: { email: "nunca-existiu@example.com" } });
    expect(a.status).toBe(b.status);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
  });
});

describe("isolamento entre usuários", () => {
  it("um usuário não lê nem altera registros de outro (links, campanhas, comissões)", async () => {
    const other = await login("sec-other@example.com");
    const link = (await call("/api/ops/links", { method: "POST", cookie: user, body: { label: "L", url: "https://a.example.com/x" } })).body.id;
    const camp = (await call("/api/ops/campaigns", { method: "POST", cookie: user, body: { name: "C", channel: "blog" } })).body.id;
    const com = (await call("/api/ops/commissions", { method: "POST", cookie: user, body: { amount: 5, currency: "BRL" } })).body.id;
    for (const [m, p, b] of [
      ["PATCH", `/api/ops/links/${link}`, { label: "hack" }], ["DELETE", `/api/ops/links/${link}`, undefined],
      ["PATCH", `/api/ops/campaigns/${camp}`, { name: "hack" }], ["DELETE", `/api/ops/campaigns/${camp}`, undefined],
      ["PATCH", `/api/ops/commissions/${com}`, { amount: 999 }], ["POST", `/api/ops/commissions/${com}/status`, { status: "approved" }], ["DELETE", `/api/ops/commissions/${com}`, undefined],
    ] as const) {
      const r = await call(p, { method: m, cookie: other, body: b });
      expect([403, 404], `${m} ${p} -> ${r.status}`).toContain(r.status);
    }
    expect((await call("/api/ops/links", { cookie: other })).body.items).toEqual([]);
    expect((await call("/api/ops/commissions", { cookie: other })).body.items).toEqual([]);
    expect((await call("/api/ops/commissions", { cookie: user })).body.items.find((c: any) => c.id === com).amount).toBe(5);
  });
});

describe("privacidade e retenção", () => {
  it("contato legal: público para ler, só o administrador altera", async () => {
    expect((await call("/api/legal")).body).toEqual({ operatorName: null, contactEmail: null });
    expect((await call("/api/admin/legal", { method: "PUT", cookie: user, body: { operatorName: "X" } })).status).toBe(403);
    expect((await call("/api/admin/legal", { method: "PUT", cookie: admin, body: { operatorName: "Op Ltda", contactEmail: "Privacidade@Op.com" } })).status).toBe(200);
    expect((await call("/api/legal")).body).toEqual({ operatorName: "Op Ltda", contactEmail: "privacidade@op.com" });
    expect((await call("/api/admin/legal", { method: "PUT", cookie: admin, body: { contactEmail: "nao-e-email" } })).status).toBe(400);
  });
  it("a limpeza apaga sessões vencidas, janelas antigas e cliques com mais de 400 dias, e só isso", async () => {
    const DAY = 86_400_000;
    const t = Date.now();
    const uid = (await call("/api/me", { cookie: user })).body.user.id as string;
    const link = (await call("/api/ops/links", { method: "POST", cookie: user, body: { label: "P", url: "https://a.example.com/p" } })).body.id as string;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('old-s', ?, ?, ?)").bind(uid, t - 40 * DAY, t - 10 * DAY),
      env.DB.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES ('old-k', ?, 1), ('new-k', ?, 1)").bind(t - 3 * DAY, t),
      env.DB.prepare("INSERT INTO link_clicks (id, link_id, user_id, at, visitor_hash) VALUES ('c-old', ?, ?, ?, 'h'), ('c-new', ?, ?, ?, 'h')").bind(link, uid, t - 401 * DAY, link, uid, t - 10 * DAY),
    ]);
    await purgeOld(env);
    const n = async (sql: string) => ((await env.DB.prepare(sql).first<{ n: number }>())!.n);
    expect(await n("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'old-s'")).toBe(0);
    expect(await n("SELECT COUNT(*) AS n FROM rate_limits WHERE key = 'old-k'")).toBe(0);
    expect(await n("SELECT COUNT(*) AS n FROM rate_limits WHERE key = 'new-k'")).toBe(1);
    expect(await n("SELECT COUNT(*) AS n FROM link_clicks WHERE id = 'c-old'")).toBe(0);
    expect(await n("SELECT COUNT(*) AS n FROM link_clicks WHERE id = 'c-new'")).toBe(1);
    expect((await call("/api/me", { cookie: user })).status).toBe(200); // sessão válida segue
  });
  it("excluir a conta apaga os dados do usuário e mantém a auditoria pseudonimizada", async () => {
    const c = await login("sec-delete@example.com");
    const me = (await call("/api/me", { cookie: c })).body.user.id as string;
    await call("/api/ops/links", { method: "POST", cookie: c, body: { label: "D", url: "https://a.example.com/d" } });
    expect((await call("/api/me", { method: "DELETE", cookie: c })).status).toBe(200);
    for (const t of ["users", "sessions", "affiliate_links", "user_profiles"]) {
      const col = t === "users" ? "id" : "user_id";
      expect(((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).bind(me).first<{ n: number }>())!.n), t).toBe(0);
    }
    expect(((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE user_id = ? AND action = 'user.deleted'").bind(me).first<{ n: number }>())!.n)).toBe(1);
  });
});
