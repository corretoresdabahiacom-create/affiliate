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


const wh = (o: Record<string, unknown> = {}) => ({ id: "w1", label: "n8n", url: "https://hook.example.com/a", events: ["order.new"], active: true, consecutiveDead: 0, lastDeliveryAt: null, createdAt: 1, ...o });

describe("automações", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("cria webhook, mostra o segredo uma vez e testa a entrega", async () => {
    let created: any = null;
    let list = [] as any[];
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/automation/webhooks" && (!init?.method || init.method === "GET")) return { status: 200, body: { items: list, vaultReady: true } };
      if (url === "/api/automation/webhooks" && init?.method === "POST") { created = JSON.parse(String(init.body)); list = [wh()]; return { status: 201, body: { item: wh(), secret: "whsec_abc123" } }; }
      if (url === "/api/automation/webhooks/w1/test") return { status: 200, body: { status: "delivered", responseStatus: 200, error: null } };
      if (url === "/api/automation/inbound") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/automations");
    await userEvent.type(await screen.findByLabelText("Nome", { selector: "#wh-label" }), "n8n");
    await userEvent.type(screen.getByLabelText(/Endereço https/), "https://hook.example.com/a");
    await userEvent.click(screen.getByRole("button", { name: "Criar webhook" }));
    await waitFor(() => expect(created).toEqual({ label: "n8n", url: "https://hook.example.com/a", events: ["order.new"] }));
    expect(await screen.findByText("whsec_abc123")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Enviar teste" }));
    expect(await screen.findByText("Teste: delivered (HTTP 200)")).toBeInTheDocument();
  });

  it("sem cofre configurado avisa e não deixa criar", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/automation/webhooks") return { status: 200, body: { items: [], vaultReady: false } };
      if (url === "/api/automation/inbound") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/automations");
    expect(await screen.findByText(/cofre não está configurado/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nome", { selector: "#wh-label" }), "x");
    await userEvent.type(screen.getByLabelText(/Endereço https/), "https://a.example.com");
    expect(screen.getByRole("button", { name: "Criar webhook" })).toBeDisabled();
  });

  it("webhook desativado por falhas mostra o aviso e permite reativar", async () => {
    let patch: any = null;
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/automation/webhooks" && (!init?.method || init.method === "GET")) return { status: 200, body: { items: [wh({ active: false, consecutiveDead: 10 })], vaultReady: true } };
      if (url === "/api/automation/webhooks/w1" && init?.method === "PATCH") { patch = JSON.parse(String(init.body)); return { status: 200, body: { item: wh() } }; }
      if (url === "/api/automation/inbound") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/automations");
    expect(await screen.findByText("Desativado por falhas seguidas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reativar" }));
    await waitFor(() => expect(patch).toEqual({ active: true }));
  });

  it("gancho de entrada mostra token e endereço só na criação", async () => {
    let body: any = null;
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/automation/webhooks") return { status: 200, body: { items: [], vaultReady: true } };
      if (url === "/api/automation/inbound" && init?.method === "POST") { body = JSON.parse(String(init.body)); return { status: 201, body: { item: { id: "h1" }, token: "ihk_tok", url: "https://app.example.com/api/hooks/in/h1" } }; }
      if (url === "/api/automation/inbound") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/automations");
    await userEvent.type(await screen.findByLabelText("Nome", { selector: "#ih-label" }), "fluxo");
    await userEvent.click(screen.getByRole("checkbox", { name: "Importar produtos do fornecedor" }));
    await userEvent.click(screen.getByRole("button", { name: "Criar gancho" }));
    await waitFor(() => expect(body).toEqual({ label: "fluxo", actions: ["notify", "supplier.import"] }));
    expect(await screen.findByText("ihk_tok")).toBeInTheDocument();
    expect(screen.getByText("https://app.example.com/api/hooks/in/h1")).toBeInTheDocument();
  });
});

describe("notificações", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());
  const notice = (o: Record<string, unknown> = {}) => ({ id: "n1", kind: "order.new", title: "2 novo(s) pedido(s)", body: null, link: "/orders", createdAt: 1700000000000, read: false, ...o });

  it("lista, marca todas como lidas e liga o resumo por e-mail só quando a pessoa marca", async () => {
    let readAll = false;
    let pref: any = null;
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/automation/notifications") return { status: 200, body: { items: [notice()], unread: 1, prefs: { emailEnabled: false, frequency: "daily" }, emailAvailable: true } };
      if (url === "/api/automation/notifications/read") { readAll = true; return { status: 200, body: { ok: true } }; }
      if (url === "/api/automation/notifications/prefs") { pref = JSON.parse(String(init!.body)); return { status: 200, body: { ok: true } }; }
      if (url === "/api/automation/monitor") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/notifications");
    expect(await screen.findByText("2 novo(s) pedido(s)")).toBeInTheDocument();
    expect(screen.getByText("1 não lidas")).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: "Receber resumo por e-mail" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    await waitFor(() => expect(pref).toEqual({ emailEnabled: true }));
    await userEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    await waitFor(() => expect(readAll).toBe(true));
    expect(screen.getByText(/Siga um programa em Programas/)).toBeInTheDocument();
  });

  it("avisa quando o servidor não envia e-mail", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/automation/notifications") return { status: 200, body: { items: [], unread: 0, prefs: { emailEnabled: false, frequency: "daily" }, emailAvailable: false } };
      if (url === "/api/automation/monitor") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/notifications");
    expect(await screen.findByText(/envio de e-mail não está configurado/i)).toBeInTheDocument();
    expect(screen.getByText("Nenhuma notificação.")).toBeInTheDocument();
  });

  it("monitor mostra o estado das fontes, deixa claro que não altera o catálogo e verifica sob demanda", async () => {
    let checked = false;
    mockFetch(base(meUser, (url, init) => {
      if (url === "/api/automation/notifications") return { status: 200, body: { items: [], unread: 0, prefs: { emailEnabled: false, frequency: "daily" }, emailAvailable: true } };
      if (url === "/api/automation/monitor") return { status: 200, body: { items: [{ sourceId: "s1", programId: "p1", programName: "Programa X", url: "https://docs.example.com/regras", lastStatus: 200, failures: 0, lastCheckedAt: 1700000000000, changedAt: 1700000100000 }, { sourceId: "s2", programId: "p2", programName: "Programa Y", url: "https://docs.example.com/y", lastStatus: null, failures: 2, lastCheckedAt: null, changedAt: null }] } };
      if (url === "/api/automation/monitor/check/p1" && init?.method === "POST") { checked = true; return { status: 200, body: { checked: 1, findings: ["source_changed"] } }; }
      return { status: 404, body: {} };
    }));
    renderApp("/notifications");
    expect(await screen.findByText("Programa X")).toBeInTheDocument();
    expect(screen.getByText(/O catálogo nunca é alterado automaticamente/)).toBeInTheDocument();
    expect(screen.getByText(/mudou em/)).toBeInTheDocument();
    expect(screen.getByText(/ainda não verificada/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Verificar agora" })[0]!);
    await waitFor(() => expect(checked).toBe(true));
    expect(await screen.findByText("1 fonte(s) verificada(s), 1 aviso(s).")).toBeInTheDocument();
  });
});

describe("correções da auditoria (web)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("notificação aparece no idioma de quem lê, com os valores guardados; a vinda do n8n mostra o texto como veio", async () => {
    mockFetch(base(meUser, (url) => {
      if (url === "/api/automation/notifications") return { status: 200, body: { items: [
        { id: "n1", kind: "order.new", title: "3 novo(s) pedido(s) na Shopee", body: null, link: "/orders", createdAt: 1, read: false, data: { n: 3 } },
        { id: "n2", kind: "inbound.notify", title: "Fluxo rodou", body: null, link: null, createdAt: 2, read: false, data: null },
        { id: "n3", kind: "monitor.source_changed", title: "Fonte oficial mudou: P", body: "x", link: "/programs/p", createdAt: 3, read: false, data: { program: "Programa X" } },
      ], unread: 3, prefs: { emailEnabled: false, frequency: "daily" }, emailAvailable: true } };
      if (url === "/api/automation/monitor") return { status: 200, body: { items: [] } };
      return { status: 404, body: {} };
    }));
    renderApp("/notifications", "en-US");
    expect(await screen.findByText("3 new Shopee order(s)")).toBeInTheDocument();
    expect(screen.getByText("Official source changed: Programa X")).toBeInTheDocument();
    expect(screen.getByText(/the catalog was not changed/)).toBeInTheDocument();
    expect(screen.getByText("Fluxo rodou")).toBeInTheDocument();
  });
});

