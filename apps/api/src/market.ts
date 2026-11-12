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
import { audit } from "./audit";
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
    `SELECT * FROM marketplace_listings WHERE user_id = ? ${s ? "AND status = ?" : ""} ${cid ? "AND connection_id = ?" : ""} ORDER BY created_at DESC LIMIT 300`,
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

  const created: ReturnType<typeof listingOut>[] = [];
  const skipped: Array<{ productId: string; reason: "not_found" | "already_listed" }> = [];
  const ai: Array<{ productId: string; mode: string; reason: string | null }> = [];
  for (const id of ids) {
    const prod = byId.get(id);
    if (!prod) { skipped.push({ productId: id, reason: "not_found" }); continue; }
    if (taken.has(id)) { skipped.push({ productId: id, reason: "already_listed" }); continue; }
    const rule = p.data.fixedPrice != null ? { fixedPrice: p.data.fixedPrice } : { markupPercent: p.data.markupPercent ?? 0 };
    const pv = parseVariants(prod.variants);
    const variants = pv ? priceVariants(pv, rule) : null;
    const sum = variants ? variantsSummary(variants) : null;
    let cost = sum ? sum.minCost : (prod.cost_price as number);
    const price = sum ? sum.minPrice : p.data.fixedPrice != null ? p.data.fixedPrice : priceFromMarkup(cost, p.data.markupPercent ?? 0);
    const stockVal = sum ? sum.stock : (prod.stock as number | null);
    const context = factsText(prod);
    let description = String(prod.description ?? "").trim() || String(prod.name);
    let source: "supplier" | "model" = "supplier";
    if (p.data.withModel) {
      const g = await generate(c, "listing", `Write the marketplace description for: ${prod.name}`, [{ id, name: prod.name as string, text: context, sourceUrls: [] }], p.data.locale);
      ai.push({ productId: id, mode: g.mode, reason: g.reason });
      if (g.answer && adClaimIssues(g.answer).length === 0) { description = g.answer.slice(0, 3000); source = "model"; }
    }
    const lid = crypto.randomUUID();
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO marketplace_listings (id, user_id, connection_id, supplier_product_id, product_name, title, description, price, cost_price, currency, stock, weight_kg,
        category_id, logistics_channel_ids, images, context, text_source, status, created_at, updated_at, variants, price_rule)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,'[]',?,?,?,'draft',?,?,?,?)`,
    ).bind(lid, uid(c), conn.id, id, prod.name, String(prod.name).slice(0, 120), description.slice(0, 3000), price, cost, prod.currency, stockVal, prod.weight_kg, prod.images, context, source, t, t, variants ? JSON.stringify(variants) : null, JSON.stringify(rule)).run();
    created.push(listingOut((await c.env.DB.prepare("SELECT * FROM marketplace_listings WHERE id = ?").bind(lid).first<Row>())!));
  }
  await audit(c.env.DB, uid(c), "store.build", conn.id as string, { created: created.length, skipped: skipped.length });
  return c.json({ items: created, skipped, ai, published: false }, 201);
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
  const rows: Row[] = [];
  for (const id of new Set(p.data.listingIds)) {
    const cur = await ownListing(c, id);
    if (cur && ["draft", "approved", "failed"].includes(cur.status as string)) rows.push(cur);
  }
  const cats = rows.map((r) => (p.data.categoryId ?? (r.category_id as number | null))).filter((x): x is number => !!x);
  const schemas = new Map<string, Map<number, AttributeDef[] | null>>();
  for (const connId of new Set(rows.map((r) => r.connection_id as string))) {
    const conn = await ownConn(c, connId, "shopee");
    schemas.set(connId, conn && cats.length ? await loadSchemas(c.env, conn, cats) : new Map());
  }
  let n = 0;
  for (const cur of rows) {
    const cat = p.data.categoryId ?? (cur.category_id as number | null);
    const sc = cat ? schemas.get(cur.connection_id as string)?.get(cat) : null;
    await c.env.DB.prepare(
      "UPDATE marketplace_listings SET category_id=?, logistics_channel_ids=?, weight_kg=?, attributes=?, attribute_schema=?, status='draft', authorized_at=NULL, updated_at=? WHERE id=?",
    ).bind(
      cat, p.data.logisticsChannelIds ? JSON.stringify(p.data.logisticsChannelIds) : cur.logistics_channel_ids, p.data.weightKg ?? cur.weight_kg,
      p.data.attributes ? JSON.stringify(p.data.attributes) : cur.attributes, sc ? JSON.stringify(sc) : null, now(), cur.id,
    ).run();
    n++;
  }
  return c.json({ updated: n });
});

/** Autorização humana, em lote ou individual. Só passa quem não tem pendência; o usuário confirma a quantidade. */
market.post("/listings/authorize", async (c) => {
  const p = authorizeSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const ids = [...new Set(p.data.listingIds)];
  if (p.data.confirmCount !== ids.length) return c.json({ error: "confirm_count_mismatch", expected: ids.length }, 422);
  const authorized: string[] = [];
  const rejected: Array<{ id: string; issues: string[] }> = [];
  for (const id of ids) {
    const cur = await ownListing(c, id);
    if (!cur) { rejected.push({ id, issues: ["not_found"] }); continue; }
    const liveUpdate = cur.status === "published" && cur.update_status === "dirty";
    if (!liveUpdate && !canListingTransition(cur.status as ListingStatus, "approved")) { rejected.push({ id, issues: ["invalid_status"] }); continue; }
    const issues = listingIssues(checkInput(cur));
    if (issues.length) { rejected.push({ id, issues }); continue; }
    if (liveUpdate) await c.env.DB.prepare("UPDATE marketplace_listings SET update_status='authorized', authorized_at=?, updated_at=? WHERE id=?").bind(now(), now(), id).run();
    else await c.env.DB.prepare("UPDATE marketplace_listings SET status='approved', authorized_at=?, updated_at=? WHERE id=?").bind(now(), now(), id).run();
    authorized.push(id);
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
  if (!(await allow(c.env.DB, `publish:${uid(c)}`, 4, 60))) return c.json({ error: "rate_limited" }, 429);
  const ids = [...new Set(p.data.listingIds)];
  const rows: Row[] = [];
  for (const id of ids) {
    const r = await ownListing(c, id);
    if (r) rows.push(r);
  }
  const connIds = new Set(rows.map((r) => r.connection_id as string));
  if (connIds.size > 1) return c.json({ error: "single_connection_only" }, 422);
  const results: Array<{ id: string; ok: boolean; itemId?: string; error?: string; issues?: string[]; updated?: boolean }> = [];
  const known = new Set(rows.map((r) => r.id as string));
  for (const id of ids) if (!known.has(id)) results.push({ id, ok: false, error: "not_found" });
  if (rows.length === 0) return c.json({ results });

  const conn = await ownConn(c, [...connIds][0]!, "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  let creds: shopee.ShopeeCreds;
  try { creds = await shopeeCreds(c.env, conn); } catch (e) { return shopeeFail(c, e); }

  for (const r of rows) {
    const id = r.id as string;
    const liveUpdate = r.status === "published" && r.update_status === "authorized";
    if (r.status !== "approved" && !liveUpdate) { results.push({ id, ok: false, error: "not_authorized" }); continue; }
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
        await audit(c.env.DB, uid(c), "listing.updated_live", id, { provider: "shopee", itemId: r.external_item_id });
        results.push({ id, ok: true, itemId: r.external_item_id as string, updated: true });
      } else {
        const hadItem = !!r.external_item_id;
        const itemId = await createOnShopee(c.env, creds, r);
        // Numa nova tentativa o item já existia: o que foi editado depois fica como alteração pendente, para ser autorizada e enviada.
        await c.env.DB.prepare("UPDATE marketplace_listings SET status='published', external_item_id=?, published_at=?, last_error=NULL, update_status=?, last_synced_at=?, updated_at=? WHERE id=?").bind(itemId, now(), hadItem ? "dirty" : null, now(), now(), id).run();
        await audit(c.env.DB, uid(c), "listing.published", id, { provider: "shopee", itemId });
        results.push({ id, ok: true, itemId });
      }
    } catch (e) {
      const msg = e instanceof shopee.ShopeeError ? `${e.code}: ${e.detail}` : "unexpected_error";
      if (liveUpdate) await c.env.DB.prepare("UPDATE marketplace_listings SET update_status='dirty', last_error=?, updated_at=? WHERE id=?").bind(msg, now(), id).run();
      else await c.env.DB.prepare("UPDATE marketplace_listings SET status='failed', last_error=?, updated_at=? WHERE id=?").bind(msg, now(), id).run();
      results.push({ id, ok: false, error: msg });
    }
  }
  return c.json({ results });
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
  for (const id of new Set(p.data.listingIds)) {
    const r = await c.env.DB.prepare(
      `SELECT l.*, sp.cost_price AS sp_cost, sp.stock AS sp_stock, sp.variants AS sp_variants FROM marketplace_listings l
       JOIN supplier_products sp ON sp.id = l.supplier_product_id WHERE l.id = ? AND l.user_id = ? AND l.connection_id = ? AND l.status = 'published'`,
    ).bind(id, uid(c), p.data.connectionId).first<Row>();
    if (!r) continue;
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
    await c.env.DB.prepare("UPDATE marketplace_listings SET price=?, stock=?, cost_price=?, variants=?, update_status='dirty', authorized_at=NULL, updated_at=? WHERE id=?")
      .bind(price, stock, cost, variants ? JSON.stringify(variants) : null, now(), id).run();
    applied++;
  }
  await audit(c.env.DB, uid(c), "listing.sync_applied", p.data.connectionId, { applied, kinds: p.data.kinds });
  return c.json({ applied, requiresAuthorization: true });
});

/**
 * Sincronização automática de ESTOQUE, só para quem ligou "autoStock" na conexão (a ligação é a autorização prévia).
 * Preço nunca é alterado automaticamente. Roda pelo agendador do Worker.
 */
export async function runAutoStock(env: Env): Promise<{ checked: number; updated: number; failed: number }> {
  const { results: conns } = await env.DB.prepare("SELECT * FROM integration_connections WHERE provider = 'shopee' AND status = 'connected'").all<Row>();
  const stats = { checked: 0, updated: 0, failed: 0 };
  for (const conn of conns) {
    if (!j<{ autoStock?: boolean }>(conn.config, {}).autoStock) continue;
    let creds: shopee.ShopeeCreds;
    try { creds = await shopeeCreds(env, conn); } catch { stats.failed++; continue; }
    const { results } = await env.DB.prepare(
      `SELECT l.*, sp.stock AS sp_stock, sp.variants AS sp_variants FROM marketplace_listings l
       JOIN supplier_products sp ON sp.id = l.supplier_product_id WHERE l.connection_id = ? AND l.status = 'published' AND l.update_status IS NULL LIMIT 200`,
    ).bind(conn.id).all<Row>();
    for (const r of results) {
      stats.checked++;
      const v = parseVariants(r.variants);
      const sv = parseVariants(r.sp_variants);
      try {
        if (v && sv) {
          const stocks = v.models.map((m) => sv.models.find((x) => (x.sku || x.tierIndex.join(",")) === (m.sku || m.tierIndex.join(",")))?.stock ?? m.stock ?? 0);
          if (stocks.every((x, i) => x === (v.models[i]!.stock ?? 0))) continue;
          await pushStockOnly(env, creds, r, null, stocks);
          const nv = { ...v, models: v.models.map((m, i) => ({ ...m, stock: stocks[i]! })) };
          await env.DB.prepare("UPDATE marketplace_listings SET variants=?, stock=?, last_synced_at=?, updated_at=? WHERE id=?").bind(JSON.stringify(nv), variantsSummary(nv).stock, now(), now(), r.id).run();
        } else {
          const target = r.sp_stock as number | null;
          if (target == null || target === r.stock) continue;
          await pushStockOnly(env, creds, r, target);
          await env.DB.prepare("UPDATE marketplace_listings SET stock=?, last_synced_at=?, updated_at=? WHERE id=?").bind(target, now(), now(), r.id).run();
        }
        await audit(env.DB, r.user_id as string, "listing.stock_auto", r.id as string, { from: r.stock });
        stats.updated++;
      } catch {
        stats.failed++;
      }
    }
  }
  return stats;
}

market.delete("/listings/:id", async (c) => {
  const cur = await ownListing(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status === "publishing") return c.json({ error: "not_editable", status: cur.status }, 409);
  await c.env.DB.prepare("DELETE FROM marketplace_listings WHERE id = ?").bind(cur.id).run();
  return c.json({ ok: true });
});
