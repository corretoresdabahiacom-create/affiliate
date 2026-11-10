import { z } from "zod";

/** Segmentos do catálogo. */
export const SEGMENTS = ["physical", "saas", "digital", "services"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const NETWORK_KINDS = ["network", "platform"] as const;
export const OPERATIONAL_STATUS = ["active", "migrating", "closed", "unverified"] as const;

/** Status do link: só "verified" quando uma fonte oficial confirma. */
export const URL_STATUS = ["verified", "unverified", "unavailable"] as const;
export type UrlStatus = (typeof URL_STATUS)[number];

export const LIFECYCLE_STATUS = ["active", "closed", "suspended", "unavailable"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUS)[number];

export const COMMISSION_TYPES = ["percent", "fixed", "tiered", "unknown"] as const;
export const PAYOUT_FREQUENCIES = ["weekly", "biweekly", "monthly", "threshold", "unknown"] as const;

/**
 * Tipos de fonte, do mais ao menos confiável (rank menor = mais confiável).
 * Só os quatro primeiros contam como oficiais e podem confirmar um campo.
 */
export const SOURCE_TYPES = [
  "official_docs",
  "official_page",
  "official_api",
  "official_communication",
  "secondary_reliable",
  "unconfirmed",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const sourceRank = (t: SourceType) => SOURCE_TYPES.indexOf(t);
export const isOfficialSource = (t: SourceType) => sourceRank(t) <= 3;

/** Campos tri-estado de um programa (aceitação). Valor "yes"/"no" exige fonte oficial. */
export const TRI_FIELDS = [
  "accepts_brazil",
  "accepts_individuals",
  "requires_company",
  "requires_website",
  "accepts_social",
  "accepts_paid_traffic",
  "accepts_organic",
  "is_recurring",
] as const;
export type TriField = (typeof TRI_FIELDS)[number];

/** Campos que, ao mudar, exigem fonte oficial que os cubra (além dos tri-estado). */
export const SOURCED_FIELDS = [
  ...TRI_FIELDS,
  "commission_type",
  "commission_percent",
  "commission_fixed",
  "cookie_days",
  "min_payout",
  "payout_frequency",
  "validation_days",
  "signup_url",
  "lifecycle_status",
] as const;

export const VERIFICATION_STATES = [
  "verified_recently",
  "awaiting_update",
  "outdated",
  "divergent",
  "closed",
  "suspended",
  "unavailable",
  "never_verified",
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const DEFAULT_STALE_DAYS = 90;

/**
 * Estado de verificação exibido ao usuário. Funções puras: nada de data implícita.
 * - closed/suspended/unavailable vêm do ciclo de vida e vencem qualquer outro estado;
 * - divergent: um editor marcou conflito entre fontes;
 * - awaiting_update: um editor marcou que a fonte mudou e falta reconferir;
 * - nunca verificado: sem data de verificação;
 * - outdated: verificado há mais de `staleDays`.
 */
export function verificationState(
  p: {
    lifecycleStatus: LifecycleStatus;
    verificationFlag: "none" | "divergent" | "awaiting_update";
    lastVerifiedAt: number | null;
  },
  now: number,
  staleDays = DEFAULT_STALE_DAYS,
): VerificationState {
  if (p.lifecycleStatus !== "active") return p.lifecycleStatus;
  if (p.verificationFlag === "divergent") return "divergent";
  if (p.verificationFlag === "awaiting_update") return "awaiting_update";
  if (p.lastVerifiedAt === null) return "never_verified";
  const ageDays = (now - p.lastVerifiedAt) / 86_400_000;
  return ageDays > staleDays ? "outdated" : "verified_recently";
}

/** Normaliza texto para comparação e deduplicação (sem acento, minúsculo, sem pontuação). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Host de uma URL sem "www." (para deduplicar). */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Chave de deduplicação: mesmo anunciante + mesma rede + mesmo nome de programa. */
export function dedupeKey(advertiserId: string, networkId: string | null, programName: string): string {
  return `${advertiserId}|${networkId ?? "direct"}|${normalizeName(programName)}`;
}

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "http(s) only");
const optUrl = httpUrl.nullish();
const optText = (max: number) => z.string().trim().max(max).nullish();
const tri = z.enum(["yes", "no", "unverified"]).default("unverified");

export const networkSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(NETWORK_KINDS).default("network"),
  websiteUrl: optUrl,
  websiteUrlStatus: z.enum(URL_STATUS).default("unverified"),
  operationalStatus: z.enum(OPERATIONAL_STATUS).default("unverified"),
  notes: optText(2000),
});
export type NetworkInput = z.infer<typeof networkSchema>;

export const advertiserSchema = z.object({
  name: z.string().trim().min(1).max(160),
  websiteUrl: optUrl,
  country: z.string().trim().length(2).toUpperCase().nullish(),
  notes: optText(2000),
});
export type AdvertiserInput = z.infer<typeof advertiserSchema>;

export const categorySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]+$/)
    .max(60),
  segment: z.enum(SEGMENTS),
  namePt: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  nameEs: z.string().trim().min(1).max(80),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const programSchema = z.object({
  advertiserId: z.string().min(1),
  networkId: z.string().min(1).nullish(),
  categoryId: z.string().min(1).nullish(),
  name: z.string().trim().min(1).max(160),
  segment: z.enum(SEGMENTS),
  description: optText(2000),

  acceptsBrazil: tri,
  acceptsIndividuals: tri,
  requiresCompany: tri,
  requiresWebsite: tri,
  acceptsSocial: tri,
  acceptsPaidTraffic: tri,
  acceptsOrganic: tri,

  commissionType: z.enum(COMMISSION_TYPES).default("unknown"),
  commissionPercent: z.number().min(0).max(100).nullish(),
  commissionFixed: z.number().min(0).max(1_000_000).nullish(),
  currency: z.string().trim().length(3).toUpperCase().nullish(),
  isRecurring: tri,
  recurringDurationMonths: z.number().int().min(1).max(600).nullish(),
  cookieDays: z.number().int().min(0).max(3650).nullish(),
  attributionModel: optText(80),
  minPayout: z.number().min(0).max(10_000_000).nullish(),
  payoutCurrency: z.string().trim().length(3).toUpperCase().nullish(),
  payoutFrequency: z.enum(PAYOUT_FREQUENCIES).default("unknown"),
  payoutMethods: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  validationDays: z.number().int().min(0).max(3650).nullish(),
  refundPolicy: optText(1000),
  approvalRequirements: optText(1000),
  promoRestrictions: optText(1000),

  officialUrl: optUrl,
  signupUrl: optUrl,
  signupUrlStatus: z.enum(URL_STATUS).default("unverified"),
  docsUrl: optUrl,
  lifecycleStatus: z.enum(LIFECYCLE_STATUS).default("active"),
});
export type ProgramInput = z.infer<typeof programSchema>;

export const programPatchSchema = programSchema.partial();

export const sourceSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  /** Campo coberto pela fonte; vazio = a fonte cobre o programa de modo geral. */
  field: z.enum(SOURCED_FIELDS).nullish(),
  url: httpUrl,
  consultedAt: z.number().int().positive().optional(),
  confirmedAt: z.number().int().positive().nullish(),
  note: optText(500),
});
export type SourceInput = z.infer<typeof sourceSchema>;

export const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  url: optUrl,
  description: optText(1000),
});
export const offerSchema = z.object({
  title: z.string().trim().min(1).max(160),
  details: optText(1000),
  url: optUrl,
  startsAt: z.number().int().positive().nullish(),
  endsAt: z.number().int().positive().nullish(),
});

export const verifyActionSchema = z.object({
  /** "verify" marca como verificado; "flag_divergent"/"flag_awaiting" sinalizam; "clear_flag" limpa. */
  action: z.enum(["verify", "flag_divergent", "flag_awaiting", "clear_flag"]),
  note: optText(500),
});

export const statusChangeSchema = z.object({
  lifecycleStatus: z.enum(LIFECYCLE_STATUS),
  note: optText(500),
});

/** Linha do CSV de importação (cabeçalhos em inglês, valores livres validados no servidor). */
export const CSV_COLUMNS = [
  "advertiser",
  "advertiser_url",
  "network",
  "program",
  "segment",
  "category",
  "official_url",
  "signup_url",
  "docs_url",
] as const;
