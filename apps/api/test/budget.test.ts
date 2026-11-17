import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { runAutoStock } from "../src/market";

/**
 * Orçamento por invocação no plano GRATUITO da Cloudflare (docs, nov/2026):
 *  - D1: 50 consultas por invocação (um db.batch conta como 1);
 *  - subrequests externos (fetch): 50 por invocação.
 * Cada app.request é uma invocação. Margem: exigimos <= 45.
 */
const LIMIT = Number(process.env.BUDGET_LIMIT ?? 45);
const RAW = Symbol("raw");
function counted(db: D1Database) {
  const c = { q: 0 };
  const wrap = (st: any): any => new Proxy(st, {
    get(t, p) {
      if (p === RAW) return t;
      if (p === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
      if (p === "run" || p === "first" || p === "all" || p === "raw") return (...a: unknown[]) => { c.q++; return t[p](...a); };
      const v = t[p]; return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const proxy = new Proxy(db as any, {
    get(t, p) {
      if (p === "prepare") return (sql: string) => wrap(t.prepare(sql));
      if (p === "batch") return (sts: any[]) => { c.q++; return t.batch(sts.map((s) => s[RAW] ?? s)); };
      if (p === "exec") return (sql: string) => { c.q++; return t.exec(sql); };
      const v = t[p]; return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { db: proxy as D1Database, c };
}

let counter = 0;
async function login(email: string) {
  const h = (ip: string) => ({ "content-type": "application/json", "x-requested-with": "fetch", "cf-connecting-ip": ip });
  const r1 = await app.request("/api/auth/login", { method: "POST", headers: h(`10.51.0.${++counter % 250}`), body: JSON.stringify({ email }) }, env);
  const token = new URL(((await r1.json()) as any).devLink).searchParams.get("token")!;
  const r2 = await app.request("/api/auth/verify", { method: "POST", headers: h(`10.51.1.${counter % 250}`), body: JSON.stringify({ token }) }, env);
  return r2.headers.get("set-cookie")!.split(";")[0]!;
}
const KEY = btoa("0123456789abcdef0123456789abcdef");
const base = { ...env, CREDENTIALS_KEY: KEY, APP_URL: "https://app.example.com", AI: { run: async () => ({ response: "" }) } } as any;
let ext = 0;
const measured: Array<{ route: string; d1: number; fetch: number }> = [];
async function call(path: string, o: { method?: string; body?: unknown; cookie?: string; label?: string } = {}) {
  const { db, c } = counted(env.DB);
  ext = 0;
  const res = await app.request(path, {
    method: o.method ?? "GET",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", ...(o.cookie ? { cookie: o.cookie } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: "manual",
  } as any, { ...base, DB: db });
  const body = (await res.json().catch(() => null)) as any;
  if (o.label) measured.push({ route: o.label, d1: c.q, fetch: ext });
  return { status: res.status, body, d1: c.q, fetch: ext };
}

let shopeeImpl: (u: URL) => unknown = () => ({ error: "", response: {} });
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const u = new URL(String(input));
    if (u.hostname === "img.example.com") { ext++; return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }); }
    if (u.hostname.includes("shopee")) { ext++; return new Response(JSON.stringify(shopeeImpl(u)), { headers: { "content-type": "application/json" } }); }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

let me = "", sid = "", cid = "";
beforeAll(async () => {
  me = await login("budget@example.com");
  sid = (await call("/api/integrations/connections", { method: "POST", cookie: me, body: { provider: "shopee", label: "Loja", partnerId: "1001", partnerKey: "partner-key-xyz" } })).body.item.id;
  const au = await call(`/api/integrations/connections/${sid}/shopee/auth-url`, { cookie: me });
  const st = new URL(new URL(au.body.url).searchParams.get("redirect")!).searchParams.get("state")!;
  shopeeImpl = () => ({ error: "", response: { access_token: "AT", refresh_token: "RT", expire_in: 14400 } });
  await call(`/api/integrations/shopee/callback?state=${st}&code=C&shop_id=777`, { cookie: me });
  cid = (await call("/api/integrations/connections", { method: "POST", cookie: me, body: { provider: "supplier", label: "Forn" } })).body.item.id;
});

const rows = (n: number) => "external_id,name,cost_price,stock,images,weight_kg\n" + Array.from({ length: n }, (_, i) => `P${i},Produto ${i},${10 + (i % 7)},${5 + (i % 3)},https://img.example.com/${i}.jpg,0.3`).join("\n");

describe("orçamento por requisição no plano gratuito", () => {
  let productIds: string[] = [];
  let listingIds: string[] = [];
  it("importar 500 linhas do fornecedor", async () => {
    const r = await call("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: rows(500) }, label: "supplier/import 500 (novo)" });
    expect(r.status).toBe(200);
    const r2 = await call("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: rows(500) }, label: "supplier/import 500 (atualiza)" });
    expect(r2.status).toBe(200);
    productIds = (await call(`/api/integrations/supplier/products?connectionId=${cid}&limit=50`, { cookie: me, label: "supplier/products" })).body.items.map((p: any) => p.id).slice(0, 50);
    expect(r.d1).toBeLessThanOrEqual(LIMIT);
    expect(r2.d1).toBeLessThanOrEqual(LIMIT);
  });
  it("montar 50 rascunhos", async () => {
    const r = await call("/api/market/store/build", { method: "POST", cookie: me, body: { connectionId: sid, productIds, markupPercent: 80, withModel: false }, label: "store/build 50" });
    expect(r.status).toBe(201);
    listingIds = r.body.items.map((l: any) => l.id);
    expect(listingIds.length).toBe(50);
    expect(r.d1).toBeLessThanOrEqual(LIMIT);
  });
  it("ajustar 50 em lote e autorizar 50", async () => {
    shopeeImpl = () => ({ error: "", response: { attribute_list: [] } });
    const b = await call("/api/market/listings/bulk-patch", { method: "POST", cookie: me, body: { listingIds, categoryId: 12, logisticsChannelIds: [8001], weightKg: 0.3 }, label: "listings/bulk-patch 50" });
    expect(b.status).toBe(200);
    const a = await call("/api/market/listings/authorize", { method: "POST", cookie: me, body: { listingIds, confirmCount: 50 }, label: "listings/authorize 50" });
    expect(a.body.authorized.length).toBe(50);
    expect(b.d1).toBeLessThanOrEqual(LIMIT);
    expect(b.fetch).toBeLessThanOrEqual(LIMIT);
    expect(a.d1).toBeLessThanOrEqual(LIMIT);
  });
  it("publicar 50 (em quantas chamadas forem precisas)", async () => {
    let n = 0;
    shopeeImpl = (u) => u.pathname.includes("upload_image") ? { error: "", response: { image_info: { image_id: "img" } } } : u.pathname.includes("add_item") ? { error: "", response: { item_id: 1000 + n++ } } : { error: "", response: {} };
    let published = 0, calls = 0, worst = { d1: 0, fetch: 0 };
    while (published < 50 && calls < 60) {
      const r = await call("/api/market/listings/publish", { method: "POST", cookie: me, body: { listingIds }, label: `listings/publish #${calls + 1}` });
      calls++;
      published += (r.body.results ?? []).filter((x: any) => x.ok).length;
      worst = { d1: Math.max(worst.d1, r.d1), fetch: Math.max(worst.fetch, r.fetch) };
      if (!r.body.remaining) break;
      await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'publish:%'").run();
    }
    expect(published).toBe(50);
    expect(worst.d1).toBeLessThanOrEqual(LIMIT);
    expect(worst.fetch).toBeLessThanOrEqual(LIMIT);
  });

  it("sincronizar preço/estoque de 50 publicados", async () => {
    await call("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: rows(500).replace(/,5,https/g, ",9,https") } });
    const pv = await call("/api/market/sync/preview", { method: "POST", cookie: me, body: { connectionId: sid }, label: "sync/preview" });
    const ids = pv.body.items.map((i: any) => i.listingId);
    expect(ids.length).toBeGreaterThan(5);
    const ap = await call("/api/market/sync/apply", { method: "POST", cookie: me, body: { connectionId: sid, listingIds: ids, kinds: ["stock"] }, label: `sync/apply ${ids.length}` });
    expect(ap.body.applied).toBe(ids.length);
    expect(pv.d1).toBeLessThanOrEqual(LIMIT);
    expect(ap.d1).toBeLessThanOrEqual(LIMIT);
  });
  it("buscar 120 pedidos", async () => {
    const order = (i: number) => ({ order_sn: `SN${i}`, order_status: "READY_TO_SHIP", create_time: 1_700_000_000 + i, total_amount: 50, item_list: [{ item_id: 1000 + (i % 50), item_name: "P", model_id: 0, model_quantity_purchased: 1, model_discounted_price: 50 }] });
    shopeeImpl = (u) => {
      if (u.pathname.includes("get_order_list")) {
        const cursor = Number(u.searchParams.get("cursor") || 0);
        const page = Array.from({ length: Math.min(50, 120 - cursor) }, (_, k) => ({ order_sn: `SN${cursor + k}` }));
        return { error: "", response: { order_list: page, more: cursor + 50 < 120, next_cursor: String(cursor + 50) } };
      }
      if (u.pathname.includes("get_order_detail")) {
        const sns = (u.searchParams.get("order_sn_list") ?? "").split(",").filter(Boolean);
        return { error: "", response: { order_list: sns.map((sn) => order(Number(sn.slice(2)))) } };
      }
      return { error: "", response: {} };
    };
    const r = await call("/api/orders/sync", { method: "POST", cookie: me, body: { connectionId: sid, days: 7 }, label: "orders/sync 120" });
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(120);
    const again = await call("/api/orders/sync", { method: "POST", cookie: me, body: { connectionId: sid, days: 7 }, label: "orders/sync 120 (de novo)" });
    expect(again.body.updated).toBe(120);
    expect(r.d1).toBeLessThanOrEqual(LIMIT);
    expect(again.d1).toBeLessThanOrEqual(LIMIT);
  });

  it("disjuntor: importação que zera a loja pausa o estoque automático em vez de zerar a Shopee", async () => {
    await call(`/api/integrations/connections/${sid}`, { method: "PATCH", cookie: me, body: { autoStock: true } });
    await call("/api/integrations/supplier/import", { method: "POST", cookie: me, body: { connectionId: cid, format: "csv", data: rows(500).replace(/,(5|6|7|9),https/g, ",0,https") } });
    let stockCalls = 0;
    shopeeImpl = (u) => { if (u.pathname.includes("update_stock")) stockCalls++; return { error: "", response: {} }; };
    const r = await runAutoStock(base);
    expect(r.updated).toBe(0);
    expect(stockCalls).toBe(0);
    const conn = (await call("/api/integrations/connections", { cookie: me })).body.items.find((x: any) => x.id === sid);
    expect(conn.config.autoStock).toBe(false);
    expect(conn.config.autoStockPausedAt).toBeGreaterThan(0);
    const n = (await call("/api/automation/notifications", { cookie: me })).body.items.find((x: any) => x.kind === "autostock.paused");
    expect(n.data.zeroing).toBeGreaterThanOrEqual(5);
    // religar limpa o aviso de pausa
    await call(`/api/integrations/connections/${sid}`, { method: "PATCH", cookie: me, body: { autoStock: true } });
    const again = (await call("/api/integrations/connections", { cookie: me })).body.items.find((x: any) => x.id === sid);
    expect(again.config.autoStockPausedAt).toBeUndefined();
  });
  it("relatório", () => {
    console.log("\nORCAMENTO (D1 / fetch externo por requisição):\n" + measured.map((m) => `${m.route.padEnd(36)} ${String(m.d1).padStart(5)} ${String(m.fetch).padStart(5)}`).join("\n"));
    expect(measured.every((m) => m.d1 <= LIMIT && m.fetch <= LIMIT)).toBe(true);
  });
});
