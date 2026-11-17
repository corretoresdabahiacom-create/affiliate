import { render, screen, waitFor } from "@testing-library/react";
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
const renderApp = (path: string, locale: "pt-BR" | "en-US" | "es" = "pt-BR") =>
  render(<I18nProvider initial={locale}><AuthProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></AuthProvider></I18nProvider>);
const profile = {
  displayName: "Ana", locale: "pt-BR", country: "BR", experience: null, niches: [], channels: [], hasWebsite: false, monthlyBudgetUsd: null,
  wantsRecurring: false, acceptsPaidTraffic: false, languages: [], audienceSize: null, weeklyHours: null, prefersPhysical: false, prefersSaas: false, onboarded: true,
};
const meUser = { user: { id: "1", email: "a@a.com", role: "user", planId: "free" }, profile };
const meAdmin = { ...meUser, user: { ...meUser.user, role: "admin" } };
const base = (me: unknown, extra: Handler): Handler => (url, init) => (url === "/api/me" ? { status: 200, body: me } : extra(url, init));

const info = (o: Record<string, unknown> = {}) => ({
  plan: { id: "free", name: "Free", limits: { links: 10, reports: 0 } },
  usage: { savedPrograms: 2, links: 10, campaigns: 0, aiRequestsMonthly: 1 },
  subscription: null,
  plans: [
    { id: "free", name: "Free", priceCents: null, currency: "USD", limits: { links: 10, reports: 0 } },
    { id: "pro", name: "Pro", priceCents: 4900, currency: "USD", limits: { reports: 1 } },
    { id: "business", name: "Business", priceCents: null, currency: "USD", limits: {} },
  ],
  payments: [], trialDays: 0, trialAvailable: false, paymentMode: "manual", ...o,
});

describe("plano e assinatura", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("mostra uso e limites, desabilita plano sem preço e assina o plano com preço", async () => {
    let subscribed: any = null;
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/billing") return { status: 200, body: info() };
      if (url === "/api/billing/subscribe") { subscribed = JSON.parse(String(init?.body)); return { status: 201, body: { ok: true, status: "incomplete" } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/billing");
    expect(await screen.findByRole("heading", { name: "Plano e assinatura" })).toBeInTheDocument();
    expect(screen.getByLabelText("Links")).toHaveAttribute("value", "10");
    const buttons = screen.getAllByRole("button", { name: "Assinar" });
    expect(buttons).toHaveLength(2); // free não tem botão
    const [pro, business] = buttons;
    expect(business).toBeDisabled(); // preço não definido
    expect(screen.getAllByText("Preço ainda não definido").length).toBeGreaterThan(0);
    await userEvent.click(pro!);
    await waitFor(() => expect(subscribed).toEqual({ planId: "pro" }));
    expect(await screen.findByText(/Pedido registrado/)).toBeInTheDocument();
    expect(screen.getByText(/confirmados manualmente/)).toBeInTheDocument();
  });

  it("assinatura em carência mostra aviso e permite cancelar", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/billing") return { status: 200, body: info({ plan: { id: "pro", name: "Pro", limits: {} }, subscription: { planId: "pro", status: "past_due", trialEndsAt: null, currentPeriodStart: 1, currentPeriodEnd: 2, cancelAtPeriodEnd: false, graceUntil: 1_900_000_000_000 } }) };
      return { status: 404, body: {} };
    }));
    renderApp("/billing");
    expect(await screen.findByRole("alert")).toHaveTextContent(/período venceu/);
    expect(screen.getByRole("button", { name: "Cancelar agora" })).toBeInTheDocument();
  });

  it("traduz o limite do plano nas mensagens de erro", async () => {
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/billing") return { status: 200, body: info() };
      if (url === "/api/billing/subscribe") return { status: 409, body: { error: "price_not_set" } };
      return { status: 404, body: {} };
    }));
    renderApp("/billing", "en-US");
    await userEvent.click((await screen.findAllByRole("button", { name: "Subscribe" }))[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("price has not been set");
  });
});

describe("relatórios", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const profit = {
    range: { from: 1, to: 2 },
    campaigns: [
      { id: "c1", name: "Ads Blog", channel: "blog", status: "active", currency: "BRL", spend: 100, clicksOwnTracking: 20, clicksReported: null, conversionsReported: null,
        commissions: { estimated: 0, pending: 50, approved: 150, paid: 0, rejected: 0 }, realized: 150, projected: 200, roiRealized: 0.5, roiProjected: 1, epcRealized: 7.5, confirmedConversions: 2, conversionRate: 0.1, otherCurrencies: ["USD"] },
      { id: "c2", name: "Sem custo", channel: "blog", status: "active", currency: "BRL", spend: null, clicksOwnTracking: 0, clicksReported: null, conversionsReported: null,
        commissions: { estimated: 40, pending: 0, approved: 0, paid: 0, rejected: 0 }, realized: 0, projected: 40, roiRealized: null, roiProjected: null, epcRealized: null, confirmedConversions: 0, conversionRate: null, otherCurrencies: [] },
    ],
    totalsByCurrency: [{ currency: "BRL", spend: 100, realized: 150, projected: 240, roiRealized: 0.5, roiProjected: 1.4 }], unattributedClicks: 0,
  };

  it("mostra ROI, traço quando não há base e bloqueia relatório completo fora do plano", async () => {
    mockFetch(base(meUser, (url) => {
      if (url.startsWith("/api/analytics/profitability")) return { status: 200, body: profit };
      if (url.startsWith("/api/analytics/report")) return { status: 402, body: { error: "plan_limit", key: "reports", limit: 0, used: 0, planId: "free" } };
      return { status: 404, body: {} };
    }));
    renderApp("/reports");
    expect(await screen.findByRole("heading", { name: "Relatórios e rentabilidade" })).toBeInTheDocument();
    const row = (await screen.findByText("Ads Blog")).closest("tr")!;
    expect(row).toHaveTextContent("50%"); // ROI realizado
    expect(row).toHaveTextContent("USD"); // aviso de outra moeda
    const none = screen.getByText("Sem custo").closest("tr")!;
    expect(none).toHaveTextContent("—");
    expect(await screen.findByText(/Relatórios completos não estão incluídos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver planos" })).toHaveAttribute("href", "/billing");
  });

  it("com o recurso no plano mostra séries, aging e links de CSV", async () => {
    mockFetch(base(meUser, (url) => {
      if (url.startsWith("/api/analytics/profitability")) return { status: 200, body: profit };
      if (url.startsWith("/api/analytics/report")) return { status: 200, body: { range: { from: 1, to: 2 }, groupBy: "month", clicksOwnTracking: [{ period: "2026-11", clicks: 20 }], commissions: [{ period: "2026-11", status: "approved", currency: "BRL", count: 1, amount: 150 }], byProgram: [{ program: "Prog A", status: "approved", currency: "BRL", count: 1, amount: 150 }], aging: [{ bucket: "31-60", status: "pending", currency: "BRL", count: 1, amount: 50 }] } };
      return { status: 404, body: {} };
    }));
    renderApp("/reports");
    expect(await screen.findByText("Prog A")).toBeInTheDocument();
    expect(screen.getByText("31-60")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Baixar CSV" });
    expect(links).toHaveLength(3);
    expect(links[0]!.getAttribute("href")).toContain("/api/analytics/report?format=csv&section=series");
  });
});

describe("admin: receita", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());
  it("registra pagamento com a moeda do plano e mostra a receita sem somar moedas", async () => {
    let posted: any = null;
    mockFetch(base(meAdmin, (url, init) => {
      if (url === "/api/admin/billing/overview") return { status: 200, body: { subscriptionsByStatus: { active: 2 }, mrrByCurrency: [{ currency: "USD", cents: 9800, subscriptions: 2 }, { currency: "BRL", cents: 5000, subscriptions: 1 }], paidLast30dByCurrency: [], paidByMonth: [], endedLast30d: 0, refundedLast30d: 0, settings: { trialDays: 0, graceDays: 7 } } };
      if (url === "/api/admin/billing/payments" && init?.method === "POST") { posted = JSON.parse(String(init.body)); return { status: 201, body: { ok: true, duplicate: false } }; }
      if (url === "/api/admin/billing/payments") return { status: 200, body: { items: [] } };
      if (url === "/api/admin/users") return { status: 200, body: { users: [{ id: "u9", email: "x@x.com", role: "user", planId: "free", createdAt: 1, lastLoginAt: null }], total: 1 } };
      if (url === "/api/admin/plans") return { status: 200, body: { plans: [{ id: "free", name: "Free", monthlyPriceCents: null, currency: "USD", limits: {}, active: true }, { id: "pro", name: "Pro", monthlyPriceCents: 4900, currency: "USD", limits: {}, active: true }] } };
      return { status: 404, body: {} };
    }));
    renderApp("/admin");
    await userEvent.click(await screen.findByRole("button", { name: "Receita" }));
    expect(await screen.findByText(/US\$\s?98,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s?50,00/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Usuário"), "u9");
    await userEvent.type(screen.getByLabelText(/Valor/), "49,00");
    await userEvent.click(screen.getByRole("button", { name: "Registrar pagamento" }));
    await waitFor(() => expect(posted).toEqual({ userId: "u9", planId: "pro", amountCents: 4900, currency: "USD" }));
    expect(await screen.findByText("Pagamento registrado.")).toBeInTheDocument();
  });
});
