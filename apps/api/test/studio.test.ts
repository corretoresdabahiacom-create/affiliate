import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";

let counter = 0;
type Opts = { method?: string; body?: unknown; cookie?: string };
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.11.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const r = await app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.12.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.12.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
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
  advId = (await call("/api/catalog/advertisers", { method: "POST", body: { name: "AI Corp" }, cookie: editor })).body.id;
  other = await login("other@example.com");
  await call("/api/me/profile", { method: "PUT", body: profileBody(), cookie: user });
});

let aiImpl: (model: string, input: any) => Promise<unknown> = async () => ({ response: "" });
const aiCalls: any[] = [];
const testEnv = { ...env, AI: { run: async (m: string, i: any) => (aiCalls.push({ m, i }), aiImpl(m, i)) } };
const callE = async (path: string, o: { method?: string; body?: unknown; cookie?: string } = {}, e: any = testEnv) => {
  const res = await app.request(path, {
    method: o.method ?? "GET",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(o.cookie ? { cookie: o.cookie } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  }, e);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const mk = async (name: string, extra: Record<string, unknown> = {}) =>
  (await call("/api/catalog/programs", { method: "POST", cookie: editor, body: { advertiserId: advId, name, segment: "saas", description: "Ferramenta de e-mail para criadores.", ...extra } })).body.id as string;
const confirm = async (id: string, field: string | string[], patch: Record<string, unknown>) => {
  for (const f of ([] as string[]).concat(field)) {
    await call(`/api/catalog/programs/${id}/sources`, { method: "POST", cookie: editor, body: { sourceType: "official_docs", field: f, url: `https://docs.example.com/${id}/${f}` } });
  }
  expect((await call(`/api/catalog/programs/${id}`, { method: "PATCH", cookie: editor, body: patch })).status).toBe(200);
};
const gen = (cookie: string, body: Record<string, unknown>) => callE("/api/studio/ads/generate", { method: "POST", cookie, body: { channel: "blog", locale: "pt-BR", withModel: false, ...body } });
const setStatus = (cookie: string, id: string, status: string, extra: Record<string, unknown> = {}) =>
  callE(`/api/studio/ads/${id}/status`, { method: "POST", cookie, body: { status, ...extra } });

describe("calendário sazonal", () => {
  it("exige login e começa vazio (nada pré-carregado)", async () => {
    expect((await call("/api/studio/seasonal")).status).toBe(401);
    const r = await call("/api/studio/seasonal", { cookie: user });
    expect(r.body.items).toEqual([]);
  });

  it("só editor cria; métrica exige valor, rótulo e fonte", async () => {
    const base = { month: 11, niche: "Eletrônicos", note: "Procura costuma subir antes da Black Friday." };
    expect((await call("/api/studio/seasonal", { method: "POST", cookie: user, body: base })).status).toBe(403);
    const noSource = await call("/api/studio/seasonal", { method: "POST", cookie: editor, body: { ...base, metricLabel: "Crescimento", metricValue: "+720%" } });
    expect(noSource.status).toBe(422);
    expect(noSource.body.issues).toContain("metric_needs_source");
    const half = await call("/api/studio/seasonal", { method: "POST", cookie: editor, body: { ...base, metricValue: "+10%", sourceUrl: "https://trends.example.com/x" } });
    expect(half.body.issues).toContain("metric_incomplete");
    const ok = await call("/api/studio/seasonal", { method: "POST", cookie: editor, body: { ...base, metricLabel: "Crescimento", metricValue: "+720%", sourceUrl: "https://trends.example.com/x" } });
    expect(ok.status).toBe(201);
  });

  it("rascunho não aparece para usuários; publicado aparece com programas e fonte", async () => {
    const pid = await mk("Sazonal Prog");
    const c1 = await call("/api/studio/seasonal", { method: "POST", cookie: editor, body: { month: 12, niche: "Presentes", programIds: [pid] } });
    expect((await call("/api/studio/seasonal?month=12", { cookie: user })).body.items).toHaveLength(0);
    expect((await call("/api/studio/seasonal/manage", { cookie: editor })).body.items.some((i: any) => i.id === c1.body.id)).toBe(true);
    expect((await call("/api/studio/seasonal/manage", { cookie: user })).status).toBe(403);
    await call(`/api/studio/seasonal/${c1.body.id}`, { method: "PATCH", cookie: editor, body: { status: "published" } });
    const list = await call("/api/studio/seasonal?month=12", { cookie: user });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].programs[0].name).toBe("Sazonal Prog");
    expect(list.body.items[0].metricValue).toBeNull();
  });

  it("programa inexistente é recusado; remover a fonte de uma métrica existente é recusado", async () => {
    const bad = await call("/api/studio/seasonal", { method: "POST", cookie: editor, body: { month: 3, niche: "X1", programIds: ["nope"] } });
    expect(bad.status).toBe(422);
    const c = await call("/api/studio/seasonal", { method: "POST", cookie: editor, body: { month: 3, niche: "Moda", metricLabel: "Buscas", metricValue: "+50%", sourceUrl: "https://trends.example.com/m" } });
    const p = await call(`/api/studio/seasonal/${c.body.id}`, { method: "PATCH", cookie: editor, body: { sourceUrl: null } });
    expect(p.status).toBe(422);
    expect((await call(`/api/studio/seasonal/${c.body.id}`, { method: "DELETE", cookie: editor })).status).toBe(200);
    expect((await call(`/api/studio/seasonal/${c.body.id}`, { method: "DELETE", cookie: editor })).status).toBe(404);
  });
});

describe("rascunhos de divulgação", () => {
  it("gera sem modelo, com divulgação de afiliado, sem chamar o modelo e sem publicar", async () => {
    const pid = await mk("Mail Pro");
    await confirm(pid, "accepts_organic", { acceptsOrganic: "yes" });
    aiCalls.length = 0;
    const r = await gen(user, { programIds: [pid] });
    expect(r.status).toBe(201);
    expect(aiCalls).toHaveLength(0);
    const d = r.body.items[0];
    expect(d.title).toContain("Mail Pro");
    expect(d.disclosure).toMatch(/afiliado/i);
    expect(d.channelCheck).toBe("ok");
    expect(d.textSource).toBe("catalog");
    expect(d.status).toBe("draft");
    expect(r.body.publishedAnywhere).toBe(false);
  });

  it("não exporta antes de aprovar; aprovado exporta texto com a divulgação", async () => {
    const pid = await mk("Export Prog");
    await confirm(pid, "accepts_organic", { acceptsOrganic: "yes" });
    const id = (await gen(user, { programIds: [pid], userLink: "https://meulink.example.com/abc" })).body.items[0].id;
    expect((await callE(`/api/studio/ads/${id}/export`, { cookie: user })).status).toBe(409);
    expect((await setStatus(user, id, "approved")).status).toBe(200);
    const ex = await callE(`/api/studio/ads/${id}/export`, { cookie: user });
    expect(ex.body.text).toContain("https://meulink.example.com/abc");
    expect(ex.body.text).toMatch(/afiliado/i);
    expect(ex.body.published).toBe(false);
  });

  it("canal bloqueado não aprova; canal não verificado exige ciência", async () => {
    const blocked = await mk("No Social");
    await confirm(blocked, "accepts_social", { acceptsSocial: "no" });
    const b = (await gen(user, { programIds: [blocked], channel: "instagram" })).body.items[0];
    expect(b.channelCheck).toBe("blocked");
    const rb = await setStatus(user, b.id, "approved", { acknowledgeUnverified: true });
    expect(rb.status).toBe(422);
    expect(rb.body.error).toBe("channel_blocked");

    const unk = await mk("Unknown Social");
    const u = (await gen(user, { programIds: [unk], channel: "youtube" })).body.items[0];
    expect(u.channelCheck).toBe("unverified");
    expect((await setStatus(user, u.id, "approved")).body.error).toBe("needs_acknowledgement");
    expect((await setStatus(user, u.id, "approved", { acknowledgeUnverified: true })).status).toBe(200);
  });

  it("promessa de ganho e número fora do catálogo impedem a aprovação; editar depois de aprovar reabre", async () => {
    const pid = await mk("Edit Prog");
    await confirm(pid, "accepts_organic", { acceptsOrganic: "yes" });
    const id = (await gen(user, { programIds: [pid] })).body.items[0].id;
    await callE(`/api/studio/ads/${id}`, { method: "PATCH", cookie: user, body: { description: "Renda garantida todo mês!" } });
    const r1 = await setStatus(user, id, "approved");
    expect(r1.status).toBe(422);
    expect(r1.body.issues).toContain("forbidden_claim");
    await callE(`/api/studio/ads/${id}`, { method: "PATCH", cookie: user, body: { description: "Comissão de 50% garantida pela rede." } });
    expect((await setStatus(user, id, "approved")).body.issues).toEqual(expect.arrayContaining(["forbidden_claim", "ungrounded"]));
    await callE(`/api/studio/ads/${id}`, { method: "PATCH", cookie: user, body: { description: "Ferramenta de e-mail para criadores, vale conhecer." } });
    expect((await setStatus(user, id, "approved")).status).toBe(200);
    const edited = await callE(`/api/studio/ads/${id}`, { method: "PATCH", cookie: user, body: { title: "Outro título" } });
    expect(edited.body.item.status).toBe("draft");
    expect(edited.body.item.textSource).toBe("user");
  });

  it("texto do modelo ancorado é usado; com número inventado ou promessa, volta ao texto do catálogo", async () => {
    const pid = await mk("Model Prog");
    await confirm(pid, ["commission_type", "commission_percent", "accepts_organic"], { commissionType: "percent", commissionPercent: 30, acceptsOrganic: "yes" });
    aiImpl = async () => ({ response: "Uma ferramenta prática para quem cria conteúdo por e-mail." });
    const good = await gen(user, { programIds: [pid], withModel: true });
    expect(good.body.items[0].textSource).toBe("model");
    expect(aiCalls.at(-1).i.messages[0].content).toMatch(/do not mention commissions/i);

    aiImpl = async () => ({ response: "Receba 99% de comissão neste programa" });
    const pidB = await mk("Model Prog B");
    const bad = await gen(user, { programIds: [pidB], withModel: true });
    expect(bad.body.items[0].textSource).toBe("catalog");
    expect(bad.body.items[0].description).toBe("Ferramenta de e-mail para criadores.");

    aiImpl = async () => ({ response: "Um produto sem risco para todos." });
    const pidC = await mk("Model Prog C");
    const promise = await gen(user, { programIds: [pidC], withModel: true });
    expect(promise.body.items[0].textSource).toBe("catalog");
    aiImpl = async () => ({ response: "" });
  });

  it("pula programa inativo e inexistente; limita o lote a 10", async () => {
    const closed = await mk("Closed Prog");
    await call(`/api/catalog/programs/${closed}/status`, { method: "POST", cookie: editor, body: { lifecycleStatus: "closed" } });
    const r = await gen(user, { programIds: [closed, "nope"] });
    expect(r.body.items).toHaveLength(0);
    expect(r.body.skipped).toEqual(expect.arrayContaining([{ programId: closed, reason: "not_active" }, { programId: "nope", reason: "not_found" }]));
    const many = await gen(user, { programIds: Array.from({ length: 11 }, (_, i) => `p${i}`) });
    expect(many.status).toBe(400);
  });

  it("rascunhos são privados; transições e exclusão", async () => {
    const pid = await mk("Private Prog");
    await confirm(pid, "accepts_organic", { acceptsOrganic: "yes" });
    const id = (await gen(user, { programIds: [pid] })).body.items[0].id;
    expect((await callE(`/api/studio/ads/${id}`, { method: "PATCH", cookie: other, body: { title: "x" } })).status).toBe(404);
    expect((await callE(`/api/studio/ads/${id}/export`, { cookie: other })).status).toBe(404);
    expect((await callE("/api/studio/ads", { cookie: other })).body.items.some((i: any) => i.id === id)).toBe(false);
    expect((await setStatus(user, id, "discarded")).status).toBe(200);
    expect((await setStatus(user, id, "approved")).status).toBe(409);
    expect((await callE(`/api/studio/ads/${id}`, { method: "DELETE", cookie: user })).status).toBe(200);
  });

  it("apagar a conta apaga os rascunhos e a exportação os inclui", async () => {
    const gone = await login("gone-studio@example.com");
    const pid = await mk("Gone Prog");
    await gen(gone, { programIds: [pid] });
    const exp = await call("/api/me/export", { cookie: gone });
    expect(exp.body.adDrafts?.length ?? exp.body.ops?.adDrafts?.length).toBeGreaterThan(0);
    await call("/api/me", { method: "DELETE", cookie: gone });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ad_drafts WHERE program_name = 'Gone Prog'").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
