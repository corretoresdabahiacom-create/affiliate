import { defaultContent } from "@ai/shared";
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
const summary = { id: "pg1", slug: "minha-vitrine-ab12c", title: "Minha vitrine", templateId: "drop-vitrine", status: "draft", updatedAt: 1, publishedAt: null };

function setup(onCall?: (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = onCall?.(url, init);
    let r: { status: number; body: unknown };
    if (custom) r = custom;
    else if (url === "/api/me") r = { status: 200, body: ME };
    else if (url === "/api/pages") r = { status: 200, body: { items: init?.method === "POST" ? [] : [summary], max: 10 } };
    else if (url === "/api/pages/pg1")
      r = { status: 200, body: { ...summary, content: defaultContent("drop-vitrine"), issues: ["placeholder_left", "owner_missing"], images: [], limits: { maxImages: 12, maxImageBytes: 350000 } } };
    else r = { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const renderAt = (path: string) =>
  render(
    <I18nProvider initial="pt-BR">
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );

describe("Páginas de venda (telas)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("lista os modelos por categoria, filtra e cria a página a partir do modelo", async () => {
    const fn = setup((url, init) => (url === "/api/pages" && init?.method === "POST" ? { status: 201, body: { ok: true, id: "pg1" } } : undefined));
    renderAt("/pages");
    expect(await screen.findByRole("heading", { name: "Páginas de venda" })).toBeInTheDocument();
    expect(await screen.findByText("Minha vitrine")).toBeInTheDocument();
    expect(screen.getByText(/não aceita promessa de ganho/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Downloads reels" })).toBeInTheDocument();
    const user = userEvent.setup();
    expect(screen.getAllByRole("button", { name: "Usar este modelo" })).toHaveLength(12);
    await user.click(screen.getByRole("tab", { name: "Serviços" }));
    expect(screen.getAllByRole("button", { name: "Usar este modelo" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Usar este modelo" })[0]!);
    await user.click(screen.getByRole("button", { name: "Criar página" }));
    await waitFor(() => {
      const call = fn.mock.calls.find(([u, i]) => u === "/api/pages" && (i as RequestInit | undefined)?.method === "POST");
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ title: "Confiança", templateId: "serv-confianca" });
    });
  });

  it("no editor mostra o que falta para publicar, a prévia e salva as alterações", async () => {
    const fn = setup();
    renderAt("/pages/pg1");
    expect(await screen.findByDisplayValue("Minha vitrine")).toBeInTheDocument();
    expect(screen.getByText(/texto de exemplo entre \[colchetes\]/)).toBeInTheDocument();
    expect(screen.getByText(/nome do responsável e um e-mail/)).toBeInTheDocument();
    const frame = screen.getByTitle("Prévia") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("<!doctype html>");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nome do responsável pela página"), "Ana");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => {
      const put = fn.mock.calls.find(([u, i]) => u === "/api/pages/pg1" && (i as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse((put![1] as RequestInit).body as string).content.settings.ownerName).toBe("Ana");
    });
    expect(await screen.findByText("Salvo")).toBeInTheDocument();
  });

  it("mostra o motivo quando o servidor bloqueia a publicação", async () => {
    setup((url, init) => (url === "/api/pages/pg1/publish" && init?.method === "POST" ? { status: 409, body: { error: "publish_blocked", issues: ["forbidden_claim"] } } : undefined));
    renderAt("/pages/pg1");
    await screen.findByDisplayValue("Minha vitrine");
    await userEvent.setup().click(screen.getByRole("button", { name: "Publicar" }));
    expect(await screen.findByText(/promessa de ganho ou resultado garantido/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Corrija os itens destacados antes de publicar.");
  });

  it("reordena e remove seções", async () => {
    setup();
    renderAt("/pages/pg1");
    await screen.findByDisplayValue("Minha vitrine");
    const user = userEvent.setup();
    const count = () => screen.getAllByRole("button", { name: "Remover seção" }).length;
    const before = count();
    expect(before).toBe(6);
    await user.click(screen.getAllByRole("button", { name: "Mover para baixo" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Remover seção" })[0]!);
    expect(count()).toBe(before - 1);
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  });
});

describe("Downloads reels (tela)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("explica por que não baixa links de terceiros e guia pelos caminhos oficiais", async () => {
    setup();
    renderAt("/downloads");
    expect(await screen.findByRole("heading", { name: "Downloads reels" })).toBeInTheDocument();
    expect(screen.getByText(/viola os termos de uso/)).toBeInTheDocument();
    for (const name of ["Instagram", "TikTok", "YouTube"]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Abrir página oficial" });
    expect(links).toHaveLength(2);
    for (const a of links) expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(screen.getByRole("heading", { name: "TikTok" }).closest("section")!).getAllByRole("listitem")).toHaveLength(4);
  });
});
