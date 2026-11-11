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

describe("assistente de IA", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a resposta com selo, programas e fonte oficial consultados", async () => {
    const posted: any[] = [];
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/ai/status") return { status: 200, body: status };
      if (url === "/api/ai/chat") {
        posted.push(JSON.parse(String(init?.body)));
        return { status: 200, body: { mode: "llm", reason: null, grounding: { ok: true, ungroundedNumbers: [], ungroundedUrls: [] }, answer: "A Zeta paga 30%.",
          citations: [{ programId: "p1", name: "Zeta Hosting", sourceUrls: ["https://docs.example.com/c"] }, { programId: "p2", name: "Sem Fonte", sourceUrls: [] }] } };
      }
      return { status: 404, body: {} };
    }));
    renderApp("/assistant");
    expect(await screen.findByText("Uso hoje: 2 de 20 perguntas")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Assistente de IA", { selector: "input" }), "Qual a comissão da Zeta?");
    await userEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    expect(await screen.findByText("A Zeta paga 30%.")).toBeInTheDocument();
    expect(screen.getByText("Resposta da IA, conferida com as fontes do sistema")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zeta Hosting" })).toHaveAttribute("href", "/programs/p1");
    expect(screen.getByRole("link", { name: "https://docs.example.com/c" })).toHaveAttribute("rel", expect.stringContaining("nofollow"));
    expect(screen.getByText("Sem fonte oficial registrada")).toBeInTheDocument();
    expect(posted[0]).toMatchObject({ message: "Qual a comissão da Zeta?", locale: "pt-BR" });
  });

  it("resposta descartada por falta de ancoragem não exibe o texto do modelo", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/ai/status") return { status: 200, body: status };
      if (url === "/api/ai/chat") return { status: 200, body: { mode: "facts_only", reason: "grounding_failed", answer: null, grounding: { ok: false, ungroundedNumbers: ["55%"], ungroundedUrls: [] }, citations: [{ programId: "p1", name: "Zeta Hosting", sourceUrls: [] }] } };
      return { status: 404, body: {} };
    }));
    renderApp("/assistant");
    await userEvent.type(await screen.findByLabelText("Assistente de IA", { selector: "input" }), "Qual a comissão?");
    await userEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    expect(await screen.findByText(/foi descartada porque continha números ou links que não estão nas fontes do sistema/)).toBeInTheDocument();
    expect(screen.getByText("Somente dados do sistema")).toBeInTheDocument();
    expect(screen.queryByText(/55%/)).not.toBeInTheDocument();
  });

  it("limite diário e ausência de dados são explicados sem inventar nada", async () => {
    let n = 0;
    mockFetch(base(meUser, (url) => {
      if (url === "/api/ai/status") return { status: 200, body: status };
      if (url === "/api/ai/chat") return { status: 200, body: { mode: "facts_only", reason: n++ === 0 ? "daily_requests" : "no_context", answer: null, grounding: null, citations: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/assistant");
    const input = await screen.findByLabelText("Assistente de IA", { selector: "input" });
    await userEvent.type(input, "primeira pergunta");
    await userEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    expect(await screen.findByText(/atingiu o limite diário de perguntas/)).toBeInTheDocument();
    await userEvent.type(input, "segunda pergunta");
    await userEvent.click(screen.getByRole("button", { name: "Perguntar" }));
    expect(await screen.findByText(/Não encontrei programas no catálogo para essa pergunta/)).toBeInTheDocument();
  });

  it("pesquisa: mostra como a pergunta foi entendida e só os resultados confirmados", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/ai/status") return { status: 200, body: status };
      if (url.startsWith("/api/ai/search")) return { status: 200, body: { interpreted: { segment: "saas", isRecurring: "yes", text: "hospedagem" }, onlyConfirmed: true, items: [{ id: "p1", name: "Zeta Hosting", advertiser: { name: "Zeta Inc" }, segment: "saas" }] } };
      return { status: 404, body: {} };
    }));
    renderApp("/assistant");
    await userEvent.type(await screen.findByLabelText("Pesquisa em linguagem natural", { selector: "input" }), "saas recorrente hospedagem");
    await userEvent.click(screen.getByRole("button", { name: "Pesquisar" }));
    expect(await screen.findByText("Segmento: SaaS e IA")).toBeInTheDocument();
    expect(screen.getByText("Recorrente (confirmado)")).toBeInTheDocument();
    expect(screen.getByText("Texto: hospedagem")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zeta Hosting" })).toBeInTheDocument();
  });
});

describe("análise no programa e administração", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const program = { id: "p1", name: "Zeta Hosting", segment: "saas", description: null, advertiser: { id: "a", name: "Zeta Inc" }, network: null, category: null,
    acceptsBrazil: "yes", acceptsIndividuals: "unverified", requiresCompany: "unverified", requiresWebsite: "unverified", acceptsSocial: "unverified",
    acceptsPaidTraffic: "unverified", acceptsOrganic: "unverified", allowsRedirect: "unverified", commissionType: "percent", commissionPercent: 30, commissionFixed: null,
    currency: "USD", isRecurring: "yes", recurringDurationMonths: null, cookieDays: null, minPayout: null, payoutCurrency: null, payoutFrequency: "unknown",
    validationDays: null, officialUrl: null, signupUrl: null, signupUrlStatus: "unverified", docsUrl: null, lifecycleStatus: "active", verificationFlag: "none",
    lastVerifiedAt: null, verification: "never_verified", updatedAt: 1 };
  const detail = (url: string) =>
    url === "/api/catalog/programs/p1" ? { status: 200, body: { program, sources: [], history: [], products: [], offers: [] } }
    : url === "/api/intel/programs/p1/score" ? { status: 200, body: { score: { quality: { score: 10, confirmed: [], missing: [] }, attractiveness: { score: 20, raw: 20, coverage: 0.2, band: "low", capped: false, items: [] }, availability: "unverified", warnings: [] }, profileMissing: false } }
    : url === "/api/ops/programs" ? { status: 200, body: { items: [] } } : null;

  it("separa o que o sistema confirmou do texto sugerido pela IA", async () => {
    mockFetch(base(meUser, (url) => {
      const d = detail(url);
      if (d) return d;
      if (url === "/api/ai/programs/p1/analysis") return { status: 200, body: {
        score: { attractiveness: { score: 20, band: "low" }, quality: { score: 10 } }, confirmedFields: ["commission_percent", "accepts_brazil"], missingFields: ["min_payout"],
        verification: "never_verified", lifecycleStatus: "active", note: "ai_never_changes_catalog", citations: [],
        narrative: { mode: "llm", reason: null, grounding: { ok: true, ungroundedNumbers: [], ungroundedUrls: [] }, answer: "Comissão de 30%; falta confirmar o mínimo." } } };
      return { status: 404, body: {} };
    }));
    renderApp("/programs/p1");
    const panel = within(await screen.findByLabelText("Análise e estratégia com IA"));
    await userEvent.click(panel.getByRole("button", { name: "Analisar programa" }));
    expect(await panel.findByText(/Confirmado por fonte oficial:/)).toBeInTheDocument();
    expect(panel.getByText(/Ainda sem dado confirmado:/)).toBeInTheDocument();
    expect(panel.getByText("Sugestão da IA (revise antes de agir)")).toBeInTheDocument();
    expect(panel.getByText("Comissão de 30%; falta confirmar o mínimo.")).toBeInTheDocument();
    expect(panel.getByText(/não alteram o catálogo/)).toBeInTheDocument();
  });

  it("estratégia: mostra compatibilidade calculada pelo sistema e pede perfil quando falta", async () => {
    let first = true;
    mockFetch(base(meUser, (url) => {
      const d = detail(url);
      if (d) return d;
      if (url === "/api/ai/programs/p1/strategy") {
        if (first) { first = false; return { status: 409, body: { error: "profile_required" } }; }
        return { status: 200, body: { suggestionOnly: true, citations: [], fit: [{ id: "brazil", status: "ok", field: "accepts_brazil" }, { id: "website", status: "blocked", field: "requires_website" }, { id: "individuals", status: "unknown", field: "accepts_individuals" }],
          narrative: { mode: "facts_only", reason: "no_model", grounding: null, answer: null } } };
      }
      return { status: 404, body: {} };
    }));
    renderApp("/programs/p1");
    const panel = within(await screen.findByLabelText("Análise e estratégia com IA"));
    await userEvent.click(panel.getByRole("button", { name: "Sugerir estratégia" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("Preencha seu perfil (país) primeiro");
    await userEvent.click(panel.getByRole("button", { name: "Sugerir estratégia" }));
    expect(await panel.findByText("Aceita afiliados do Brasil:")).toBeInTheDocument();
    expect(panel.getByText(/Exige site:/).closest("li")!.textContent).toContain("Bloqueio");
    expect(panel.getByText(/Aceita pessoa física:/).closest("li")!.textContent).toContain("Sem dado confirmado");
    expect(panel.getByText("O modelo de IA não está disponível neste ambiente.")).toBeInTheDocument();
  });

  it("administração: avisa quando não há modelo, salva a configuração e mostra só totais", async () => {
    const saved: any[] = [];
    const config = { enabled: true, model: "@cf/meta/llama-3.1-8b-instruct", dailyRequestsPerUser: 20, dailyTokensPerUser: 40000, monthlyRequestsGlobal: 3000, maxQuestionChars: 600, maxContextPrograms: 5, maxOutputTokens: 600, cacheTtlHours: 24 };
    mockFetch(base(meAdmin, (url, init) => {
      if (url === "/api/ai/admin/config" && init?.method === "PUT") { saved.push(JSON.parse(String(init.body))); return { status: 200, body: { ok: true } }; }
      if (url === "/api/ai/admin/config") return { status: 200, body: { config, modelAvailable: false } };
      if (url === "/api/ai/admin/usage") return { status: 200, body: { totals: { requests: 12, llm: 8, cached: 4, inTok: 1000, outTok: 500, discarded: 1, users: 3 }, byDay: [] } };
      if (url.startsWith("/api/admin")) return { status: 200, body: { items: [], users: [], plans: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/admin");
    await userEvent.click(await screen.findByRole("button", { name: "IA" }));
    expect(await screen.findByText(/binding de IA não está configurado/)).toBeInTheDocument();
    expect(await screen.findByText("1500")).toBeInTheDocument(); // tokens estimados = 1000 + 500
    const field = screen.getByLabelText("Perguntas por usuário por dia");
    await userEvent.clear(field);
    await userEvent.type(field, "5");
    await userEvent.click(screen.getByLabelText(/IA ligada/));
    await userEvent.click(screen.getByRole("button", { name: "Salvar configuração" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ dailyRequestsPerUser: 5, enabled: false });
    expect(await screen.findByText("Configuração salva.")).toBeInTheDocument();
  });
});
