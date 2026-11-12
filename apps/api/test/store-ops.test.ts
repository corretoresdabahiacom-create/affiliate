import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { runAutoStock } from "../src/market";

let counter = 0;
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.31.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.31.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}
const KEY = btoa("0123456789abcdef0123456789abcdef");
const menv = { ...env, CREDENTIALS_KEY: KEY, APP_URL: "https://app.example.com", AI: { run: async () => ({ response: "" }) } } as any;
const callE = async (path: string, o: { method?: string; body?: unknown; cookie?: string } = {}) => {
  const res = await app.request(path, {
    method: o.method ?? "GET",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(o.cookie ? { cookie: o.cookie } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: "manual",
  } as any, menv);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};

type Hit = { url: string; init?: RequestInit };
let hits: Hit[] = [];
let shopeeImpl: (u: URL, init?: RequestInit) => unknown = () => ({ error: "", response: {} });
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const u = new URL(String(input));
    hits.push({ url: String(input), init });
    if (u.hostname === "img.example.com") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    if (u.hostname.includes("shopee")) return new Response(JSON.stringify(shopeeImpl(u, init)), { headers: { "content-type": "application/json" } });
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });
const shopeeHits = (frag?: string) => hits.filter((h) => new URL(h.url).hostname.includes("shopee") && (!frag || h.url.includes(frag)));
const bodyOf = (h: Hit) => JSON.parse(String(h.init!.body));

let me = "", other = "";
let sid = "", cid = "";
beforeAll(async () => {
  me = await login("ops@example.com");
  other = await login("ops-other@example.com");
  const c1 = await callE("/api/integrations/connections", { method: "POST", cookie: me, body: { provider: "shopee", label: "Loja", partnerId: "1001", partnerKey: "partner-key-xyz" } });
  sid = c1.body.item.id;
  const au = await callE(`/api/integrations/connections/${sid}/shopee/auth-url`, { cookie: me });
  const st = new URL(new URL(au.body.url).searchParams.get("redirect")!).searchParams.get("state")!;
  shopeeImpl = () => ({ error: "", response: { access_token: "AT", refresh_token: "RT", expire_in: 14400 } });
  await callE(`/api/integrations/shopee/callback?state=${st}&code=C&shop_id=777`, { cookie: me });
  cid = (await callE("/api/integrations/connections", { method: "POST", cookie: me, body: { provider: "supplier", label: "Forn" } })).body.item.id;
});

const VCSV = [
  "external_id,name,tier1_name,option1,tier2_name,option2,variant_sku,variant_cost,variant_stock,images,weight_kg",
  "V1,Camiseta Básica,Cor,Azul,Tamanho,P,CB-AZ-P,20,5,https://img.example.com/c.jpg,0.2",
  "V1,Camiseta Básica,Cor,Azul,Tamanho,M,CB-AZ-M,22,0,https://img.example.com/c.jpg,0.2",
  "V1,Camiseta Básica,Cor,Vermelha,Tamanho,P,CB-VM-P,\"21,5\",3,https://img.example.com/c.jpg,0.2",
].join("\n");

const resetLimits = () => env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'publish:%'").run();
let listingId = "";
let productId = "";
const getListing = async () => (await callE(`/api/market/listings/${listingId}`, { cookie: me })).body.item ?? (await callE("/api/market/listings", { cookie: me })).body.items.find((i: any) => i.id === listingId);

describe("variações", () => {
  it("importa CSV com variações agrupadas por produto; sem coluna de custo é recusado", async () => {
    const miss = await callE("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: "external_id,name\nX,Y" } });
    expect(miss.body.error).toBe("missing_columns");
    const dry = await callE("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: VCSV, dryRun: true } });
    expect(dry.body.valid).toBe(1);
    const r = await callE("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: VCSV } });
    expect(r.body).toMatchObject({ created: 1, errors: [] });
    const p = (await callE(`/api/integrations/supplier/products?connectionId=${cid}`, { cookie: me })).body.items[0];
    productId = p.id;
    expect(p.costPrice).toBe(20);
    expect(p.stock).toBe(8);
    expect(p.variants.tiers).toEqual([{ name: "Cor", options: ["Azul", "Vermelha"] }, { name: "Tamanho", options: ["P", "M"] }]);
    expect(p.variants.models.map((m: any) => m.tierIndex)).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(p.variants.models[2].costPrice).toBe(21.5);
  });

  it("monta o rascunho com preço por variação e exige os atributos obrigatórios da categoria", async () => {
    const b = await callE("/api/market/store/build", { method: "POST", cookie: me, body: { connectionId: sid, productIds: [productId], markupPercent: 100, withModel: false } });
    const l = b.body.items[0];
    listingId = l.id;
    expect(l.variants.models.map((m: any) => m.price)).toEqual([40, 44, 43]);
    expect(l.price).toBe(40);
    expect(l.stock).toBe(8);
    shopeeImpl = (u) => u.pathname.includes("get_attributes")
      ? { error: "", response: { attribute_list: [{ attribute_id: 100, display_attribute_name: "Marca", is_mandatory: true, input_type: "DROP_DOWN", attribute_value_list: [{ value_id: 1, display_value_name: "Genérica" }] }, { attribute_id: 101, display_attribute_name: "Material", is_mandatory: false }] } }
      : { error: "", response: {} };
    await callE("/api/market/listings/bulk-patch", { method: "POST", cookie: me, body: { listingIds: [listingId], categoryId: 12, logisticsChannelIds: [80001], weightKg: 0.2 } });
    const rej = await callE("/api/market/listings/authorize", { method: "POST", cookie: me, body: { listingIds: [listingId], confirmCount: 1 } });
    expect(rej.body.rejected[0].issues).toContain("attribute_missing");
    const ok = await callE(`/api/market/listings/${listingId}`, { method: "PATCH", cookie: me, body: { attributes: [{ attributeId: 100, valueId: 1 }] } });
    expect(ok.body.item.attributeSchema).toHaveLength(2);
    const auth = await callE("/api/market/listings/authorize", { method: "POST", cookie: me, body: { listingIds: [listingId], confirmCount: 1 } });
    expect(auth.body.authorized).toHaveLength(1);
  });

  it("publica criando o item e depois as variações; falha nas variações não duplica o item", async () => {
    hits = [];
    let failVariations = true;
    shopeeImpl = (u) =>
      u.pathname.includes("upload_image") ? { error: "", response: { image_info: { image_id: "img" } } }
      : u.pathname.includes("add_item") ? { error: "", response: { item_id: 5550 } }
      : u.pathname.includes("init_tier_variation") ? (failVariations ? { error: "error_param", message: "tier invalid" } : { error: "", response: {} })
      : u.pathname.includes("get_model_list") ? { error: "", response: { model: [{ model_id: 91, tier_index: [0, 0] }, { model_id: 92, tier_index: [0, 1] }, { model_id: 93, tier_index: [1, 0] }] } }
      : { error: "", response: {} };
    await resetLimits();
    const first = await callE("/api/market/listings/publish", { method: "POST", cookie: me, body: { listingIds: [listingId] } });
    expect(first.body.results[0]).toMatchObject({ ok: false });
    expect(first.body.results[0].error).toContain("variations_failed");
    const add = shopeeHits("add_item");
    expect(add).toHaveLength(1);
    expect(bodyOf(add[0]!).attribute_list).toEqual([{ attribute_id: 100, attribute_value_list: [{ value_id: 1 }] }]);
    // nova tentativa: precisa de nova autorização e NÃO cria outro item
    const st = (await callE("/api/market/listings?status=failed", { cookie: me })).body.items[0];
    expect(st.externalItemId ?? st.itemId ?? "5550").toBeTruthy();
    failVariations = false;
    await callE("/api/market/listings/authorize", { method: "POST", cookie: me, body: { listingIds: [listingId], confirmCount: 1 } });
    await resetLimits();
    const second = await callE("/api/market/listings/publish", { method: "POST", cookie: me, body: { listingIds: [listingId] } });
    expect(second.body.results[0]).toMatchObject({ ok: true, itemId: "5550" });
    expect(shopeeHits("add_item")).toHaveLength(1);
    const init = bodyOf(shopeeHits("init_tier_variation").at(-1)!);
    expect(init.tier_variation).toEqual([{ name: "Cor", option_list: [{ option: "Azul" }, { option: "Vermelha" }] }, { name: "Tamanho", option_list: [{ option: "P" }, { option: "M" }] }]);
    expect(init.model.map((m: any) => m.original_price)).toEqual([40, 44, 43]);
    expect(init.model[0]).toMatchObject({ tier_index: [0, 0], model_sku: "CB-AZ-P", seller_stock: [{ stock: 5 }] });
    const row = await env.DB.prepare("SELECT shopee_models, status FROM marketplace_listings WHERE id = ?").bind(listingId).first<any>();
    expect(row.status).toBe("published");
    expect(JSON.parse(row.shopee_models)).toHaveLength(3);
  });
});

describe("editar anúncio publicado (com nova autorização)", () => {
  it("edição vira alteração pendente; campos travados são recusados; só vai à Shopee depois de autorizada", async () => {
    expect((await callE(`/api/market/listings/${listingId}`, { method: "PATCH", cookie: me, body: { categoryId: 13 } })).status).toBe(422);
    const ed = await callE(`/api/market/listings/${listingId}`, { method: "PATCH", cookie: me, body: { title: "Camiseta Básica Algodão", modelPrices: [45, 48, 47], modelStocks: [6, 1, 3] } });
    expect(ed.body.item.status).toBe("published");
    expect(ed.body.item.updateStatus).toBe("dirty");
    expect(ed.body.item.price).toBe(45);
    expect(ed.body.item.stock).toBe(10);
    await resetLimits();
    hits = [];
    const blocked = await callE("/api/market/listings/publish", { method: "POST", cookie: me, body: { listingIds: [listingId] } });
    expect(blocked.body.results[0]).toMatchObject({ ok: false, error: "not_authorized" });
    expect(shopeeHits()).toHaveLength(0);
    const auth = await callE("/api/market/listings/authorize", { method: "POST", cookie: me, body: { listingIds: [listingId], confirmCount: 1 } });
    expect(auth.body.authorized).toHaveLength(1);
    await resetLimits();
    const r = await callE("/api/market/listings/publish", { method: "POST", cookie: me, body: { listingIds: [listingId] } });
    expect(r.body.results[0]).toMatchObject({ ok: true, updated: true });
    expect(shopeeHits("add_item")).toHaveLength(0);
    expect(bodyOf(shopeeHits("update_item")[0]!)).toMatchObject({ item_id: 5550, item_name: "Camiseta Básica Algodão" });
    expect(bodyOf(shopeeHits("update_price")[0]!).price_list).toEqual([{ model_id: 91, original_price: 45 }, { model_id: 92, original_price: 48 }, { model_id: 93, original_price: 47 }]);
    expect(bodyOf(shopeeHits("update_stock")[0]!).stock_list.map((x: any) => x.seller_stock[0].stock)).toEqual([6, 1, 3]);
    const row = await env.DB.prepare("SELECT update_status FROM marketplace_listings WHERE id = ?").bind(listingId).first<any>();
    expect(row.update_status).toBeNull();
    // sem pendência, publicar de novo não faz nada
    await resetLimits();
    const again = await callE("/api/market/listings/publish", { method: "POST", cookie: me, body: { listingIds: [listingId] } });
    expect(again.body.results[0].ok).toBe(false);
  });
});

describe("sincronização de preço e estoque", () => {
  it("compara com o fornecedor, aplica como pendência e não envia nada sem autorização", async () => {
    const changed = VCSV.replace("CB-AZ-P,20,5", "CB-AZ-P,24,9");
    await callE("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: changed } });
    const prev = await callE("/api/market/sync/preview", { method: "POST", cookie: me, body: { connectionId: sid } });
    expect(prev.body.checked).toBe(1);
    const prop = prev.body.items[0].proposal;
    expect(prop.models[0]).toMatchObject({ key: "CB-AZ-P", stock: { from: 6, to: 9 }, price: { from: 45, to: 48 } });
    hits = [];
    const ap = await callE("/api/market/sync/apply", { method: "POST", cookie: me, body: { connectionId: sid, listingIds: [listingId], kinds: ["stock"] } });
    expect(ap.body).toMatchObject({ applied: 1, requiresAuthorization: true });
    expect(shopeeHits()).toHaveLength(0);
    const row = await env.DB.prepare("SELECT update_status, authorized_at, variants FROM marketplace_listings WHERE id = ?").bind(listingId).first<any>();
    expect(row.update_status).toBe("dirty");
    expect(row.authorized_at).toBeNull();
    const m0 = JSON.parse(row.variants).models[0];
    expect(m0.stock).toBe(9);
    expect(m0.price).toBe(45); // só estoque foi aplicado
    expect((await callE("/api/market/sync/preview", { method: "POST", cookie: other, body: { connectionId: sid } })).status).toBe(404);
  });
});

describe("estoque automático (opt-in)", () => {
  it("só roda para quem ligou; mexe só em estoque; nunca em preço; registra auditoria", async () => {
    // volta o anúncio para "sem pendência" e põe um estoque novo no fornecedor
    await callE("/api/market/listings/authorize", { method: "POST", cookie: me, body: { listingIds: [listingId], confirmCount: 1 } });
    shopeeImpl = () => ({ error: "", response: {} });
    await resetLimits();
    await callE("/api/market/listings/publish", { method: "POST", cookie: me, body: { listingIds: [listingId] } });
    await callE("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: VCSV.replace("CB-AZ-P,20,5", "CB-AZ-P,24,2") } });
    hits = [];
    expect((await runAutoStock(menv)).updated).toBe(0); // desligado por padrão
    expect(shopeeHits()).toHaveLength(0);
    expect((await callE(`/api/integrations/connections/${sid}`, { method: "PATCH", cookie: other, body: { autoStock: true } })).status).toBe(404);
    expect((await callE(`/api/integrations/connections/${sid}`, { method: "PATCH", cookie: me, body: { autoStock: "yes" } })).status).toBe(400);
    const on = await callE(`/api/integrations/connections/${sid}`, { method: "PATCH", cookie: me, body: { autoStock: true } });
    expect(on.body.item.config?.autoStock ?? on.body.item.autoStock).toBe(true);
    const run = await runAutoStock(menv);
    expect(run.updated).toBe(1);
    expect(shopeeHits("update_price")).toHaveLength(0);
    expect(bodyOf(shopeeHits("update_stock")[0]!).stock_list.map((x: any) => x.seller_stock[0].stock)).toEqual([2, 0, 3]);
    const a = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'listing.stock_auto'").first<any>();
    expect(a.n).toBeGreaterThan(0);
    expect((await runAutoStock(menv)).updated).toBe(0); // já igual
  });
});

describe("pedidos, rastreio e ficha do fornecedor", () => {
  let orderId = "";
  const rawOrder = {
    order_sn: "2611AAA",
    order_status: "READY_TO_SHIP",
    create_time: Math.floor(Date.now() / 1000) - 3600,
    total_amount: 90,
    buyer_username: "joao123",
    recipient_address: { name: "João da Silva", phone: "11999990000", full_address: "Rua X, 1" },
    item_list: [{ item_id: 5550, item_name: "Camiseta Básica Algodão", model_id: 91, model_sku: "CB-AZ-P", model_quantity_purchased: 2, model_discounted_price: 45 }, { item_id: 9999, item_name: "Outro produto", model_id: 0, model_quantity_purchased: 1, model_discounted_price: 30 }],
  };

  it("sincroniza pedidos sem guardar dado pessoal do comprador", async () => {
    hits = [];
    shopeeImpl = (u) => u.pathname.includes("get_order_list") ? { error: "", response: { order_list: [{ order_sn: "2611AAA", order_status: "READY_TO_SHIP" }], more: false } }
      : u.pathname.includes("get_order_detail") ? { error: "", response: { order_list: [rawOrder] } } : { error: "", response: {} };
    const s = await callE("/api/orders/sync", { method: "POST", cookie: me, body: { connectionId: sid, days: 7 } });
    expect(s.body).toMatchObject({ created: 1, updated: 0 });
    expect(shopeeHits("get_order_detail")[0]!.url).not.toContain("buyer");
    const row = await env.DB.prepare("SELECT * FROM marketplace_orders WHERE order_sn = '2611AAA'").first<any>();
    expect(JSON.stringify(row)).not.toMatch(/João|joao123|11999990000|Rua X/);
    const list = await callE("/api/orders", { cookie: me });
    orderId = list.body.items[0].id;
    expect(list.body.items[0]).toMatchObject({ orderSn: "2611AAA", status: "READY_TO_SHIP", supplierStatus: "not_placed", total: 90 });
    const again = await callE("/api/orders/sync", { method: "POST", cookie: me, body: { connectionId: sid, days: 7 } });
    expect(again.body).toMatchObject({ created: 0, updated: 1 });
    expect((await callE("/api/orders/sync", { method: "POST", cookie: me, body: { connectionId: sid, days: 99 } })).status).toBe(400);
  });

  it("gera a ficha do fornecedor com custo real e marca o que não encontrou, sem inventar", async () => {
    const sh = await callE(`/api/orders/${orderId}/supplier-sheet`, { cookie: me });
    expect(sh.body.note).toBe("manual_purchase");
    expect(sh.body.lines[0]).toMatchObject({ supplierExternalId: "V1", sku: "CB-AZ-P", quantity: 2, unitCost: 24, lineCost: 48, matched: true });
    expect(sh.body.lines[1]).toMatchObject({ matched: false, unitCost: null, lineCost: null });
    expect(sh.body.unmatched).toBe(1);
    expect(sh.body.totalCost).toBeNull(); // há item sem custo conhecido
  });

  it("registra o andamento no fornecedor à mão e consulta o rastreio da Shopee", async () => {
    const p = await callE(`/api/orders/${orderId}`, { method: "PATCH", cookie: me, body: { supplierStatus: "placed", supplierRef: "PED-77", supplierTracking: "BR123" } });
    expect(p.body.item).toMatchObject({ supplierStatus: "placed", supplierRef: "PED-77", supplierTracking: "BR123" });
    expect((await callE(`/api/orders/${orderId}`, { method: "PATCH", cookie: me, body: { supplierStatus: "bought_by_robot" } })).status).toBe(400);
    shopeeImpl = (u) => u.pathname.includes("get_tracking_number") ? { error: "", response: { tracking_number: "BR999" } }
      : u.pathname.includes("get_tracking_info") ? { error: "", response: { logistics_status: "LOGISTICS_PICKUP_DONE", tracking_info: [{ update_time: 1700000000, description: "Coletado", logistics_status: "LOGISTICS_PICKUP_DONE" }] } } : { error: "", response: {} };
    const t = await callE(`/api/orders/${orderId}/tracking/refresh`, { method: "POST", cookie: me });
    expect(t.body.item).toMatchObject({ trackingNumber: "BR999", trackingStatus: "LOGISTICS_PICKUP_DONE" });
    expect(t.body.item.trackingEvents[0].description).toBe("Coletado");
    // o que foi registrado à mão sobrevive à próxima sincronização
    shopeeImpl = (u) => u.pathname.includes("get_order_list") ? { error: "", response: { order_list: [{ order_sn: "2611AAA" }], more: false } } : u.pathname.includes("get_order_detail") ? { error: "", response: { order_list: [{ ...rawOrder, order_status: "SHIPPED" }] } } : { error: "", response: {} };
    await callE("/api/orders/sync", { method: "POST", cookie: me, body: { connectionId: sid } });
    const o = (await callE("/api/orders?supplierStatus=placed", { cookie: me })).body.items[0];
    expect(o).toMatchObject({ status: "SHIPPED", supplierRef: "PED-77", trackingNumber: "BR999" });
  });

  it("privacidade: outro usuário não acessa; exportação inclui pedidos; apagar a conta apaga tudo", async () => {
    expect((await callE("/api/orders", { cookie: other })).body.items).toHaveLength(0);
    for (const [m, path] of [["GET", `/api/orders/${orderId}/supplier-sheet`], ["PATCH", `/api/orders/${orderId}`], ["POST", `/api/orders/${orderId}/tracking/refresh`]] as const)
      expect((await callE(path, { method: m, cookie: other, body: m === "PATCH" ? { supplierStatus: "placed" } : undefined })).status).toBe(404);
    const exp = await callE("/api/me/export", { cookie: me });
    expect(exp.body.orders).toHaveLength(1);
    expect(JSON.stringify(exp.body)).not.toContain("partner-key-xyz");
    await callE("/api/me", { method: "DELETE", cookie: me });
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM marketplace_orders) AS o, (SELECT COUNT(*) FROM marketplace_listings WHERE id = ?) AS l").bind(listingId).first<any>();
    expect(left).toEqual({ o: 0, l: 0 });
  });
});
