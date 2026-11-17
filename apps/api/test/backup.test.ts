import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import reindexSql from "../../../scripts/reindex.sql?raw";

let counter = 0;
async function call(path: string, o: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.50.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const r = await app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.51.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.51.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

describe("backup e restauração", () => {
  let admin = "";
  beforeAll(async () => { admin = await login("boss@example.com"); });

  it("o SQL de reindexação do restore gera o mesmo índice que a API mantém", async () => {
    const adv = (await call("/api/catalog/advertisers", { method: "POST", cookie: admin, body: { name: "Busca Corp" } })).body.id;
    for (const name of ["Alfa Hosting", "Beta Cursos"]) {
      const r = await call("/api/catalog/programs", { method: "POST", cookie: admin, body: { advertiserId: adv, name, segment: "saas", description: `desc ${name}` } });
      expect(r.status).toBe(201);
    }
    const snap = async () => (await env.DB.prepare("SELECT program_id, content FROM program_search ORDER BY program_id").all<{ program_id: string; content: string }>()).results;
    const viaApi = await snap();
    expect(viaApi.length).toBe(2);
    // Roda o SQL do restore (instruções separadas) sobre o mesmo banco e compara
    const stmts = reindexSql.split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean);
    expect(stmts).toHaveLength(2);
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
    expect(await snap()).toEqual(viaApi);
  });

  it("o banco tem tabela virtual (por isso o wrangler d1 export não serve) e o backup próprio não depende dela", async () => {
    const v = await env.DB.prepare("SELECT name FROM sqlite_master WHERE sql LIKE 'CREATE VIRTUAL TABLE%'").all<{ name: string }>();
    expect(v.results.map((r) => r.name)).toEqual(["program_search"]);
  });

  it("toda tabela de dados tem rowid (o backup pagina por rowid)", async () => {
    const t = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'program_search%'").all<{ name: string; sql: string }>();
    expect(t.results.length).toBeGreaterThan(30);
    expect(t.results.filter((r) => /WITHOUT ROWID/i.test(r.sql)).map((r) => r.name)).toEqual([]);
  });
});
