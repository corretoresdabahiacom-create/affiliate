import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";

let counter = 0;
async function call(path: string, o: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.31.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const r = await app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.32.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.32.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

let me = "", other = "";
const WEEK = "2026-11-23";
const post = (cookie: string, over: Record<string, unknown> = {}) =>
  call("/api/content/posts", { method: "POST", cookie, body: { weekStart: WEEK, day: 0, title: "Vídeo 1", platforms: ["instagram"], script: "Roteiro", ...over } });
const status = (cookie: string, id: string, s: string) => call(`/api/content/posts/${id}/status`, { method: "POST", cookie, body: { status: s } });

beforeAll(async () => {
  me = await login("content-me@example.com");
  other = await login("content-other@example.com");
});

describe("semana de conteúdo (API)", () => {
  it("exige login", async () => {
    expect((await call("/api/content/week")).status).toBe(401);
  });

  it("cria, lista pela segunda-feira e isola por usuário", async () => {
    const r = await post(me, { weekStart: "2026-11-26" }); // quinta → cai na semana de 23/11
    expect(r.status).toBe(201);
    const w = await call(`/api/content/week?start=2026-11-27`, { cookie: me });
    expect(w.body.weekStart).toBe(WEEK);
    expect(w.body.prev).toBe("2026-11-16");
    expect(w.body.next).toBe("2026-11-30");
    expect(w.body.items.some((i: any) => i.id === r.body.id && i.status === "idea")).toBe(true);
    expect((await call(`/api/content/week?start=${WEEK}`, { cookie: other })).body.items).toHaveLength(0);
    expect((await call(`/api/content/posts/${r.body.id}`, { method: "PATCH", cookie: other, body: { title: "x" } })).status).toBe(404);
    expect((await status(other, r.body.id, "approved")).status).toBe(404);
    expect((await call(`/api/content/posts/${r.body.id}`, { method: "DELETE", cookie: other })).status).toBe(404);
  });

  it("rejeita entrada inválida", async () => {
    expect((await post(me, { platforms: [] })).status).toBe(400);
    expect((await post(me, { day: 9 })).status).toBe(400);
    expect((await post(me, { title: "" })).status).toBe(400);
  });

  it("não pula a aprovação e exige roteiro e divulgação", async () => {
    const noScript = (await post(me, { title: "Sem roteiro", script: null })).body.id;
    expect((await status(me, noScript, "scheduled")).status).toBe(409); // não pula a aprovação
    const blocked = await status(me, noScript, "approved");
    expect(blocked.status).toBe(409);
    expect(blocked.body.issues).toEqual(["script_missing"]);

    const aff = (await post(me, { title: "Com link", usesAffiliateLink: true })).body.id;
    expect((await status(me, aff, "approved")).body.issues).toEqual(["disclosure_missing"]);
    await call(`/api/content/posts/${aff}`, { method: "PATCH", cookie: me, body: { disclosureConfirmed: true } });
    expect((await status(me, aff, "approved")).status).toBe(200);
  });

  it("editar conteúdo aprovado exige nova aprovação; editar horário não", async () => {
    const id = (await post(me, { title: "Editável" })).body.id;
    await status(me, id, "approved");
    const t = await call(`/api/content/posts/${id}`, { method: "PATCH", cookie: me, body: { time: "18:30" } });
    expect(t.body.reapprovalNeeded).toBe(false);
    const c = await call(`/api/content/posts/${id}`, { method: "PATCH", cookie: me, body: { script: "Outro roteiro" } });
    expect(c.body.reapprovalNeeded).toBe(true);
    const w = await call(`/api/content/week?start=${WEEK}`, { cookie: me });
    expect(w.body.items.find((i: any) => i.id === id).status).toBe("idea");
    expect(w.body.items.find((i: any) => i.id === id).time).toBe("18:30");
  });

  it("métricas só depois de publicado; publicado fica travado", async () => {
    const id = (await post(me, { title: "Para publicar" })).body.id;
    expect((await call(`/api/content/posts/${id}/metrics`, { method: "PUT", cookie: me, body: { views: 10 } })).status).toBe(409);
    await status(me, id, "approved");
    await status(me, id, "scheduled");
    expect((await status(me, id, "published")).status).toBe(200);
    expect((await call(`/api/content/posts/${id}`, { method: "PATCH", cookie: me, body: { title: "x" } })).status).toBe(409);
    expect((await status(me, id, "idea")).status).toBe(409);
    expect((await call(`/api/content/posts/${id}/metrics`, { method: "PUT", cookie: me, body: { views: 1500, likes: 90, shares: 10, saves: 50, retentionPct: 61.5 } })).status).toBe(200);
    expect((await call(`/api/content/posts/${id}/metrics`, { method: "PUT", cookie: me, body: { views: -5 } })).status).toBe(400);
    const w = await call(`/api/content/week?start=${WEEK}`, { cookie: me });
    expect(w.body.items.find((i: any) => i.id === id).metrics).toMatchObject({ views: 1500, likes: 90, retentionPct: 61.5 });
  });

  it("limita 21 posts por semana", async () => {
    const wk = "2026-03-02";
    for (let i = 0; i < 21; i++) expect((await post(other, { weekStart: wk, day: i % 7 })).status).toBe(201);
    const over = await post(other, { weekStart: wk });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("week_full");
  });

  it("insights: só aponta tendência com 3+ posts medidos", async () => {
    const wk = new Date().toISOString().slice(0, 10);
    const user = await login("content-insights@example.com");
    const pub = async (title: string, views: number, day: number, platforms: string[]) => {
      const id = (await post(user, { weekStart: wk, title, day, platforms })).body.id;
      await status(user, id, "approved");
      await status(user, id, "published");
      await call(`/api/content/posts/${id}/metrics`, { method: "PUT", cookie: user, body: { views, likes: Math.round(views / 10) } });
    };
    await pub("A", 1000, 0, ["instagram"]);
    await pub("B", 4000, 2, ["tiktok"]);
    let r = (await call("/api/content/insights", { cookie: user })).body;
    expect(r.enough).toBe(false);
    expect(r.best).toEqual({ platform: null, day: null });
    await pub("C", 2000, 2, ["tiktok"]);
    r = (await call("/api/content/insights", { cookie: user })).body;
    expect(r.enough).toBe(true);
    expect(r.ranking[0].title).toBe("B");
    expect(r.best).toEqual({ platform: "tiktok", day: 2 });
  });

  it("entra na exportação e some com a exclusão da conta", async () => {
    const tmp = await login("content-gone@example.com");
    const id = (await post(tmp, { title: "Some com a conta" })).body.id;
    const ex = (await call("/api/me/export", { cookie: tmp })).body;
    expect(ex.contentPosts.map((p: any) => p.id)).toContain(id);
    expect((await call("/api/me", { method: "DELETE", cookie: tmp })).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM content_posts WHERE id = ?").bind(id).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
