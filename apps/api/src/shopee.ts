import type { Env } from "./types";

/**
 * Cliente da Shopee Open Platform v2 (assinatura HMAC-SHA256 em hexadecimal).
 * Base da assinatura: partner_id + caminho + timestamp [+ access_token + shop_id nas APIs de loja].
 * Não foi exercitado contra a Shopee real (precisa das credenciais do parceiro); confira a documentação oficial
 * da Open Platform ao ativar. Erros da Shopee são devolvidos como vieram.
 */

export interface ShopeeCreds {
  host: string;
  partnerId: string;
  partnerKey: string;
  shopId?: string;
  accessToken?: string;
  refreshToken?: string;
  /** epoch ms de expiração do access token */
  expiresAt?: number;
}

export class ShopeeError extends Error {
  constructor(public code: string, public detail: string, public status = 502) {
    super(code);
  }
}

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const shopeeBaseString = (c: Pick<ShopeeCreds, "partnerId" | "accessToken" | "shopId">, path: string, ts: number, shopApi: boolean) =>
  `${c.partnerId}${path}${ts}${shopApi ? `${c.accessToken ?? ""}${c.shopId ?? ""}` : ""}`;

const nowSec = () => Math.floor(Date.now() / 1000);

export async function authUrl(c: ShopeeCreds, redirect: string): Promise<string> {
  const path = "/api/v2/shop/auth_partner";
  const ts = nowSec();
  const sign = await hmacHex(c.partnerKey, shopeeBaseString(c, path, ts, false));
  return `${c.host}${path}?${new URLSearchParams({ partner_id: c.partnerId, timestamp: String(ts), sign, redirect })}`;
}

async function call(c: ShopeeCreds, method: "GET" | "POST", path: string, opts: { shopApi: boolean; query?: Record<string, string>; body?: unknown; form?: FormData }) {
  const ts = nowSec();
  const sign = await hmacHex(c.partnerKey, shopeeBaseString(c, path, ts, opts.shopApi));
  const q = new URLSearchParams({ partner_id: c.partnerId, timestamp: String(ts), sign, ...(opts.shopApi ? { access_token: c.accessToken ?? "", shop_id: c.shopId ?? "" } : {}), ...(opts.query ?? {}) });
  let res: Response;
  try {
    res = await fetch(`${c.host}${path}?${q}`, {
      method,
      headers: opts.form ? undefined : opts.body ? { "content-type": "application/json" } : undefined,
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ShopeeError("shopee_unreachable", "network");
  }
  const json = (await res.json().catch(() => null)) as any;
  if (!json || (json.error && String(json.error) !== "")) {
    throw new ShopeeError("shopee_error", `${json?.error ?? `http_${res.status}`}${json?.message ? `: ${json.message}` : ""}`.slice(0, 400), res.status === 401 || res.status === 403 ? 401 : 502);
  }
  return json.response ?? json;
}

/** Troca o código de autorização por tokens. */
export async function exchangeCode(c: ShopeeCreds, code: string, shopId: string): Promise<ShopeeCreds> {
  const r = await call(c, "POST", "/api/v2/auth/token/get", { shopApi: false, body: { code, shop_id: Number(shopId), partner_id: Number(c.partnerId) } });
  return { ...c, shopId, accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: Date.now() + Number(r.expire_in ?? 14_400) * 1000 };
}

export async function refresh(c: ShopeeCreds): Promise<ShopeeCreds> {
  const r = await call(c, "POST", "/api/v2/auth/access_token/get", {
    shopApi: false,
    body: { refresh_token: c.refreshToken, shop_id: Number(c.shopId), partner_id: Number(c.partnerId) },
  });
  return { ...c, accessToken: r.access_token, refreshToken: r.refresh_token ?? c.refreshToken, expiresAt: Date.now() + Number(r.expire_in ?? 14_400) * 1000 };
}

export const needsRefresh = (c: ShopeeCreds) => !c.accessToken || (c.expiresAt ?? 0) - Date.now() < 300_000;

export interface ShopeeCategory { id: number; parentId: number; name: string; hasChildren: boolean }
export async function getCategories(c: ShopeeCreds): Promise<ShopeeCategory[]> {
  const r = await call(c, "GET", "/api/v2/product/get_category", { shopApi: true, query: { language: "pt-BR" } });
  return ((r.category_list ?? []) as any[]).map((x) => ({ id: x.category_id, parentId: x.parent_category_id, name: x.display_category_name, hasChildren: !!x.has_children }));
}

export interface ShopeeChannel { id: number; name: string; enabled: boolean }
export async function getChannels(c: ShopeeCreds): Promise<ShopeeChannel[]> {
  const r = await call(c, "GET", "/api/v2/logistics/get_channel_list", { shopApi: true });
  return ((r.logistics_channel_list ?? []) as any[]).map((x) => ({ id: x.logistics_channel_id, name: x.logistics_channel_name, enabled: !!x.enabled }));
}

const MAX_IMAGE = 5 * 1024 * 1024;
/** Baixa a imagem (https) e envia para o espaço de mídia da Shopee. Devolve o image_id. */
export async function uploadImage(c: ShopeeCreds, url: string): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new ShopeeError("image_not_https", url.slice(0, 120), 422);
  let img: Response;
  try {
    img = await fetch(url);
  } catch {
    throw new ShopeeError("image_unreachable", url.slice(0, 120), 422);
  }
  const type = img.headers.get("content-type") ?? "";
  if (!img.ok || !type.startsWith("image/")) throw new ShopeeError("image_invalid", `${url.slice(0, 120)} (${img.status}, ${type || "no content-type"})`, 422);
  const buf = await img.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE) throw new ShopeeError("image_too_large", url.slice(0, 120), 422);
  const form = new FormData();
  form.append("image", new Blob([buf], { type }), "image");
  const r = await call(c, "POST", "/api/v2/media_space/upload_image", { shopApi: false, form });
  const id = r.image_info?.image_id ?? r.image_info_list?.[0]?.image_info?.image_id;
  if (!id) throw new ShopeeError("shopee_error", "upload_image: no image_id in response");
  return String(id);
}

export interface NewItem {
  title: string;
  description: string;
  price: number;
  stock: number;
  weightKg: number;
  categoryId: number;
  logisticsChannelIds: number[];
  imageIds: string[];
  sku?: string | null;
}
export async function addItem(c: ShopeeCreds, i: NewItem): Promise<string> {
  const r = await call(c, "POST", "/api/v2/product/add_item", {
    shopApi: true,
    body: {
      item_name: i.title,
      description: i.description,
      original_price: i.price,
      seller_stock: [{ stock: i.stock }],
      weight: i.weightKg,
      category_id: i.categoryId,
      image: { image_id_list: i.imageIds },
      logistic_info: i.logisticsChannelIds.map((id) => ({ logistic_id: id, enabled: true })),
      item_status: "NORMAL",
      ...(i.sku ? { item_sku: i.sku } : {}),
    },
  });
  const id = r.item_id;
  if (!id) throw new ShopeeError("shopee_error", "add_item: no item_id in response");
  return String(id);
}

/** Sugestão (não escolha): categorias-folha cujo nome tem palavras em comum com o produto. */
export function suggestCategories(list: ShopeeCategory[], text: string, limit = 10): ShopeeCategory[] {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const words = [...new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length > 2))];
  if (!words.length) return [];
  return list
    .filter((c) => !c.hasChildren)
    .map((c) => ({ c, s: words.filter((w) => norm(c.name).includes(w)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

export type { Env };
