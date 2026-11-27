import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AuthProvider } from "../auth";
import { I18nProvider } from "../i18n";

const ME = {
  user: { id: "1", email: "a@a.com", role: "user", planId: "free" },
  profile: { displayName: "Ana", locale: "pt-BR", country: "BR", experience: "beginner", niches: ["saas"], channels: ["blog"], hasWebsite: true, wantsRecurring: true, acceptsPaidTraffic: false, onboarded: true },
};

const post = (over: Record<string, unknown> = {}) => ({
  id: "p1", weekStart: "2026-11-23", day: 1, time: "18:30", title: "Como escolher um programa", hook: "Você erra nisso", script: "Roteiro completo",
  platforms: ["instagram", "tiktok"], status: "idea", usesAffiliateLink: false, disclosureConfirmed: false, notes: null, metrics: null, ...over,
});

function setup(items: unknown[], onCall?: (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = onCall?.(url, init);
    let r: { status: number; body: unknown };
    if (custom) r = custom;
    else if (url === "/api/me") r = { status: 200, body: ME };
    else if (url.startsWith("/api/content/week")) r = { status: 200, body: { weekStart: "2026-11-23", prev: "2026-11-16", next: "2026-11-30", items } };
    else if (url === "/api/content/insights") r = { status: 200, body: { since: "2026-09-07", sample: 0, enough: false, ranking: [], byPlatform: [], byDay: [], best: { platform: null, day: null } } };
    else r = { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const renderPage = () =>
  render(
    <I18nProvider initial="pt-BR">
      <AuthProvider>
        <MemoryRouter initialEntries={["/week"]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );

describe("Semana de conteúdo (tela)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a semana, o aviso de que o sistema não publica e o prompt com o nicho do perfil", async () => {
    setup([post()]);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Semana de conteúdo" })).toBeInTheDocument();
    expect(screen.getByText(/ele não publica nada/)).toBeInTheDocument();
    expect(screen.getByText("Como escolher um programa")).toBeInTheDocument();
    expect(screen.getByText("0 de 1 posts aprovados")).toBeInTheDocument();
    expect(screen.getByText(/nicho \(SaaS e tecnologia\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Semana de conteúdo" })).toBeInTheDocument(); // item no menu
  });

  it("aprova um post enviando o novo status", async () => {
    const fn = setup([post()]);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Aprovar" }));
    const call = fn.mock.calls.find(([u]) => u === "/api/content/posts/p1/status")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ status: "approved" });
  });

  it("mostra o motivo quando a aprovação é bloqueada pela divulgação", async () => {
    setup([post({ usesAffiliateLink: true })], (url) =>
      url.endsWith("/status") ? { status: 409, body: { error: "approval_blocked", issues: ["disclosure_missing"] } } : undefined,
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Aprovar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("só é aprovado com a divulgação confirmada");
  });

  it("só pede a confirmação de divulgação quando o post usa link de afiliado", async () => {
    setup([]);
    renderPage();
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Adicionar neste dia: segunda-feira/ }))[0]!);
    const form = await screen.findByRole("form", { name: "Adicionar post" });
    expect(within(form).queryByLabelText(/Confirmo que a divulgação/)).not.toBeInTheDocument();
    await user.click(within(form).getByLabelText("Este post usa link de afiliado"));
    expect(within(form).getByLabelText(/Confirmo que a divulgação/)).toBeInTheDocument();
  });

  it("cria um post na semana exibida", async () => {
    const fn = setup([]);
    renderPage();
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Adicionar neste dia: terça-feira/ }))[0]!);
    const form = await screen.findByRole("form", { name: "Adicionar post" });
    await user.type(within(form).getByLabelText("Título"), "Vídeo novo");
    await user.click(within(form).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === "/api/content/posts" && i?.method === "POST")).toBe(true));
    const call = fn.mock.calls.find(([u, i]) => u === "/api/content/posts" && i?.method === "POST")!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ weekStart: "2026-11-23", day: 1, title: "Vídeo novo", platforms: ["instagram"], usesAffiliateLink: false });
  });

  it("post publicado oferece métricas, não edição", async () => {
    setup([post({ status: "published" })]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Informar métricas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
  });

  it("não aponta tendência com menos de 3 posts medidos", async () => {
    setup([], (url) =>
      url === "/api/content/insights"
        ? { status: 200, body: { since: "x", sample: 2, enough: false, ranking: [{ id: "a", title: "A", views: 100, engagement: 0.1, retentionPct: null }, { id: "b", title: "B", views: 50, engagement: null, retentionPct: null }], byPlatform: [], byDay: [], best: { platform: null, day: null } } }
        : undefined,
    );
    renderPage();
    expect(await screen.findByText(/Com 2 de 3 posts medidos/)).toBeInTheDocument();
    expect(screen.queryByText(/melhor resultado médio/)).not.toBeInTheDocument();
  });
});
