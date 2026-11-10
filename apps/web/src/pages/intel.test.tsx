import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCORING } from "@ai/shared";
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
function renderApp(path: string, locale: "pt-BR" | "en-US" = "pt-BR") {
  return render(
    <I18nProvider initial={locale}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}
const profile = { displayName: "Ana", locale: "pt-BR", country: "BR", experience: null, niches: ["saas"], channels: [], hasWebsite: false, monthlyBudgetUsd: null, wantsRecurring: false, acceptsPaidTraffic: false, onboarded: true };
const me = (role = "user") => ({ user: { id: "1", email: "a@a.com", role, planId: "free" }, profile });
const program = (id: string, name: string, over = {}) => ({
  id, name, segment: "saas", description: null, advertiser: { id: "a", name: "Acme" }, network: null, category: null,
  acceptsBrazil: "unverified", acceptsIndividuals: "unverified", requiresCompany: "unverified", requiresWebsite: "unverified",
  acceptsSocial: "unverified", acceptsPaidTraffic: "unverified", acceptsOrganic: "unverified", allowsRedirect: "unverified", commissionType: "unknown",
  commissionPercent: null, commissionFixed: null, currency: null, isRecurring: "unverified", recurringDurationMonths: null,
  cookieDays: null, minPayout: null, payoutCurrency: null, payoutFrequency: "unknown", validationDays: null, officialUrl: null,
  signupUrl: null, signupUrlStatus: "unverified", docsUrl: null, lifecycleStatus: "active", verificationFlag: "none",
  lastVerifiedAt: null, verification: "never_verified", updatedAt: 1, ...over,
});
const score = (over: any = {}) => ({
  quality: { score: 42, confirmed: ["accepts_brazil"], missing: ["cookie_days", "verification"] },
  attractiveness: {
    score: 61, raw: 70, coverage: 0.6, band: "moderate", capped: false,
    items: [
      { criterion: "commission", status: "confirmed", value: 0.75, weight: 18, code: "commission_percent", params: { value: 30 } },
      { criterion: "ease", status: "interpretation", value: 0.8, weight: 8, code: "ease_derived" },
      { criterion: "cookie", status: "unverified", value: null, weight: 8, code: "unverified_field" },
      { criterion: "demand", status: "no_data", value: null, weight: 5, code: "no_data_source" },
    ],
  },
  availability: "confirmed", warnings: [], ...over,
});

describe("inteligência de oportunidades", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());
  const base = (extra: Handler): Handler => (url, init) => (url === "/api/me" ? { status: 200, body: me() } : extra(url, init));

  it("detalhe mostra as duas dimensões e separa confirmado, interpretação e não verificado", async () => {
    mockFetch(base((url) => {
      if (url === "/api/catalog/programs/p1") return { status: 200, body: { program: program("p1", "Prog Um"), sources: [], history: [], products: [], offers: [] } };
      if (url === "/api/intel/programs/p1/score") return { status: 200, body: { score: score(), profileMissing: false } };
      return { status: 404, body: {} };
    }));
    renderApp("/programs/p1");
    const card = within(await screen.findByLabelText("Inteligência de oportunidade"));
    expect(card.getByText("Atratividade comercial")).toBeInTheDocument();
    expect(card.getByText("Qualidade dos dados")).toBeInTheDocument();
    expect(card.getByText("Oportunidade moderada")).toBeInTheDocument();
    expect(card.getByText("30% de comissão, confirmado.")).toBeInTheDocument();
    expect(card.getByText("Dado ainda não verificado neste programa.")).toBeInTheDocument();
    expect(card.getByText(/não entra na nota/)).toBeInTheDocument();
    expect(card.getByText(/Não é garantia de lucro/)).toBeInTheDocument();
    expect(card.getByText(/Falta confirmar:/)).toHaveTextContent("Cookie (dias)");
  });

  it("recomendações: separa recomendados de 'para verificar' e avisa que estes não são disponíveis", async () => {
    mockFetch(base((url) =>
      url === "/api/intel/recommendations"
        ? { status: 200, body: {
            recommended: [{ program: program("p1", "Rec Confirmado"), score: score() }],
            toVerify: [{ program: program("p2", "Rec Duvidoso"), score: score({ availability: "unverified" }) }],
            excludedDenied: 2, evaluated: 5, profileMissing: false, country: "BR" } }
        : { status: 404, body: {} }));
    renderApp("/recommendations");
    expect(await screen.findByRole("link", { name: "Rec Confirmado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rec Duvidoso" })).toBeInTheDocument();
    expect(screen.getByText(/Não os trate como disponíveis/)).toBeInTheDocument();
    expect(screen.getByText(/2 programas ficaram de fora/)).toBeInTheDocument();
    expect(screen.getAllByText("Disponível para o seu país (confirmado)")).toHaveLength(1);
  });

  it("comparação mostra lado a lado e exige 2 a 4 programas", async () => {
    mockFetch(base((url) =>
      url.startsWith("/api/intel/compare")
        ? { status: 200, body: { items: [{ program: program("a", "Prog A"), score: score() }, { program: program("b", "Prog B"), score: score({ availability: "denied" }) }], profileMissing: false } }
        : { status: 404, body: {} }));
    const { unmount } = renderApp("/compare?ids=a,b");
    const table = within(await screen.findByRole("table"));
    expect(table.getByRole("link", { name: "Prog A" })).toBeInTheDocument();
    expect(table.getByRole("link", { name: "Prog B" })).toBeInTheDocument();
    expect(table.getByText("Não aceita o seu país (confirmado)")).toBeInTheDocument();
    unmount();
    renderApp("/compare?ids=a");
    expect(await screen.findByText(/Escolha de 2 a 4 programas/)).toBeInTheDocument();
  });

  it("simulador por cliques calcula e rotula como simulação", async () => {
    mockFetch(base(() => ({ status: 404, body: {} })));
    renderApp("/simulator");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Comissão (%)"), "20");
    expect(screen.getByText(/Não é previsão nem promessa de ganho/)).toBeInTheDocument();
    // 1000 cliques x 2% = 20 vendas x R$ 20 = 400 por mês
    expect(await screen.findByText("Comissão mensal estimada")).toBeInTheDocument();
    const dl = screen.getByText("Comissão mensal estimada").closest("div")!;
    expect(dl).toHaveTextContent("400");
  });

  it("simulador recorrente exige duração ou confirmação de recorrência vitalícia", async () => {
    mockFetch(base(() => ({ status: 404, body: {} })));
    renderApp("/simulator");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "SaaS recorrente" }));
    await user.type(screen.getByLabelText("Comissão (%)"), "20");
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe a duração da recorrência");
    await user.click(screen.getByLabelText(/pagam enquanto o cliente continuar assinando/));
    expect(await screen.findByText(/recorrência vitalícia porque você confirmou/)).toBeInTheDocument();
    expect(screen.queryByText(/Informe a duração da recorrência/)).not.toBeInTheDocument();
  });

  it("simulador avisa sobre tráfego pago sem permissão confirmada", async () => {
    mockFetch(base((url) =>
      url === "/api/catalog/programs/p1" ? { status: 200, body: { program: program("p1", "Prog Um", { commissionType: "percent", commissionPercent: 25 }), sources: [], history: [], products: [], offers: [] } } : { status: 404, body: {} }));
    renderApp("/simulator?program=p1");
    const user = userEvent.setup();
    await screen.findByText(/Valores preenchidos com dados confirmados do catálogo/);
    expect(screen.getByLabelText("Comissão (%)")).toHaveValue(25);
    const traffic = screen.getByLabelText("Custo de tráfego por mês");
    await user.clear(traffic);
    await user.type(traffic, "100");
    expect(await screen.findByRole("alert")).toHaveTextContent("Não execute anúncios antes de confirmar as regras");
  });

  it("alertas mostram fonte e data de verificação, ou avisam que não há fonte", async () => {
    mockFetch(base((url) => {
      if (url.startsWith("/api/intel/alerts?")) return { status: 200, body: { unread: 1, alerts: [
        { id: "h1", category: "commission_changes", programId: "p1", programName: "Prog Um", advertiser: "Acme", field: "commission_percent", oldValue: "30", newValue: "35", at: 1_700_000_000_000, lastVerifiedAt: 1_700_000_000_000, sourceUrl: "https://docs.example.com/c", unread: true },
        { id: "h2", category: "new_programs", programId: "p2", programName: "Prog Dois", advertiser: "Beta", field: "created", oldValue: null, newValue: "Prog Dois", at: 1_700_000_000_000, lastVerifiedAt: null, sourceUrl: null, unread: false },
      ] } };
      if (url === "/api/intel/alerts/prefs") return { status: 200, body: { prefs: { categories: ["commission_changes", "new_programs"], frequency: "daily" } } };
      return { status: 404, body: {} };
    }));
    renderApp("/alerts");
    expect(await screen.findByText("Comissão (%): 30 → 35")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://docs.example.com/c" })).toBeInTheDocument();
    expect(screen.getByText(/sem fonte oficial registrada/)).toBeInTheDocument();
    expect(screen.getByText("1 novos")).toBeInTheDocument();
    expect(screen.getByText(/o envio por e-mail ainda não existe/)).toBeInTheDocument();
  });

  it("aba de pontuação é do admin e salva a configuração completa", async () => {
    const fetchFn = mockFetch((url, init) => {
      if (url === "/api/me") return { status: 200, body: me("admin") };
      if (url === "/api/intel/config") return { status: 200, body: { config: DEFAULT_SCORING } };
      if (url === "/api/intel/admin/scoring" && init?.method === "PUT") return { status: 200, body: { ok: true } };
      if (url.startsWith("/api/admin/")) return { status: 200, body: { users: [], total: 0, plans: [], entries: [] } };
      return { status: 404, body: {} };
    });
    renderApp("/admin");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Pontuação" }));
    const exc = await screen.findByLabelText("Excelente oportunidade");
    await user.clear(exc);
    await user.type(exc, "90");
    await user.click(screen.getByRole("button", { name: "Salvar configuração" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Configuração salva");
    const put = fetchFn.mock.calls.find(([u, i]) => u === "/api/intel/admin/scoring" && i?.method === "PUT")!;
    expect(JSON.parse(put[1]!.body as string).bands.excellent).toBe(90);
  });

  it("faixas inválidas são barradas antes de enviar", async () => {
    const fetchFn = mockFetch((url) => {
      if (url === "/api/me") return { status: 200, body: me("admin") };
      if (url === "/api/intel/config") return { status: 200, body: { config: DEFAULT_SCORING } };
      if (url.startsWith("/api/admin/")) return { status: 200, body: { users: [], total: 0, plans: [], entries: [] } };
      return { status: 404, body: {} };
    });
    renderApp("/admin");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Pontuação" }));
    const low = await screen.findByLabelText("Baixa prioridade");
    await user.clear(low);
    await user.type(low, "80");
    await user.click(screen.getByRole("button", { name: "Salvar configuração" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Valores inválidos");
    expect(fetchFn.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);
  });
});
