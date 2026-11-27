import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";

let counter = 0;
async function raw(path: string, o: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": `10.41.${Math.floor(counter / 250)}.${++counter % 250}`, "x-requested-with": "fetch" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  return app.request(path, { method: o.method ?? "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined }, env);
}
async function call(path: string, o: Parameters<typeof raw>[1] = {}) {
  const r = await raw(path, o);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.42.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.42.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}

let me = "", other = "";
// PNG mínimo válido (cabeçalho + padding) em base64, com mais de 100 caracteres.
const png = (n = 200) => btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(n).fill(7)));

async function newPage(cookie: string, templateId = "drop-vitrine", title = "Meu produto") {
  const r = await call("/api/pages", { method: "POST", cookie, body: { title, templateId } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
/** Deixa a página pronta para publicar: troca os [marcadores], define link e responsável. */
async function makeReady(cookie: string, id: string) {
  const g = await call(`/api/pages/${id}`, { cookie });
  const c = JSON.parse(JSON.stringify(g.body.content).replace(/\[[^\]"]+\]/g, "Texto real"));
  c.settings.ownerName = "Ana";
  c.settings.contactEmail = "ana@example.com";
  for (const b of c.blocks) if (b.ctaUrl === "" || b.ctaUrl === "#preco") b.ctaUrl = b.type === "hero" ? "#preco" : "https://loja.example.com/p";
  const r = await call(`/api/pages/${id}`, { method: "PUT", cookie, body: { content: c } });
  expect(r.status).toBe(200);
  return c;
}

beforeAll(async () => {
  me = await login("pages-me@example.com");
  other = await login("pages-other@example.com");
});

describe("páginas de venda (API)", () => {
  it("exige login (exceto a página pública)", async () => {
    expect((await call("/api/pages")).status).toBe(401);
    expect((await raw("/p/nao-existe")).status).toBe(404);
  });

  it("cria a partir de um modelo, lista e isola por usuário", async () => {
    const id = await newPage(me);
    const list = await call("/api/pages", { cookie: me });
    expect(list.body.items.map((p: any) => p.id)).toContain(id);
    expect((await call("/api/pages", { cookie: other })).body.items).toHaveLength(0);
    expect((await call(`/api/pages/${id}`, { cookie: other })).status).toBe(404);
    expect((await call(`/api/pages/${id}`, { method: "PUT", cookie: other, body: { title: "x" } })).status).toBe(404);
    expect((await call(`/api/pages/${id}`, { method: "DELETE", cookie: other })).status).toBe(404);
    const g = await call(`/api/pages/${id}`, { cookie: me });
    expect(g.body.status).toBe("draft");
    expect(g.body.issues).toEqual(expect.arrayContaining(["placeholder_left", "owner_missing"]));
    expect((await call("/api/pages", { method: "POST", cookie: me, body: { title: "x", templateId: "nao-existe" } })).status).toBe(400);
  });

  it("não publica modelo sem editar nem com promessa de ganho; publica quando está certo", async () => {
    const id = await newPage(me, "drop-impacto", "Tênis leve");
    const blocked = await call(`/api/pages/${id}/publish`, { method: "POST", cookie: me });
    expect(blocked.status).toBe(409);
    expect(blocked.body.issues).toContain("placeholder_left");
    const c = await makeReady(me, id);
    c.blocks[0].headline = "Ganhe dinheiro garantido";
    await call(`/api/pages/${id}`, { method: "PUT", cookie: me, body: { content: c } });
    expect((await call(`/api/pages/${id}/publish`, { method: "POST", cookie: me })).body.issues).toContain("forbidden_claim");
    c.blocks[0].headline = "Tênis leve para o dia a dia";
    await call(`/api/pages/${id}`, { method: "PUT", cookie: me, body: { content: c } });
    const ok = await call(`/api/pages/${id}/publish`, { method: "POST", cookie: me });
    expect(ok.status).toBe(200);
    expect(ok.body.path).toMatch(/^\/p\/tenis-leve-/);
  });

  it("serve a página pública com CSP própria, sem script e com divulgação de afiliado", async () => {
    const id = await newPage(me, "review-comparativo", "Review <b>X</b>");
    const c = await makeReady(me, id);
    c.settings.usesAffiliateLinks = true;
    c.blocks[0].headline = `Vale a pena? <script>alert(1)</script>`;
    await call(`/api/pages/${id}`, { method: "PUT", cookie: me, body: { content: c } });
    const pub = await call(`/api/pages/${id}/publish`, { method: "POST", cookie: me });
    expect(pub.status).toBe(200);
    const r = await raw(pub.body.path);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("comissão");
    const csp = r.headers.get("content-security-policy")!;
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    // despublicar tira do ar
    await call(`/api/pages/${id}/unpublish`, { method: "POST", cookie: me });
    expect((await raw(pub.body.path)).status).toBe(404);
  });

  it("página publicada que deixa de cumprir as regras volta para rascunho", async () => {
    const id = await newPage(me, "leads-foco", "Material grátis");
    const c = await makeReady(me, id);
    expect((await call(`/api/pages/${id}/publish`, { method: "POST", cookie: me })).status).toBe(200);
    c.blocks[0].subheadline = "Renda extra garantida";
    const r = await call(`/api/pages/${id}`, { method: "PUT", cookie: me, body: { content: c } });
    expect(r.body.unpublished).toBe(true);
    expect((await call(`/api/pages/${id}`, { cookie: me })).body.status).toBe("draft");
  });

  it("valida o endereço (slug): único, sem 'img', formato", async () => {
    const a = await newPage(me, "leads-foco", "Página A");
    const b = await newPage(me, "leads-foco", "Página B");
    expect((await call(`/api/pages/${a}`, { method: "PUT", cookie: me, body: { slug: "minha-oferta" } })).status).toBe(200);
    expect((await call(`/api/pages/${b}`, { method: "PUT", cookie: me, body: { slug: "minha-oferta" } })).status).toBe(409);
    for (const bad of ["img", "AB", "com espaço", "-x-", "a/b"]) expect((await call(`/api/pages/${b}`, { method: "PUT", cookie: me, body: { slug: bad } })).status, bad).toBe(400);
  });

  it("rejeita link inseguro e bloco com imagem de outra página", async () => {
    const id = await newPage(me, "drop-vitrine", "Links");
    const g = await call(`/api/pages/${id}`, { cookie: me });
    const bad = JSON.parse(JSON.stringify(g.body.content));
    bad.blocks[0].ctaUrl = "javascript:alert(1)";
    expect((await call(`/api/pages/${id}`, { method: "PUT", cookie: me, body: { content: bad } })).status).toBe(400);
    const foreign = JSON.parse(JSON.stringify(g.body.content));
    foreign.blocks[0].ctaUrl = "";
    foreign.blocks[0].imageId = "11111111-1111-4111-8111-111111111111";
    expect((await call(`/api/pages/${id}`, { method: "PUT", cookie: me, body: { content: foreign } })).body.error).toBe("invalid_image");
  });

  it("envia imagem: confere os bytes, limita tamanho/quantidade e só serve ao público se publicada", async () => {
    const id = await newPage(me, "drop-vitrine", "Com imagem");
    // tipo declarado diferente do real, e SVG disfarçado de PNG
    expect((await call(`/api/pages/${id}/images`, { method: "POST", cookie: me, body: { mime: "image/jpeg", data: png() } })).status).toBe(400);
    const svg = btoa("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".padEnd(150, " "));
    expect((await call(`/api/pages/${id}/images`, { method: "POST", cookie: me, body: { mime: "image/png", data: svg } })).status).toBe(400);
    expect((await call(`/api/pages/${id}/images`, { method: "POST", cookie: other, body: { mime: "image/png", data: png() } })).status).toBe(404);
    const up = await call(`/api/pages/${id}/images`, { method: "POST", cookie: me, body: { mime: "image/png", data: png() } });
    expect(up.status).toBe(201);
    const imgId = up.body.id as string;
    // dono vê; outro usuário e anônimo não
    expect((await raw(`/api/pages/img/${imgId}`, { cookie: me })).status).toBe(200);
    expect((await raw(`/api/pages/img/${imgId}`, { cookie: other })).status).toBe(404);
    // rascunho: público não vê
    expect((await raw(`/p/img/${imgId}`)).status).toBe(404);
    // usa no herói e publica
    const c = await makeReady(me, id);
    c.blocks[0].imageId = imgId;
    expect((await call(`/api/pages/${id}`, { method: "PUT", cookie: me, body: { content: c } })).status).toBe(200);
    const pub = await call(`/api/pages/${id}/publish`, { method: "POST", cookie: me });
    expect(pub.status).toBe(200);
    const img = await raw(`/p/img/${imgId}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");
    expect(await (await raw(pub.body.path)).text()).toContain(`/p/img/${imgId}`);
    // apagar a imagem tira a referência do bloco
    expect((await call(`/api/pages/${id}/images/${imgId}`, { method: "DELETE", cookie: me })).status).toBe(200);
    expect((await call(`/api/pages/${id}`, { cookie: me })).body.content.blocks[0].imageId).toBeNull();
    expect((await raw(`/p/img/${imgId}`)).status).toBe(404);
  });

  it("limita imagens por página", async () => {
    const id = await newPage(me, "drop-vitrine", "Muitas imagens");
    for (let i = 0; i < 12; i++) expect((await call(`/api/pages/${id}/images`, { method: "POST", cookie: me, body: { mime: "image/png", data: png(150 + i) } })).status).toBe(201);
    const r = await call(`/api/pages/${id}/images`, { method: "POST", cookie: me, body: { mime: "image/png", data: png() } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("image_limit");
  });

  it("limita a quantidade de páginas por usuário", async () => {
    const c = await login("pages-limit@example.com");
    for (let i = 0; i < 10; i++) await newPage(c, "leads-foco", `Página ${i}`);
    expect((await call("/api/pages", { method: "POST", cookie: c, body: { title: "Mais uma", templateId: "leads-foco" } })).body.error).toBe("page_limit");
  });

  it("entra na exportação da conta e sai na exclusão", async () => {
    const c = await login("pages-export@example.com");
    const id = await newPage(c, "leads-foco", "Exporta");
    const ex = await call("/api/me/export", { cookie: c });
    expect(ex.body.salesPages.map((p: any) => p.id)).toContain(id);
    expect((await call("/api/me", { method: "DELETE", cookie: c })).status).toBe(200);
    const left = await (env as any).DB.prepare("SELECT COUNT(*) AS n FROM sales_pages WHERE id = ?").bind(id).first();
    expect(left.n).toBe(0);
  });
});
