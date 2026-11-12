import { z } from "zod";
import { adApprovalIssues, adClaimIssues } from "./studio";

/**
 * Integrações e montagem de loja (Fase 6, parte 2).
 * Regras: credenciais só do próprio usuário e nunca devolvidas pela API; nada é publicado sem rascunho
 * revisado e autorização explícita; preço de venda é decisão do usuário; taxas do marketplace não são
 * estimadas; erro do marketplace aparece como veio, sem ser escondido.
 */

export const MAX_STORE_BATCH = 50;

const httpsUrl = z.string().trim().max(2000).url().refine((u) => /^https:\/\//i.test(u), "https only");
const label = z.string().trim().min(1).max(80);

/** Hosts aceitos para a Open Platform da Shopee (evita enviar a assinatura para um servidor qualquer). */
export const SHOPEE_HOST_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(shopeemobile\.com|shopee\.com\.br|shopee\.cn|shopee\.com)$/i;
export const SHOPEE_HOST_PRESETS = ["https://partner.shopeemobile.com", "https://openplatform.shopee.com.br"] as const;

export const shopeeConnectionSchema = z.object({
  provider: z.literal("shopee"),
  label,
  partnerId: z.string().trim().regex(/^\d{1,20}$/),
  partnerKey: z.string().trim().min(8).max(300),
  host: z.string().trim().regex(SHOPEE_HOST_RE).default(SHOPEE_HOST_PRESETS[0]),
});

/** Caminhos (com pontos) dos campos no JSON do fornecedor. */
export const supplierMappingSchema = z
  .object({
    items: z.string().trim().max(80).optional(),
    externalId: z.string().trim().max(80).default("id"),
    sku: z.string().trim().max(80).optional(),
    name: z.string().trim().max(80).default("name"),
    description: z.string().trim().max(80).default("description"),
    costPrice: z.string().trim().max(80).default("price"),
    stock: z.string().trim().max(80).default("stock"),
    images: z.string().trim().max(80).default("images"),
    category: z.string().trim().max(80).optional(),
    weightKg: z.string().trim().max(80).optional(),
  })
  .default({} as never);
export type SupplierMapping = z.infer<typeof supplierMappingSchema>;

export const supplierConnectionSchema = z.object({
  provider: z.literal("supplier"),
  label,
  /** Endpoint JSON da documentação do fornecedor. Vazio = só importação manual (CSV/JSON). */
  url: httpsUrl.nullish(),
  authHeader: z.string().trim().regex(/^[A-Za-z0-9-]{1,40}$/).default("Authorization"),
  token: z.string().trim().max(1000).nullish(),
  mapping: supplierMappingSchema,
});
export const connectionCreateSchema = z.discriminatedUnion("provider", [shopeeConnectionSchema, supplierConnectionSchema]);

export const supplierProductInputSchema = z.object({
  externalId: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(120).nullish(),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullish(),
  costPrice: z.number().min(0).max(100_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("BRL"),
  stock: z.number().int().min(0).max(10_000_000).nullish(),
  images: z.array(httpsUrl).max(9).default([]),
  category: z.string().trim().max(200).nullish(),
  weightKg: z.number().min(0).max(1000).nullish(),
});
export type SupplierProductInput = z.infer<typeof supplierProductInputSchema>;
export const supplierImportSchema = z.object({
  connectionId: z.string().min(1),
  format: z.enum(["csv", "json"]),
  data: z.string().max(1_000_000),
  dryRun: z.boolean().default(false),
});

const dig = (o: unknown, path: string | undefined): unknown =>
  path ? path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o) : undefined;
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
};

/** Converte um item cru do JSON do fornecedor. Campo que não dá para ler vira erro, nunca valor inventado. */
export function normalizeSupplierItem(raw: unknown, m: SupplierMapping): { ok: true; item: SupplierProductInput } | { ok: false; error: string } {
  const id = dig(raw, m.externalId);
  const cost = num(dig(raw, m.costPrice));
  const imgs = dig(raw, m.images);
  const candidate = {
    externalId: id === undefined || id === null ? "" : String(id),
    sku: m.sku ? (dig(raw, m.sku) as string | undefined) ?? null : null,
    name: String(dig(raw, m.name) ?? ""),
    description: dig(raw, m.description) == null ? null : String(dig(raw, m.description)),
    costPrice: cost ?? NaN,
    stock: num(dig(raw, m.stock)) === null ? null : Math.trunc(num(dig(raw, m.stock))!),
    images: Array.isArray(imgs) ? imgs.map((i) => (typeof i === "string" ? i : String((i as any)?.url ?? ""))).filter(Boolean) : typeof imgs === "string" && imgs ? imgs.split("|").map((s) => s.trim()).filter(Boolean) : [],
    category: m.category ? (dig(raw, m.category) as string | undefined) ?? null : null,
    weightKg: m.weightKg ? num(dig(raw, m.weightKg)) : null,
  };
  const p = supplierProductInputSchema.safeParse(candidate);
  return p.success ? { ok: true, item: p.data } : { ok: false, error: p.error.issues.map((i) => i.path.join(".") || "item").join(",") };
}

// ---------- Preço ----------

const cents = (n: number) => Math.round(n * 100) / 100;
/** Preço de venda por markup definido pelo usuário. Não inclui taxas nem frete do marketplace. */
export const priceFromMarkup = (cost: number, markupPercent: number) => cents(cost * (1 + markupPercent / 100));
export function margin(cost: number, price: number) {
  const amount = cents(price - cost);
  return { amount, percentOfPrice: price > 0 ? cents((amount / price) * 100) : 0, feesIncluded: false as const };
}

// ---------- Anúncios no marketplace ----------

export const LISTING_STATUS = ["draft", "approved", "publishing", "published", "failed", "discarded"] as const;
export type ListingStatus = (typeof LISTING_STATUS)[number];
const T: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ["approved", "discarded"],
  approved: ["draft", "discarded", "publishing"],
  publishing: ["published", "failed"],
  published: [],
  failed: ["draft", "approved", "discarded"],
  discarded: ["draft"],
};
export const canListingTransition = (a: ListingStatus, b: ListingStatus) => T[a].includes(b);

export const storeBuildSchema = z
  .object({
    connectionId: z.string().min(1),
    productIds: z.array(z.string().min(1)).min(1).max(MAX_STORE_BATCH),
    /** Uma das duas formas de definir o preço; a escolha é do usuário. */
    markupPercent: z.number().min(0).max(1000).nullish(),
    fixedPrice: z.number().positive().max(100_000_000).nullish(),
    locale: z.enum(["pt-BR", "en-US", "es"]).default("pt-BR"),
    withModel: z.boolean().default(true),
  })
  .refine((v) => (v.markupPercent == null) !== (v.fixedPrice == null), { message: "choose_one_price_rule" });

export const listingPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(3000).optional(),
  price: z.number().positive().max(100_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  weightKg: z.number().positive().max(1000).nullish(),
  categoryId: z.number().int().positive().nullish(),
  logisticsChannelIds: z.array(z.number().int().positive()).max(10).optional(),
  images: z.array(httpsUrl).max(9).optional(),
});
export const authorizeSchema = z.object({
  listingIds: z.array(z.string().min(1)).min(1).max(MAX_STORE_BATCH),
  /** Deve ser igual ao número de itens: força a pessoa a ver quantos está autorizando. */
  confirmCount: z.number().int().min(1),
});
export const publishSchema = z.object({ listingIds: z.array(z.string().min(1)).min(1).max(MAX_STORE_BATCH) });

export interface ListingCheckInput {
  title: string;
  description: string;
  price: number;
  cost: number;
  stock: number | null;
  weightKg: number | null;
  categoryId: number | null;
  logisticsChannelIds: number[];
  images: string[];
  /** Fatos do fornecedor, contra os quais o texto é conferido. */
  context: string;
}
/** O que impede de autorizar. Lista vazia = pode autorizar. */
export function listingIssues(l: ListingCheckInput): string[] {
  const out: string[] = [];
  if (!l.title.trim()) out.push("title_missing");
  if (!l.description.trim()) out.push("description_missing");
  if (!(l.price > 0)) out.push("price_invalid");
  else if (l.price <= l.cost) out.push("price_not_above_cost");
  if (l.stock === null || l.stock < 1) out.push("stock_missing");
  if (!l.weightKg) out.push("weight_missing");
  if (!l.categoryId) out.push("category_missing");
  if (l.logisticsChannelIds.length === 0) out.push("logistics_missing");
  if (l.images.length === 0) out.push("images_missing");
  for (const i of adApprovalIssues(`${l.title}\n${l.description}`, l.context)) out.push(i);
  return [...new Set(out)];
}
export { adClaimIssues };
