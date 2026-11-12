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
  type ListingStatus,
} from "@ai/shared";
import { audit } from "./audit";
import { generate } from "./ai";
import type { Row } from "./catalog";
import { ownConn, shopeeCreds, shopeeFail } from "./integrations";
import { requireUser } from "./middleware";
import { allow } from "./ratelimit";
import * as shopee from "./shopee";
import type { AppBindings } from "./types";

export const market = new Hono<AppBindings>();
market.use("*", requireUser);

const uid = (c: any) => c.get("user").id as string;
const now = () => Date.now();
const j = <T>(s: unknown, d: T): T => {
  try { return JSON.parse(String(s)) as T; } catch { return d; }
};

export const listingOut = (r: Row) => {
  const price = r.price as number;
  const cost = r.cost_price as number;
  const images = j<string[]>(r.images, []);
  const logisticsChannelIds = j<number[]>(r.logistics_channel_ids, []);
  return {
    id: r.id, connectionId: r.connection_id, productId: r.supplier_product_id, productName: r.product_name, title: r.title, description: r.description,
    price, costPrice: cost, currency: r.currency, margin: margin(cost, price), stock: r.stock, weightKg: r.weight_kg, categoryId: r.category_id,
    logisticsChannelIds, images, textSource: r.text_source, status: r.status, externalItemId: r.external_item_id, lastError: r.last_error,
    authorizedAt: r.authorized_at, publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at,
    issues: listingIssues({ title: r.title as string, description: r.description as string, price, cost, stock: r.stock as number | null, weightKg: r.weight_kg as number | null, categoryId: r.category_id as number | null, logisticsChannelIds, images, context: r.context as string }),
  };
};

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
    const cost = prod.cost_price as number;
    const price = p.data.fixedPrice != null ? p.data.fixedPrice : priceFromMarkup(cost, p.data.markupPercent ?? 0);
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
        category_id, logistics_channel_ids, images, context, text_source, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,'[]',?,?,?,'draft',?,?)`,
    ).bind(lid, uid(c), conn.id, id, prod.name, String(prod.name).slice(0, 120), description.slice(0, 3000), price, cost, prod.currency, prod.stock, prod.weight_kg, prod.images, context, source, t, t).run();
    created.push(listingOut((await c.env.DB.prepare("SELECT * FROM marketplace_listings WHERE id = ?").bind(lid).first<Row>())!));
  }
  await audit(c.env.DB, uid(c), "store.build", conn.id as string, { created: created.length, skipped: skipped.length });
  return c.json({ items: created, skipped, ai, published: false }, 201);
});

const EDITABLE: ListingStatus[] = ["draft", "approved", "failed"];
const ownListing = (c: any, id: string): Promise<Row | null> => c.env.DB.prepare("SELECT * FROM marketplace_listings WHERE id = ? AND user_id = ?").bind(id, uid(c)).first();

market.patch("/listings/:id", async (c) => {
  const cur = await ownListing(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (!EDITABLE.includes(cur.status as ListingStatus)) return c.json({ error: "not_editable", status: cur.status }, 409);
  const p = listingPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const d = p.data;
  const textChanged = (d.title !== undefined && d.title !== cur.title) || (d.description !== undefined && d.description !== cur.description);
  // Qualquer edição derruba a autorização: o que foi alterado precisa ser revisto e autorizado de novo.
  await c.env.DB.prepare(
    `UPDATE marketplace_listings SET title=?, description=?, price=?, stock=?, weight_kg=?, category_id=?, logistics_channel_ids=?, images=?, text_source=?, status='draft', authorized_at=NULL, last_error=NULL, updated_at=? WHERE id=?`,
  ).bind(
    d.title ?? cur.title, d.description ?? cur.description, d.price ?? cur.price, d.stock ?? cur.stock, d.weightKg !== undefined ? d.weightKg : cur.weight_kg,
    d.categoryId !== undefined ? d.categoryId : cur.category_id, d.logisticsChannelIds ? JSON.stringify(d.logisticsChannelIds) : cur.logistics_channel_ids,
    d.images ? JSON.stringify(d.images) : cur.images, textChanged ? "user" : cur.text_source, now(), cur.id,
  ).run();
  return c.json({ item: listingOut((await ownListing(c, cur.id as string))!) });
});

const bulkSchema = z.object({
  listingIds: z.array(z.string().min(1)).min(1).max(50),
  categoryId: z.number().int().positive().optional(),
  logisticsChannelIds: z.array(z.number().int().positive()).max(10).optional(),
  weightKg: z.number().positive().max(1000).optional(),
});
/** Aplica a mesma categoria, logística ou peso a vários rascunhos. Volta todos a rascunho. */
market.post("/listings/bulk-patch", async (c) => {
  const p = bulkSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  let n = 0;
  for (const id of new Set(p.data.listingIds)) {
    const cur = await ownListing(c, id);
    if (!cur || !EDITABLE.includes(cur.status as ListingStatus)) continue;
    await c.env.DB.prepare(
      "UPDATE marketplace_listings SET category_id=?, logistics_channel_ids=?, weight_kg=?, status='draft', authorized_at=NULL, updated_at=? WHERE id=?",
    ).bind(p.data.categoryId ?? cur.category_id, p.data.logisticsChannelIds ? JSON.stringify(p.data.logisticsChannelIds) : cur.logistics_channel_ids, p.data.weightKg ?? cur.weight_kg, now(), id).run();
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
    if (!canListingTransition(cur.status as ListingStatus, "approved")) { rejected.push({ id, issues: ["invalid_status"] }); continue; }
    const issues = listingOut(cur).issues;
    if (issues.length) { rejected.push({ id, issues }); continue; }
    await c.env.DB.prepare("UPDATE marketplace_listings SET status='approved', authorized_at=?, updated_at=? WHERE id=?").bind(now(), now(), id).run();
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
  const results: Array<{ id: string; ok: boolean; itemId?: string; error?: string; issues?: string[] }> = [];
  const known = new Set(rows.map((r) => r.id as string));
  for (const id of ids) if (!known.has(id)) results.push({ id, ok: false, error: "not_found" });
  if (rows.length === 0) return c.json({ results });

  const conn = await ownConn(c, [...connIds][0]!, "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  let creds: shopee.ShopeeCreds;
  try { creds = await shopeeCreds(c.env, conn); } catch (e) { return shopeeFail(c, e); }

  for (const r of rows) {
    const id = r.id as string;
    if (r.status !== "approved") { results.push({ id, ok: false, error: "not_authorized" }); continue; }
    const issues = listingOut(r).issues;
    if (issues.length) {
      await c.env.DB.prepare("UPDATE marketplace_listings SET status='draft', authorized_at=NULL, updated_at=? WHERE id=?").bind(now(), id).run();
      results.push({ id, ok: false, error: "issues", issues });
      continue;
    }
    // Reserva atômica: dois cliques não publicam duas vezes.
    const claim = await c.env.DB.prepare("UPDATE marketplace_listings SET status='publishing', updated_at=? WHERE id=? AND user_id=? AND status='approved'").bind(now(), id, uid(c)).run();
    if (!claim.meta.changes) { results.push({ id, ok: false, error: "not_authorized" }); continue; }
    try {
      const imageIds: string[] = [];
      for (const url of j<string[]>(r.images, []).slice(0, 9)) imageIds.push(await shopee.uploadImage(creds, url));
      const itemId = await shopee.addItem(creds, {
        title: r.title as string, description: r.description as string, price: r.price as number, stock: r.stock as number, weightKg: r.weight_kg as number,
        categoryId: r.category_id as number, logisticsChannelIds: j<number[]>(r.logistics_channel_ids, []), imageIds,
      });
      await c.env.DB.prepare("UPDATE marketplace_listings SET status='published', external_item_id=?, published_at=?, last_error=NULL, updated_at=? WHERE id=?").bind(itemId, now(), now(), id).run();
      await audit(c.env.DB, uid(c), "listing.published", id, { provider: "shopee", itemId });
      results.push({ id, ok: true, itemId });
    } catch (e) {
      const msg = e instanceof shopee.ShopeeError ? `${e.code}: ${e.detail}` : "unexpected_error";
      await c.env.DB.prepare("UPDATE marketplace_listings SET status='failed', last_error=?, updated_at=? WHERE id=?").bind(msg, now(), id).run();
      results.push({ id, ok: false, error: msg });
    }
  }
  return c.json({ results });
});

market.delete("/listings/:id", async (c) => {
  const cur = await ownListing(c, c.req.param("id"));
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status === "publishing") return c.json({ error: "not_editable", status: cur.status }, 409);
  await c.env.DB.prepare("DELETE FROM marketplace_listings WHERE id = ?").bind(cur.id).run();
  return c.json({ ok: true });
});
