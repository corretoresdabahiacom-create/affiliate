import { describe, expect, it } from "vitest";
import {
  DISCLOSURE, PAGE_CATEGORIES, PAGE_TEMPLATES, defaultContent, isSafeUrl, pageContentSchema, publishIssues, renderPage, slugify, sniffImage,
  type PageContent,
} from "./pages";

const IMG = "11111111-1111-4111-8111-111111111111";
const ok = (): PageContent => {
  const c = defaultContent("drop-vitrine");
  c.settings.ownerName = "Ana";
  c.settings.contactEmail = "ana@example.com";
  // troca todos os [marcadores] por texto real
  return JSON.parse(JSON.stringify(c).replace(/\[[^\]"]+\]/g, "Texto real")) as PageContent;
};

describe("páginas de venda", () => {
  it("tem 2 modelos por categoria e todos geram conteúdo válido", () => {
    for (const cat of PAGE_CATEGORIES) expect(PAGE_TEMPLATES.filter((t) => t.category === cat)).toHaveLength(2);
    for (const t of PAGE_TEMPLATES) expect(pageContentSchema.safeParse(defaultContent(t.id)).success, t.id).toBe(true);
    expect(() => defaultContent("nao-existe")).toThrow();
  });

  it("aceita só https e âncoras internas", () => {
    expect(isSafeUrl("https://example.com/x?a=1")).toBe(true);
    expect(isSafeUrl("#preco")).toBe(true);
    for (const bad of ["http://example.com", "javascript:alert(1)", "data:text/html,x", "//evil.com", "https://", "ftp://x.com", "#a b"]) expect(isSafeUrl(bad), bad).toBe(false);
  });

  it("não deixa publicar o modelo sem editar, nem sem dono, nem com promessa de ganho", () => {
    const raw = defaultContent("drop-vitrine");
    expect(publishIssues(raw, "Título")).toEqual(expect.arrayContaining(["placeholder_left", "cta_url_missing", "owner_missing"]));
    const c = ok();
    (c.blocks.find((b) => b.id === "preco") as any).ctaUrl = "https://loja.example.com/p";
    expect(publishIssues(c, "Meu produto")).toEqual([]);
    (c.blocks[0] as any).headline = "Renda garantida todo mês";
    expect(publishIssues(c, "Meu produto")).toContain("forbidden_claim");
  });

  it("exige confirmação de que os depoimentos são reais", () => {
    const c = ok();
    (c.blocks.find((b) => b.id === "preco") as any).ctaUrl = "https://loja.example.com/p";
    c.blocks.push({ id: "dep", type: "testimonials", title: "Clientes", confirmedReal: false, items: [{ name: "Maria", text: "Gostei" }] });
    expect(publishIssues(c, "t")).toContain("testimonial_unconfirmed");
    (c.blocks.at(-1) as any).confirmedReal = true;
    expect(publishIssues(c, "t")).not.toContain("testimonial_unconfirmed");
  });

  it("renderiza com escape, sem script e com a divulgação de afiliado", () => {
    const c = ok();
    (c.blocks[0] as any).headline = `<script>alert(1)</script> & "aspas"`;
    (c.blocks[0] as any).ctaUrl = "https://loja.example.com/?a=1&b=2";
    (c.blocks[0] as any).imageId = IMG;
    c.settings.usesAffiliateLinks = true;
    const html = renderPage({ title: "T <b>", content: c }, { imgSrc: (id) => `/p/img/${id}` });
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; &quot;aspas&quot;");
    expect(html).toContain('href="https://loja.example.com/?a=1&amp;b=2"');
    expect(html).toContain('rel="nofollow sponsored noopener noreferrer"');
    expect(html).toContain(`src="/p/img/${IMG}"`);
    expect(html).toContain(DISCLOSURE);
    expect(html).toContain("<title>T &lt;b&gt;</title>");
    expect(html).toContain("Página de Ana");
  });

  it("não renderiza link inseguro, imagem com id estranho nem depoimento não confirmado", () => {
    const c = ok();
    (c.blocks[0] as any).ctaUrl = "javascript:alert(1)";
    (c.blocks[0] as any).imageId = '"><img src=x onerror=alert(1)>';
    c.blocks.push({ id: "dep", type: "testimonials", title: "Clientes", confirmedReal: false, items: [{ name: "Maria", text: "Texto secreto" }] });
    const html = renderPage({ title: "t", content: c }, { imgSrc: (id) => `/p/img/${id}` });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("Texto secreto");
  });

  it("sem link de afiliado, não mostra a divulgação", () => {
    const c = ok();
    c.settings.usesAffiliateLinks = false;
    expect(renderPage({ title: "t", content: c }, { imgSrc: (i) => i })).not.toContain(DISCLOSURE);
  });

  it("gera slug limpo e reconhece imagens pelos bytes", () => {
    expect(slugify("Tênis Corrida — Promoção!")).toBe("tenis-corrida-promocao");
    expect(slugify("!!")).toBe("pagina");
    const pad = (a: number[]) => new Uint8Array([...a, ...new Array(20).fill(0)]);
    expect(sniffImage(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });
});
