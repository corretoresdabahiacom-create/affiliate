import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";
import { I18nProvider } from "../i18n";

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };
function mockFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const renderApp = (path: string, locale: "pt-BR" | "en-US" = "pt-BR") =>
  render(
    <I18nProvider initial={locale}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
const profile = {
  displayName: "Ana", locale: "pt-BR", country: "BR", experience: null, niches: [], channels: [], hasWebsite: false, monthlyBudgetUsd: null,
  wantsRecurring: false, acceptsPaidTraffic: false, languages: [], audienceSize: null, weeklyHours: null, prefersPhysical: false, prefersSaas: false, onboarded: true,
};
const meUser = { user: { id: "1", email: "a@a.com", role: "user", planId: "free" }, profile };
const meAdmin = { ...meUser, user: { ...meUser.user, role: "admin" } };
const base = (me: unknown, extra: Handler): Handler => (url, init) => (url === "/api/me" ? { status: 200, body: me } : extra(url, init));
const _status = { enabled: true, modelAvailable: true, limit: null, usedToday: 2, tokensToday: 300, dailyRequests: 20, dailyTokens: 40000 };

const shop = { id: "c1", provider: "shopee", label: "Minha loja", status: "connected", statusDetail: null, config: { shopId: "555" }, hasSecrets: true, createdAt: 1 };
const sup = { id: "c2", provider: "supplier", label: "Fornecedor X", status: "connected", statusDetail: null, config: { url: null }, hasSecrets: false, createdAt: 1 };
const prod = (i: number) => ({ id: `p${i}`, connectionId: "c2", externalId: `E${i}`, sku: null, name: `Produto ${i}`, description: null, costPrice: 10, currency: "BRL", stock: 5, images: ["https://img.example.com/a.jpg"], category: null, weightKg: 0.2, source: "csv", syncedAt: 1 });
const listing = (o: Record<string, unknown> = {}) => ({
  id: "l1", connectionId: "c1", productId: "p1", productName: "Produto 1", title: "Produto 1", description: "Desc", price: 20, costPrice: 10, currency: "BRL",
  margin: { amount: 10, percentOfPrice: 50, feesIncluded: false }, stock: 5, weightKg: 0.2, categoryId: 12, logisticsChannelIds: [1], images: ["https://img.example.com/a.jpg"],
  textSource: "supplier", status: "draft", externalItemId: null, lastError: null, issues: [], ...o,
});


const V = { tiers: [{ name: "Cor", options: ["Azul", "Vermelha"] }], models: [{ tierIndex: [0], sku: "A", costPrice: 10, stock: 5, price: 20 }, { tierIndex: [1], sku: "B", costPrice: 12, stock: 2, price: 24 }] };
const ext = (o: Record<string, unknown> = {}) => listing({ variants: V, attributes: [], attributeSchema: null, priceRule: { markupPercent: 100 }, updateStatus: null, lastSyncedAt: null, ...o });
const storeHandler = (listings: unknown[], extra: Handler = () => ({ status: 404, body: {} })): Handler => base(meUser, (url, init) => {
  if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop, sup] } };
  if (url.startsWith("/api/integrations/supplier/products")) return { status: 200, body: { items: [prod(1)] } };
  if (url.startsWith("/api/market/listings") && (!init?.method || init.method === "GET")) return { status: 200, body: { items: listings } };
  return extra(url, init);
});

describe("loja: variações, atributos e edição de publicados", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("mostra as variações e salva preço e estoque por modelo", async () => {
    let patch: any = null;
    mockFetch(storeHandler([ext()], (url, init) => {
      if (url === "/api/market/listings/l1" && init?.method === "PATCH") { patch = JSON.parse(String(init.body)); return { status: 200, body: { item: ext() } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    expect(await screen.findByText(/Variações: Cor/)).toBeInTheDocument();
    const price = screen.getByLabelText("Preço 1") as HTMLInputElement;
    await userEvent.clear(price);
    await userEvent.type(price, "30");
    await userEvent.click(screen.getByRole("button", { name: /^salvar/i }));
    await waitFor(() => expect(patch).toEqual({ title: "Produto 1", description: "Desc", modelPrices: [20, 30], modelStocks: [5, 2] }));
  });

  it("pede os atributos obrigatórios da categoria e envia os escolhidos", async () => {
    let patch: any = null;
    const schema = [{ id: 100, name: "Marca", mandatory: true, inputType: "DROP_DOWN", values: [{ id: 1, name: "Genérica" }] }];
    mockFetch(storeHandler([ext({ attributeSchema: schema, issues: ["attribute_missing"] })], (url, init) => {
      if (url === "/api/market/listings/l1" && init?.method === "PATCH") { patch = JSON.parse(String(init.body)); return { status: 200, body: { item: ext() } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    expect(await screen.findByText("Falta atributo obrigatório da categoria")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Marca *"), "1");
    await userEvent.click(screen.getByRole("button", { name: /^salvar/i }));
    await waitFor(() => expect(patch.attributes).toEqual([{ attributeId: 100, valueId: 1 }]));
  });

  it("anúncio publicado: alteração pendente exige autorização e só depois aparece o botão de enviar", async () => {
    let auth: any = null;
    const dirty = ext({ status: "published", externalItemId: "55", updateStatus: "dirty", issues: [] });
    mockFetch(storeHandler([dirty], (url, init) => {
      if (url === "/api/market/listings/authorize") { auth = JSON.parse(String(init!.body)); return { status: 200, body: { authorized: ["l1"], rejected: [] } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    expect(await screen.findByText("Alteração pendente (não enviada)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar \d+ alterações/i })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Produto 1" }));
    await userEvent.type(screen.getByLabelText(/confirme a quantidade|digite/i), "1");
    await userEvent.click(screen.getByRole("button", { name: /^autorizar/i }));
    await waitFor(() => expect(auth).toEqual({ listingIds: ["l1"], confirmCount: 1 }));
  });

  it("anúncio com alteração autorizada mostra o botão de enviar e usa o publicar", async () => {
    let sent: any = null;
    mockFetch(storeHandler([ext({ status: "published", externalItemId: "55", updateStatus: "authorized" })], (url, init) => {
      if (url === "/api/market/listings/publish") { sent = JSON.parse(String(init!.body)); return { status: 200, body: { results: [{ id: "l1", ok: true, itemId: "55", updated: true }] } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    await userEvent.click(await screen.findByRole("button", { name: "Enviar 1 alterações autorizadas" }));
    await waitFor(() => expect(sent).toEqual({ listingIds: ["l1"] }));
    await waitFor(() => expect(document.body.textContent).toMatch(/1 atualizados, 0 com problema/));
  });

  it("sincronização só propõe e aplicar vira alteração pendente", async () => {
    let applied: any = null;
    mockFetch(storeHandler([ext({ status: "published", externalItemId: "55" })], (url, init) => {
      if (url === "/api/market/sync/preview") return { status: 200, body: { checked: 1, items: [{ listingId: "l1", productName: "Produto 1", proposal: { stock: { from: 5, to: 9 }, costChanged: false } }] } };
      if (url === "/api/market/sync/apply") { applied = JSON.parse(String(init!.body)); return { status: 200, body: { applied: 1, requiresAuthorization: true } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    await userEvent.click(await screen.findByRole("button", { name: "Comparar agora" }));
    expect(await screen.findByText("Estoque 5 → 9")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aplicar só estoque" }));
    await waitFor(() => expect(applied).toEqual({ connectionId: "c1", listingIds: ["l1"], kinds: ["stock"] }));
    expect(await screen.findByText(/1 anúncios com alteração pendente/)).toBeInTheDocument();
  });
});

const order = (o: Record<string, unknown> = {}) => ({
  id: "o1", connectionId: "c1", orderSn: "2611AAA", status: "READY_TO_SHIP", orderedAt: 1700000000000, currency: "BRL", total: 90, items: [{ itemId: "5", modelId: "91", name: "Camiseta", sku: "A", quantity: 2, price: 45 }],
  trackingNumber: null, trackingStatus: null, trackingEvents: [], trackingCheckedAt: null, supplierStatus: "not_placed", supplierRef: null, supplierTracking: null, syncedAt: 1, ...o,
});

describe("pedidos", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("sem loja autorizada orienta a ir para Integrações", async () => {
    mockFetch(base(meUser, (url) => (url === "/api/integrations/connections" ? { status: 200, body: { items: [] } } : { status: 404, body: {} })));
    renderApp("/orders");
    expect(await screen.findByText(/conecte e autorize uma loja shopee/i)).toBeInTheDocument();
  });

  it("busca pedidos, mostra a ficha do fornecedor sem inventar custo e salva o andamento manual", async () => {
    let patch: any = null;
    let list = [order()];
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop] } };
      if (url.startsWith("/api/orders?")) return { status: 200, body: { items: list } };
      if (url === "/api/orders/sync") { list = [order()]; return { status: 200, body: { created: 1, updated: 0 } }; }
      if (url === "/api/orders/o1/supplier-sheet") return { status: 200, body: { orderSn: "2611AAA", lines: [{ productName: "Camiseta", supplierExternalId: "V1", sku: "A", quantity: 2, unitCost: 24, lineCost: 48, matched: true }, { productName: "Outro", supplierExternalId: null, sku: null, quantity: 1, unitCost: null, lineCost: null, matched: false }], totalCost: null, unmatched: 1, note: "manual_purchase" } };
      if (url === "/api/orders/o1" && init?.method === "PATCH") { patch = JSON.parse(String(init.body)); return { status: 200, body: { item: order() } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/orders");
    expect(await screen.findByText("Pedido 2611AAA")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/comprador:|endereço de entrega/i);
    await userEvent.click(screen.getByRole("button", { name: "Buscar pedidos" }));
    expect(await screen.findByText("1 novos, 0 atualizados.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ficha do fornecedor" }));
    const region = await screen.findByRole("region", { name: "Ficha do fornecedor" });
    expect(within(region).getByText(/1 item\(ns\) sem anúncio correspondente/)).toBeInTheDocument();
    expect(within(region).getByText("Custo total desconhecido.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Compra no fornecedor", { selector: "select" }), "placed");
    await userEvent.type(screen.getByLabelText("Nº do pedido no fornecedor"), "PED-77");
    await userEvent.click(screen.getByRole("button", { name: "Salvar andamento" }));
    await waitFor(() => expect(patch).toEqual({ supplierStatus: "placed", supplierRef: "PED-77", supplierTracking: null }));
  });

  it("atualiza o rastreio da Shopee", async () => {
    let called = false;
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop] } };
      if (url.startsWith("/api/orders?")) return { status: 200, body: { items: [order()] } };
      if (url === "/api/orders/o1/tracking/refresh" && init?.method === "POST") { called = true; return { status: 200, body: { item: order({ trackingNumber: "BR999", trackingStatus: "PICKUP", trackingCheckedAt: 5, trackingEvents: [{ at: 1700000000000, description: "Coletado", status: null }] }) } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/orders");
    await userEvent.click(await screen.findByRole("button", { name: "Atualizar rastreio" }));
    await waitFor(() => expect(called).toBe(true));
  });
});

describe("estoque automático", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());
  it("vem desligado e só liga quando a pessoa marca", async () => {
    let body: any = null;
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/integrations/status") return { status: 200, body: { vaultReady: true, hosts: [] } };
      if (url === "/api/integrations/connections/c1" && init?.method === "PATCH") { body = JSON.parse(String(init.body)); return { status: 200, body: { item: shop } }; }
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop] } };
      return { status: 404, body: {} };
    }));
    renderApp("/integrations");
    const box = await screen.findByRole("checkbox", { name: "Sincronizar estoque automaticamente" });
    expect((box as HTMLInputElement).checked).toBe(false);
    await userEvent.click(box);
    await waitFor(() => expect(body).toEqual({ autoStock: true }));
  });
});
