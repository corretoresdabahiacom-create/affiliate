import { describe, expect, it } from "vitest";
import {
  attributeIssues,
  groupVariantRows,
  normalizeOrder,
  priceVariants,
  supplierSheet,
  syncProposals,
  variantIssues,
  variantsSchema,
  variantsSummary,
  type Variants,
} from "./store";
import { listingIssues, normalizeSupplierItem, supplierMappingSchema } from "./market";

const V: Variants = {
  tiers: [{ name: "Cor", options: ["Azul", "Vermelha"] }, { name: "Tamanho", options: ["P", "M"] }],
  models: [
    { tierIndex: [0, 0], sku: "A", costPrice: 20, stock: 5 },
    { tierIndex: [0, 1], sku: "B", costPrice: 22, stock: 0 },
    { tierIndex: [1, 0], sku: null, costPrice: 21.5, stock: 3 },
  ],
};

describe("variações", () => {
  it("valida limites, índices e duplicatas", () => {
    expect(variantsSchema.safeParse(V).success).toBe(true);
    expect(variantsSchema.safeParse({ ...V, models: [{ tierIndex: [2, 0], costPrice: 1 }] }).success).toBe(false);
    expect(variantsSchema.safeParse({ ...V, models: [V.models[0], V.models[0]] }).success).toBe(false);
    expect(variantsSchema.safeParse({ tiers: [{ name: "Nome grande demais aqui", options: ["a"] }], models: [{ tierIndex: [0], costPrice: 1 }] }).success).toBe(false);
    expect(variantsSchema.safeParse({ tiers: [{ name: "A", options: ["x"] }, { name: "B", options: ["y"] }, { name: "C", options: ["z"] }], models: [] }).success).toBe(false);
  });

  it("precifica cada modelo pela regra e resume menor preço, custo e estoque", () => {
    const p = priceVariants(V, { markupPercent: 100 });
    expect(p.models.map((m) => m.price)).toEqual([40, 44, 43]);
    expect(variantsSummary(p)).toEqual({ minPrice: 40, minCost: 20, stock: 8 });
    expect(priceVariants(V, { fixedPrice: 59.9 }).models.every((m) => m.price === 59.9)).toBe(true);
  });

  it("pendências: preço não acima do custo e estoque ausente", () => {
    expect(variantIssues(null)).toEqual([]);
    expect(variantIssues(priceVariants(V, { markupPercent: 50 }))).toEqual([]);
    expect(variantIssues(priceVariants(V, { markupPercent: 0 }))).toContain("variant_price_not_above_cost");
    expect(variantIssues(V)).toContain("variant_price_not_above_cost"); // sem preço ainda
    const noStock = priceVariants({ ...V, models: [{ ...V.models[0]!, stock: null }, ...V.models.slice(1)] }, { markupPercent: 50 });
    expect(variantIssues(noStock)).toContain("variant_stock_missing");
  });

  it("listingIssues inclui as pendências de variação e de atributo", () => {
    const base = { title: "Camiseta", description: "x", price: 40, cost: 20, context: "Camiseta 20 reais", stock: 8, weightKg: 0.2, categoryId: 12, logisticsChannelIds: [1], images: ["https://a/b.jpg"] };
    expect(listingIssues({ ...base, variants: priceVariants(V, { markupPercent: 0 }) })).toContain("variant_price_not_above_cost");
    expect(listingIssues({ ...base, attributeSchema: [{ id: 1, name: "Marca", mandatory: true, inputType: "", values: [] }], attributes: [] })).toContain("attribute_missing");
    expect(listingIssues({ ...base, variants: priceVariants(V, { markupPercent: 50 }) })).not.toContain("variant_price_not_above_cost");
  });
});

describe("atributos obrigatórios", () => {
  const schema = [{ id: 1, name: "Marca", mandatory: true, inputType: "DROP_DOWN", values: [] }, { id: 2, name: "Cor", mandatory: false, inputType: "", values: [] }];
  it("sem categoria não há o que checar; schema não consultado é sinalizado", () => {
    expect(attributeIssues(null, null, [])).toEqual([]);
    expect(attributeIssues(12, null, [])).toEqual(["attributes_unchecked"]);
  });
  it("só os obrigatórios faltando bloqueiam", () => {
    expect(attributeIssues(12, schema, [])).toEqual(["attribute_missing"]);
    expect(attributeIssues(12, schema, [{ attributeId: 1, valueId: 9 }])).toEqual([]);
    expect(attributeIssues(12, [schema[1]!], [])).toEqual([]);
  });
});

describe("sincronização com o fornecedor", () => {
  const listing = { price: 40, costPrice: 20, stock: 8, variants: priceVariants(V, { markupPercent: 100 }), rule: { markupPercent: 100 } };
  it("sem mudança não propõe nada", () => {
    expect(syncProposals(listing, { costPrice: 20, stock: 8, variants: V })).toBeNull();
  });
  it("propõe estoque e preço (markup) por modelo, casando por SKU", () => {
    const sv: Variants = { ...V, models: [{ ...V.models[0]!, costPrice: 24, stock: 9 }, ...V.models.slice(1)] };
    const p = syncProposals(listing, { costPrice: 20, stock: 12, variants: sv })!;
    expect(p.models).toEqual([{ key: "A", stock: { from: 5, to: 9 }, price: { from: 40, to: 48 } }]);
    expect(p.costChanged).toBe(true);
  });
  it("preço fixo nunca é mexido; só avisa que o custo mudou", () => {
    const p = syncProposals({ price: 50, costPrice: 20, stock: 5, variants: null, rule: { fixedPrice: 50 } }, { costPrice: 30, stock: 5, variants: null })!;
    expect(p.price).toBeUndefined();
    expect(p.costChanged).toBe(true);
  });
  it("produto simples: estoque e preço por markup", () => {
    const p = syncProposals({ price: 40, costPrice: 20, stock: 8, variants: null, rule: { markupPercent: 100 } }, { costPrice: 25, stock: 3, variants: null })!;
    expect(p).toMatchObject({ stock: { from: 8, to: 3 }, price: { from: 40, to: 50 } });
  });
  it("estoque desconhecido no fornecedor não vira zero", () => {
    expect(syncProposals({ price: 40, costPrice: 20, stock: 8, variants: null, rule: null }, { costPrice: 20, stock: null, variants: null })).toBeNull();
  });
});

describe("pedidos", () => {
  it("normaliza sem dados do comprador", () => {
    const o = normalizeOrder({
      order_sn: "S1", order_status: "SHIPPED", create_time: 1700000000, total_amount: "90.5", buyer_username: "joao", recipient_address: { name: "João", phone: "1" },
      item_list: [{ item_id: 5, item_name: "Camiseta", model_id: 91, model_sku: "A", model_quantity_purchased: 2, model_discounted_price: 45 }, { item_id: 6, model_id: 0 }],
    })!;
    expect(o).toMatchObject({ orderSn: "S1", status: "SHIPPED", createdAt: 1700000000000, total: 90.5 });
    expect(o.items[0]).toEqual({ itemId: "5", modelId: "91", name: "Camiseta", sku: "A", quantity: 2, price: 45 });
    expect(o.items[1]).toMatchObject({ modelId: null, quantity: 1 });
    expect(JSON.stringify(o)).not.toMatch(/joao|João|recipient|buyer/);
    expect(normalizeOrder({})).toBeNull();
    expect(normalizeOrder(null)).toBeNull();
  });
  it("ficha do fornecedor: total só se todo item tiver custo conhecido", () => {
    const items = [{ itemId: "5", modelId: null, name: "A", sku: null, quantity: 2, price: 1 }, { itemId: "6", modelId: null, name: "B", sku: null, quantity: 1, price: 1 }];
    const find = (id: string) => (id === "5" ? { name: "A", externalId: "E5", sku: "S", unitCost: 10.1 } : null);
    const s = supplierSheet(items, find);
    expect(s.lines[0]).toMatchObject({ lineCost: 20.2, matched: true });
    expect(s.lines[1]).toMatchObject({ lineCost: null, matched: false });
    expect(s).toMatchObject({ totalCost: null, unmatched: 1 });
    expect(supplierSheet([items[0]!], find).totalCost).toBe(20.2);
  });
});

describe("importação de variações", () => {
  it("agrupa linhas por produto; linhas simples passam intactas", () => {
    const rows: Array<Record<string, string>> = [
      { external_id: "V1", name: "Cam", tier1_name: "Cor", option1: "Azul", option2: "", variant_cost: "20", variant_stock: "5", cost_price: "" },
      { external_id: "V1", name: "Cam", tier1_name: "Cor", option1: "Vermelha", option2: "", variant_cost: "21,5", variant_stock: "2", cost_price: "" },
      { external_id: "N1", name: "Caneca", option1: "", cost_price: "9" },
    ];
    const out = groupVariantRows(rows);
    expect(out).toHaveLength(2);
    const v = out[0]!.variants as any;
    expect(v.tiers).toEqual([{ name: "Cor", options: ["Azul", "Vermelha"] }]);
    expect(v.models.map((m: any) => [m.tier_index, m.cost_price, m.stock])).toEqual([[[0], 20, 5], [[1], 21.5, 2]]);
    expect(out[0]).toMatchObject({ cost_price: "20", stock: "7" });
    expect(out[1]).toEqual(rows[2]);
  });
  it("custo de variação ilegível rejeita o item, sem inventar", () => {
    const out = groupVariantRows([{ external_id: "V", name: "X", option1: "A", variant_cost: "abc", cost_price: "" }]);
    const n = normalizeSupplierItem(out[0], supplierMappingSchema.parse({ externalId: "external_id", name: "name", costPrice: "cost_price", variants: "variants" }));
    expect(n.ok).toBe(false);
  });
});
