import { Hono } from "hono";
import {
  connectionCreateSchema,
  groupVariantRows,
  normalizeSupplierItem,
  supplierImportSchema,
  supplierMappingSchema,
  type SupplierMapping,
  type SupplierProductInput,
} from "@ai/shared";
import { audit } from "./audit";
import { parseCsv, type Row } from "./catalog";
import { randomToken, sha256Hex } from "./crypto";
import { requireUser } from "./middleware";
import { allow } from "./ratelimit";
import * as shopee from "./shopee";
import type { AppBindings, Env } from "./types";
import { open, seal, vaultReady } from "./vault";

export const integrations = new Hono<AppBindings>();
integrations.use("*", requireUser);

const uid = (c: any) => c.get("user").id as string;
const now = () => Date.now();
const MAX_CONNECTIONS = 10;
const MAX_ROWS = 500;

/** Nunca inclui segredos. Só informa se há token guardado. */
export const connOut = (r: Row) => {
  const cfg = JSON.parse(r.config as string) as Record<string, unknown>;
  const { authState: _hidden, ...pub } = cfg;
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    status: r.status,
    statusDetail: r.status_detail,
    config: pub,
    hasSecrets: !!r.secrets_enc,
    createdAt: r.created_at,
  };
};

export async function ownConn(c: any, id: string, provider?: "shopee" | "supplier"): Promise<Row | null> {
  const r = await c.env.DB.prepare("SELECT * FROM integration_connections WHERE id = ? AND user_id = ?").bind(id, uid(c)).first();
  return r && (!provider || r.provider === provider) ? r : null;
}

/** Credenciais da Shopee prontas para uso (renova o token se estiver perto de vencer). */
export async function shopeeCreds(env: Env, conn: Row): Promise<shopee.ShopeeCreds> {
  const cfg = JSON.parse(conn.config as string);
  const sec = await open<Record<string, any>>(env, conn.secrets_enc as string | null);
  if (!sec?.partnerKey) throw new shopee.ShopeeError("connection_not_ready", "no_secrets", 409);
  let creds: shopee.ShopeeCreds = { host: cfg.host, partnerId: cfg.partnerId, partnerKey: sec.partnerKey, shopId: sec.shopId, accessToken: sec.accessToken, refreshToken: sec.refreshToken, expiresAt: sec.expiresAt };
  if (!creds.shopId || !creds.refreshToken) throw new shopee.ShopeeError("connection_not_ready", "not_authorized", 409);
  if (shopee.needsRefresh(creds)) {
    creds = await shopee.refresh(creds);
    const sealed = await seal(env, { partnerKey: creds.partnerKey, shopId: creds.shopId, accessToken: creds.accessToken, refreshToken: creds.refreshToken, expiresAt: creds.expiresAt });
    await env.DB.prepare("UPDATE integration_connections SET secrets_enc = ?, updated_at = ? WHERE id = ?").bind(sealed, now(), conn.id).run();
  }
  return creds;
}

export const shopeeFail = (c: any, e: unknown) => {
  if (e instanceof shopee.ShopeeError) return c.json({ error: e.code, detail: e.detail }, e.status as 401 | 409 | 422 | 502);
  throw e;
};

integrations.get("/status", (c) => c.json({ vaultReady: vaultReady(c.env), hosts: ["https://partner.shopeemobile.com", "https://openplatform.shopee.com.br"] }));

integrations.get("/connections", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM integration_connections WHERE user_id = ? ORDER BY created_at").bind(uid(c)).all<Row>();
  return c.json({ items: results.map(connOut) });
});

integrations.post("/connections", async (c) => {
  if (!vaultReady(c.env)) return c.json({ error: "vault_not_configured" }, 503);
  const p = connectionCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM integration_connections WHERE user_id = ?").bind(uid(c)).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_CONNECTIONS) return c.json({ error: "too_many_connections", max: MAX_CONNECTIONS }, 409);
  const d = p.data;
  const id = crypto.randomUUID();
  const t = now();
  let config: Record<string, unknown>;
  let secrets: Record<string, unknown> | null;
  let status = "pending";
  if (d.provider === "shopee") {
    config = { host: d.host, partnerId: d.partnerId };
    secrets = { partnerKey: d.partnerKey };
  } else {
    config = { url: d.url ?? null, authHeader: d.authHeader, mapping: d.mapping };
    secrets = d.token ? { token: d.token } : null;
    status = "connected"; // fornecedor não tem etapa de autorização; "conectado" só significa configurado
  }
  await c.env.DB.prepare(
    "INSERT INTO integration_connections (id, user_id, provider, label, config, secrets_enc, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, uid(c), d.provider, d.label, JSON.stringify(config), secrets ? await seal(c.env, secrets) : null, status, t, t)
    .run();
  await audit(c.env.DB, uid(c), "integration.created", id, { provider: d.provider });
  return c.json({ item: connOut((await ownConn(c, id))!) }, 201);
});

integrations.delete("/connections/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM integration_connections WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  await audit(c.env.DB, uid(c), "integration.deleted", c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- Shopee: autorização da loja pelo próprio dono ----------

integrations.get("/connections/:id/shopee/auth-url", async (c) => {
  const conn = await ownConn(c, c.req.param("id"), "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  const cfg = JSON.parse(conn.config as string);
  const sec = await open<Record<string, any>>(c.env, conn.secrets_enc as string | null);
  if (!sec?.partnerKey) return c.json({ error: "connection_not_ready" }, 409);
  const nonce = randomToken(16);
  cfg.authState = await sha256Hex(nonce);
  await c.env.DB.prepare("UPDATE integration_connections SET config = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(cfg), now(), conn.id).run();
  const redirect = `${c.env.APP_URL.replace(/\/$/, "")}/api/integrations/shopee/callback?state=${conn.id}.${nonce}`;
  return c.json({ url: await shopee.authUrl({ host: cfg.host, partnerId: cfg.partnerId, partnerKey: sec.partnerKey }, redirect) });
});

integrations.get("/shopee/callback", async (c) => {
  const [id, nonce] = (c.req.query("state") ?? "").split(".");
  const code = c.req.query("code");
  const shopId = c.req.query("shop_id");
  const back = (q: string) => c.redirect(`${c.env.APP_URL.replace(/\/$/, "")}/integrations?${q}`);
  const conn = id ? await ownConn(c, id, "shopee") : null;
  if (!conn || !nonce || !code || !shopId || !/^\d+$/.test(shopId)) return back("error=invalid_callback");
  const cfg = JSON.parse(conn.config as string);
  if (!cfg.authState || cfg.authState !== (await sha256Hex(nonce))) return back("error=invalid_state");
  try {
    const sec = await open<Record<string, any>>(c.env, conn.secrets_enc as string | null);
    const creds = await shopee.exchangeCode({ host: cfg.host, partnerId: cfg.partnerId, partnerKey: sec!.partnerKey }, code, shopId);
    delete cfg.authState; // uso único
    cfg.shopId = shopId;
    await c.env.DB.prepare("UPDATE integration_connections SET config = ?, secrets_enc = ?, status = 'connected', status_detail = NULL, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(cfg), await seal(c.env, { partnerKey: creds.partnerKey, shopId, accessToken: creds.accessToken, refreshToken: creds.refreshToken, expiresAt: creds.expiresAt }), now(), conn.id)
      .run();
    await audit(c.env.DB, uid(c), "integration.authorized", conn.id as string, { provider: "shopee" });
    return back("connected=1");
  } catch (e) {
    const detail = e instanceof shopee.ShopeeError ? e.detail : "unknown";
    await c.env.DB.prepare("UPDATE integration_connections SET status = 'error', status_detail = ?, updated_at = ? WHERE id = ?").bind(detail, now(), conn.id).run();
    return back("error=shopee");
  }
});

integrations.get("/connections/:id/shopee/categories", async (c) => {
  const conn = await ownConn(c, c.req.param("id"), "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  if (!(await allow(c.env.DB, `shopee-read:${uid(c)}`, 20, 60))) return c.json({ error: "rate_limited" }, 429);
  try {
    const list = await shopee.getCategories(await shopeeCreds(c.env, conn));
    const q = (c.req.query("q") ?? "").trim();
    // Só sugestão: quem escolhe a categoria é a pessoa.
    return c.json({ items: q ? shopee.suggestCategories(list, q, 30) : list.filter((x) => !x.hasChildren).slice(0, 30), suggestionOnly: true });
  } catch (e) {
    return shopeeFail(c, e);
  }
});

integrations.get("/connections/:id/shopee/channels", async (c) => {
  const conn = await ownConn(c, c.req.param("id"), "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  if (!(await allow(c.env.DB, `shopee-read:${uid(c)}`, 20, 60))) return c.json({ error: "rate_limited" }, 429);
  try {
    return c.json({ items: await shopee.getChannels(await shopeeCreds(c.env, conn)) });
  } catch (e) {
    return shopeeFail(c, e);
  }
});

/** Atributos da categoria (os obrigatórios variam). Só leitura: quem preenche o valor é a pessoa. */
integrations.get("/connections/:id/shopee/attributes", async (c) => {
  const conn = await ownConn(c, c.req.param("id"), "shopee");
  if (!conn) return c.json({ error: "not_found" }, 404);
  const categoryId = Number(c.req.query("categoryId"));
  if (!Number.isInteger(categoryId) || categoryId <= 0) return c.json({ error: "invalid_input" }, 400);
  if (!(await allow(c.env.DB, `shopee-read:${uid(c)}`, 20, 60))) return c.json({ error: "rate_limited" }, 429);
  try {
    return c.json({ items: await shopee.getAttributes(await shopeeCreds(c.env, conn), categoryId) });
  } catch (e) {
    return shopeeFail(c, e);
  }
});

/** Preferências da conexão. autoStock: liga a sincronização automática só de ESTOQUE dos anúncios já publicados (preço nunca muda sozinho). */
integrations.patch("/connections/:id", async (c) => {
  const conn = await ownConn(c, c.req.param("id"));
  if (!conn) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json().catch(() => null)) as { autoStock?: unknown } | null;
  if (!body || typeof body.autoStock !== "boolean" || conn.provider !== "shopee") return c.json({ error: "invalid_input" }, 400);
  const cfg = JSON.parse(conn.config as string);
  cfg.autoStock = body.autoStock;
  await c.env.DB.prepare("UPDATE integration_connections SET config = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(cfg), now(), conn.id).run();
  await audit(c.env.DB, uid(c), body.autoStock ? "integration.auto_stock_on" : "integration.auto_stock_off", conn.id as string);
  return c.json({ item: connOut((await ownConn(c, conn.id as string))!) });
});

// ---------- Fornecedor: catálogo e custos ----------

async function upsertProducts(c: any, connectionId: string, items: SupplierProductInput[], source: "csv" | "json" | "api") {
  const t = now();
  let created = 0;
  let updated = 0;
  for (const i of items) {
    const ex = await c.env.DB.prepare("SELECT id FROM supplier_products WHERE connection_id = ? AND external_id = ?").bind(connectionId, i.externalId).first();
    if (ex) {
      await c.env.DB.prepare(
        "UPDATE supplier_products SET sku=?, name=?, description=?, cost_price=?, currency=?, stock=?, images=?, category=?, weight_kg=?, source=?, synced_at=?, variants=? WHERE id=?",
      ).bind(i.sku ?? null, i.name, i.description ?? null, i.costPrice, i.currency, i.stock ?? null, JSON.stringify(i.images), i.category ?? null, i.weightKg ?? null, source, t, i.variants ? JSON.stringify(i.variants) : null, ex.id).run();
      updated++;
    } else {
      await c.env.DB.prepare(
        "INSERT INTO supplier_products (id, user_id, connection_id, external_id, sku, name, description, cost_price, currency, stock, images, category, weight_kg, source, synced_at, variants) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(crypto.randomUUID(), uid(c), connectionId, i.externalId, i.sku ?? null, i.name, i.description ?? null, i.costPrice, i.currency, i.stock ?? null, JSON.stringify(i.images), i.category ?? null, i.weightKg ?? null, source, t, i.variants ? JSON.stringify(i.variants) : null).run();
      created++;
    }
  }
  return { created, updated };
}

const CSV_MAP: SupplierMapping = supplierMappingSchema.parse({ externalId: "external_id", sku: "sku", name: "name", description: "description", costPrice: "cost_price", stock: "stock", images: "images", category: "category", weightKg: "weight_kg", variants: "variants" });

integrations.post("/supplier/import", async (c) => {
  const p = supplierImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  const conn = await ownConn(c, p.data.connectionId, "supplier");
  if (!conn) return c.json({ error: "not_found" }, 404);
  let raws: unknown[];
  let mapping = CSV_MAP;
  let source: "csv" | "json" = p.data.format;
  if (p.data.format === "csv") {
    const table = parseCsv(p.data.data);
    const header = (table.shift() ?? []).map((h) => h.trim().toLowerCase());
    for (const need of ["external_id", "name"]) if (!header.includes(need)) return c.json({ error: "missing_columns", required: ["external_id", "name", "cost_price"] }, 400);
    if (!header.includes("cost_price") && !header.includes("variant_cost")) return c.json({ error: "missing_columns", required: ["external_id", "name", "cost_price"] }, 400);
    raws = groupVariantRows(table.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))));
  } else {
    let j: unknown;
    try { j = JSON.parse(p.data.data); } catch { return c.json({ error: "invalid_json" }, 400); }
    mapping = (JSON.parse(conn.config as string).mapping as SupplierMapping) ?? supplierMappingSchema.parse({});
    raws = Array.isArray(j) ? j : (j as any)?.[mapping.items ?? "items"] ?? (j as any)?.data ?? (j as any)?.products ?? [];
    if (!Array.isArray(raws)) return c.json({ error: "no_items_found" }, 400);
  }
  if (raws.length > MAX_ROWS) return c.json({ error: "too_many_rows", max: MAX_ROWS }, 413);
  const ok: SupplierProductInput[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  raws.forEach((r, i) => {
    const n = normalizeSupplierItem(r, mapping);
    if (n.ok) ok.push(n.item);
    else errors.push({ row: i + 1, error: n.error });
  });
  if (p.data.dryRun) return c.json({ dryRun: true, valid: ok.length, errors, sample: ok.slice(0, 3) });
  const res = await upsertProducts(c, conn.id as string, ok, source);
  await audit(c.env.DB, uid(c), "supplier.imported", conn.id as string, { ...res, errors: errors.length, format: p.data.format });
  return c.json({ ...res, errors });
});

const blockedHost = (h: string) => h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || !h.includes(".") || /\.(local|internal|localhost)$/i.test(h);

integrations.post("/connections/:id/supplier/sync", async (c) => {
  const conn = await ownConn(c, c.req.param("id"), "supplier");
  if (!conn) return c.json({ error: "not_found" }, 404);
  const cfg = JSON.parse(conn.config as string);
  if (!cfg.url) return c.json({ error: "no_endpoint_configured" }, 409);
  const u = new URL(cfg.url);
  if (u.protocol !== "https:" || blockedHost(u.hostname)) return c.json({ error: "endpoint_not_allowed" }, 422);
  if (!(await allow(c.env.DB, `supplier-sync:${uid(c)}`, 6, 60))) return c.json({ error: "rate_limited" }, 429);
  const sec = await open<Record<string, any>>(c.env, conn.secrets_enc as string | null);
  const headers: Record<string, string> = { accept: "application/json" };
  if (sec?.token) headers[cfg.authHeader] = String(cfg.authHeader).toLowerCase() === "authorization" && !/^(bearer|basic) /i.test(sec.token) ? `Bearer ${sec.token}` : sec.token;
  let res: Response;
  try {
    res = await fetch(cfg.url, { headers, signal: AbortSignal.timeout(20_000), redirect: "error" });
  } catch {
    return c.json({ error: "supplier_unreachable" }, 502);
  }
  const text = await res.text();
  if (!res.ok) return c.json({ error: "supplier_error", status: res.status }, 502);
  if (text.length > 5_000_000) return c.json({ error: "response_too_large" }, 413);
  let j: any;
  try { j = JSON.parse(text); } catch { return c.json({ error: "invalid_json" }, 502); }
  const mapping = cfg.mapping as SupplierMapping;
  const raws = Array.isArray(j) ? j : j?.[mapping.items ?? "items"] ?? j?.data ?? j?.products;
  if (!Array.isArray(raws)) return c.json({ error: "no_items_found" }, 502);
  if (raws.length > MAX_ROWS) return c.json({ error: "too_many_rows", max: MAX_ROWS }, 413);
  const ok: SupplierProductInput[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  raws.forEach((r: unknown, i: number) => {
    const n = normalizeSupplierItem(r, mapping);
    if (n.ok) ok.push(n.item);
    else errors.push({ row: i + 1, error: n.error });
  });
  const out = await upsertProducts(c, conn.id as string, ok, "api");
  await audit(c.env.DB, uid(c), "supplier.synced", conn.id as string, { ...out, errors: errors.length });
  return c.json({ ...out, errors });
});

export const productOut = (r: Row) => ({
  id: r.id, connectionId: r.connection_id, externalId: r.external_id, sku: r.sku, name: r.name, description: r.description,
  costPrice: r.cost_price, currency: r.currency, stock: r.stock, images: JSON.parse((r.images as string) || "[]"), category: r.category, weightKg: r.weight_kg,
  source: r.source, syncedAt: r.synced_at, variants: r.variants ? JSON.parse(r.variants as string) : null,
});

integrations.get("/supplier/products", async (c) => {
  const cid = c.req.query("connectionId");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM supplier_products WHERE user_id = ? ${cid ? "AND connection_id = ?" : ""} ${q ? "AND lower(name) LIKE ?" : ""} ORDER BY name LIMIT 200`,
  ).bind(...[uid(c), ...(cid ? [cid] : []), ...(q ? [`%${q.replace(/[%_]/g, "")}%`] : [])]).all<Row>();
  return c.json({ items: results.map(productOut) });
});
