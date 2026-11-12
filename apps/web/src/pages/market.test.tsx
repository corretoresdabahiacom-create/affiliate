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
const status = { enabled: true, modelAvailable: true, limit: null, usedToday: 2, tokensToday: 300, dailyRequests: 20, dailyTokens: 40000 };

const shop = { id: "c1", provider: "shopee", label: "Minha loja", status: "connected", statusDetail: null, config: { shopId: "555" }, hasSecrets: true, createdAt: 1 };
const sup = { id: "c2", provider: "supplier", label: "Fornecedor X", status: "connected", statusDetail: null, config: { url: null }, hasSecrets: false, createdAt: 1 };
const prod = (i: number) => ({ id: `p${i}`, connectionId: "c2", externalId: `E${i}`, sku: null, name: `Produto ${i}`, description: null, costPrice: 10, currency: "BRL", stock: 5, images: ["https://img.example.com/a.jpg"], category: null, weightKg: 0.2, source: "csv", syncedAt: 1 });
const listing = (o: Record<string, unknown> = {}) => ({
  id: "l1", connectionId: "c1", productId: "p1", productName: "Produto 1", title: "Produto 1", description: "Desc", price: 20, costPrice: 10, currency: "BRL",
  margin: { amount: 10, percentOfPrice: 50, feesIncluded: false }, stock: 5, weightKg: 0.2, categoryId: 12, logisticsChannelIds: [1], images: ["https://img.example.com/a.jpg"],
  textSource: "supplier", status: "draft", externalItemId: null, lastError: null, issues: [], ...o,
});

describe("integrações", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("avisa quando o cofre não está configurado e nunca mostra a chave", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/integrations/status") return { status: 200, body: { vaultReady: false, hosts: ["https://partner.shopeemobile.com"] } };
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop] } };
      return { status: 404, body: {} };
    }));
    renderApp("/integrations");
    expect(await screen.findByText(/cofre de credenciais não está configurado/i)).toBeInTheDocument();
    expect(await screen.findByText("Minha loja")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /autorizar loja na shopee/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/partnerKey":/);
    expect((screen.getByLabelText("Partner Key") as HTMLInputElement).type).toBe("password");
  });

  it("cria conexão Shopee e mostra o erro do servidor em linguagem clara", async () => {
    const fn = mockFetch(base(meUser, (url, init) => {
      if (url === "/api/integrations/status") return { status: 200, body: { vaultReady: true, hosts: ["https://partner.shopeemobile.com"] } };
      if (url === "/api/integrations/connections" && init?.method === "POST") return { status: 503, body: { error: "vault_not_configured" } };
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/integrations");
    await userEvent.type(await screen.findByLabelText("Nome da conexão", { selector: "#sh-label" }), "Loja");
    await userEvent.type(screen.getByLabelText("Partner ID"), "1001");
    await userEvent.type(screen.getByLabelText("Partner Key"), "chave-secreta-123");
    await userEvent.click(screen.getAllByRole("button", { name: "Salvar conexão" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/cofre de credenciais não está configurado neste servidor/i);
    const post = fn.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ provider: "shopee", partnerId: "1001" });
  });

  it("simula a importação antes de gravar", async () => {
    const fn = mockFetch(base(meUser, (url, init) => {
      if (url === "/api/integrations/status") return { status: 200, body: { vaultReady: true, hosts: [] } };
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [sup] } };
      if (url === "/api/integrations/supplier/import") return { status: 200, body: { dryRun: true, valid: 2, errors: [{ row: 3, error: "costPrice" }] } };
      return { status: 404, body: {} };
    }));
    renderApp("/integrations");
    await userEvent.type(await screen.findByLabelText("Dados"), "external_id,name,cost_price");
    await userEvent.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByText(/Simulação: 2 válidos, 1 com erro/)).toBeInTheDocument();
    expect(JSON.parse(String((fn.mock.calls.find(([u]) => u === "/api/integrations/supplier/import")![1] as RequestInit).body)).dryRun).toBe(true);
  });
});

describe("montagem de loja", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("sem loja autorizada, orienta a ir para Integrações", async () => {
    mockFetch(base(meUser, (url) => (url === "/api/integrations/connections" ? { status: 200, body: { items: [{ ...shop, status: "pending" }] } } : url.startsWith("/api/integrations/supplier") ? { status: 200, body: { items: [] } } : { status: 404, body: {} })));
    renderApp("/store");
    expect(await screen.findByText(/conecte e autorize uma loja shopee/i)).toBeInTheDocument();
  });

  it("seleciona no máximo 50 produtos e monta rascunhos sem publicar", async () => {
    const products = Array.from({ length: 60 }, (_, i) => prod(i));
    const fn = mockFetch(base(meUser, (url, init) => {
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop, sup] } };
      if (url.startsWith("/api/integrations/supplier/products")) return { status: 200, body: { items: products } };
      if (url.startsWith("/api/market/listings")) return { status: 200, body: { items: [] } };
      if (url === "/api/market/store/build") return { status: 201, body: { items: Array.from({ length: 50 }, (_, i) => listing({ id: `n${i}` })), skipped: [], published: false } };
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    await userEvent.click(await screen.findByRole("button", { name: "Selecionar até 50" }));
    expect(screen.getByText(/Produtos \(50\/50 selecionados\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Montar 50 anúncios \(rascunho\)/ }));
    expect(await screen.findByText(/50 rascunhos criados\. Nada foi publicado\./)).toBeInTheDocument();
    const call = fn.mock.calls.find(([u]) => u === "/api/market/store/build")!;
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body.productIds).toHaveLength(50);
    expect(body).toMatchObject({ connectionId: "c1", markupPercent: 100 });
    expect(fn.mock.calls.some(([u]) => String(u).includes("/publish"))).toBe(false);
  });

  it("autorizar exige digitar a quantidade; publicar só aparece para autorizados e mostra o erro da Shopee", async () => {
    let status = "draft";
    const fn = mockFetch(base(meUser, (url, init) => {
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop] } };
      if (url.startsWith("/api/integrations/supplier/products")) return { status: 200, body: { items: [] } };
      if (url.startsWith("/api/market/listings") && (!init?.method || init.method === "GET")) return { status: 200, body: { items: [listing({ status })] } };
      if (url === "/api/market/listings/authorize") { status = "approved"; return { status: 200, body: { authorized: ["l1"], rejected: [] } }; }
      if (url === "/api/market/listings/publish") return { status: 200, body: { results: [{ id: "l1", ok: false, error: "shopee_error: category requires attribute Brand" }] } };
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Produto 1" }));
    const authBtn = screen.getByRole("button", { name: "Autorizar publicação" });
    expect(authBtn).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Publicar \d+ autorizado/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Digite 1 para confirmar/), "2");
    expect(authBtn).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/Digite 1 para confirmar/));
    await userEvent.type(screen.getByLabelText(/Digite 1 para confirmar/), "1");
    await userEvent.click(authBtn);
    const pub = await screen.findByRole("button", { name: /Publicar 1 autorizado\(s\) na Shopee/ });
    await userEvent.click(pub);
    expect(await screen.findByText(/category requires attribute Brand/)).toBeInTheDocument();
    expect(JSON.parse(String((fn.mock.calls.find(([u]) => u === "/api/market/listings/authorize")![1] as RequestInit).body))).toEqual({ listingIds: ["l1"], confirmCount: 1 });
  });

  it("mostra pendências e a margem sem taxas", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/integrations/connections") return { status: 200, body: { items: [shop] } };
      if (url.startsWith("/api/integrations/supplier/products")) return { status: 200, body: { items: [] } };
      if (url.startsWith("/api/market/listings")) return { status: 200, body: { items: [listing({ issues: ["category_missing", "price_not_above_cost"] })] } };
      return { status: 404, body: {} };
    }));
    renderApp("/store");
    expect(await screen.findByText("Falta a categoria")).toBeInTheDocument();
    expect(screen.getByText("Preço não passa do custo")).toBeInTheDocument();
    expect(screen.getByText(/Margem antes das taxas/)).toBeInTheDocument();
  });
});
