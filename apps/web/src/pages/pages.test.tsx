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

const profile = (over = {}) => ({
  displayName: "Ana",
  locale: "pt-BR",
  country: "BR",
  experience: "beginner",
  niches: ["saas"],
  channels: ["blog"],
  hasWebsite: true,
  monthlyBudgetUsd: 50,
  wantsRecurring: true,
  acceptsPaidTraffic: false,
  onboarded: true,
  ...over,
});

describe("páginas", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("sem sessão, leva ao login e mostra o formulário em português", async () => {
    mockFetch(() => ({ status: 401, body: { error: "unauthenticated" } }));
    renderApp("/");
    expect(await screen.findByRole("button", { name: "Receber link de acesso" })).toBeInTheDocument();
  });

  it("login envia o e-mail com o cabeçalho anti-CSRF e mostra a confirmação", async () => {
    const fetchFn = mockFetch((url) =>
      url === "/api/me" ? { status: 401, body: {} } : { status: 200, body: { ok: true } },
    );
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Receber link de acesso" }));
    expect(await screen.findByRole("status")).toHaveTextContent("link chegará");
    const call = fetchFn.mock.calls.find(([u]) => u === "/api/auth/login")!;
    expect((call[1]!.headers as Record<string, string>)["x-requested-with"]).toBe("fetch");
    expect(JSON.parse(call[1]!.body as string)).toEqual({ email: "ana@example.com", locale: "pt-BR" });
  });

  it("limite de tentativas mostra mensagem própria", async () => {
    mockFetch((url) => (url === "/api/me" ? { status: 401, body: {} } : { status: 429, body: { error: "rate_limited" } }));
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Receber link de acesso" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Muitas tentativas");
  });

  it("login em inglês usa os textos em inglês", async () => {
    mockFetch(() => ({ status: 401, body: {} }));
    renderApp("/login", "en-US");
    expect(await screen.findByRole("button", { name: "Email me a sign-in link" })).toBeInTheDocument();
  });

  it("usuário sem onboarding é levado ao formulário de perfil", async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: "1", email: "a@a.com", role: "user", planId: "free" }, profile: profile({ onboarded: false }) },
    }));
    renderApp("/");
    expect(await screen.findByText("Conte um pouco sobre você")).toBeInTheDocument();
  });

  it("dashboard mostra os dados do perfil e não oferece Administração a usuário comum", async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: "1", email: "a@a.com", role: "user", planId: "free" }, profile: profile() },
    }));
    renderApp("/");
    expect(await screen.findByText("Olá, Ana")).toBeInTheDocument();
    expect(screen.getByText("SaaS e tecnologia")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Administração" })).not.toBeInTheDocument();
  });

  it("página de admin é bloqueada para usuário comum", async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: "1", email: "a@a.com", role: "user", planId: "free" }, profile: profile() },
    }));
    renderApp("/admin");
    expect(await screen.findByRole("alert")).toHaveTextContent("não tem permissão");
  });

  it("admin vê o link de Administração e a lista de usuários", async () => {
    mockFetch((url) => {
      if (url === "/api/me")
        return {
          status: 200,
          body: { user: { id: "9", email: "boss@x.com", role: "admin", planId: "free" }, profile: profile() },
        };
      if (url === "/api/admin/users")
        return {
          status: 200,
          body: {
            total: 1,
            users: [{ id: "9", email: "boss@x.com", role: "admin", planId: "free", createdAt: 1, lastLoginAt: null }],
          },
        };
      return { status: 200, body: {} };
    });
    renderApp("/admin");
    expect(await screen.findByRole("link", { name: "Administração" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1 usuários no total")).toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("boss@x.com")).toBeInTheDocument();
  });
});
