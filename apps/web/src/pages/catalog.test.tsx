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

const profile = { displayName: "Ana", locale: "pt-BR", country: "BR", experience: "beginner", niches: [], channels: [], hasWebsite: false, monthlyBudgetUsd: null, wantsRecurring: false, acceptsPaidTraffic: false, onboarded: true };
const meAs = (role: string) => ({ user: { id: "1", email: "a@a.com", role, planId: "free" }, profile });
const meta = {
  segments: ["physical", "saas", "digital", "services"],
  networks: [{ id: "n1", name: "Awin", kind: "network", websiteUrl: null, websiteUrlStatus: "unverified", operationalStatus: "unverified", notes: null }],
  categories: [{ id: "c1", slug: "ai_tools", segment: "saas", namePt: "Ferramentas de IA", nameEn: "AI tools", nameEs: "Herramientas de IA" }],
  staleAfterDays: 90,
};
const program = (over = {}) => ({
  id: "p1", name: "Programa Teste", segment: "saas", description: null,
  advertiser: { id: "a1", name: "Acme" }, network: { id: "n1", name: "Awin" }, category: null,
  acceptsBrazil: "unverified", acceptsIndividuals: "unverified", requiresCompany: "unverified", requiresWebsite: "unverified",
  acceptsSocial: "unverified", acceptsPaidTraffic: "unverified", acceptsOrganic: "unverified",
  commissionType: "unknown", commissionPercent: null, commissionFixed: null, currency: null,
  isRecurring: "unverified", recurringDurationMonths: null, cookieDays: null, minPayout: null, payoutCurrency: null,
  payoutFrequency: "unknown", validationDays: null, officialUrl: null, signupUrl: null, signupUrlStatus: "unverified",
  docsUrl: null, lifecycleStatus: "active", verificationFlag: "none", lastVerifiedAt: null, verification: "never_verified", updatedAt: 1,
  ...over,
});

describe("catálogo", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  const base = (role: string, extra: Handler = () => ({ status: 404, body: {} })): Handler => (url, init) => {
    if (url === "/api/me") return { status: 200, body: meAs(role) };
    if (url === "/api/catalog/meta") return { status: 200, body: meta };
    return extra(url, init);
  };

  it("lista programas com selos de texto: dado não verificado nunca aparece como 'Sim'", async () => {
    mockFetch(base("user", (url) =>
      url.startsWith("/api/catalog/programs?") ? { status: 200, body: { items: [program()], total: 1 } } : { status: 404, body: {} }));
    renderApp("/programs");
    expect(await screen.findByRole("link", { name: "Programa Teste" })).toBeInTheDocument();
    const list = within(screen.getByRole("list"));
    expect(list.getAllByText("Não verificado").length).toBeGreaterThanOrEqual(3);
    expect(list.getByText("Nunca verificado")).toBeInTheDocument();
    expect(list.queryByText("Sim")).not.toBeInTheDocument();
  });

  it("filtro de aceita Brasil envia só o valor confirmado ao servidor", async () => {
    const fetchFn = mockFetch(base("user", (url) =>
      url.startsWith("/api/catalog/programs?") ? { status: 200, body: { items: [], total: 0 } } : { status: 404, body: {} }));
    renderApp("/programs");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Aceita Brasil (confirmado)"), "yes");
    await waitFor(() => expect(fetchFn.mock.calls.some(([u]) => String(u).includes("accepts_brazil=yes"))).toBe(true));
    expect(await screen.findByText(/Nenhum programa encontrado/)).toBeInTheDocument();
  });

  it("detalhe sem fontes avisa que nada está confirmado e não mostra edição a usuário comum", async () => {
    mockFetch(base("user", (url) =>
      url === "/api/catalog/programs/p1"
        ? { status: 200, body: { program: program(), sources: [], history: [{ id: 1, field: "created", oldValue: null, newValue: "Programa Teste", changedBy: null, note: null, changedAt: 1 }], products: [], offers: [] } }
        : { status: 404, body: {} }));
    renderApp("/programs/p1");
    expect(await screen.findByRole("heading", { name: "Programa Teste" })).toBeInTheDocument();
    expect(screen.getByText(/nada neste programa está confirmado/)).toBeInTheDocument();
    expect(screen.getByText("Programa criado")).toBeInTheDocument();
    expect(screen.queryByText("Edição (editores)")).not.toBeInTheDocument();
  });

  it("editor vê o painel e a recusa por falta de fonte oficial aparece traduzida", async () => {
    const fetchFn = mockFetch(base("editor", (url, init) => {
      if (url === "/api/catalog/programs/p1" && init?.method === "GET")
        return { status: 200, body: { program: program(), sources: [], history: [], products: [], offers: [] } };
      if (url === "/api/catalog/programs/p1" && init?.method === "PATCH")
        return { status: 422, body: { error: "official_source_required", fields: ["accepts_brazil"] } };
      return { status: 404, body: {} };
    }));
    renderApp("/programs/p1");
    const user = userEvent.setup();
    expect(await screen.findByText("Edição (editores)")).toBeInTheDocument();
    await user.selectOptions(document.getElementById("d-accepts_brazil") as HTMLSelectElement, "yes");
    await user.click(screen.getByRole("button", { name: "Salvar dados" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Falta fonte oficial que cubra: Aceita Brasil");
    const patch = fetchFn.mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ acceptsBrazil: "yes" });
  });

  it("gestão do catálogo é bloqueada para usuário comum e liberada para editor", async () => {
    mockFetch(base("user"));
    const { unmount } = renderApp("/catalog");
    expect(await screen.findByRole("alert")).toHaveTextContent("permissão");
    unmount();
    mockFetch(base("editor", (url) => (url.startsWith("/api/catalog/advertisers") ? { status: 200, body: { advertisers: [] } } : { status: 404, body: {} })));
    renderApp("/catalog");
    expect(await screen.findByRole("heading", { name: "Gestão do catálogo" })).toBeInTheDocument();
  });

  it("importação mostra relatório de simulação sem prometer gravação", async () => {
    mockFetch(base("editor", (url, init) => {
      if (url === "/api/catalog/import") return { status: 200, body: { created: 2, duplicates: [{ line: 4, reason: "already_exists" }], errors: [{ line: 5, error: "unknown_network" }], dryRun: true } };
      return url.startsWith("/api/catalog/advertisers") ? { status: 200, body: { advertisers: [] } } : { status: 404, body: {} };
    }));
    renderApp("/catalog");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Importar CSV" }));
    await user.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByText("Simulação: nada foi gravado.")).toBeInTheDocument();
    expect(screen.getByText(/2 a criar\/criados, 1 duplicados, 1 com erro/)).toBeInTheDocument();
  });
});
