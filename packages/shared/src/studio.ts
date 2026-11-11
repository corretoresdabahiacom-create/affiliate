import { z } from "zod";
import { checkGrounding } from "./ai";

/**
 * Estúdio (Fase 6): calendário sazonal e rascunhos de divulgação.
 * - Sazonalidade só vem de editor, e número ("+720%") só aparece com fonte citada. Nada é inventado nem pré-carregado.
 * - Rascunho de divulgação é sugestão: nada é publicado. Aprovar exige checagem do canal e do texto.
 */

const httpUrl = z.string().trim().max(2000).url().refine((u) => /^https?:\/\//i.test(u), "http(s) only");
const opt = (n: number) => z.string().trim().max(n).nullish();

export const SEASONAL_STATUS = ["draft", "published"] as const;
export const seasonalEntrySchema = z.object({
  month: z.number().int().min(1).max(12),
  niche: z.string().trim().min(2).max(80),
  note: opt(500),
  /** Ex.: "Pico de buscas". Só vale junto com valor e fonte. */
  metricLabel: opt(80),
  metricValue: opt(40),
  sourceUrl: httpUrl.nullish(),
  programIds: z.array(z.string().min(1)).max(20).default([]),
  status: z.enum(SEASONAL_STATUS).default("draft"),
});
export const seasonalEntryPatchSchema = seasonalEntrySchema.partial();
export type SeasonalEntryInput = z.infer<typeof seasonalEntrySchema>;

/** Regra de integridade: métrica sem fonte não pode ser publicada, nem existir pela metade. */
export function seasonalIssues(e: { metricLabel?: string | null; metricValue?: string | null; sourceUrl?: string | null; status?: string }): string[] {
  const out: string[] = [];
  const hasValue = !!e.metricValue?.trim();
  const hasLabel = !!e.metricLabel?.trim();
  if (hasValue !== hasLabel) out.push("metric_incomplete");
  if (hasValue && !e.sourceUrl) out.push("metric_needs_source");
  return out;
}

// ---------- Rascunhos de divulgação ----------

export const CONTENT_CHANNELS = ["blog", "youtube", "instagram", "tiktok", "email", "other"] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];
/** Campo do catálogo que precisa estar confirmado como "yes" para o canal. null = sem exigência específica. */
export const CHANNEL_FIELD: Record<ContentChannel, string | null> = {
  blog: "accepts_organic",
  email: "accepts_organic",
  youtube: "accepts_social",
  instagram: "accepts_social",
  tiktok: "accepts_social",
  other: null,
};

export const AD_STATUS = ["draft", "approved", "discarded"] as const;
export type AdStatus = (typeof AD_STATUS)[number];
const AD_TRANSITIONS: Record<AdStatus, readonly AdStatus[]> = { draft: ["approved", "discarded"], approved: ["draft", "discarded"], discarded: ["draft"] };
export const canAdTransition = (from: AdStatus, to: AdStatus) => AD_TRANSITIONS[from].includes(to);

export const adGenerateSchema = z.object({
  programIds: z.array(z.string().min(1)).min(1).max(10),
  channel: z.enum(CONTENT_CHANNELS),
  locale: z.enum(["pt-BR", "en-US", "es"]).default("pt-BR"),
  withModel: z.boolean().default(true),
  /** Link do próprio usuário (afiliado), opcional. */
  userLink: httpUrl.nullish(),
});
export const adPatchSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().min(1).max(1500).optional(),
  userLink: httpUrl.nullish(),
});
export const adStatusSchema = z.object({ status: z.enum(AD_STATUS), acknowledgeUnverified: z.boolean().default(false) });

export type ChannelCheck = "ok" | "unverified" | "blocked" | "none";

/** Estado do campo exigido pelo canal, lido do texto de fatos (só "yes" com valor confirmado conta). */
export function channelCheck(channel: ContentChannel, factsText: string): { check: ChannelCheck; field: string | null } {
  const field = CHANNEL_FIELD[channel];
  if (!field) return { check: "none", field: null };
  const m = new RegExp(`^- ${field}: (\\S+)`, "m").exec(factsText);
  const v = m?.[1] ?? "UNKNOWN";
  if (v === "yes") return { check: "ok", field };
  if (v === "no") return { check: "blocked", field };
  return { check: "unverified", field };
}

const DISCLOSURE: Record<string, string> = {
  "pt-BR": "Divulgação: este conteúdo contém link de afiliado. Posso receber comissão se você comprar ou se cadastrar, sem custo extra para você.",
  "en-US": "Disclosure: this content contains an affiliate link. I may earn a commission if you buy or sign up, at no extra cost to you.",
  es: "Divulgación: este contenido incluye un enlace de afiliado. Puedo recibir una comisión si compras o te registras, sin costo adicional para ti.",
};
const TITLE: Record<string, (n: string) => string> = {
  "pt-BR": (n) => `Conheça ${n}`,
  "en-US": (n) => `Meet ${n}`,
  es: (n) => `Conoce ${n}`,
};
const GENERIC: Record<string, (n: string) => string> = {
  "pt-BR": (n) => `${n} é um programa de afiliados do catálogo. Confira os detalhes no site oficial antes de decidir.`,
  "en-US": (n) => `${n} is an affiliate program from the catalog. Check the details on the official site before deciding.`,
  es: (n) => `${n} es un programa de afiliados del catálogo. Revisa los detalles en el sitio oficial antes de decidir.`,
};

export interface AdCopy {
  title: string;
  description: string;
  disclosure: string;
  /** Link oficial de cadastro, só se confirmado por fonte oficial. */
  officialUrl: string | null;
}

/** Valor confirmado por fonte oficial de um campo, ou null. */
export function confirmedValue(factsText: string, field: string): { value: string; url: string } | null {
  const m = new RegExp(`^- ${field}: (.+?) \\(confirmed by official source (\\S+?)[,)]`, "m").exec(factsText);
  return m ? { value: m[1]!, url: m[2]! } : null;
}

/** Texto determinístico: sempre existe, mesmo sem modelo. Usa só o que o catálogo tem. */
export function buildAdCopy(p: { name: string; description?: string | null }, factsText: string, locale: string): AdCopy {
  const l = DISCLOSURE[locale] ? locale : "pt-BR";
  const desc = p.description?.trim();
  const signup = confirmedValue(factsText, "signup_url");
  return {
    title: TITLE[l]!(p.name).slice(0, 150),
    description: (desc ? desc.slice(0, 400) : GENERIC[l]!(p.name)),
    disclosure: DISCLOSURE[l]!,
    officialUrl: signup && /^https?:\/\//i.test(signup.value) ? signup.value : null,
  };
}

/** Frases que prometem ganho ou eliminam risco. Nunca aprovadas. */
const FORBIDDEN =
  /garantid|garantia de (?:ganho|lucro|renda)|sem risco|risco zero|renda (?:extra )?(?:certa|garantida)|fique rico|enriquec|guaranteed|risk[- ]free|no risk|get rich|passive income guaranteed|ganancia asegurada|sin riesgo|ingresos garantizados|(?:ganhe|earn|gana)\s+(?:até\s+|up to\s+|hasta\s+)?(?:R\$|US\$|\$)/i;
export const adClaimIssues = (text: string) => (FORBIDDEN.test(text) ? ["forbidden_claim"] : []);

/**
 * Conferência para aprovar: sem promessa de ganho e sem número ou link fora do contexto
 * (fatos do catálogo + link e texto que o próprio usuário informou na geração).
 */
export function adApprovalIssues(text: string, context: string): string[] {
  const out = [...adClaimIssues(text)];
  const g = checkGrounding(text, context);
  if (!g.ok) out.push("ungrounded");
  return out;
}

/** Texto final copiável de um rascunho aprovado. */
export function adExportText(d: { title: string; description: string; disclosure: string; link: string | null }): string {
  const cta = d.link ? `\n\n${d.link}` : "";
  return `${d.title}\n\n${d.description}${cta}\n\n${d.disclosure}`;
}
