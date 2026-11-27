import { z } from "zod";
import { adClaimIssues } from "./studio";

/**
 * Páginas de venda: modelos por categoria, validações e um renderizador único (servidor e prévia usam o mesmo HTML).
 * Regras: nada de depoimento sem confirmação de que é real, nada de contagem regressiva/escassez inventada,
 * nada de promessa de ganho, divulgação de afiliado sempre no rodapé quando houver link de afiliado.
 */

export const PAGE_CATEGORIES = ["dropshipping", "infoproduct", "saas", "service", "leads", "review"] as const;
export type PageCategory = (typeof PAGE_CATEGORIES)[number];

export const MAX_PAGES_PER_USER = 10;
export const MAX_BLOCKS = 20;
export const MAX_IMAGES_PER_PAGE = 12;
export const MAX_IMAGE_BYTES = 350_000;

// ---------- Esquemas ----------

const text = (max: number) => z.string().trim().max(max);
const blockId = z.string().regex(/^[a-z0-9-]{1,36}$/);
const imageId = z.string().regex(/^[0-9a-f-]{36}$/);

/** Só https:// ou âncora interna (#preco). Nunca javascript:, data: ou http. */
export function isSafeUrl(u: string): boolean {
  if (/^#[a-z0-9-]{1,36}$/.test(u)) return true;
  if (u.length > 2000 || !u.startsWith("https://")) return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}
const url = z.union([z.literal(""), z.string().trim().refine(isSafeUrl, "invalid_url")]);
const item = z.object({ title: text(100), text: text(400) });
const items = (min: number, max: number) => z.array(item).min(min).max(max);

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id: blockId, type: z.literal("hero"), badge: text(50).default(""), headline: text(140), subheadline: text(400).default(""), ctaLabel: text(40), ctaUrl: url, imageId: imageId.nullish() }),
  z.object({ id: blockId, type: z.literal("benefits"), title: text(100).default(""), items: items(1, 6) }),
  z.object({ id: blockId, type: z.literal("steps"), title: text(100).default(""), items: items(1, 5) }),
  z.object({ id: blockId, type: z.literal("gallery"), title: text(100).default(""), imageIds: z.array(imageId).max(6) }),
  z.object({ id: blockId, type: z.literal("text"), title: text(100).default(""), body: text(2000) }),
  z.object({
    id: blockId, type: z.literal("price"), title: text(100).default(""), productName: text(100), price: text(40), note: text(200).default(""),
    bullets: z.array(text(120)).max(8).default([]), ctaLabel: text(40), ctaUrl: url,
  }),
  z.object({
    id: blockId, type: z.literal("testimonials"), title: text(100).default(""), confirmedReal: z.boolean().default(false),
    items: z.array(z.object({ name: text(60), text: text(400) })).min(1).max(6),
  }),
  z.object({ id: blockId, type: z.literal("faq"), title: text(100).default(""), items: z.array(z.object({ q: text(150), a: text(600) })).min(1).max(8) }),
  z.object({ id: blockId, type: z.literal("cta"), headline: text(140), text: text(300).default(""), ctaLabel: text(40), ctaUrl: url }),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export const BLOCK_TYPES: BlockType[] = ["hero", "benefits", "steps", "gallery", "text", "price", "testimonials", "faq", "cta"];

export const settingsSchema = z.object({
  ownerName: text(80).default(""),
  contactEmail: z.union([z.literal(""), z.string().trim().email().max(120)]).default(""),
  usesAffiliateLinks: z.boolean().default(false),
  description: text(200).default(""),
});
export type PageSettings = z.infer<typeof settingsSchema>;

export const pageContentSchema = z.object({
  templateId: z.string().max(40),
  settings: settingsSchema,
  blocks: z.array(blockSchema).max(MAX_BLOCKS).refine((b) => new Set(b.map((x) => x.id)).size === b.length, "duplicate_block_id"),
});
export type PageContent = z.infer<typeof pageContentSchema>;

export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(60).refine((s) => s !== "img", "reserved");
export const pageCreateSchema = z.object({ title: z.string().trim().min(1).max(100), templateId: z.string().max(40) });
export const pageUpdateSchema = z.object({ title: z.string().trim().min(1).max(100).optional(), slug: slugSchema.optional(), content: pageContentSchema.optional() });
export const imageUploadSchema = z.object({ mime: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().min(100).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) });

export function slugify(s: string): string {
  const base = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return base.length >= 3 ? base : "pagina";
}

/** Reconhece JPEG, PNG e WebP pelos primeiros bytes (não confia no tipo informado). SVG nunca é aceito. */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

// ---------- Conferência para publicar ----------

export type PublishIssue = "no_hero" | "cta_url_missing" | "placeholder_left" | "forbidden_claim" | "testimonial_unconfirmed" | "owner_missing";

function textsOf(b: Block): string[] {
  switch (b.type) {
    case "hero": return [b.badge, b.headline, b.subheadline, b.ctaLabel];
    case "benefits": case "steps": return [b.title, ...b.items.flatMap((i) => [i.title, i.text])];
    case "gallery": return [b.title];
    case "text": return [b.title, b.body];
    case "price": return [b.title, b.productName, b.price, b.note, ...b.bullets, b.ctaLabel];
    case "testimonials": return [b.title, ...b.items.flatMap((i) => [i.name, i.text])];
    case "faq": return [b.title, ...b.items.flatMap((i) => [i.q, i.a])];
    case "cta": return [b.headline, b.text, b.ctaLabel];
  }
}

/** Marcador de texto de exemplo deixado no modelo: [assim]. */
const PLACEHOLDER = /\[[^\]]{2,}\]/;

export function publishIssues(c: PageContent, title: string): PublishIssue[] {
  const out = new Set<PublishIssue>();
  if (!c.blocks.some((b) => b.type === "hero")) out.add("no_hero");
  const all = [title, c.settings.description, ...c.blocks.flatMap(textsOf)];
  if (all.some((t) => PLACEHOLDER.test(t))) out.add("placeholder_left");
  if (all.some((t) => adClaimIssues(t).length > 0)) out.add("forbidden_claim");
  for (const b of c.blocks) {
    if ((b.type === "hero" || b.type === "price" || b.type === "cta") && !b.ctaUrl) out.add("cta_url_missing");
    if (b.type === "testimonials" && !b.confirmedReal) out.add("testimonial_unconfirmed");
  }
  if (!c.settings.ownerName.trim() || !c.settings.contactEmail.trim()) out.add("owner_missing");
  return [...out];
}

// ---------- Temas e modelos ----------

export interface Theme {
  bg: string; surface: string; text: string; muted: string; accent: string; accentText: string; border: string;
  radius: number; font: "sans" | "serif" | "rounded"; hero: "split" | "center" | "gradient"; dark: boolean; heroBg: string;
}
const T = (t: Theme) => t;
const THEMES: Record<string, Theme> = {
  citrus: T({ bg: "#fff8f0", surface: "#ffffff", text: "#1f1a14", muted: "#6b5f52", accent: "#e8590c", accentText: "#ffffff", border: "#f0e2d2", radius: 18, font: "sans", hero: "split", dark: false, heroBg: "linear-gradient(135deg,#fff1e0,#ffe0c2)" }),
  impact: T({ bg: "#0c0c0f", surface: "#16161b", text: "#f6f4ef", muted: "#a5a2ac", accent: "#ff5a1f", accentText: "#ffffff", border: "#26262e", radius: 14, font: "sans", hero: "center", dark: true, heroBg: "radial-gradient(900px 400px at 50% -10%,#3a1a0c,transparent)" }),
  editorial: T({ bg: "#f7f3ea", surface: "#fffdf8", text: "#1d1b16", muted: "#665f50", accent: "#8a3b12", accentText: "#ffffff", border: "#e6dfcf", radius: 6, font: "serif", hero: "split", dark: false, heroBg: "linear-gradient(180deg,#f2ebdb,#f7f3ea)" }),
  neon: T({ bg: "#0e0a1f", surface: "#171232", text: "#f3f0ff", muted: "#a59fc7", accent: "#8b5cf6", accentText: "#ffffff", border: "#2a2350", radius: 20, font: "rounded", hero: "gradient", dark: true, heroBg: "radial-gradient(800px 420px at 80% -10%,#4c1d95,transparent),radial-gradient(600px 300px at 0% 0%,#1d4ed8 0%,transparent 70%)" }),
  aurora: T({ bg: "#f8f9ff", surface: "#ffffff", text: "#12132b", muted: "#5b5f82", accent: "#4f46e5", accentText: "#ffffff", border: "#e4e6fb", radius: 18, font: "sans", hero: "gradient", dark: false, heroBg: "radial-gradient(700px 360px at 85% -10%,#c7d2fe,transparent),radial-gradient(600px 300px at 0% 10%,#fbcfe8,transparent)" }),
  mono: T({ bg: "#ffffff", surface: "#f6f6f6", text: "#0a0a0a", muted: "#5f5f5f", accent: "#0a0a0a", accentText: "#ffffff", border: "#e5e5e5", radius: 10, font: "sans", hero: "center", dark: false, heroBg: "#ffffff" }),
  trust: T({ bg: "#f5f9ff", surface: "#ffffff", text: "#0f1d33", muted: "#51627f", accent: "#1d5fd1", accentText: "#ffffff", border: "#dce7f8", radius: 14, font: "sans", hero: "split", dark: false, heroBg: "linear-gradient(135deg,#e6f0ff,#f5f9ff)" }),
  grove: T({ bg: "#f4faf5", surface: "#ffffff", text: "#102417", muted: "#4d6655", accent: "#15803d", accentText: "#ffffff", border: "#d8eadc", radius: 16, font: "rounded", hero: "split", dark: false, heroBg: "linear-gradient(135deg,#dcf3e2,#f4faf5)" }),
  focus: T({ bg: "#fffdf9", surface: "#ffffff", text: "#1a1a1a", muted: "#666666", accent: "#d9480f", accentText: "#ffffff", border: "#eee7dc", radius: 12, font: "sans", hero: "center", dark: false, heroBg: "#fffdf9" }),
  vivid: T({ bg: "#fff5fa", surface: "#ffffff", text: "#2a0b1c", muted: "#7a4a63", accent: "#e11d74", accentText: "#ffffff", border: "#f8dbe9", radius: 22, font: "rounded", hero: "gradient", dark: false, heroBg: "radial-gradient(700px 360px at 90% -10%,#fecdd3,transparent),radial-gradient(600px 300px at 0% 0%,#fed7aa,transparent)" }),
  compare: T({ bg: "#f9fafb", surface: "#ffffff", text: "#111827", muted: "#4b5563", accent: "#0f766e", accentText: "#ffffff", border: "#e5e7eb", radius: 12, font: "sans", hero: "split", dark: false, heroBg: "linear-gradient(135deg,#e6fffa,#f9fafb)" }),
  verdict: T({ bg: "#0b1220", surface: "#111a2e", text: "#eef2ff", muted: "#9aa6c4", accent: "#22d3ee", accentText: "#06222b", border: "#1e2a47", radius: 14, font: "sans", hero: "center", dark: true, heroBg: "radial-gradient(800px 380px at 50% -10%,#0e3a4a,transparent)" }),
};

export interface PageTemplate { id: string; category: PageCategory; name: string; description: string; theme: string }
export const PAGE_TEMPLATES: PageTemplate[] = [
  { id: "drop-vitrine", category: "dropshipping", name: "Vitrine", description: "Claro e acolhedor: foto grande do produto, benefícios e um botão de compra.", theme: "citrus" },
  { id: "drop-impacto", category: "dropshipping", name: "Impacto", description: "Fundo escuro e título forte, feito para tráfego de anúncio em vídeo curto.", theme: "impact" },
  { id: "info-editorial", category: "infoproduct", name: "Editorial", description: "Aparência de revista: conta uma história antes de apresentar o curso ou e-book.", theme: "editorial" },
  { id: "info-neon", category: "infoproduct", name: "Neon", description: "Moderno e ousado, para cursos, mentorias e comunidades.", theme: "neon" },
  { id: "saas-aurora", category: "saas", name: "Aurora", description: "Degradê suave e passos simples para software e assinaturas.", theme: "aurora" },
  { id: "saas-mono", category: "saas", name: "Mono", description: "Minimalista em preto e branco: o produto fala por si.", theme: "mono" },
  { id: "serv-confianca", category: "service", name: "Confiança", description: "Azul sóbrio, perguntas frequentes e contato direto, para serviços e consultorias.", theme: "trust" },
  { id: "serv-local", category: "service", name: "Local", description: "Verde acolhedor para negócios locais, imobiliário e atendimento por WhatsApp.", theme: "grove" },
  { id: "leads-foco", category: "leads", name: "Foco", description: "Uma promessa, um botão. Para captar contatos com um material gratuito.", theme: "focus" },
  { id: "leads-vibrante", category: "leads", name: "Vibrante", description: "Cores vivas para lista de espera e lançamentos.", theme: "vivid" },
  { id: "review-comparativo", category: "review", name: "Comparativo", description: "Análise honesta de um produto, com prós, contras e como escolher.", theme: "compare" },
  { id: "review-veredito", category: "review", name: "Veredito", description: "Escuro e direto: o resumo da análise logo no topo.", theme: "verdict" },
];
export const templateById = (id: string) => PAGE_TEMPLATES.find((t) => t.id === id) ?? null;
const themeOf = (id: string): Theme => THEMES[templateById(id)?.theme ?? "citrus"]!;

const rid = (n: number) => `b${n}`;

/** Conteúdo inicial de cada categoria. Os trechos entre [colchetes] precisam ser trocados antes de publicar. */
export function defaultContent(templateId: string): PageContent {
  const t = templateById(templateId);
  if (!t) throw new Error("unknown_template");
  const settings: PageSettings = { ownerName: "", contactEmail: "", usesAffiliateLinks: t.category !== "service", description: "" };
  const faq = (n: number): Block => ({ id: rid(n), type: "faq", title: "Perguntas frequentes", items: [
    { q: "[Pergunta que seu cliente mais faz]", a: "[Resposta curta e honesta]" },
    { q: "[Segunda dúvida comum]", a: "[Resposta]" },
  ] });
  const price = (n: number, cta: string): Block => ({ id: "preco", type: "price", title: "Oferta", productName: "[Nome do produto]", price: "[Preço real, ex.: R$ 97,00]", note: "[Condições reais: frete, prazo, forma de pagamento]", bullets: ["[O que vem incluso]", "[Outro item incluso]"], ctaLabel: cta, ctaUrl: "" });
  let blocks: Block[];
  switch (t.category) {
    case "dropshipping":
      blocks = [
        { id: rid(1), type: "hero", badge: "[Para quem é: ex. quem treina em casa]", headline: "[Resultado que o cliente quer, em uma frase]", subheadline: "[Como o produto resolve o problema, sem exagero]", ctaLabel: "Quero o meu", ctaUrl: "#preco", imageId: null },
        { id: rid(2), type: "benefits", title: "Por que as pessoas escolhem", items: [
          { title: "[Benefício 1]", text: "[Explique em uma linha]" }, { title: "[Benefício 2]", text: "[Explique em uma linha]" }, { title: "[Benefício 3]", text: "[Explique em uma linha]" } ] },
        { id: rid(3), type: "gallery", title: "Veja de perto", imageIds: [] },
        { id: rid(4), type: "steps", title: "Como funciona a compra", items: [
          { title: "Escolha", text: "[Variações disponíveis]" }, { title: "Receba", text: "[Prazo real de entrega]" }, { title: "Use", text: "[Como usar]" } ] },
        price(5, "Comprar agora"), faq(6),
      ];
      break;
    case "infoproduct":
      blocks = [
        { id: rid(1), type: "hero", badge: "[Formato: curso, e-book, mentoria]", headline: "[A transformação que você ensina]", subheadline: "[Para quem é e o que a pessoa vai conseguir fazer]", ctaLabel: "Quero participar", ctaUrl: "#preco", imageId: null },
        { id: rid(2), type: "text", title: "A história por trás", body: "[Conte por que criou isso, o problema que enfrentou e o que aprendeu. Histórias reais convencem mais que promessas.]" },
        { id: rid(3), type: "steps", title: "O que você vai aprender", items: [
          { title: "[Módulo 1]", text: "[O que ensina]" }, { title: "[Módulo 2]", text: "[O que ensina]" }, { title: "[Módulo 3]", text: "[O que ensina]" } ] },
        price(4, "Garantir minha vaga"), faq(5),
      ];
      break;
    case "saas":
      blocks = [
        { id: rid(1), type: "hero", badge: "[Teste grátis, se existir]", headline: "[O que o software faz por você, em uma frase]", subheadline: "[Para quem é e qual problema resolve]", ctaLabel: "Experimentar", ctaUrl: "", imageId: null },
        { id: rid(2), type: "benefits", title: "O que você ganha", items: [
          { title: "[Recurso 1]", text: "[Benefício concreto]" }, { title: "[Recurso 2]", text: "[Benefício concreto]" }, { title: "[Recurso 3]", text: "[Benefício concreto]" } ] },
        { id: rid(3), type: "steps", title: "Comece em 3 passos", items: [
          { title: "Crie a conta", text: "[Detalhe]" }, { title: "Configure", text: "[Detalhe]" }, { title: "Use", text: "[Detalhe]" } ] },
        faq(4), { id: rid(5), type: "cta", headline: "[Pronto para começar?]", text: "[Condições reais do plano ou do teste]", ctaLabel: "Começar agora", ctaUrl: "" },
      ];
      break;
    case "service":
      blocks = [
        { id: rid(1), type: "hero", badge: "[Cidade ou região atendida]", headline: "[Serviço que você presta e para quem]", subheadline: "[O que muda na vida do cliente depois de contratar]", ctaLabel: "Falar no WhatsApp", ctaUrl: "", imageId: null },
        { id: rid(2), type: "benefits", title: "Como trabalhamos", items: [
          { title: "[Diferencial 1]", text: "[Explique]" }, { title: "[Diferencial 2]", text: "[Explique]" }, { title: "[Diferencial 3]", text: "[Explique]" } ] },
        { id: rid(3), type: "steps", title: "Do primeiro contato ao resultado", items: [
          { title: "Conversa", text: "[Como começa]" }, { title: "Proposta", text: "[Prazos e valores reais]" }, { title: "Entrega", text: "[Como entrega]" } ] },
        faq(4), { id: rid(5), type: "cta", headline: "[Vamos conversar?]", text: "[Horário de atendimento]", ctaLabel: "Chamar agora", ctaUrl: "" },
      ];
      break;
    case "leads":
      blocks = [
        { id: rid(1), type: "hero", badge: "[Material gratuito]", headline: "[A promessa do material, sem exagero]", subheadline: "[O que a pessoa recebe e em quanto tempo]", ctaLabel: "Quero receber", ctaUrl: "", imageId: null },
        { id: rid(2), type: "benefits", title: "Dentro do material", items: [
          { title: "[Item 1]", text: "[Do que trata]" }, { title: "[Item 2]", text: "[Do que trata]" }, { title: "[Item 3]", text: "[Do que trata]" } ] },
        { id: rid(3), type: "cta", headline: "[Receba agora]", text: "[Como será entregue e como cancelar]", ctaLabel: "Quero receber", ctaUrl: "" },
      ];
      break;
    case "review":
      blocks = [
        { id: rid(1), type: "hero", badge: "[Análise independente]", headline: "[Produto]: vale a pena? [Para quem]", subheadline: "[Resumo do veredito em duas linhas]", ctaLabel: "Ver preço atual", ctaUrl: "", imageId: null },
        { id: rid(2), type: "benefits", title: "O que achamos bom", items: [
          { title: "[Ponto positivo 1]", text: "[Evidência: o que você testou]" }, { title: "[Ponto positivo 2]", text: "[Evidência]" } ] },
        { id: rid(3), type: "benefits", title: "O que pesa contra", items: [
          { title: "[Ponto negativo 1]", text: "[Evidência]" }, { title: "[Ponto negativo 2]", text: "[Evidência]" } ] },
        { id: rid(4), type: "text", title: "Para quem serve (e para quem não serve)", body: "[Diga com franqueza quem deve evitar o produto.]" },
        faq(5), { id: rid(6), type: "cta", headline: "[Quer conferir?]", text: "[Preço e condições mudam: confira na página oficial]", ctaLabel: "Ver na página oficial", ctaUrl: "" },
      ];
      break;
  }
  return { templateId, settings, blocks };
}

// ---------- Renderizador ----------

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const para = (s: string) => s.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
const FONTS = {
  sans: `ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`,
  serif: `ui-serif,Georgia,Cambria,"Times New Roman",serif`,
  rounded: `ui-rounded,"SF Pro Rounded","Nunito","Segoe UI",system-ui,sans-serif`,
};

export const DISCLOSURE = "Esta página pode conter links de afiliado: se você comprar por eles, o responsável pode receber uma comissão, sem custo extra para você. Isso não muda a nossa avaliação.";

export interface RenderOpts { imgSrc: (id: string) => string; canonical?: string }

export function renderPage(page: { title: string; content: PageContent }, o: RenderOpts): string {
  const { settings, blocks, templateId } = page.content;
  const th = themeOf(templateId);
  const aff = settings.usesAffiliateLinks;
  const rel = aff ? "nofollow sponsored noopener noreferrer" : "noopener noreferrer";
  const link = (u: string) => (u.startsWith("#") ? u : u);
  const btn = (label: string, u: string, cls = "btn") => (u && isSafeUrl(u) ? `<a class="${cls}" href="${esc(link(u))}" rel="${rel}"${u.startsWith("#") ? "" : ' target="_blank"'}>${esc(label)}</a>` : "");
  const img = (id: string | null | undefined, alt: string, cls = "") => (id && /^[0-9a-f-]{36}$/.test(id) ? `<img class="${cls}" src="${esc(o.imgSrc(id))}" alt="${esc(alt)}" loading="lazy" decoding="async">` : "");
  const hero = blocks.find((b) => b.type === "hero") as Extract<Block, { type: "hero" }> | undefined;
  const heroImg = hero ? img(hero.imageId, hero.headline, "hero-img") : "";

  const sections = blocks.map((b) => {
    switch (b.type) {
      case "hero":
        return `<header class="hero hero-${th.hero}" id="${b.id}"><div class="wrap hero-in${heroImg ? " has-img" : ""}"><div class="hero-copy">${b.badge ? `<span class="badge">${esc(b.badge)}</span>` : ""}<h1>${esc(b.headline)}</h1>${b.subheadline ? `<p class="lead">${esc(b.subheadline)}</p>` : ""}<div class="cta-row">${btn(b.ctaLabel, b.ctaUrl)}</div></div>${heroImg ? `<div class="hero-media">${heroImg}</div>` : ""}</div></header>`;
      case "benefits":
        return `<section class="sec" id="${b.id}"><div class="wrap">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<div class="grid">${b.items.map((i) => `<div class="card"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join("")}</div></div></section>`;
      case "steps":
        return `<section class="sec" id="${b.id}"><div class="wrap">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<ol class="steps">${b.items.map((i, n) => `<li class="card"><span class="num">${n + 1}</span><div><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div></li>`).join("")}</ol></div></section>`;
      case "gallery":
        return b.imageIds.length ? `<section class="sec" id="${b.id}"><div class="wrap">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<div class="gal">${b.imageIds.map((id) => img(id, b.title || "Imagem")).join("")}</div></div></section>` : "";
      case "text":
        return `<section class="sec" id="${b.id}"><div class="wrap narrow">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<div class="prose">${para(b.body)}</div></div></section>`;
      case "price":
        return `<section class="sec" id="${b.id}"><div class="wrap narrow"><div class="card price">${b.title ? `<span class="badge">${esc(b.title)}</span>` : ""}<h2>${esc(b.productName)}</h2><p class="amount">${esc(b.price)}</p>${b.note ? `<p class="muted">${esc(b.note)}</p>` : ""}${b.bullets.length ? `<ul class="ticks">${b.bullets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}<div class="cta-row">${btn(b.ctaLabel, b.ctaUrl)}</div></div></div></section>`;
      case "testimonials":
        return b.confirmedReal ? `<section class="sec" id="${b.id}"><div class="wrap">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}<div class="grid">${b.items.map((i) => `<figure class="card quote"><blockquote>${esc(i.text)}</blockquote><figcaption>${esc(i.name)}</figcaption></figure>`).join("")}</div></div></section>` : "";
      case "faq":
        return `<section class="sec" id="${b.id}"><div class="wrap narrow">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}${b.items.map((i) => `<details class="card faq"><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p></details>`).join("")}</div></section>`;
      case "cta":
        return `<section class="sec" id="${b.id}"><div class="wrap narrow"><div class="card final"><h2>${esc(b.headline)}</h2>${b.text ? `<p>${esc(b.text)}</p>` : ""}<div class="cta-row">${btn(b.ctaLabel, b.ctaUrl)}</div></div></div></section>`;
    }
  });

  const stickyUrl = hero?.ctaUrl && isSafeUrl(hero.ctaUrl) ? hero.ctaUrl : "";
  const sticky = hero && stickyUrl ? `<div class="sticky">${btn(hero.ctaLabel, stickyUrl, "btn block")}</div>` : "";
  const desc = settings.description || hero?.subheadline || "";
  const c = th;
  const css = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:${c.bg};color:${c.text};font-family:${FONTS[c.font]};line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}.narrow{max-width:720px}
h1,h2,h3{line-height:1.12;letter-spacing:-.02em;margin:0 0 .5em}h1{font-size:clamp(2rem,6vw,3.6rem);font-weight:800}h2{font-size:clamp(1.5rem,3.6vw,2.2rem);font-weight:750;text-align:center}h3{font-size:1.1rem}
p{margin:0 0 1em}.muted{color:${c.muted}}.lead{font-size:clamp(1.05rem,2.2vw,1.3rem);color:${c.muted};max-width:36em}
.hero{background:${c.heroBg};padding:clamp(40px,9vw,96px) 0 clamp(36px,7vw,72px)}.hero-in{display:grid;gap:32px;align-items:center}.hero-center .hero-in,.hero-gradient .hero-in{text-align:center;justify-items:center}.hero-center .lead,.hero-gradient .lead{margin-left:auto;margin-right:auto}
@media(min-width:820px){.hero-split .hero-in.has-img,.hero-in.has-img{grid-template-columns:1.1fr .9fr;text-align:left;justify-items:start}.hero-in.has-img .lead{margin-left:0}}
.hero-img{width:100%;height:auto;max-height:520px;object-fit:cover;border-radius:${c.radius + 6}px;box-shadow:0 30px 60px -30px rgba(0,0,0,.45)}
.badge{display:inline-block;padding:6px 14px;border-radius:999px;background:${c.surface};color:${c.accent};border:1px solid ${c.border};font-size:.82rem;font-weight:700;margin-bottom:16px}
.cta-row{margin-top:24px}.btn{display:inline-block;background:${c.accent};color:${c.accentText};text-decoration:none;font-weight:750;padding:16px 30px;border-radius:999px;font-size:1.05rem;box-shadow:0 14px 30px -12px ${c.accent};transition:transform .15s}.btn:hover{transform:translateY(-2px)}.btn.block{display:block;text-align:center}
.sec{padding:clamp(32px,6vw,64px) 0}.grid{display:grid;gap:16px;margin-top:28px}@media(min-width:720px){.grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
.card{background:${c.surface};border:1px solid ${c.border};border-radius:${c.radius}px;padding:22px}.card p{color:${c.muted};margin:0}.card h3{margin-bottom:.35em}
.steps{list-style:none;padding:0;margin:28px 0 0;display:grid;gap:14px}.steps li{display:flex;gap:16px;align-items:flex-start}.num{flex:none;width:38px;height:38px;border-radius:50%;background:${c.accent};color:${c.accentText};display:grid;place-items:center;font-weight:800}
.gal{display:grid;gap:12px;margin-top:28px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.gal img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:${c.radius}px}
.prose{font-size:1.1rem}.prose p{color:${c.text}}
.price{text-align:center;padding:32px 24px}.price h2{margin-top:6px}.amount{font-size:clamp(2rem,6vw,3rem)!important;font-weight:850;color:${c.text}!important;letter-spacing:-.03em;margin:.2em 0!important}
.ticks{list-style:none;padding:0;margin:20px auto 0;display:inline-block;text-align:left}.ticks li{padding-left:28px;position:relative;margin:8px 0}.ticks li:before{content:"✓";position:absolute;left:0;color:${c.accent};font-weight:900}
.quote blockquote{margin:0 0 12px;font-size:1.05rem}.quote figcaption{font-weight:700;color:${c.muted};font-size:.9rem}
.faq{margin-top:12px;padding:0}.faq summary{cursor:pointer;font-weight:700;padding:18px 22px;list-style:none}.faq summary::-webkit-details-marker{display:none}.faq summary:after{content:"+";float:right;color:${c.accent};font-size:1.3rem;line-height:1}.faq[open] summary:after{content:"–"}.faq p{padding:0 22px 20px}
.final{text-align:center;padding:40px 24px;background:${c.dark ? c.surface : c.heroBg === c.bg ? c.surface : c.heroBg}}
footer{padding:36px 0 120px;color:${c.muted};font-size:.82rem;border-top:1px solid ${c.border};margin-top:24px}footer p{margin:0 0 .6em}
.sticky{position:fixed;left:0;right:0;bottom:0;padding:10px 16px;background:${c.bg};border-top:1px solid ${c.border};z-index:5}@media(min-width:820px){.sticky{display:none}footer{padding-bottom:36px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;
  const owner = settings.ownerName ? `Página de ${esc(settings.ownerName)}${settings.contactEmail ? ` · contato: ${esc(settings.contactEmail)}` : ""}` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.title)}</title>${desc ? `<meta name="description" content="${esc(desc.slice(0, 200))}">` : ""}<meta property="og:title" content="${esc(page.title)}">${desc ? `<meta property="og:description" content="${esc(desc.slice(0, 200))}">` : ""}<meta name="referrer" content="strict-origin-when-cross-origin"><style>${css}</style></head><body>${sections.join("")}<footer><div class="wrap narrow">${aff ? `<p>${esc(DISCLOSURE)}</p>` : ""}${owner ? `<p>${owner}</p>` : ""}</div></footer>${sticky}</body></html>`;
}
