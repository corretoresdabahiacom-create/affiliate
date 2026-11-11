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

const entry = { id: "e1", month: 11, niche: "Eletrônicos", note: "Procura sobe antes da Black Friday.", metricLabel: "Buscas", metricValue: "+40%", sourceUrl: "https://trends.example.com/e", status: "published", programs: [{ id: "p1", name: "Mail Pro", lifecycleStatus: "active" }], updatedAt: 1 };
const noMetric = { ...entry, id: "e2", niche: "Presentes", metricLabel: null, metricValue: null, sourceUrl: null, programs: [] };
const draft = (o: Record<string, unknown> = {}) => ({
  id: "d1", programId: "p1", programName: "Mail Pro", channel: "blog", locale: "pt-BR", title: "Conheça Mail Pro", description: "Ferramenta de e-mail.", disclosure: "Divulgação: link de afiliado.",
  userLink: null, officialUrl: null, channelField: "accepts_organic", channelCheck: "ok", textSource: "catalog", status: "draft", issues: [], createdAt: 1, updatedAt: 1, ...o,
});

describe("calendário sazonal", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a fonte da métrica e marca observação sem métrica", async () => {
    mockFetch(base(meUser, (url) => (url.startsWith("/api/studio/seasonal?") ? { status: 200, body: { items: [entry, noMetric] } } : { status: 404, body: {} })));
    renderApp("/seasonal");
    expect(await screen.findByText("+40%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://trends.example.com/e" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mail Pro" })).toBeInTheDocument();
    expect(screen.getByText(/sem métrica/i)).toBeInTheDocument();
    expect(screen.queryByText(/gerenciar entradas/i)).not.toBeInTheDocument();
  });

  it("mês vazio explica que o sistema não preenche dados", async () => {
    mockFetch(base(meUser, (url) => (url.startsWith("/api/studio/seasonal?") ? { status: 200, body: { items: [] } } : { status: 404, body: {} })));
    renderApp("/seasonal");
    expect(await screen.findByText(/não preenche dados/i)).toBeInTheDocument();
  });

  it("editor não consegue salvar métrica sem fonte (nem chama a API)", async () => {
    const editor = { ...meUser, user: { ...meUser.user, role: "editor" } };
    const fn = mockFetch(base(editor, (url) => {
      if (url.startsWith("/api/studio/seasonal?")) return { status: 200, body: { items: [] } };
      if (url === "/api/studio/seasonal/manage") return { status: 200, body: { items: [] } };
      if (url.startsWith("/api/catalog/programs")) return { status: 200, body: { items: [], total: 0 } };
      return { status: 404, body: {} };
    }));
    renderApp("/seasonal");
    await screen.findByText(/gerenciar entradas/i);
    await userEvent.type(screen.getByLabelText("Nicho"), "Moda");
    await userEvent.type(screen.getByLabelText("Métrica (rótulo)"), "Buscas");
    await userEvent.type(screen.getByLabelText("Métrica (valor)"), "+10%");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/precisa de rótulo, valor e link da fonte/i);
    expect(fn.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });
});

describe("estúdio de divulgação", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("mostra aviso do canal, exige ciência e não oferece copiar antes de aprovar", async () => {
    let status = "draft";
    const fn = mockFetch(base(meUser, (url, init) => {
      if (url.startsWith("/api/catalog/programs")) return { status: 200, body: { items: [], total: 0 } };
      if (url === "/api/studio/ads") return { status: 200, body: { items: [draft({ channelCheck: "unverified", status })] } };
      if (url === "/api/studio/ads/d1/status") {
        const b = JSON.parse(String(init?.body));
        if (!b.acknowledgeUnverified) return { status: 422, body: { error: "needs_acknowledgement" } };
        status = "approved";
        return { status: 200, body: { item: draft({ status }) } };
      }
      return { status: 404, body: {} };
    }));
    renderApp("/studio");
    expect(await screen.findByText(/canal não verificado/i)).toBeInTheDocument();
    expect(screen.getByText(/Divulgação: link de afiliado\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar texto" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/confirme que você vai verificar/i);
    await userEvent.click(screen.getByLabelText(/vou verificar antes de publicar/i));
    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(await screen.findByRole("button", { name: "Copiar texto" })).toBeInTheDocument();
    expect(fn.mock.calls.filter(([u]) => String(u).includes("/status"))).toHaveLength(2);
  });

  it("canal bloqueado e promessa de ganho aparecem como alerta", async () => {
    mockFetch(base(meUser, (url) => {
      if (url.startsWith("/api/catalog/programs")) return { status: 200, body: { items: [], total: 0 } };
      if (url === "/api/studio/ads") return { status: 200, body: { items: [draft({ channelCheck: "blocked", issues: ["forbidden_claim"] })] } };
      return { status: 404, body: {} };
    }));
    renderApp("/studio");
    expect(await screen.findByText(/não aceita este canal/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/promessa de ganho/i);
  });

  it("gera rascunhos para os programas escolhidos e mostra o aviso de ignorados", async () => {
    const prog = { id: "p1", name: "Mail Pro", segment: "saas", description: null, advertiser: { id: "a", name: "Acme" }, network: null };
    const fn = mockFetch(base(meUser, (url, init) => {
      if (url.startsWith("/api/catalog/programs")) return { status: 200, body: { items: [prog], total: 1 } };
      if (url === "/api/studio/ads/generate") return { status: 201, body: { items: [draft()], skipped: [{ programId: "x", reason: "not_active" }], ai: [], publishedAnywhere: false } };
      if (url === "/api/studio/ads") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/studio");
    await userEvent.click(await screen.findByLabelText(/Mail Pro/));
    await userEvent.click(screen.getByRole("button", { name: "Gerar rascunhos" }));
    expect(await screen.findByText(/1 programa\(s\) ignorado/i)).toBeInTheDocument();
    const call = fn.mock.calls.find(([u]) => u === "/api/studio/ads/generate")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ programIds: ["p1"], channel: "blog", withModel: true });
  });
});
