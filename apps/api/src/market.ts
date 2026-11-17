import { Hono } from "hono";
import { z } from "zod";
import {
  authorizeSchema,
  canListingTransition,
  listingIssues,
  listingPatchSchema,
  margin,
  priceFromMarkup,
  publishSchema,
  storeBuildSchema,
  adClaimIssues,
  attributeValueSchema,
  priceVariants,
  syncProposals,
  variantsSchema,
  variantsSummary,
  type AttributeDef,
  type AttributeValue,
  type ListingStatus,
  type Variants,
} from "@ai/shared";
import { audit, auditStmt } from "./audit";
import { emitManyFrom, notify, notifyStmt } from "./automation";
import { chunks, type Budget } from "./budget";
import { generate } from "./ai";
import type { Row } from "./catalog";
import { ownConn, shopeeCreds, shopeeFail } from "./integrations";
import { requireUser } from "./middleware";
import { allow } from "./ratelimit";
import * as shopee from "./shopee";
import type { AppBindings, Env } from "./types";

export const market = new Hono<AppBindings>();
market.use("*", requireUser);

const uid = (c: any) => c.get("user").id as string;
const now = () => Date.now();
const j = <T>(s: unknown, d: T): T => {
  try { return JSON.parse(String(s)) as T; } catch { return d; }
};

const parseVariants = (v: unknown): Variants | null => (v ? j<Variants | null>(v, null) : null);
const parseSchema = (v: unknown): AttributeDef[] | null => (v ? j<AttributeDef[] | null>(v, null) : null);

export function checkInput(r: Row) {
  return {
    title: r.title as string, description: r.description as string, price: r.price as number, cost: r.cost_price as number, stock: r.stock as number | null,
    weightKg: r.weight_kg as number | null, categoryId: r.category_id as number | null, logisticsChannelIds: j<number[]>(r.logistics_channel_ids, []),
    images: j<string[]>(r.images, []), context: r.context as string, variants: parseVariants(r.variants), attributeSchema: parseSchema(r.attribute_schema),
    attributes: j<AttributeValue[]>(r.attributes, []),
  };
}

export const listingOut = (r: Row) => {
  const price = r.price as number;
  const cost = r.cost_price as number;
  const published = r.status === "published";
  return {
    id: r.id, connectionId: r.connection_id, productId: r.supplier_product_id, productName: r.product_name, title: r.title, description: r.description,
    price, costPrice: cost, currency: r.currency, margin: margin(cost, price), stock: r.stock, weightKg: r.weight_kg, categoryId: r.category_id,
    logisticsChannelIds: j<number[]>(r.logistics_channel_ids, []), images: j<string[]>(r.images, []), textSource: r.text_source, status: r.status,
    externalItemId: r.external_item_id, lastError: r.last_error, authorizedAt: r.authorized_at, publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at,
    variants: parseVariants(r.variants), attributes: j<AttributeValue[]>(r.attributes, []), attributeSchema: parseSchema(r.attribute_schema),
    priceRule: j<Record<string, number> | null>(r.price_rule, null), updateStatus: r.update_status ?? null, lastSyncedAt: r.last_synced_at ?? null,
    issues: published && !r.update_status ? [] : listingIssues(checkInput(r)),
  };
};

/** Lista de atributos da categoria, vinda da Shopee. Null = não foi possível consultar (fica como "não verificado"). */
async function loadSchemas(env: Env, conn: Row, categoryIds: number[]): Promise<Map<number, AttributeDef[] | null>> {
  const out = new Map<number, AttributeDef[] | null>();
  let creds: shopee.ShopeeCreds | null = null;
  for (const id of new Set(categoryIds)) {
    try {
      creds ??= await shopeeCreds(env, conn);
      out.set(id, (await shopee.getAttributes(creds, id)).map((a) => ({ id: a.id, name: a.name, mandatory: a.mandatory, inputType: a.inputType, values: a.values })));
    } catch {
      out.set(id, null);
    }
  }
  return out;
}

const factsText = (p: Row) =>
  [
    `PRODUCT: ${p.name}`,
    p.sku ? `SKU: ${p.sku}` : null,
    p.category ? `SUPPLIER CATEGORY: ${p.category}` : null,
    p.weight_kg != null ? `WEIGHT_KG: ${p.weight_kg}` : null,
    p.stock != null ? `STOCK: ${p.stock}` : null,
    p.description ? `DESCRIPTION (supplier text): ${String(p.description).slice(0, 1500)}` : null,
  ].filter(Boolean).join("\n");

market.get("/listings", async (c) => {
  const s = c.req.query("status");
  const cid = c.req.query("connectionId");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM marketplace_listings WHERE user_id = ? ${s ? "AND status = ?" : ""} ${cid ? "AND connection_id = ?" : ""} ORDER BY created_at DESC, id LIMIT 300`,
  ).bind(...[uid(c), ...(s ? [s] : []), ...(cid ? [cid] : [])]).all<Row>();
  return c.json({ items: results.map(listingOut) });
});

/** "Montagem de loja": até 50 rascunhos de uma vez. Nada é publicado; todos nascem como rascunho. */
market.post("/store/build", async (c) => {
  const p = storeBuildSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const conn = await ownConn(c, p.data.connectionId, "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  if (!(await allow(c.env.DB, `store-build:${uid(c)}`, 10, 60))) return c.json({ error: "rate_limited" }, 429);
  const ids = [...new Set(p.data.productIds)];
  const { results: prods } = await c.env.DB.prepare(
    `SELECT * FROM supplier_products WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
  ).bind(uid(c), ...ids).all<Row>();
  const byId = new Map(prods.map((x) => [x.id as string, x]));
  const { results: existing } = await c.env.DB.prepare(
    "SELECT supplier_product_id FROM marketplace_listings WHERE user_id = ? AND connection_id = ? AND status IN ('draft','approved','publishing','published')",
  ).bind(uid(c), conn.id).all<Row>();
  const taken = new Set(existing.map((e) => e.supplier_product_id as string));

  const skipped: Array<{ productId: string; reason: "not_found" | "already_listed" }> = [];
  const ai: Array<{ productId: string; mode: string; reason: string | null }> = [];
  const budget = c.get("budget");
  const t = now();
  const rule = p.data.fixedPrice != null ? { fixedPrice: p.data.fixedPrice } : { markupPercent: p.data.markupPercent ?? 0 };
  const stmts: D1PreparedStatement[] = [];
  const newIds: string[] = [];
  const aiPending: string[] = [];
  for (const id of ids) {
    const prod = byId.get(id);
    if (!prod) { skipped.push({ productId: id, reason: "not_found" }); continue; }
    if (taken.has(id)) { skipped.push({ productId: id, reason: "already_listed" }); continue; }
    const pv = parseVariants(prod.variants);
    const variants = pv ? priceVariants(pv, rule) : null;
    const sum = variants ? variantsSummary(variants) : null;
    const cost = sum ? sum.minCost : (prod.cost_price as number);
    const price = sum ? sum.minPrice : p.data.fixedPrice != null ? p.data.fixedPrice : priceFromMarkup(cost, p.data.markupPercent ?? 0);
    const stockVal = sum ? sum.stock : (prod.stock as number | null);
    const context = factsText(prod);
    let description = String(prod.description ?? "").trim() || String(prod.name);
    let source: "supplier" | "model" = "supplier";
    const lid = crypto.randomUUID();
    if (p.data.withModel) {
      // Cada texto da IA custa ~7 consultas; o que não couber nesta chamada fica para /listings/ai-text.
      if (budget.can(12)) {
        const g = await generate(c, "listing", `Write the marketplace description for: ${prod.name}`, [{ id, name: prod.name as string, text: context, sourceUrls: [] }], p.data.locale);
        ai.push({ productId: id, mode: g.mode, reason: g.reason });
        if (g.answer && adClaimIssues(g.answer).length === 0) { description = g.answer.slice(0, 3000); source = "model"; }
      } else aiPending.push(lid);
    }
    newIds.push(lid);
    const at = t + newIds.length; // horários distintos: a lista mantém a ordem em que os produtos foram escolhidos
    stmts.push(c.env.DB.prepare(
      `INSERT INTO marketplace_listings (id, user_id, connection_id, supplier_product_id, product_name, title, description, price, cost_price, currency, stock, weight_kg,
        category_id, logistics_channel_ids, images, context, text_source, status, created_at, updated_at, variants, price_rule)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,'[]',?,?,?,'draft',?,?,?,?)`,
    ).bind(lid, uid(c), conn.id, id, prod.name, String(prod.name).slice(0, 120), description.slice(0, 3000), price, cost, prod.currency, stockVal, prod.weight_kg, prod.images, context, source, at, at, variants ? JSON.stringify(variants) : null, JSON.stringify(rule)));
  }
  for (const part of chunks(stmts, 100)) await c.env.DB.batch(part);
  const created = (await ownListings(c, newIds)).map(listingOut);
  await audit(c.env.DB, uid(c), "store.build", conn.id as string, { created: created.length, skipped: skipped.length });
  return c.json({ items: created, skipped, ai, aiPending, published: false }, 201);
});

/**
 * Reescreve com a IA a descrição de rascunhos que ainda estão com o texto do fornecedor.
 * Processa o que couber no orçamento da chamada e devolve `pending` para a próxima.
 */
const aiTextSchema = z.object({ listingIds: z.array(z.string().min(1)).min(1).max(50), locale: z.enum(["pt-BR", "en-US", "es"]).default("pt-BR") });
market.post("/listings/ai-text", async (c) => {
  const p = aiTextSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  if (!(await allow(c.env.DB, `ai-text:${uid(c)}`, 30, 60))) return c.json({ error: "rate_limited" }, 429);
  const budget = c.get("budget");
  const rows = (await ownListings(c, p.data.listingIds)).filter((r) => (r.status === "draft" || r.status === "failed") && r.text_source === "supplier");
  const items: ReturnType<typeof listingOut>[] = [];
  const ai: Array<{ listingId: string; mode: string; reason: string | null }> = [];
  const pending: string[] = [];
  for (const r of rows) {
    if (!budget.can(12)) { pending.push(r.id as string); continue; }
    const g = await generate(c, "listing", `Write the marketplace description for: ${r.product_name}`, [{ id: r.supplier_product_id as string, name: r.product_name as string, text: r.context as string, sourceUrls: [] }], p.data.locale);
    ai.push({ listingId: r.id as string, mode: g.mode, reason: g.reason });
    if (g.answer && adClaimIssues(g.answer).length === 0) {
      await c.env.DB.prepare("UPDATE marketplace_listings SET description=?, text_source='model', authorized_at=NULL, updated_at=? WHERE id=? AND text_source='supplier'").bind(g.answer.slice(0, 3000), now(), r.id).run();
      items.push(listingOut({ ...r, description: g.answer.slice(0, 3000), text_source: "model" }));
    }
  }
  return c.json({ items, ai, pending });
});


/** Cria o item na Shopee. Se o item já foi criado numa tentativa anterior (falha nas variações), só refaz o que faltou. */
async function createOnShopee(env: Env, creds: shopee.ShopeeCreds, r: Row): Promise<string> {
  const v = parseVariants(r.variants);
  let itemId = (r.external_item_id as string | null) ?? null;
  if (!itemId) {
    const imageIds: string[] = [];
    for (const url of j<string[]>(r.images, []).slice(0, 9)) imageIds.push(await shopee.uploadImage(creds, url));
    itemId = await shopee.addItem(creds, {
      title: r.title as string, description: r.description as string, price: r.price as number, stock: r.stock as number, weightKg: r.weight_kg as number,
      categoryId: r.category_id as number, logisticsChannelIds: j<number[]>(r.logistics_channel_ids, []), imageIds, attributes: j<AttributeValue[]>(r.attributes, []), sku: null,
    });
    // Guarda já: se a próxima etapa falhar, a nova tentativa não cria um segundo item.
    await env.DB.prepare("UPDATE marketplace_listings SET external_item_id=? WHERE id=?").bind(itemId, r.id).run();
  }
  if (v) {
    try {
      await shopee.initTierVariation(creds, itemId, { tiers: v.tiers, models: v.models.map((m) => ({ tierIndex: m.tierIndex, sku: m.sku, price: m.price!, stock: m.stock ?? 0 })) });
      const models = await shopee.getModelList(creds, itemId);
      await env.DB.prepare("UPDATE marketplace_listings SET shopee_models=? WHERE id=?").bind(JSON.stringify(models), r.id).run();
    } catch (e) {
      if (e instanceof shopee.ShopeeError) throw new shopee.ShopeeError("variations_failed", `item ${itemId} criado sem variações: ${e.detail}`, e.status);
      throw e;
    }
  }
  return itemId;
}

const modelIdFor = (models: Array<{ modelId: number; tierIndex: number[] }>, tierIndex: number[]) => models.find((m) => m.tierIndex.join(",") === tierIndex.join(","))?.modelId;

/** Envia título, descrição, preço e estoque de um anúncio já publicado. */
async function pushUpdate(env: Env, creds: shopee.ShopeeCreds, r: Row) {
  const itemId = r.external_item_id as string;
  await shopee.updateItem(creds, itemId, { title: r.title as string, description: r.description as string });
  const v = parseVariants(r.variants);
  if (!v) {
    await shopee.updatePrice(creds, itemId, [{ modelId: 0, price: r.price as number }]);
    await shopee.updateStock(creds, itemId, [{ modelId: 0, stock: (r.stock as number) ?? 0 }]);
    return;
  }
  let models = j<Array<{ modelId: number; tierIndex: number[] }>>(r.shopee_models, []);
  if (!models.length) {
    models = await shopee.getModelList(creds, itemId);
    await env.DB.prepare("UPDATE marketplace_listings SET shopee_models=? WHERE id=?").bind(JSON.stringify(models), r.id).run();
  }
  const prices: Array<{ modelId: number; price: number }> = [];
  const stocks: Array<{ modelId: number; stock: number }> = [];
  for (const m of v.models) {
    const id = modelIdFor(models, m.tierIndex);
    if (id == null) throw new shopee.ShopeeError("model_not_found", `variação ${m.tierIndex.join(",")} não existe na Shopee`, 422);
    prices.push({ modelId: id, price: m.price! });
    stocks.push({ modelId: id, stock: m.stock ?? 0 });
  }
  await shopee.updatePrice(creds, itemId, prices);
  await shopee.updateStock(creds, itemId, stocks);
}

/** Só estoque (usado pela sincronização automática que o usuário ligou). */
export async function pushStockOnly(env: Env, creds: shopee.ShopeeCreds, r: Row, newStock: number | null, modelStocks?: number[]) {
  const itemId = r.external_item_id as string;
  const v = parseVariants(r.variants);
  if (!v) return shopee.updateStock(creds, itemId, [{ modelId: 0, stock: newStock ?? 0 }]);
  let models = j<Array<{ modelId: number; tierIndex: number[] }>>(r.shopee_models, []);
  if (!models.length) models = await shopee.getModelList(creds, itemId);
  const list = v.models.map((m, i) => ({ modelId: modelIdFor(models, m.tierIndex)!, stock: modelStocks?.[i] ?? m.stock ?? 0 })).filter((x) => x.modelId != null);
  await shopee.updateStock(creds, itemId, list);
}

const EDITABLE: ListingStatus[] = ["draft", "approved", "failed", "published"];
const ownListing = (c: any, id: string): Promise<Row | null> => c.env.DB.prepare("SELECT * FROM marketplace_listings WHERE id = ? AND user_id = ?").bind(id, uid(c)).first();
/** Vários anúncios do usuário numa consulta só (em pedaços de 90 por causa do limite de 100 parâmetros). Mantém a ordem pedida. */
async function ownListings(c: any, ids: string[]): Promise<Row[]> {
  const uniq = [...new Set(ids)];
  const found = new Map<string, Row>();
  for (const part of chunks(uniq, 90)) {
    const { results } = await (c.env.DB as D1Database).prepare(`SELECT * FROM marketplace_listings WHERE user_id = ? AND id IN (${part.map(() => "?").join(",")})`).bind(uid(c), ...part).all<Row>();
    for (const r of results) found.set(r.id as string, r);
  }
  return uniq.map((id) => found.get(id)).filter((r): r is Row => !!r);
}
/** Campos que não dá para alterar em anúncio já publicado por este sistema. */
const LOCKED_WHEN_PUBLISHED = ["categoryId", "logisticsChannelIds", "images", "attributes", "weightKg"] as const;

const patchSchema = listingPatchSchema.extend({
  attributes: z.array(attributeValueSchema).max(50).optional(),
  /** Preço e estoque por modelo, na ordem das variações do anúncio. */
  modelPrices: z.array(z.number().positive().max(100_000_000)).max(50).optional(),
  modelStocks: z.array(z.number().int().min(0).max(1_000_000)).max(50).optional(),
});

market.patch("/listings/:id", async (c) => {
  const cur = await ownListing(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (!EDITABLE.includes(cur.status as ListingStatus)) return c.json({ error: "not_editable", status: cur.status }, 409);
  const p = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const d = p.data;
  const published = cur.status === "published";
  if (published && LOCKED_WHEN_PUBLISHED.some((k) => d[k] !== undefined)) return c.json({ error: "field_not_updatable" }, 422);
  let variants = parseVariants(cur.variants);
  if (variants && (d.modelPrices || d.modelStocks)) {
    if ((d.modelPrices && d.modelPrices.length !== variants.models.length) || (d.modelStocks && d.modelStocks.length !== variants.models.length)) return c.json({ error: "invalid_input" }, 400);
    variants = { ...variants, models: variants.models.map((m, i) => ({ ...m, ...(d.modelPrices ? { price: d.modelPrices[i] } : {}), ...(d.modelStocks ? { stock: d.modelStocks[i] } : {}) })) };
    if (!variantsSchema.safeParse(variants).success) return c.json({ error: "invalid_input" }, 400);
  }
  const sum = variants ? variantsSummary(variants) : null;
  let schema = cur.attribute_schema as string | null;
  const newCat = d.categoryId !== undefined ? d.categoryId : (cur.category_id as number | null);
  if (newCat && newCat !== cur.category_id) {
    const conn = await ownConn(c, cur.connection_id as string, "shopee");
    const m = conn ? await loadSchemas(c.env, conn, [newCat]) : new Map();
    schema = m.get(newCat) ? JSON.stringify(m.get(newCat)) : null;
  }
  const textChanged = (d.title !== undefined && d.title !== cur.title) || (d.description !== undefined && d.description !== cur.description);
  // Qualquer edição derruba a autorização. Em anúncio publicado, a alteração fica "pendente" até ser autorizada e enviada.
  await c.env.DB.prepare(
    `UPDATE marketplace_listings SET title=?, description=?, price=?, stock=?, weight_kg=?, category_id=?, logistics_channel_ids=?, images=?, attributes=?, attribute_schema=?, variants=?,
       text_source=?, status=?, update_status=?, authorized_at=NULL, last_error=NULL, updated_at=? WHERE id=?`,
  ).bind(
    d.title ?? cur.title, d.description ?? cur.description, sum ? sum.minPrice : (d.price ?? cur.price), sum ? sum.stock : (d.stock ?? cur.stock),
    d.weightKg !== undefined ? d.weightKg : cur.weight_kg, newCat, d.logisticsChannelIds ? JSON.stringify(d.logisticsChannelIds) : cur.logistics_channel_ids,
    d.images ? JSON.stringify(d.images) : cur.images, d.attributes ? JSON.stringify(d.attributes) : cur.attributes, schema, variants ? JSON.stringify(variants) : null,
    textChanged ? "user" : cur.text_source, published ? "published" : "draft", published ? "dirty" : null, now(), cur.id,
  ).run();
  return c.json({ item: listingOut((await ownListing(c, cur.id as string))!) });
});

const bulkSchema = z.object({
  listingIds: z.array(z.string().min(1)).min(1).max(50),
  categoryId: z.number().int().positive().optional(),
  logisticsChannelIds: z.array(z.number().int().positive()).max(10).optional(),
  weightKg: z.number().positive().max(1000).optional(),
  attributes: z.array(attributeValueSchema).max(50).optional(),
});
/** Aplica a mesma categoria, logística, peso ou atributos a vários rascunhos. Volta todos a rascunho. */
market.post("/listings/bulk-patch", async (c) => {
  const p = bulkSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const rows = (await ownListings(c, p.data.listingIds)).filter((cur) => ["draft", "approved", "failed"].includes(cur.status as string));
  const cats = rows.map((r) => (p.data.categoryId ?? (r.category_id as number | null))).filter((x): x is number => !!x);
  const schemas = new Map<string, Map<number, AttributeDef[] | null>>();
  for (const connId of new Set(rows.map((r) => r.connection_id as string))) {
    const conn = await ownConn(c, connId, "shopee");
    schemas.set(connId, conn && cats.length ? await loadSchemas(c.env, conn, cats) : new Map());
  }
  const stmts = rows.map((cur) => {
    const cat = p.data.categoryId ?? (cur.category_id as number | null);
    const sc = cat ? schemas.get(cur.connection_id as string)?.get(cat) : null;
    return c.env.DB.prepare(
      "UPDATE marketplace_listings SET category_id=?, logistics_channel_ids=?, weight_kg=?, attributes=?, attribute_schema=?, status='draft', authorized_at=NULL, updated_at=? WHERE id=?",
    ).bind(
      cat, p.data.logisticsChannelIds ? JSON.stringify(p.data.logisticsChannelIds) : cur.logistics_channel_ids, p.data.weightKg ?? cur.weight_kg,
      p.data.attributes ? JSON.stringify(p.data.attributes) : cur.attributes, sc ? JSON.stringify(sc) : null, now(), cur.id,
    );
  });
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ updated: stmts.length });
});

/** Autorização humana, em lote ou individual. Só passa quem não tem pendência; o usuário confirma a quantidade. */
market.post("/listings/authorize", async (c) => {
  const p = authorizeSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const ids = [...new Set(p.data.listingIds)];
  if (p.data.confirmCount !== ids.length) return c.json({ error: "confirm_count_mismatch", expected: ids.length }, 422);
  const authorized: string[] = [];
  const rejected: Array<{ id: string; issues: string[] }> = [];
  const byId = new Map((await ownListings(c, ids)).map((r) => [r.id as string, r]));
  const stmts: D1PreparedStatement[] = [];
  for (const id of ids) {
    const cur = byId.get(id);
    if (!cur) { rejected.push({ id, issues: ["not_found"] }); continue; }
    const liveUpdate = cur.status === "published" && cur.update_status === "dirty";
    if (!liveUpdate && !canListingTransition(cur.status as ListingStatus, "approved")) { rejected.push({ id, issues: ["invalid_status"] }); continue; }
    const issues = listingIssues(checkInput(cur));
    if (issues.length) { rejected.push({ id, issues }); continue; }
    // A condição no WHERE garante que nada mudou entre a leitura e a autorização.
    if (liveUpdate) stmts.push(c.env.DB.prepare("UPDATE marketplace_listings SET update_status='authorized', authorized_at=?, updated_at=? WHERE id=? AND status='published' AND update_status='dirty' AND updated_at=?").bind(now(), now(), id, cur.updated_at));
    else stmts.push(c.env.DB.prepare("UPDATE marketplace_listings SET status='approved', authorized_at=?, updated_at=? WHERE id=? AND status=? AND updated_at=?").bind(now(), now(), id, cur.status, cur.updated_at));
    authorized.push(id);
  }
  if (stmts.length) {
    const res = await c.env.DB.batch(stmts);
    // Se algum anúncio foi editado no meio do caminho, ele não é autorizado.
    res.forEach((r, i) => { if (!r.meta.changes) { const id = authorized[i]!; rejected.push({ id, issues: ["changed_meanwhile"] }); authorized[i] = ""; } });
    for (let i = authorized.length - 1; i >= 0; i--) if (!authorized[i]) authorized.splice(i, 1);
  }
  await audit(c.env.DB, uid(c), "listing.authorized", null as unknown as string, { count: authorized.length, ids: authorized });
  return c.json({ authorized, rejected });
});

market.post("/listings/:id/status", async (c) => {
  const cur = await ownListing(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  const to = (await c.req.json().catch(() => ({})) as any)?.status as ListingStatus;
  if (to !== "draft" && to !== "discarded") return c.json({ error: "invalid_input" }, 400);
  if (!canListingTransition(cur.status as ListingStatus, to)) return c.json({ error: "invalid_transition", from: cur.status, to }, 409);
  await c.env.DB.prepare("UPDATE marketplace_listings SET status=?, authorized_at=NULL, updated_at=? WHERE id=?").bind(to, now(), cur.id).run();
  return c.json({ item: listingOut((await ownListing(c, cur.id as string))!) });
});

/** Publica na Shopee só o que foi autorizado. Cada item é independente; o erro da Shopee fica registrado como veio. */
market.post("/listings/publish", async (c) => {
  const p = publishSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  // Publicar 50 leva algumas chamadas (orçamento por invocação); o limite é por chamada, não por anúncio.
  if (!(await allow(c.env.DB, `publish:${uid(c)}`, 30, 60))) return c.json({ error: "rate_limited" }, 429);
  const budget = c.get("budget");
  const ids = [...new Set(p.data.listingIds)];
  const rows = await ownListings(c, ids);
  const connIds = new Set(rows.map((r) => r.connection_id as string));
  if (connIds.size > 1) return c.json({ error: "single_connection_only" }, 422);
  const results: Array<{ id: string; ok: boolean; itemId?: string; error?: string; issues?: string[]; updated?: boolean }> = [];
  const known = new Set(rows.map((r) => r.id as string));
  for (const id of ids) if (!known.has(id)) results.push({ id, ok: false, error: "not_found" });
  if (rows.length === 0) return c.json({ results, pendingIds: [], remaining: 0 });

  const conn = await ownConn(c, [...connIds][0]!, "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  let creds: shopee.ShopeeCreds;
  budget.spendFetch(1); // possível renovação do token
  try { creds = await shopeeCreds(c.env, conn); } catch (e) { return shopeeFail(c, e); }

  const pendingIds: string[] = [];
  const events: Array<{ event: "listing.published" | "listing.updated"; data: Record<string, unknown> }> = [];
  const audits: D1PreparedStatement[] = [];
  for (const r of rows) {
    const id = r.id as string;
    const liveUpdate = r.status === "published" && r.update_status === "authorized";
    if (r.status !== "approved" && !liveUpdate) { results.push({ id, ok: false, error: "not_authorized" }); continue; }
    // Custo estimado deste anúncio: chamadas à Shopee e consultas ao D1. Se não couber, fica para a próxima chamada.
    const v = parseVariants(r.variants);
    const fetchCost = liveUpdate ? 3 + (v && !j<unknown[]>(r.shopee_models, []).length ? 1 : 0) : (r.external_item_id ? 0 : Math.min(j<string[]>(r.images, []).length, 9) + 1) + (v ? 2 : 0);
    if (!budget.can(6 + 4, fetchCost)) { pendingIds.push(id); continue; }
    budget.spendFetch(fetchCost);
    const issues = listingIssues(checkInput(r));
    if (issues.length) {
      if (liveUpdate) await c.env.DB.prepare("UPDATE marketplace_listings SET update_status='dirty', authorized_at=NULL, updated_at=? WHERE id=?").bind(now(), id).run();
      else await c.env.DB.prepare("UPDATE marketplace_listings SET status='draft', authorized_at=NULL, updated_at=? WHERE id=?").bind(now(), id).run();
      results.push({ id, ok: false, error: "issues", issues });
      continue;
    }
    // Reserva atômica: dois cliques não publicam nem atualizam duas vezes.
    const claim = liveUpdate
      ? await c.env.DB.prepare("UPDATE marketplace_listings SET update_status='dirty', authorized_at=NULL, updated_at=? WHERE id=? AND user_id=? AND status='published' AND update_status='authorized'").bind(now(), id, uid(c)).run()
      : await c.env.DB.prepare("UPDATE marketplace_listings SET status='publishing', updated_at=? WHERE id=? AND user_id=? AND status='approved'").bind(now(), id, uid(c)).run();
    if (!claim.meta.changes) { results.push({ id, ok: false, error: "not_authorized" }); continue; }
    try {
      if (liveUpdate) {
        await pushUpdate(c.env, creds, r);
        await c.env.DB.prepare("UPDATE marketplace_listings SET update_status=NULL, last_error=NULL, last_synced_at=?, updated_at=? WHERE id=?").bind(now(), now(), id).run();
        audits.push(auditStmt(c.env.DB, uid(c), "listing.updated_live", id, { provider: "shopee", itemId: r.external_item_id }));
        results.push({ id, ok: true, itemId: r.external_item_id as string, updated: true });
        events.push({ event: "listing.updated", data: { listingId: id, productName: r.product_name, itemId: r.external_item_id } });
      } else {
        const hadItem = !!r.external_item_id;
        const itemId = await createOnShopee(c.env, creds, r);
        // Numa nova tentativa o item já existia: o que foi editado depois fica como alteração pendente, para ser autorizada e enviada.
        await c.env.DB.prepare("UPDATE marketplace_listings SET status='published', external_item_id=?, published_at=?, last_error=NULL, update_status=?, last_synced_at=?, updated_at=? WHERE id=?").bind(itemId, now(), hadItem ? "dirty" : null, now(), now(), id).run();
        audits.push(auditStmt(c.env.DB, uid(c), "listing.published", id, { provider: "shopee", itemId }));
        results.push({ id, ok: true, itemId });
        events.push({ event: "listing.published", data: { listingId: id, productName: r.product_name, itemId } });
      }
    } catch (e) {
      const msg = e instanceof shopee.ShopeeError ? `${e.code}: ${e.detail}` : "unexpected_error";
      if (liveUpdate) await c.env.DB.prepare("UPDATE marketplace_listings SET update_status='dirty', last_error=?, updated_at=? WHERE id=?").bind(msg, now(), id).run();
      else await c.env.DB.prepare("UPDATE marketplace_listings SET status='failed', last_error=?, updated_at=? WHERE id=?").bind(msg, now(), id).run();
      results.push({ id, ok: false, error: msg });
    }
  }
  if (audits.length) await c.env.DB.batch(audits);
  await emitManyFrom(c, events);
  const okN = results.filter((x) => x.ok).length;
  const badN = results.filter((x) => !x.ok).length;
  // Uma notificação por lote concluído (não uma por chamada parcial).
  if (!pendingIds.length && (okN || badN)) await notify(c.env.DB, uid(c), "listing.publish", `Publicação na Shopee: ${okN} ok, ${badN} com problema`, null, "/store", { ok: okN, bad: badN }).catch(() => undefined);
  return c.json({ results, pendingIds, remaining: pendingIds.length });
});

/** Compara os anúncios publicados com o catálogo atual do fornecedor (depois de importar ou sincronizar). Só propõe. */
const syncSchema = z.object({ connectionId: z.string().min(1) });
market.post("/sync/preview", async (c) => {
  const p = syncSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  if (!(await ownConn(c, p.data.connectionId, "shopee"))) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, sp.cost_price AS sp_cost, sp.stock AS sp_stock, sp.variants AS sp_variants FROM marketplace_listings l
     JOIN supplier_products sp ON sp.id = l.supplier_product_id WHERE l.user_id = ? AND l.connection_id = ? AND l.status = 'published'`,
  ).bind(uid(c), p.data.connectionId).all<Row>();
  const items = [];
  for (const r of results) {
    const proposal = syncProposals(
      { price: r.price as number, costPrice: r.cost_price as number, stock: r.stock as number | null, variants: parseVariants(r.variants), rule: j<Record<string, number> | null>(r.price_rule, null) },
      { costPrice: r.sp_cost as number, stock: r.sp_stock as number | null, variants: parseVariants(r.sp_variants) },
    );
    if (proposal) items.push({ listingId: r.id, productName: r.product_name, proposal });
  }
  return c.json({ items, checked: results.length, note: "proposals_only" });
});

/** Aplica ao anúncio o que foi proposto. Continua sem ir para a Shopee: vira alteração pendente que precisa de autorização. */
const syncApplySchema = z.object({ connectionId: z.string().min(1), listingIds: z.array(z.string().min(1)).min(1).max(100), kinds: z.array(z.enum(["stock", "price"])).min(1).default(["stock", "price"]) });
market.post("/sync/apply", async (c) => {
  const p = syncApplySchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  let applied = 0;
  // Leitura única (em pedaços) + gravação em lote: cabe no orçamento do plano gratuito mesmo com 100 anúncios.
  const want = [...new Set(p.data.listingIds)];
  const found: Row[] = [];
  for (const part of chunks(want, 90)) {
    const { results } = await (c.env.DB as D1Database).prepare(
      `SELECT l.*, sp.cost_price AS sp_cost, sp.stock AS sp_stock, sp.variants AS sp_variants FROM marketplace_listings l
       JOIN supplier_products sp ON sp.id = l.supplier_product_id WHERE l.user_id = ? AND l.connection_id = ? AND l.status = 'published' AND l.id IN (${part.map(() => "?").join(",")})`,
    ).bind(uid(c), p.data.connectionId, ...part).all<Row>();
    found.push(...results);
  }
  const writes: D1PreparedStatement[] = [];
  for (const r of found) {
    const id = r.id as string;
    const prop = syncProposals(
      { price: r.price as number, costPrice: r.cost_price as number, stock: r.stock as number | null, variants: parseVariants(r.variants), rule: j<Record<string, number> | null>(r.price_rule, null) },
      { costPrice: r.sp_cost as number, stock: r.sp_stock as number | null, variants: parseVariants(r.sp_variants) },
    );
    if (!prop) continue;
    const wantStock = p.data.kinds.includes("stock");
    const wantPrice = p.data.kinds.includes("price");
    let variants = parseVariants(r.variants);
    let price = r.price as number;
    let stock = r.stock as number | null;
    let cost = r.cost_price as number;
    let changed = false;
    if (variants && prop.models) {
      const spv = parseVariants(r.sp_variants);
      variants = {
        ...variants,
        models: variants.models.map((m) => {
          const key = m.sku || m.tierIndex.join(",");
          const pm = prop.models!.find((x) => x.key === key);
          const sm = spv?.models.find((x) => (x.sku || x.tierIndex.join(",")) === key);
          const next = { ...m };
          if (pm?.stock && wantStock) { next.stock = pm.stock.to; changed = true; }
          if (sm && wantPrice) next.costPrice = sm.costPrice; // custo novo acompanha o preço novo
          if (pm?.price && wantPrice) { next.price = pm.price.to; changed = true; }
          return next;
        }),
      };
      const sum = variantsSummary(variants);
      price = sum.minPrice; stock = sum.stock; cost = sum.minCost;
    } else {
      if (prop.stock && wantStock) { stock = prop.stock.to; changed = true; }
      if (prop.price && wantPrice) { price = prop.price.to; cost = r.sp_cost as number; changed = true; }
    }
    if (!changed) continue;
    writes.push(c.env.DB.prepare("UPDATE marketplace_listings SET price=?, stock=?, cost_price=?, variants=?, update_status='dirty', authorized_at=NULL, updated_at=? WHERE id=?")
      .bind(price, stock, cost, variants ? JSON.stringify(variants) : null, now(), id));
    applied++;
  }
  for (const part of chunks(writes, 100)) await c.env.DB.batch(part);
  await audit(c.env.DB, uid(c), "listing.sync_applied", p.data.connectionId, { applied, kinds: p.data.kinds });
  return c.json({ applied, requiresAuthorization: true });
});

/**
 * Sincronização automática de ESTOQUE, só para quem ligou "autoStock" na conexão (a ligação é a autorização prévia).
 * Preço nunca é alterado automaticamente. Roda pelo agendador do Worker.
 */
/** Pausa o estoque automático quando >= 50% dos anúncios com estoque iriam a zero de uma vez (mínimo de 5). */
export const AUTO_STOCK_BREAKER = { share: 0.5, minListings: 5 } as const;

/** Estoque que o fornecedor indica para o anúncio (soma das variações quando houver). Null = desconhecido. */
function autoStockTarget(r: Row): number | null {
  const v = parseVariants(r.variants);
  const sv = parseVariants(r.sp_variants);
  if (v && sv) return v.models.reduce((acc, m) => acc + (sv.models.find((x) => (x.sku || x.tierIndex.join(",")) === (m.sku || m.tierIndex.join(",")))?.stock ?? m.stock ?? 0), 0);
  return (r.sp_stock as number | null) ?? null;
}

export async function runAutoStock(env: Env, budget?: Budget | null): Promise<{ checked: number; updated: number; failed: number }> {
  const stats = { checked: 0, updated: 0, failed: 0 };
  if (budget && !budget.can(4, 2)) return stats;
  const { results: conns } = await env.DB.prepare("SELECT * FROM integration_connections WHERE provider = 'shopee' AND status = 'connected' AND config LIKE '%\"autoStock\":true%'").all<Row>();
  const audits: D1PreparedStatement[] = [];
  for (const conn of conns) {
    if (!j<{ autoStock?: boolean }>(conn.config, {}).autoStock) continue;
    if (budget && !budget.can(4, 2)) break;
    let creds: shopee.ShopeeCreds;
    budget?.spendFetch(1); // possível renovação do token
    try { creds = await shopeeCreds(env, conn); } catch { stats.failed++; continue; }
    // Quem está há mais tempo sem sincronizar vem primeiro: execuções seguidas cobrem a loja toda.
    const { results } = await env.DB.prepare(
      `SELECT l.*, sp.stock AS sp_stock, sp.variants AS sp_variants FROM marketplace_listings l
       JOIN supplier_products sp ON sp.id = l.supplier_product_id WHERE l.connection_id = ? AND l.status = 'published' AND l.update_status IS NULL
       ORDER BY COALESCE(l.last_synced_at, 0) ASC LIMIT 200`,
    ).bind(conn.id).all<Row>();
    // Disjuntor: se o fornecedor "zerou" de uma vez boa parte da loja, é mais provável erro de importação do que
    // ruptura real. Pausa o estoque automático desta loja e avisa; a pessoa confere e religa.
    const zeroing = results.filter((r) => ((r.stock as number | null) ?? 0) > 0 && autoStockTarget(r) === 0).length;
    const live = results.filter((r) => ((r.stock as number | null) ?? 0) > 0).length;
    if (zeroing >= AUTO_STOCK_BREAKER.minListings && zeroing / Math.max(live, 1) >= AUTO_STOCK_BREAKER.share) {
      const cfg = { ...j<Record<string, unknown>>(conn.config, {}), autoStock: false, autoStockPausedAt: now(), autoStockPausedReason: `zeroing:${zeroing}/${live}` };
      await env.DB.batch([
        env.DB.prepare("UPDATE integration_connections SET config = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(cfg), now(), conn.id),
        notifyStmt(env.DB, conn.user_id as string, "autostock.paused", `Estoque automático pausado: ${zeroing} de ${live} anúncios ficariam sem estoque`, "Confira a última importação do fornecedor. Nada foi alterado na Shopee; religue em Integrações quando estiver certo.", "/integrations", { zeroing, live, label: conn.label }),
        auditStmt(env.DB, conn.user_id as string, "listing.stock_auto_paused", conn.id as string, { zeroing, live }),
      ]);
      stats.failed++;
      continue;
    }
    for (const r of results) {
      stats.checked++;
      const v = parseVariants(r.variants);
      const sv = parseVariants(r.sp_variants);
      let write: D1PreparedStatement | null = null;
      let fetches = 1;
      let stocks: number[] | null = null;
      let target: number | null = null;
      if (v && sv) {
        stocks = v.models.map((m) => sv.models.find((x) => (x.sku || x.tierIndex.join(",")) === (m.sku || m.tierIndex.join(",")))?.stock ?? m.stock ?? 0);
        if (stocks.every((x, i) => x === (v.models[i]!.stock ?? 0))) continue;
        if (!j<unknown[]>(r.shopee_models, []).length) fetches = 2;
      } else {
        target = r.sp_stock as number | null;
        if (target == null || target === r.stock) continue;
      }
      if (budget && !budget.can(2, fetches)) break;
      budget?.spendFetch(fetches);
      try {
        if (stocks) {
          await pushStockOnly(env, creds, r, null, stocks);
          const nv = { ...v!, models: v!.models.map((m, i) => ({ ...m, stock: stocks![i]! })) };
          write = env.DB.prepare("UPDATE marketplace_listings SET variants=?, stock=?, last_synced_at=?, updated_at=? WHERE id=?").bind(JSON.stringify(nv), variantsSummary(nv).stock, now(), now(), r.id);
        } else {
          await pushStockOnly(env, creds, r, target);
          write = env.DB.prepare("UPDATE marketplace_listings SET stock=?, last_synced_at=?, updated_at=? WHERE id=?").bind(target, now(), now(), r.id);
        }
        await write.run();
        audits.push(auditStmt(env.DB, r.user_id as string, "listing.stock_auto", r.id as string, { from: r.stock }));
        stats.updated++;
      } catch {
        stats.failed++;
      }
    }
  }
  if (audits.length) await env.DB.batch(audits);
  return stats;
}

market.delete("/listings/:id", async (c) => {
  const cur = await ownListing(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status === "publishing") return c.json({ error: "not_editable", status: cur.status }, 409);
  await c.env.DB.prepare("DELETE FROM marketplace_listings WHERE id = ?").bind(cur.id).run();
  return c.json({ ok: true });
});
