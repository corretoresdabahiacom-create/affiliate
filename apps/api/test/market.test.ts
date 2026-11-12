import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

let sup = "", mkt = "";
beforeAll(async () => { sup = await login("sup@example.com"); mkt = await login("mkt@example.com"); });
const KEY = btoa("0123456789abcdef0123456789abcdef");
const benv = { ...env, CREDENTIALS_KEY: KEY, APP_URL: "https://app.example.com" } as any;
const aiCalls: any[] = [];
let aiImpl: (m: string, i: any) => Promise<unknown> = async () => ({ response: "" });
const menv = { ...benv, AI: { run: async (m: string, i: any) => (aiCalls.push({ m, i }), aiImpl(m, i)) } };
const callE = async (path: string, o: { method?: string; body?: unknown; cookie?: string } = {}, e: any = menv) => {
  const res = await app.request(path, {
    method: o.method ?? "GET",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(o.cookie ? { cookie: o.cookie } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: "manual",
  } as any, e);
  const loc = res.headers.get("location");
  return { status: res.status, loc, body: (await res.json().catch(() => null)) as any };
};

// ---- Shopee e fornecedor simulados ----
type Hit = { url: string; init?: RequestInit };
let hits: Hit[] = [];
let shopeeImpl: (u: URL, init?: RequestInit) => unknown = () => ({ error: "", response: {} });
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    hits.push({ url, init });
    const u = new URL(url);
    if (u.hostname === "img.example.com") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    if (u.hostname === "supplier.example.com") return new Response(JSON.stringify({ items: [{ id: "S1", name: "Jogo Infantil", price: "18,99", stock: 40, images: ["https://img.example.com/a.jpg"] }] }), { headers: { "content-type": "application/json" } });
    if (u.hostname.includes("shopee")) return new Response(JSON.stringify(shopeeImpl(u, init)), { headers: { "content-type": "application/json" } });
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });
const shopeeHits = () => hits.filter((h) => new URL(h.url).hostname.includes("shopee"));
const hex = async (key: string, msg: string) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const shopeeBody = { provider: "shopee", label: "Minha loja", partnerId: "1001", partnerKey: "super-secret-partner-key" };
async function shopeeConn(cookie: string, expireIn = 14400) {
  const c1 = await callE("/api/integrations/connections", { method: "POST", cookie, body: shopeeBody });
  const id = c1.body.item.id as string;
  const au = await callE(`/api/integrations/connections/${id}/shopee/auth-url`, { cookie });
  const state = new URL(au.body.url).searchParams.get("redirect")!;
  const st = new URL(state).searchParams.get("state")!;
  shopeeImpl = () => ({ error: "", response: { access_token: "AT1", refresh_token: "RT1", expire_in: expireIn } });
  const cb = await callE(`/api/integrations/shopee/callback?state=${st}&code=CODE&shop_id=555`, { cookie });
  return { id, cb, au };
}
const csv = "external_id,name,cost_price,sku,description,stock,images,weight_kg\nA1,Jogo Puxa Batatinhas,\"18,99\",SKU1,Jogo infantil divertido,50,https://img.example.com/1.jpg|https://img.example.com/2.jpg,0.4\nA2,Carrinho,10.50,SKU2,,20,https://img.example.com/3.jpg,0.3\nA3,Sem preço,,SKU3,,1,,\n";
async function supplierConn(cookie: string) {
  const r = await callE("/api/integrations/connections", { method: "POST", cookie, body: { provider: "supplier", label: "Fornecedor X" } });
  return r.body.item.id as string;
}
async function productIds(cookie: string, cid: string) {
  return (await callE(`/api/integrations/supplier/products?connectionId=${cid}`, { cookie })).body.items as any[];
}

describe("cofre e conexões", () => {
  it("sem CREDENTIALS_KEY nada é guardado; com a chave, segredos não voltam e ficam cifrados", async () => {
    expect((await callE("/api/integrations/connections", { method: "POST", cookie: user, body: shopeeBody }, env)).status).toBe(503);
    expect((await callE("/api/integrations/status", { cookie: user }, env)).body.vaultReady).toBe(false);
    const r = await callE("/api/integrations/connections", { method: "POST", cookie: user, body: shopeeBody });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain("super-secret");
    expect(r.body.item.hasSecrets).toBe(true);
    const row = await env.DB.prepare("SELECT config, secrets_enc FROM integration_connections WHERE id = ?").bind(r.body.item.id).first<any>();
    expect(row.config + row.secrets_enc).not.toContain("super-secret");
    expect(row.secrets_enc).toMatch(/^v1\./);
    const list = await callE("/api/integrations/connections", { cookie: user });
    expect(JSON.stringify(list.body)).not.toContain("super-secret");
  });

  it("recusa host que não é da Shopee e é privado entre usuários", async () => {
    const bad = await callE("/api/integrations/connections", { method: "POST", cookie: user, body: { ...shopeeBody, host: "https://evil.example.com" } });
    expect(bad.status).toBe(400);
    const id = await supplierConn(sup);
    expect((await callE("/api/integrations/connections", { cookie: other })).body.items.some((i: any) => i.id === id)).toBe(false);
    expect((await callE(`/api/integrations/connections/${id}`, { method: "DELETE", cookie: other })).status).toBe(404);
  });
});

describe("autorização da Shopee", () => {
  it("gera a URL com assinatura HMAC correta e troca o código por tokens (uso único)", async () => {
    hits = [];
    const { id, au, cb } = await shopeeConn(user);
    const u = new URL(au.body.url);
    expect(u.origin + u.pathname).toBe("https://partner.shopeemobile.com/api/v2/shop/auth_partner");
    const ts = u.searchParams.get("timestamp")!;
    expect(u.searchParams.get("sign")).toBe(await hex(shopeeBody.partnerKey, `1001/api/v2/shop/auth_partner${ts}`));
    expect(cb.status).toBe(302);
    expect(cb.loc).toBe("https://app.example.com/integrations?connected=1");
    const conn = (await callE("/api/integrations/connections", { cookie: user })).body.items.find((i: any) => i.id === id);
    expect(conn.status).toBe("connected");
    expect(conn.config.shopId).toBe("555");
    const tokenCall = shopeeHits().find((h) => h.url.includes("/auth/token/get"))!;
    expect(JSON.parse(String(tokenCall.init!.body))).toMatchObject({ code: "CODE", shop_id: 555, partner_id: 1001 });
    // state não pode ser reutilizado
    const st = new URL(new URL(au.body.url).searchParams.get("redirect")!).searchParams.get("state")!;
    expect((await callE(`/api/integrations/shopee/callback?state=${st}&code=CODE&shop_id=555`, { cookie: user })).loc).toContain("error=invalid_state");
  });

  it("state inválido, de outro usuário ou shop_id estranho não conecta", async () => {
    const c1 = await callE("/api/integrations/connections", { method: "POST", cookie: user, body: shopeeBody });
    expect((await callE(`/api/integrations/shopee/callback?state=${c1.body.item.id}.xxx&code=C&shop_id=1`, { cookie: user })).loc).toContain("error=invalid_state");
    expect((await callE(`/api/integrations/shopee/callback?state=${c1.body.item.id}.xxx&code=C&shop_id=1`, { cookie: other })).loc).toContain("error=invalid_callback");
    expect((await callE(`/api/integrations/shopee/callback?state=${c1.body.item.id}.xxx&code=C&shop_id=abc`, { cookie: user })).loc).toContain("error=invalid_callback");
  });

  it("token vencendo é renovado antes da chamada e as categorias vêm só como sugestão", async () => {
    const { id } = await shopeeConn(user, 1);
    hits = [];
    shopeeImpl = (u) =>
      u.pathname.includes("access_token/get")
        ? { error: "", response: { access_token: "AT2", refresh_token: "RT2", expire_in: 14400 } }
        : { error: "", response: { category_list: [{ category_id: 11, parent_category_id: 0, display_category_name: "Brinquedos", has_children: true }, { category_id: 12, parent_category_id: 11, display_category_name: "Jogos Infantis", has_children: false }, { category_id: 13, parent_category_id: 11, display_category_name: "Bonecas", has_children: false }] } };
    const r = await callE(`/api/integrations/connections/${id}/shopee/categories?q=jogo infantil`, { cookie: user });
    expect(r.body.items.map((x: any) => x.id)).toEqual([12]);
    expect(r.body.suggestionOnly).toBe(true);
    expect(shopeeHits().map((h) => new URL(h.url).pathname)).toEqual(["/api/v2/auth/access_token/get", "/api/v2/product/get_category"]);
    const cat = new URL(shopeeHits()[1]!.url);
    expect(cat.searchParams.get("access_token")).toBe("AT2");
    expect(cat.searchParams.get("sign")).toBe(await hex(shopeeBody.partnerKey, `1001/api/v2/product/get_category${cat.searchParams.get("timestamp")}AT2555`));
  });

  it("erro da Shopee é devolvido como veio", async () => {
    const { id } = await shopeeConn(user);
    shopeeImpl = () => ({ error: "error_auth", message: "Invalid access_token" });
    const r = await callE(`/api/integrations/connections/${id}/shopee/channels`, { cookie: user });
    expect(r.status).toBe(502);
    expect(r.body.detail).toContain("Invalid access_token");
  });
});

describe("catálogo do fornecedor", () => {
  it("importa CSV com validação, simula (dryRun) e atualiza por external_id", async () => {
    const cid = await supplierConn(sup);
    const dry = await callE("/api/integrations/supplier/import", { method: "POST", cookie: sup, body: { connectionId: cid, format: "csv", data: csv, dryRun: true } });
    expect(dry.body.valid).toBe(2);
    expect(dry.body.errors).toHaveLength(1);
    expect((await productIds(sup, cid))).toHaveLength(0);
    const r = await callE("/api/integrations/supplier/import", { method: "POST", cookie: sup, body: { connectionId: cid, format: "csv", data: csv } });
    expect(r.body).toMatchObject({ created: 2, updated: 0 });
    const again = await callE("/api/integrations/supplier/import", { method: "POST", cookie: sup, body: { connectionId: cid, format: "csv", data: csv } });
    expect(again.body).toMatchObject({ created: 0, updated: 2 });
    const p = (await productIds(sup, cid)).find((x) => x.externalId === "A1");
    expect(p.costPrice).toBe(18.99);
    expect(p.images).toHaveLength(2);
    const missing = await callE("/api/integrations/supplier/import", { method: "POST", cookie: sup, body: { connectionId: cid, format: "csv", data: "name\nx" } });
    expect(missing.status).toBe(400);
  });

  it("importa JSON com mapeamento e preço em formato brasileiro; sincroniza o endpoint https configurado", async () => {
    const mk = await callE("/api/integrations/connections", { method: "POST", cookie: sup, body: { provider: "supplier", label: "API X", url: "https://supplier.example.com/products", token: "tok123", mapping: { externalId: "sku", costPrice: "preco.valor", name: "titulo" } } });
    const cid = mk.body.item.id;
    const imp = await callE("/api/integrations/supplier/import", { method: "POST", cookie: sup, body: { connectionId: cid, format: "json", data: JSON.stringify({ items: [{ sku: "Z9", titulo: "Mouse", preco: { valor: "1.234,56" } }] }) } });
    expect(imp.body.created).toBe(1);
    expect((await productIds(sup, cid))[0].costPrice).toBe(1234.56);
    hits = [];
    const sync = await callE(`/api/integrations/connections/${cid}/supplier/sync`, { method: "POST", cookie: sup });
    expect(sync.status).toBe(200);
    expect((hits[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
  });

  it("não sincroniza endpoints http, IP ou localhost", async () => {
    for (const url of ["https://127.0.0.1/x", "https://localhost/x", "https://intranet/x"]) {
      const mk = await callE("/api/integrations/connections", { method: "POST", cookie: sup, body: { provider: "supplier", label: "bad", url } });
      const r = await callE(`/api/integrations/connections/${mk.body.item.id}/supplier/sync`, { method: "POST", cookie: sup });
      expect(r.status).toBe(422);
    }
    expect((await callE("/api/integrations/connections", { method: "POST", cookie: sup, body: { provider: "supplier", label: "bad", url: "http://supplier.example.com/x" } })).status).toBe(400);
  });
});

describe("montagem de loja e publicação com autorização", () => {
  let sid = "", cid = "", ids: string[] = [];
  const build = (body: Record<string, unknown> = {}) => callE("/api/market/store/build", { method: "POST", cookie: mkt, body: { connectionId: sid, productIds: ids, markupPercent: 100, withModel: false, ...body } });

  it("prepara", async () => {
    sid = (await shopeeConn(mkt)).id;
    cid = await supplierConn(mkt);
    await callE("/api/integrations/supplier/import", { method: "POST", cookie: mkt, body: { connectionId: cid, format: "csv", data: csv } });
    ids = (await productIds(mkt, cid)).map((p) => p.id);
    expect(ids).toHaveLength(2);
  });

  it("exige uma regra de preço e no máximo 50 produtos", async () => {
    expect((await build({ markupPercent: 10, fixedPrice: 30 })).status).toBe(400);
    expect((await build({ markupPercent: undefined })).status).toBe(400);
    expect((await build({ productIds: Array.from({ length: 51 }, (_, i) => `p${i}`) })).status).toBe(400);
  });

  it("gera rascunhos com preço por markup, margem sem taxas e nada publicado", async () => {
    hits = [];
    const r = await build();
    expect(r.status).toBe(201);
    expect(r.body.published).toBe(false);
    expect(shopeeHits()).toHaveLength(0);
    const a1 = r.body.items.find((i: any) => i.productName === "Jogo Puxa Batatinhas");
    expect(a1.price).toBe(37.98);
    expect(a1.margin).toEqual({ amount: 18.99, percentOfPrice: 50, feesIncluded: false });
    expect(a1.status).toBe("draft");
    expect(a1.issues).toEqual(expect.arrayContaining(["category_missing", "logistics_missing"]));
    expect(a1.images).toHaveLength(2);
    const again = await build();
    expect(again.body.items).toHaveLength(0);
    expect(again.body.skipped.every((s: any) => s.reason === "already_listed")).toBe(true);
  });

  it("autorização exige a contagem certa e sem pendências; editar derruba a autorização", async () => {
    const list = (await callE("/api/market/listings", { cookie: mkt })).body.items.filter((i: any) => i.connectionId === sid);
    const lids = list.map((i: any) => i.id);
    expect((await callE("/api/market/listings/authorize", { method: "POST", cookie: mkt, body: { listingIds: lids, confirmCount: 1 } })).body.error).toBe("confirm_count_mismatch");
    const first = await callE("/api/market/listings/authorize", { method: "POST", cookie: mkt, body: { listingIds: lids, confirmCount: lids.length } });
    expect(first.body.authorized).toHaveLength(0);
    expect(first.body.rejected[0].issues).toContain("category_missing");
    await callE("/api/market/listings/bulk-patch", { method: "POST", cookie: mkt, body: { listingIds: lids, categoryId: 12, logisticsChannelIds: [80001], weightKg: 0.5 } });
    const ok = await callE("/api/market/listings/authorize", { method: "POST", cookie: mkt, body: { listingIds: lids, confirmCount: lids.length } });
    expect(ok.body.authorized).toHaveLength(2);
    const ed = await callE(`/api/market/listings/${lids[0]}`, { method: "PATCH", cookie: mkt, body: { price: 40 } });
    expect(ed.body.item.status).toBe("draft");
    // preço igual ou abaixo do custo não autoriza
    await callE(`/api/market/listings/${lids[0]}`, { method: "PATCH", cookie: mkt, body: { price: 5 } });
    const low = await callE("/api/market/listings/authorize", { method: "POST", cookie: mkt, body: { listingIds: [lids[0]], confirmCount: 1 } });
    expect(low.body.rejected[0].issues).toContain("price_not_above_cost");
    await callE(`/api/market/listings/${lids[0]}`, { method: "PATCH", cookie: mkt, body: { price: 40 } });
  });

  it("só publica o autorizado; publica uma vez; guarda item_id; erro da Shopee vira falha visível", async () => {
    const list = (await callE("/api/market/listings", { cookie: mkt })).body.items.filter((i: any) => i.connectionId === sid);
    const [a, b] = list.map((i: any) => i.id);
    await callE(`/api/market/listings/${b}/status`, { method: "POST", cookie: mkt, body: { status: "draft" } });
    await callE("/api/market/listings/authorize", { method: "POST", cookie: mkt, body: { listingIds: [a], confirmCount: 1 } });
    hits = [];
    shopeeImpl = (u) =>
      u.pathname.includes("upload_image") ? { error: "", response: { image_info: { image_id: "img-1" } } }
      : u.pathname.includes("add_item") ? { error: "", response: { item_id: 987654 } }
      : { error: "", response: {} };
    const r = await callE("/api/market/listings/publish", { method: "POST", cookie: mkt, body: { listingIds: [a, b] } });
    expect(r.body.results.find((x: any) => x.id === a)).toMatchObject({ ok: true, itemId: "987654" });
    expect(r.body.results.find((x: any) => x.id === b)).toMatchObject({ ok: false, error: "not_authorized" });
    const add = shopeeHits().filter((h) => h.url.includes("add_item"));
    expect(add).toHaveLength(1);
    const body = JSON.parse(String(add[0]!.init!.body));
    expect(body).toMatchObject({ category_id: 12, original_price: 40, weight: 0.5, seller_stock: [{ stock: 50 }], logistic_info: [{ logistic_id: 80001, enabled: true }] });
    expect(body.image.image_id_list).toEqual(["img-1", "img-1"]);
    const again = await callE("/api/market/listings/publish", { method: "POST", cookie: mkt, body: { listingIds: [a] } });
    expect(again.body.results[0].error).toBe("not_authorized");
    expect(shopeeHits().filter((h) => h.url.includes("add_item"))).toHaveLength(1);

    await callE("/api/market/listings/authorize", { method: "POST", cookie: mkt, body: { listingIds: [b], confirmCount: 1 } });
    shopeeImpl = (u) => (u.pathname.includes("upload_image") ? { error: "", response: { image_info: { image_id: "img-2" } } } : { error: "error_param", message: "category requires attribute Brand" });
    const bad = await callE("/api/market/listings/publish", { method: "POST", cookie: mkt, body: { listingIds: [b] } });
    expect(bad.body.results[0].ok).toBe(false);
    expect(bad.body.results[0].error).toContain("category requires attribute Brand");
    const st = (await callE("/api/market/listings?status=failed", { cookie: mkt })).body.items[0];
    expect(st.lastError).toContain("Brand");
    expect(st.status).toBe("failed");
  });

  it("montagem de 50: gera 50 rascunhos de uma vez, todos como rascunho", async () => {
    const big = await supplierConn(mkt);
    const rows = ["external_id,name,cost_price,stock,images,weight_kg"];
    for (let i = 0; i < 50; i++) rows.push(`B${i},Produto ${i},${10 + i},5,https://img.example.com/${i}.jpg,0.2`);
    await callE("/api/integrations/supplier/import", { method: "POST", cookie: mkt, body: { connectionId: big, format: "csv", data: rows.join("\n") } });
    const all = (await productIds(mkt, big)).map((p) => p.id);
    expect(all).toHaveLength(50);
    hits = [];
    const r = await callE("/api/market/store/build", { method: "POST", cookie: mkt, body: { connectionId: sid, productIds: all, fixedPrice: 99.9, withModel: false } });
    expect(r.body.items).toHaveLength(50);
    expect(r.body.items.every((i: any) => i.status === "draft")).toBe(true);
    expect(shopeeHits()).toHaveLength(0);
  });

  it("texto do modelo ancorado entra; com preço inventado é descartado", async () => {
    const c2 = await supplierConn(mkt);
    await callE("/api/integrations/supplier/import", { method: "POST", cookie: mkt, body: { connectionId: c2, format: "csv", data: "external_id,name,cost_price,stock,images,weight_kg\nM1,Caneca Azul,9,10,https://img.example.com/m.jpg,0.3\nM2,Caneca Verde,9,10,https://img.example.com/m2.jpg,0.3" } });
    const [m1, m2] = (await productIds(mkt, c2)).map((p) => p.id);
    aiImpl = async () => ({ response: "Caneca resistente para o dia a dia." });
    const ok = await callE("/api/market/store/build", { method: "POST", cookie: mkt, body: { connectionId: sid, productIds: [m1], markupPercent: 50, withModel: true } });
    expect(ok.body.items[0].textSource).toBe("model");
    aiImpl = async () => ({ response: "Caneca por apenas R$ 5 hoje, renda garantida." });
    const bad = await callE("/api/market/store/build", { method: "POST", cookie: mkt, body: { connectionId: sid, productIds: [m2], markupPercent: 50, withModel: true } });
    expect(bad.body.items[0].textSource).toBe("supplier");
    aiImpl = async () => ({ response: "" });
  });

  it("privacidade: outro usuário não vê nem publica; exportação sem segredos; apagar a conta apaga tudo", async () => {
    const list = (await callE("/api/market/listings", { cookie: mkt })).body.items;
    expect((await callE("/api/market/listings", { cookie: other })).body.items).toHaveLength(0);
    expect((await callE(`/api/market/listings/${list[0].id}`, { method: "PATCH", cookie: other, body: { price: 1 } })).status).toBe(404);
    const gone = await login("gone-market@example.com");
    const g = await callE("/api/integrations/connections", { method: "POST", cookie: gone, body: shopeeBody });
    const exp = await callE("/api/me/export", { cookie: gone });
    expect(JSON.stringify(exp.body)).not.toContain("super-secret");
    expect(JSON.stringify(exp.body)).not.toContain("secrets_enc");
    expect(exp.body.connections ?? exp.body.ops?.connections).toHaveLength(1);
    await callE("/api/me", { method: "DELETE", cookie: gone });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM integration_connections WHERE id = ?").bind(g.body.item.id).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
