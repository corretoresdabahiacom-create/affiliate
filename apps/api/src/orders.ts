import { Hono } from "hono";
import { normalizeOrder, orderSyncSchema, supplierOrderPatchSchema, supplierSheet, type OrderItem } from "@ai/shared";
import { audit } from "./audit";
import { emitManyFrom, notify } from "./automation";
import { chunks } from "./budget";
import type { Row } from "./catalog";
import { ownConn, shopeeCreds, shopeeFail } from "./integrations";
import { requireUser } from "./middleware";
import { allow } from "./ratelimit";
import * as shopee from "./shopee";
import type { AppBindings } from "./types";

/**
 * Pedidos da loja (Fase 6, parte 3).
 * - Guarda só o necessário para operar: sem nome, endereço, telefone ou CPF do comprador (LGPD).
 * - O sistema NÃO compra no fornecedor: gera a ficha do pedido e a pessoa faz a compra à mão e registra o andamento.
 * - Rastreio vem da Shopee (endpoints não verificados contra a loja real; veja docs/INTEGRATIONS.md).
 */
export const orders = new Hono<AppBindings>();
orders.use("*", requireUser);

const uid = (c: any) => c.get("user").id as string;
const now = () => Date.now();
const j = <T>(s: unknown, d: T): T => {
  try { return s ? (JSON.parse(s as string) as T) : d; } catch { return d; }
};

export const orderOut = (r: Row) => ({
  id: r.id, connectionId: r.connection_id, orderSn: r.order_sn, status: r.status, orderedAt: r.ordered_at, currency: r.currency, total: r.total,
  items: j<OrderItem[]>(r.items, []), trackingNumber: r.tracking_number, trackingStatus: r.tracking_status, trackingEvents: j<unknown[]>(r.tracking_events, []),
  trackingCheckedAt: r.tracking_checked_at, supplierStatus: r.supplier_status, supplierRef: r.supplier_ref, supplierTracking: r.supplier_tracking, syncedAt: r.synced_at,
});

orders.post("/sync", async (c) => {
  const p = orderSyncSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const conn = await ownConn(c, p.data.connectionId, "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  if (!(await allow(c.env.DB, `orders-sync:${uid(c)}`, 6, 60))) return c.json({ error: "rate_limited" }, 429);
  try {
    const creds = await shopeeCreds(c.env, conn);
    const to = Math.floor(now() / 1000);
    const list = await shopee.getOrderList(creds, to - p.data.days * 86400, to);
    const details = list.length ? await shopee.getOrderDetails(creds, list.map((o) => o.sn)) : [];
    const orders = new Map<string, NonNullable<ReturnType<typeof normalizeOrder>>>();
    for (const raw of details) {
      const o = normalizeOrder(raw);
      if (o) orders.set(o.orderSn, o);
    }
    // Leitura única do que já existe + gravação em lote (o plano gratuito do D1 permite 50 consultas por invocação).
    const had = new Set<string>();
    for (const part of chunks([...orders.keys()], 90)) {
      const { results } = await (c.env.DB as D1Database).prepare(`SELECT order_sn FROM marketplace_orders WHERE connection_id = ? AND order_sn IN (${part.map(() => "?").join(",")})`).bind(conn.id, ...part).all<Row>();
      for (const r of results) had.add(r.order_sn as string);
    }
    let created = 0;
    let updated = 0;
    const stmts: D1PreparedStatement[] = [];
    const events: Array<{ event: "order.new"; data: Record<string, unknown> }> = [];
    for (const o of orders.values()) {
      // Não mexe no que a pessoa registrou (fornecedor) nem no rastreio já consultado.
      stmts.push(c.env.DB.prepare(
        `INSERT INTO marketplace_orders (id, user_id, connection_id, order_sn, status, ordered_at, currency, total, items, supplier_status, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(connection_id, order_sn) DO UPDATE SET status=excluded.status, total=excluded.total, items=excluded.items, synced_at=excluded.synced_at`,
      ).bind(crypto.randomUUID(), uid(c), conn.id, o.orderSn, o.status, o.createdAt, o.currency, o.total, JSON.stringify(o.items), "not_placed", now()));
      if (had.has(o.orderSn)) updated++;
      else {
        created++;
        events.push({ event: "order.new", data: { orderSn: o.orderSn, status: o.status, total: o.total, items: o.items.length } });
      }
    }
    for (const part of chunks(stmts, 100)) await c.env.DB.batch(part);
    await emitManyFrom(c, events);
    if (created > 0) await notify(c.env.DB, uid(c), "order.new", `${created} novo(s) pedido(s) na Shopee`, null, "/orders", { n: created });
    await audit(c.env.DB, uid(c), "orders.synced", conn.id as string, { created, updated, days: p.data.days });
    return c.json({ created, updated, days: p.data.days });
  } catch (e) {
    return shopeeFail(c, e);
  }
});

orders.get("/", async (c) => {
  const cid = c.req.query("connectionId");
  const st = c.req.query("supplierStatus");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM marketplace_orders WHERE user_id = ? ${cid ? "AND connection_id = ?" : ""} ${st ? "AND supplier_status = ?" : ""} ORDER BY ordered_at DESC LIMIT 200`,
  ).bind(...[uid(c), ...(cid ? [cid] : []), ...(st ? [st] : [])]).all<Row>();
  return c.json({ items: results.map(orderOut) });
});

async function own(c: any, id: string): Promise<Row | null> {
  return c.env.DB.prepare("SELECT * FROM marketplace_orders WHERE id = ? AND user_id = ?").bind(id, uid(c)).first();
}

/** Ficha para fazer o pedido no fornecedor À MÃO. Itens sem anúncio correspondente aparecem como "não encontrados", nunca com custo inventado. */
orders.get("/:id/supplier-sheet", async (c) => {
  const o = await own(c, c.req.param("id"));
  if (!o) return c.json({ error: "not_found" }, 404);
  const items = j<OrderItem[]>(o.items, []);
  const { results } = await c.env.DB.prepare(
    `SELECT l.external_item_id, l.variants, l.shopee_models, sp.name, sp.external_id, sp.sku, sp.cost_price, sp.variants AS sp_variants
     FROM marketplace_listings l JOIN supplier_products sp ON sp.id = l.supplier_product_id WHERE l.user_id = ? AND l.connection_id = ? AND l.external_item_id IS NOT NULL`,
  ).bind(uid(c), o.connection_id).all<Row>();
  const byItem = new Map(results.map((r) => [String(r.external_item_id), r]));
  const sheet = supplierSheet(items, (itemId, modelId, sku) => {
    const r = byItem.get(itemId);
    if (!r) return null;
    const sv = j<{ models: Array<{ tierIndex: number[]; sku?: string | null; costPrice: number }> } | null>(r.sp_variants, null);
    let unitCost: number | null = r.cost_price as number;
    let vsku: string | null = r.sku as string | null;
    if (sv) {
      const map = j<Array<{ modelId: number; tierIndex: number[] }>>(r.shopee_models, []);
      const tier = modelId ? map.find((m) => String(m.modelId) === modelId)?.tierIndex.join(",") : undefined;
      const m = sv.models.find((x) => (tier != null && x.tierIndex.join(",") === tier) || (sku && x.sku === sku));
      unitCost = m ? m.costPrice : null; // variação não identificada: custo desconhecido, não chute
      vsku = m?.sku ?? vsku;
    }
    return { name: r.name as string, externalId: r.external_id as string, sku: vsku, unitCost };
  });
  return c.json({ orderSn: o.order_sn, ...sheet, note: "manual_purchase" });
});

orders.patch("/:id", async (c) => {
  const o = await own(c, c.req.param("id"));
  if (!o) return c.json({ error: "not_found" }, 404);
  const p = supplierOrderPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const d = p.data;
  await c.env.DB.prepare("UPDATE marketplace_orders SET supplier_status=?, supplier_ref=?, supplier_tracking=? WHERE id=?")
    .bind(d.supplierStatus ?? o.supplier_status, d.supplierRef === undefined ? o.supplier_ref : d.supplierRef ?? null, d.supplierTracking === undefined ? o.supplier_tracking : d.supplierTracking ?? null, o.id).run();
  await audit(c.env.DB, uid(c), "order.supplier_updated", o.id as string, { status: d.supplierStatus });
  return c.json({ item: orderOut((await own(c, o.id as string))!) });
});

orders.post("/:id/tracking/refresh", async (c) => {
  const o = await own(c, c.req.param("id"));
  if (!o) return c.json({ error: "not_found" }, 404);
  const conn = await ownConn(c, o.connection_id as string, "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  if (!(await allow(c.env.DB, `tracking:${uid(c)}`, 20, 60))) return c.json({ error: "rate_limited" }, 429);
  try {
    const t = await shopee.getTracking(await shopeeCreds(c.env, conn), o.order_sn as string);
    await c.env.DB.prepare("UPDATE marketplace_orders SET tracking_number=?, tracking_status=?, tracking_events=?, tracking_checked_at=? WHERE id=?")
      .bind(t.trackingNumber, t.status, JSON.stringify(t.events), now(), o.id).run();
    return c.json({ item: orderOut((await own(c, o.id as string))!) });
  } catch (e) {
    return shopeeFail(c, e);
  }
});
