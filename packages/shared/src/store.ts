import { z } from "zod";

/**
 * Loja (Fase 6, parte 3): variações, atributos da categoria, sincronização, pedidos e rastreio.
 * Regras: nada vai para a loja sem autorização; pedidos guardam só o necessário (sem dados do comprador);
 * o sistema não compra no fornecedor por você.
 */

// ---------- Variações ----------

/** Limites conservadores (nome da dimensão 14, opção 20, 50 modelos). Confirme na documentação da Shopee. */
export const variantTierSchema = z.object({ name: z.string().trim().min(1).max(14), options: z.array(z.string().trim().min(1).max(20)).min(1).max(50) });
export const variantModelSchema = z.object({
  tierIndex: z.array(z.number().int().min(0)).min(1).max(2),
  sku: z.string().trim().max(100).nullish(),
  costPrice: z.number().min(0).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000).nullish(),
  /** Preço de venda do modelo; vazio no fornecedor, preenchido no anúncio. */
  price: z.number().positive().max(100_000_000).optional(),
});
export const variantsSchema = z
  .object({ tiers: z.array(variantTierSchema).min(1).max(2), models: z.array(variantModelSchema).min(1).max(50) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.models.forEach((m, i) => {
      if (m.tierIndex.length !== v.tiers.length || m.tierIndex.some((x, t) => x >= v.tiers[t]!.options.length)) ctx.addIssue({ code: "custom", message: "tier_index_out_of_range", path: ["models", i] });
      const k = m.tierIndex.join(",");
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: "duplicate_model", path: ["models", i] });
      seen.add(k);
    });
  });
export type Variants = z.infer<typeof variantsSchema>;

/** Dá preço a cada modelo pela regra do usuário (markup sobre o custo do modelo, ou preço fixo). */
export function priceVariants(v: Variants, rule: { markupPercent?: number | null; fixedPrice?: number | null }): Variants {
  const c = (n: number) => Math.round(n * 100) / 100;
  return { ...v, models: v.models.map((m) => ({ ...m, price: rule.fixedPrice != null ? rule.fixedPrice : c(m.costPrice * (1 + (rule.markupPercent ?? 0) / 100)) })) };
}
export const variantsSummary = (v: Variants) => ({
  minPrice: Math.min(...v.models.map((m) => m.price ?? m.costPrice)),
  minCost: Math.min(...v.models.map((m) => m.costPrice)),
  stock: v.models.reduce((a, m) => a + (m.stock ?? 0), 0),
});
export function variantIssues(v: Variants | null): string[] {
  if (!v) return [];
  const p = variantsSchema.safeParse(v);
  if (!p.success) return ["variants_invalid"];
  const out: string[] = [];
  if (p.data.models.some((m) => !m.price || m.price <= m.costPrice)) out.push("variant_price_not_above_cost");
  if (p.data.models.some((m) => m.stock == null)) out.push("variant_stock_missing");
  return out;
}

// ---------- Atributos obrigatórios da categoria ----------

export interface AttributeDef { id: number; name: string; mandatory: boolean; inputType: string; values: Array<{ id: number; name: string }> }
export interface AttributeValue { attributeId: number; valueId?: number; customValue?: string }
export const attributeValueSchema = z.object({ attributeId: z.number().int().positive(), valueId: z.number().int().positive().optional(), customValue: z.string().trim().min(1).max(200).optional() })
  .refine((a) => (a.valueId != null) !== (a.customValue != null), { message: "value_or_custom" });

/** Pendências de atributo. `schema` nulo = a lista da categoria ainda não foi consultada. */
export function attributeIssues(categoryId: number | null, schema: AttributeDef[] | null, given: AttributeValue[]): string[] {
  if (!categoryId) return [];
  if (!schema) return ["attributes_unchecked"];
  const have = new Set(given.map((a) => a.attributeId));
  return schema.some((a) => a.mandatory && !have.has(a.id)) ? ["attribute_missing"] : [];
}

// ---------- Sincronização com o fornecedor ----------

export interface SyncSide { price: number; costPrice: number; stock: number | null; variants: Variants | null; rule: { markupPercent?: number | null; fixedPrice?: number | null } | null }
export interface SyncProposal {
  stock?: { from: number | null; to: number };
  price?: { from: number; to: number };
  models?: Array<{ key: string; stock?: { from: number | null; to: number }; price?: { from: number | undefined; to: number } }>;
  costChanged: boolean;
}
/** Compara o anúncio com o fornecedor atual. Preço só muda sugestão se a regra for markup; preço fixo nunca é mexido. */
export function syncProposals(l: SyncSide, s: { costPrice: number; stock: number | null; variants: Variants | null }): SyncProposal | null {
  const out: SyncProposal = { costChanged: false };
  const c = (n: number) => Math.round(n * 100) / 100;
  if (l.variants && s.variants) {
    const byKey = new Map(s.variants.models.map((m) => [m.sku || m.tierIndex.join(","), m]));
    const models: NonNullable<SyncProposal["models"]> = [];
    for (const m of l.variants.models) {
      const key = m.sku || m.tierIndex.join(",");
      const sm = byKey.get(key);
      if (!sm) continue;
      const item: NonNullable<SyncProposal["models"]>[number] = { key };
      if ((sm.stock ?? 0) !== (m.stock ?? 0) && sm.stock != null) item.stock = { from: m.stock ?? null, to: sm.stock };
      if (sm.costPrice !== m.costPrice) {
        out.costChanged = true;
        if (l.rule?.markupPercent != null) {
          const np = c(sm.costPrice * (1 + l.rule.markupPercent / 100));
          if (np !== m.price) item.price = { from: m.price, to: np };
        }
      }
      if (item.stock || item.price) models.push(item);
    }
    if (models.length) out.models = models;
  } else {
    if (s.stock != null && s.stock !== l.stock) out.stock = { from: l.stock, to: s.stock };
    if (s.costPrice !== l.costPrice) {
      out.costChanged = true;
      if (l.rule?.markupPercent != null) {
        const np = c(s.costPrice * (1 + l.rule.markupPercent / 100));
        if (np !== l.price) out.price = { from: l.price, to: np };
      }
    }
  }
  return out.stock || out.price || out.models || out.costChanged ? out : null;
}

// ---------- Pedidos e rastreio ----------

export const SHOPEE_ORDER_STATUS = ["UNPAID", "READY_TO_SHIP", "PROCESSED", "SHIPPED", "COMPLETED", "IN_CANCEL", "CANCELLED", "INVOICE_PENDING"] as const;
export const SUPPLIER_ORDER_STATUS = ["not_placed", "placed", "shipped", "delivered", "problem"] as const;
export const supplierOrderPatchSchema = z.object({
  supplierStatus: z.enum(SUPPLIER_ORDER_STATUS).optional(),
  supplierRef: z.string().trim().max(120).nullish(),
  supplierTracking: z.string().trim().max(120).nullish(),
});
export const orderSyncSchema = z.object({ connectionId: z.string().min(1), days: z.number().int().min(1).max(15).default(7) });

export interface OrderItem { itemId: string; modelId: string | null; name: string | null; sku: string | null; quantity: number; price: number }
export interface NormalizedOrder { orderSn: string; status: string; createdAt: number; currency: string; total: number | null; items: OrderItem[] }
/** Só o necessário para operar: sem nome, endereço ou contato do comprador (LGPD). */
export function normalizeOrder(raw: any): NormalizedOrder | null {
  if (!raw || typeof raw.order_sn !== "string" || !raw.order_sn) return null;
  const items: OrderItem[] = (Array.isArray(raw.item_list) ? raw.item_list : []).map((i: any) => ({
    itemId: String(i.item_id ?? ""),
    modelId: i.model_id && Number(i.model_id) !== 0 ? String(i.model_id) : null,
    name: i.item_name ? String(i.item_name).slice(0, 200) : null,
    sku: i.model_sku || i.item_sku ? String(i.model_sku || i.item_sku).slice(0, 100) : null,
    quantity: Math.max(1, Math.trunc(Number(i.model_quantity_purchased ?? i.quantity ?? 1)) || 1),
    price: Number(i.model_discounted_price ?? i.model_original_price ?? i.item_price ?? 0) || 0,
  }));
  return {
    orderSn: raw.order_sn,
    status: String(raw.order_status ?? "UNKNOWN"),
    createdAt: Number(raw.create_time ?? 0) * 1000,
    currency: String(raw.currency ?? "BRL").slice(0, 3),
    total: raw.total_amount != null ? Number(raw.total_amount) : null,
    items,
  };
}

export interface SheetLine { productName: string; supplierExternalId: string | null; sku: string | null; quantity: number; unitCost: number | null; lineCost: number | null; matched: boolean }
/** Ficha para fazer o pedido no fornecedor À MÃO. O sistema não compra por você. */
export function supplierSheet(items: OrderItem[], find: (itemId: string, modelId: string | null, sku: string | null) => { name: string; externalId: string | null; sku: string | null; unitCost: number | null } | null) {
  const lines: SheetLine[] = items.map((i) => {
    const f = find(i.itemId, i.modelId, i.sku);
    const unit = f?.unitCost ?? null;
    return { productName: f?.name ?? i.name ?? i.itemId, supplierExternalId: f?.externalId ?? null, sku: f?.sku ?? i.sku, quantity: i.quantity, unitCost: unit, lineCost: unit == null ? null : Math.round(unit * i.quantity * 100) / 100, matched: !!f };
  });
  const known = lines.filter((l) => l.lineCost != null);
  return { lines, totalCost: known.length === lines.length && lines.length ? Math.round(known.reduce((a, l) => a + l.lineCost!, 0) * 100) / 100 : null, unmatched: lines.filter((l) => !l.matched).length };
}

// ---------- Importação de variações por CSV ----------

const csvNum = (s: unknown) => {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * Agrupa linhas de CSV com variação (uma linha por modelo) em um item por produto.
 * Colunas: external_id, tier1_name, option1, [tier2_name, option2], variant_sku, variant_cost, variant_stock.
 * Linhas sem option1 passam intactas. Nada é inventado: custo ou estoque ilegível vira valor inválido e o item é rejeitado adiante.
 */
export function groupVariantRows(rows: Array<Record<string, string>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const byId = new Map<string, { base: Record<string, unknown>; tiers: Array<{ name: string; options: string[] }>; models: Array<Record<string, unknown>> }>();
  for (const r of rows) {
    const o1 = (r.option1 ?? "").trim();
    if (!o1) { out.push(r); continue; }
    const id = (r.external_id ?? "").trim();
    let g = byId.get(id);
    if (!g) {
      const tiers = [{ name: (r.tier1_name ?? "").trim() || "Variação", options: [] as string[] }];
      if ((r.option2 ?? "").trim()) tiers.push({ name: (r.tier2_name ?? "").trim() || "Opção", options: [] });
      g = { base: { ...r }, tiers, models: [] };
      byId.set(id, g);
      out.push(g.base);
    }
    const opts = [o1, (r.option2 ?? "").trim()].slice(0, g.tiers.length);
    const idx = opts.map((o, t) => {
      const list = g!.tiers[t]!.options;
      let i = list.indexOf(o);
      if (i < 0) { list.push(o); i = list.length - 1; }
      return i;
    });
    g.models.push({ tier_index: idx, sku: (r.variant_sku ?? "").trim() || null, cost_price: csvNum(r.variant_cost) ?? csvNum(r.cost_price) ?? NaN, stock: csvNum(r.variant_stock) });
  }
  for (const g of byId.values()) {
    g.base.variants = { tiers: g.tiers, models: g.models };
    const costs = g.models.map((m) => m.cost_price as number).filter((x) => Number.isFinite(x));
    if (!String(g.base.cost_price ?? "").trim() && costs.length) g.base.cost_price = String(Math.min(...costs));
    const st = g.models.map((m) => m.stock as number | null);
    if (!String(g.base.stock ?? "").trim() && st.every((x) => x != null)) g.base.stock = String(st.reduce((a, b) => a! + b!, 0));
  }
  return out;
}
