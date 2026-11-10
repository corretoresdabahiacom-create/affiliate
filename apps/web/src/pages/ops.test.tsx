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
const profile = {
  displayName: "Ana", locale: "pt-BR", country: "BR", experience: null, niches: ["saas"], channels: [], hasWebsite: false,
  monthlyBudgetUsd: null, wantsRecurring: false, acceptsPaidTraffic: false, languages: [], audienceSize: null, weeklyHours: null,
  prefersPhysical: false, prefersSaas: false, onboarded: true,
};
const me = { user: { id: "1", email: "a@a.com", role: "user", planId: "free" }, profile };
const up = (over = {}) => ({
  id: "u1", programId: "p1", programName: "Prog Um", advertiser: "Acme", network: null, status: "saved", appliedAt: null, approvedAt: null,
  affiliateId: null, acceptedTerms: null, notes: null, nextAction: null, nextActionAt: null, catalogStatus: "active", needsReview: false,
  signupUrl: "https://acme.example.com/join", signupUrlStatus: "unverified", officialUrl: null, ...over,
});
const base = (extra: Handler): Handler => (url, init) => (url === "/api/me" ? { status: 200, body: me } : extra(url, init));

describe("gestão do afiliado", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("Meus programas: troca o status, avisa programa encerrado e traduz o erro", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch(base((url, init) => {
      calls.push({ url, init });
      if (url === "/api/ops/programs" && (!init || init.method === "GET")) return { status: 200, body: { items: [up({ needsReview: true, catalogStatus: "closed", status: "approved" })] } };
      if (url === "/api/ops/programs/u1" && init?.method === "PATCH") return { status: 409, body: { error: "program_not_active" } };
      return { status: 404, body: {} };
    }));
    renderApp("/my-programs");
    expect(await screen.findByText("Prog Um")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("não está ativo no catálogo");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "active");
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(await screen.findByText(/não está ativo no catálogo: não dá para marcá-lo/)).toBeInTheDocument();
  });

  it("Meus programas: mostra o link oficial como não verificado e que o usuário se inscreve sozinho", async () => {
    mockFetch(base((url) => {
      if (url === "/api/ops/programs") return { status: 200, body: { items: [up()] } };
      if (url === "/api/ops/programs/u1") return { status: 200, body: { item: up(), history: [{ from: null, to: "saved", note: null, at: 1 }], docs: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/my-programs");
    await userEvent.click(await screen.findByRole("button", { name: "Gerenciar" }));
    expect(await screen.findByText(/Link ainda não verificado/)).toBeInTheDocument();
    expect(screen.getByText(/não cria contas nem aceita contratos por você/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://acme.example.com/join" })).toHaveAttribute("rel", expect.stringContaining("nofollow"));
  });

  it("Links: rastreamento próprio recusado vira mensagem clara; QR é gerado no navegador", async () => {
    const link = { id: "l1", code: "abc", label: "Meu link", url: "https://acme.example.com/x?aff=1", programId: "p1", programName: "Prog Um", productId: null, productName: null, campaignId: null, channel: "blog", campaignTag: null, trackingMode: "none", active: true, redirectAllowed: false, trackUrl: null, clicks: 0, clicks30d: 0 };
    mockFetch(base((url, init) => {
      if (url === "/api/ops/links" && init?.method === "POST") return { status: 409, body: { error: "redirect_not_allowed" } };
      if (url === "/api/ops/links") return { status: 200, body: { items: [link] } };
      if (url === "/api/ops/programs") return { status: 200, body: { items: [up()] } };
      if (url === "/api/ops/campaigns") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/links");
    expect(await screen.findByText("Meu link")).toBeInTheDocument();
    expect(screen.getByText(/Sem rastreamento próprio: cliques não são contados aqui/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mostrar QR code" }));
    expect(screen.getByAltText("QR code do link Meu link")).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));

    await userEvent.type(screen.getByLabelText("Nome do link"), "Novo");
    await userEvent.type(screen.getByLabelText("URL do link de afiliado"), "https://acme.example.com/y");
    await userEvent.selectOptions(screen.getByLabelText("Rastreamento"), "own_redirect");
    await userEvent.click(screen.getByRole("button", { name: "Registrar link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não confirmou que permite redirecionamento");
  });

  it("Links: mostra o link rastreável e os cliques próprios, avisando que clique não é venda", async () => {
    const link = { id: "l1", code: "abc", label: "Rastreado", url: "https://acme.example.com/x", programId: "p1", programName: "Prog Um", productId: null, productName: null, campaignId: null, channel: "blog", campaignTag: "bf", trackingMode: "own_redirect", active: true, redirectAllowed: true, trackUrl: "https://app.example.com/r/abc", clicks: 7, clicks30d: 3 };
    mockFetch(base((url) => {
      if (url === "/api/ops/links") return { status: 200, body: { items: [link] } };
      if (url === "/api/ops/programs") return { status: 200, body: { items: [] } };
      if (url === "/api/ops/campaigns") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/links");
    expect(await screen.findByText("Cliques próprios: 7 (30 dias: 3)")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/app\.example\.com\/r\/abc/)).toBeInTheDocument();
    expect(screen.getByText(/Clique não é venda/)).toBeInTheDocument();
  });

  it("Campanhas: tráfego pago bloqueado mostra o motivo", async () => {
    mockFetch(base((url, init) => {
      if (url === "/api/ops/campaigns" && init?.method === "POST") return { status: 409, body: { error: "paid_traffic_not_confirmed" } };
      if (url === "/api/ops/campaigns") return { status: 200, body: { items: [] } };
      if (url === "/api/ops/programs") return { status: 200, body: { items: [up()] } };
      return { status: 404, body: {} };
    }));
    renderApp("/campaigns");
    await userEvent.type(await screen.findByLabelText("Nome da campanha"), "Camp");
    await userEvent.selectOptions(screen.getByLabelText("Canal"), "google_ads");
    await userEvent.click(screen.getByRole("button", { name: "Criar campanha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não confirmou que aceita tráfego pago");
  });
});

describe("comissões e painel", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());
  const commission = (over = {}) => ({
    id: "c1", programId: "p1", programName: "Prog Um", linkId: null, campaignId: null, productName: null, channel: null, amount: 100, adjustments: 0,
    netAmount: 100, currency: "USD", status: "estimated", conversionState: "reported", occurredAt: 1_700_000_000_000, approvedAt: null, paidAt: null,
    origin: "manual", externalRef: null, notes: null, ...over,
  });

  it("só oferece as próximas etapas do ciclo (estimada não pula para paga) e identifica origem e confirmação", async () => {
    mockFetch(base((url) => {
      if (url.startsWith("/api/ops/commissions")) return { status: 200, body: { items: [commission()] } };
      if (url === "/api/ops/programs") return { status: 200, body: { items: [up()] } };
      return { status: 404, body: {} };
    }));
    renderApp("/commissions");
    const item = within((await screen.findByText("US$ 100,00")).closest("li")!);
    expect(item.getByText("Estimada")).toBeInTheDocument();
    expect(item.getByText("Manual")).toBeInTheDocument();
    expect(item.getByText("Informada por você")).toBeInTheDocument();
    expect(item.getByRole("button", { name: "Pendente" })).toBeInTheDocument();
    expect(item.getByRole("button", { name: "Aprovada" })).toBeInTheDocument();
    expect(item.queryByRole("button", { name: "Paga" })).not.toBeInTheDocument();
    expect(screen.getByText(/Estimada ≠ aprovada ≠ paga/)).toBeInTheDocument();
  });

  it("importação: simula, mostra o relatório e os erros por linha", async () => {
    const calls: any[] = [];
    mockFetch(base((url, init) => {
      if (url === "/api/ops/commissions/import") {
        calls.push(JSON.parse(String(init?.body)));
        return { status: 200, body: { created: 2, updated: 0, unchanged: 0, errors: [{ line: 4, error: "invalid_amount" }], dryRun: true } };
      }
      if (url.startsWith("/api/ops/commissions")) return { status: 200, body: { items: [] } };
      if (url === "/api/ops/programs") return { status: 200, body: { items: [up()] } };
      return { status: 404, body: {} };
    }));
    renderApp("/commissions");
    await userEvent.selectOptions(await screen.findByLabelText("Programa", { selector: "#imp-prog" }), "p1");
    await userEvent.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByText(/2 novas, 0 atualizadas, 0 sem mudança/)).toBeInTheDocument();
    expect(screen.getByText(/Simulação: nada foi gravado/)).toBeInTheDocument();
    expect(screen.getByText("Linha 4: valor inválido")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ programId: "p1", dryRun: true });
  });

  it("painel: separa moedas, status e origens, e não chama conversão informada de confirmada", async () => {
    mockFetch(base((url) => {
      if (url === "/api/ops/dashboard") {
        return { status: 200, body: {
          programs: { discoveredInCatalog: 12, saved: 3, interested: 1, pendingApplications: 2, approved: 1, active: 0, rejected: 0, byStatus: {} },
          productsPromoted: 2, linksRegistered: 4,
          clicks: { ownTracking: 9, manualReported: 300, ownTrackingByChannel: [{ channel: "blog", clicks: 9 }] },
          conversions: { confirmedByNetwork: 1, reportedByUser: 3, manualReportedInCampaigns: 9 },
          commissionsByCurrency: { USD: { estimated: 100, pending: 0, approved: 50, paid: 0, rejected: 0 }, BRL: { estimated: 0, pending: 0, approved: 0, paid: 40, rejected: 0 } },
          commissionsByOrigin: { manual: 2, csv: 1 },
          byProduct: [], byCategory: [], byChannel: [{ name: "blog", currency: "USD", estimated: 100, pending: 0, approved: 50, paid: 0 }],
          nextActions: [{ id: "u1", programId: "p1", programName: "Prog Um", nextAction: "Enviar documentos", at: 1_700_000_000_000 }],
        } };
      }
      return { status: 404, body: {} };
    }));
    renderApp("/");
    const dash = within(await screen.findByLabelText("Minha operação"));
    expect(await dash.findByText("Conversões confirmadas pela rede")).toBeInTheDocument();
    expect(dash.getByText("Conversões informadas por você")).toBeInTheDocument();
    expect(dash.getByText("Cliques (rastreamento próprio)")).toBeInTheDocument();
    expect(dash.getByText("Cliques informados em campanhas (manual)")).toBeInTheDocument();
    expect(dash.getAllByText("US$ 100,00").length).toBeGreaterThan(0);
    expect(dash.getAllByText("R$ 40,00").length).toBeGreaterThan(0);
    expect(dash.getByText(/Manual \(2\)/)).toBeInTheDocument();
    expect(dash.getByText(/Enviar documentos/)).toBeInTheDocument();
  });

  it("ProgramDetail: salvar e acompanhar cria o registro em Meus programas", async () => {
    const posted: any[] = [];
    const program = { id: "p1", name: "Prog Um", segment: "saas", description: null, advertiser: { id: "a", name: "Acme" }, network: null, category: null,
      acceptsBrazil: "unverified", acceptsIndividuals: "unverified", requiresCompany: "unverified", requiresWebsite: "unverified", acceptsSocial: "unverified",
      acceptsPaidTraffic: "unverified", acceptsOrganic: "unverified", allowsRedirect: "unverified", commissionType: "unknown", commissionPercent: null, commissionFixed: null,
      currency: null, isRecurring: "unverified", recurringDurationMonths: null, cookieDays: null, minPayout: null, payoutCurrency: null, payoutFrequency: "unknown",
      validationDays: null, officialUrl: null, signupUrl: null, signupUrlStatus: "unverified", docsUrl: null, lifecycleStatus: "active", verificationFlag: "none",
      lastVerifiedAt: null, verification: "never_verified", updatedAt: 1 };
    mockFetch(base((url, init) => {
      if (url === "/api/catalog/programs/p1") return { status: 200, body: { program, sources: [], history: [], products: [], offers: [] } };
      if (url === "/api/intel/programs/p1/score") return { status: 200, body: { score: { quality: { score: 0, confirmed: [], missing: [] }, attractiveness: { score: 0, raw: 0, coverage: 0, band: "low", capped: false, items: [] }, availability: "unverified", warnings: [] }, profileMissing: false } };
      if (url === "/api/ops/programs" && init?.method === "POST") { posted.push(JSON.parse(String(init.body))); return { status: 201, body: { ok: true, id: "u1" } }; }
      if (url === "/api/ops/programs") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/programs/p1");
    await userEvent.click(await screen.findByRole("button", { name: "Salvar e acompanhar" }));
    expect(await screen.findByRole("link", { name: "Em Meus programas" })).toBeInTheDocument();
    expect(posted[0]).toEqual({ programId: "p1", status: "saved" });
  });
});
