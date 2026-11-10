import { z } from "zod";
import { verificationState } from "./catalog";

/** Subconjunto de um programa do catálogo (formato devolvido pela API). */
export interface ProgramLike {
  segment: string;
  acceptsBrazil: Tri;
  acceptsIndividuals: Tri;
  requiresCompany: Tri;
  requiresWebsite: Tri;
  acceptsSocial: Tri;
  acceptsPaidTraffic: Tri;
  acceptsOrganic: Tri;
  isRecurring: Tri;
  recurringDurationMonths: number | null;
  commissionType: string;
  commissionPercent: number | null;
  commissionFixed: number | null;
  cookieDays: number | null;
  minPayout: number | null;
  payoutCurrency: string | null;
  payoutFrequency: string;
  validationDays: number | null;
  officialUrl: string | null;
  signupUrlStatus: string;
  lifecycleStatus: string;
  verificationFlag: string;
  lastVerifiedAt: number | null;
}
type Tri = "yes" | "no" | "unverified";

export interface ProfileLike {
  country: string | null;
  niches: string[];
  channels: string[];
  hasWebsite: boolean;
  wantsRecurring: boolean;
  acceptsPaidTraffic: boolean;
}

// ---------- Configuração (editável pelo administrador) ----------

export const CRITERIA = [
  "commission",
  "recurrence",
  "cookie",
  "reputation",
  "brazil",
  "ease",
  "payout_methods",
  "min_payout",
  "demand",
  "conversion",
  "competition",
  "content_potential",
  "profile_fit",
] as const;
export type Criterion = (typeof CRITERIA)[number];

/** Critérios para os quais o catálogo ainda não tem nenhum dado: nunca são avaliados nem inventados. */
export const NO_DATA_CRITERIA: readonly Criterion[] = ["reputation", "demand", "conversion", "competition", "content_potential"];

export const BANDS = ["excellent", "good", "moderate", "low", "insufficient"] as const;
export type Band = (typeof BANDS)[number];

export const scoringConfigSchema = z.object({
  weights: z.object(Object.fromEntries(CRITERIA.map((c) => [c, z.number().min(0).max(100)])) as Record<Criterion, z.ZodNumber>),
  /** Pontuação mínima de cada faixa (a faixa "insufficient" começa em 0). */
  bands: z
    .object({
      excellent: z.number().min(0).max(100),
      good: z.number().min(0).max(100),
      moderate: z.number().min(0).max(100),
      low: z.number().min(0).max(100),
    })
    .refine((b) => b.excellent > b.good && b.good > b.moderate && b.moderate > b.low && b.low > 0, "bands_must_descend"),
  thresholds: z.object({
    commissionPercentFull: z.number().min(1).max(100),
    cookieDaysFull: z.number().int().min(1).max(3650),
    recurrenceMonthsFull: z.number().int().min(1).max(600),
  }),
  /** Abaixo desta qualidade de dados, a atratividade fica limitada à faixa "moderate". */
  minQualityForTopBands: z.number().min(0).max(100),
  /** Tráfego pago sem permissão confirmada: bloquear a recomendação de execução ou só avisar. */
  paidTrafficPolicy: z.enum(["block", "warn"]),
});
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const DEFAULT_SCORING: ScoringConfig = {
  weights: {
    commission: 18,
    recurrence: 14,
    cookie: 8,
    reputation: 6,
    brazil: 12,
    ease: 8,
    payout_methods: 4,
    min_payout: 4,
    demand: 5,
    conversion: 5,
    competition: 4,
    content_potential: 4,
    profile_fit: 12,
  },
  bands: { excellent: 85, good: 70, moderate: 50, low: 30 },
  thresholds: { commissionPercentFull: 40, cookieDaysFull: 60, recurrenceMonthsFull: 24 },
  minQualityForTopBands: 40,
  paidTrafficPolicy: "block",
};

/** Mescla uma configuração parcial salva com os padrões; valor inválido volta ao padrão. */
export function resolveScoringConfig(saved: unknown): ScoringConfig {
  const merged = {
    ...DEFAULT_SCORING,
    ...(saved && typeof saved === "object" ? (saved as object) : {}),
  };
  const parsed = scoringConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SCORING;
}

export function bandFor(score: number, cfg: ScoringConfig): Band {
  if (score >= cfg.bands.excellent) return "excellent";
  if (score >= cfg.bands.good) return "good";
  if (score >= cfg.bands.moderate) return "moderate";
  if (score >= cfg.bands.low) return "low";
  return "insufficient";
}

// ---------- Qualidade dos dados ----------

export interface QualityResult {
  score: number; // 0-100
  confirmed: string[];
  missing: string[];
}

const known = (v: Tri) => v !== "unverified";

/**
 * Quanto a plataforma sabe e consegue comprovar. A API só grava "sim"/"não" e valores comerciais com fonte
 * oficial do mesmo campo, então valor conhecido = confirmado. Programa fechado vale 0; divergência reduz.
 */
export function dataQuality(
  p: ProgramLike,
  ctx: { officialSources: number; now: number; staleDays: number },
): QualityResult {
  const checks: Array<[string, number, boolean]> = [
    ["accepts_brazil", 2, known(p.acceptsBrazil)],
    ["accepts_individuals", 1, known(p.acceptsIndividuals)],
    ["requires_company", 1, known(p.requiresCompany)],
    ["requires_website", 1, known(p.requiresWebsite)],
    ["accepts_social", 1, known(p.acceptsSocial)],
    ["accepts_paid_traffic", 1, known(p.acceptsPaidTraffic)],
    ["accepts_organic", 1, known(p.acceptsOrganic)],
    ["is_recurring", 2, known(p.isRecurring)],
    ["commission", 3, p.commissionType !== "unknown" && (p.commissionPercent !== null || p.commissionFixed !== null)],
    ["cookie_days", 1.5, p.cookieDays !== null],
    ["min_payout", 1, p.minPayout !== null],
    ["payout_frequency", 1, p.payoutFrequency !== "unknown"],
    ["validation_days", 1, p.validationDays !== null],
    ["signup_url", 2, p.signupUrlStatus === "verified"],
    ["official_url", 1, !!p.officialUrl],
    ["official_source", 3, ctx.officialSources >= 1],
  ];
  const state = verificationState(
    { lifecycleStatus: p.lifecycleStatus as never, verificationFlag: p.verificationFlag as never, lastVerifiedAt: p.lastVerifiedAt },
    ctx.now,
    ctx.staleDays,
  );
  const freshness: Record<string, number> = { verified_recently: 1, awaiting_update: 0.4, outdated: 0.3, divergent: 0.2 };
  const freshW = 3;
  const total = checks.reduce((s, c) => s + c[1], 0) + freshW;
  const earned = checks.reduce((s, c) => s + (c[2] ? c[1] : 0), 0) + freshW * (freshness[state] ?? 0);
  let score = (earned / total) * 100;
  if (state === "divergent") score *= 0.7;
  if (state === "closed" || state === "suspended" || state === "unavailable") score = 0;
  const missing = checks.filter((c) => !c[2]).map((c) => c[0]);
  if (state === "never_verified" || state === "outdated" || state === "awaiting_update" || state === "divergent") missing.push("verification");
  return {
    score: Math.round(score),
    confirmed: checks.filter((c) => c[2]).map((c) => c[0]),
    missing,
  };
}

// ---------- Atratividade comercial ----------

export type ItemStatus = "confirmed" | "interpretation" | "unverified" | "no_data";
export interface ExplanationItem {
  criterion: Criterion;
  status: ItemStatus;
  /** Nota 0-1 do critério; null quando não foi avaliado. */
  value: number | null;
  weight: number;
  code: string;
  params?: Record<string, string | number>;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const NICHE_SEGMENT: Record<string, string> = {
  saas: "saas",
  ai_tools: "saas",
  physical_products: "physical",
  digital_products: "digital",
  services: "services",
};

export type Availability = "confirmed" | "denied" | "unverified";
export interface Warning {
  code: "paid_traffic_not_confirmed" | "paid_traffic_forbidden" | "website_required" | "company_required" | "country_unverified";
  severity: "blocker" | "warning";
}

export interface ScoreResult {
  quality: QualityResult;
  attractiveness: {
    score: number;
    raw: number;
    coverage: number; // 0-1: peso dos critérios avaliados / peso total
    band: Band;
    capped: boolean;
    items: ExplanationItem[];
  };
  /** Disponibilidade para o país do usuário. Só há dado de aceitação para o Brasil. */
  availability: Availability;
  warnings: Warning[];
}

export function scoreProgram(
  p: ProgramLike,
  profile: ProfileLike | null,
  cfg: ScoringConfig,
  ctx: { officialSources: number; now: number; staleDays: number },
): ScoreResult {
  const quality = dataQuality(p, ctx);
  const w = cfg.weights;
  const items: ExplanationItem[] = [];
  const add = (
    criterion: Criterion,
    status: ItemStatus,
    value: number | null,
    code: string,
    params?: Record<string, string | number>,
  ) => items.push({ criterion, status, value, weight: w[criterion], code, params });

  // Comissão
  if (p.commissionType === "percent" && p.commissionPercent !== null) {
    add("commission", "confirmed", clamp01(p.commissionPercent / cfg.thresholds.commissionPercentFull), "commission_percent", {
      value: p.commissionPercent,
    });
  } else if ((p.commissionType === "fixed" || p.commissionType === "tiered") && (p.commissionFixed !== null || p.commissionType === "tiered")) {
    add("commission", "interpretation", null, "commission_not_comparable"); // valor fixo/escalonado não compara com %
  } else add("commission", "unverified", null, "unverified_field");

  // Recorrência: nunca presumida
  if (p.isRecurring === "yes") {
    const m = p.recurringDurationMonths;
    add("recurrence", "confirmed", m === null ? 0.7 : 0.7 + 0.3 * clamp01(m / cfg.thresholds.recurrenceMonthsFull), m === null ? "recurrence_yes_unknown_duration" : "recurrence_yes", {
      months: m ?? 0,
    });
  } else if (p.isRecurring === "no") add("recurrence", "confirmed", 0, "recurrence_no");
  else add("recurrence", "unverified", null, "unverified_field");

  // Cookie
  if (p.cookieDays !== null) {
    add("cookie", "confirmed", clamp01(p.cookieDays / cfg.thresholds.cookieDaysFull), "cookie_days", { days: p.cookieDays });
  } else add("cookie", "unverified", null, "unverified_field");

  // Brasileiros: nunca presumido
  if (p.acceptsBrazil === "yes") add("brazil", "confirmed", 1, "brazil_yes");
  else if (p.acceptsBrazil === "no") add("brazil", "confirmed", 0, "brazil_no");
  else add("brazil", "unverified", null, "unverified_field");

  // Facilidade de inscrição, derivada só do que está confirmado
  const easeKnown = [p.requiresCompany, p.requiresWebsite, p.acceptsIndividuals].some(known);
  if (easeKnown) {
    let e = 1;
    if (p.requiresCompany === "yes") e -= 0.4;
    if (p.requiresWebsite === "yes") e -= 0.2;
    if (p.acceptsIndividuals === "no") e -= 0.3;
    add("ease", "interpretation", clamp01(e), "ease_derived");
  } else add("ease", "unverified", null, "unverified_field");

  // Pagamento
  const freq: Record<string, number> = { weekly: 1, biweekly: 0.8, monthly: 0.6, threshold: 0.5 };
  if (p.payoutFrequency !== "unknown") {
    add("payout_methods", "confirmed", freq[p.payoutFrequency] ?? 0.5, "payout_frequency", { value: p.payoutFrequency });
  } else add("payout_methods", "unverified", null, "unverified_field");

  // Valor mínimo: só moedas comparáveis entre si; as demais não são avaliadas
  const refMoney = ["USD", "EUR", "GBP"];
  if (p.minPayout !== null && p.payoutCurrency && refMoney.includes(p.payoutCurrency)) {
    const v = p.minPayout <= 50 ? 1 : p.minPayout <= 100 ? 0.7 : p.minPayout <= 250 ? 0.4 : 0.2;
    add("min_payout", "confirmed", v, "min_payout", { value: p.minPayout, currency: p.payoutCurrency });
  } else if (p.minPayout !== null) add("min_payout", "interpretation", null, "min_payout_currency_not_scored");
  else add("min_payout", "unverified", null, "unverified_field");

  for (const c of NO_DATA_CRITERIA) add(c, "no_data", null, "no_data_source");

  // Adequação ao perfil
  const warnings: Warning[] = [];
  if (profile) {
    const parts: number[] = [];
    const niche = profile.niches.length > 0 ? profile.niches.some((n) => NICHE_SEGMENT[n] === p.segment) : null;
    if (niche !== null) parts.push(niche ? 1 : 0.2);
    if (p.requiresWebsite === "yes") {
      parts.push(profile.hasWebsite ? 1 : 0);
      if (!profile.hasWebsite) warnings.push({ code: "website_required", severity: "warning" });
    } else if (p.requiresWebsite === "no") parts.push(1); // não exige site quando aceita outros canais
    if (profile.wantsRecurring && known(p.isRecurring)) parts.push(p.isRecurring === "yes" ? 1 : 0.2);
    if (parts.length > 0) {
      const v = parts.reduce((a, b) => a + b, 0) / parts.length;
      add("profile_fit", "interpretation", v, niche === false ? "fit_niche_miss" : "fit_ok");
    } else add("profile_fit", "unverified", null, "fit_no_profile_data");
    if (profile.acceptsPaidTraffic) {
      if (p.acceptsPaidTraffic === "no") warnings.push({ code: "paid_traffic_forbidden", severity: "blocker" });
      else if (p.acceptsPaidTraffic === "unverified")
        warnings.push({ code: "paid_traffic_not_confirmed", severity: cfg.paidTrafficPolicy === "block" ? "blocker" : "warning" });
    }
    if (p.requiresCompany === "yes") warnings.push({ code: "company_required", severity: "warning" });
  } else add("profile_fit", "unverified", null, "fit_no_profile");

  // Pontuação: só critérios avaliados entram; a cobertura derruba a nota
  const assessed = items.filter((i) => i.value !== null);
  const wAssessed = assessed.reduce((s, i) => s + i.weight, 0);
  const wAll = items.reduce((s, i) => s + i.weight, 0);
  const coverage = wAll === 0 ? 0 : wAssessed / wAll;
  const raw = wAssessed === 0 ? 0 : (assessed.reduce((s, i) => s + i.weight * (i.value as number), 0) / wAssessed) * 100;
  let score = raw * (0.5 + 0.5 * coverage);
  // Adequação ao perfil sozinha não é dado do programa: sem nenhum critério confirmado/derivado do catálogo, nota 0.
  const dataAssessed = assessed.filter((i) => i.criterion !== "profile_fit").length;
  if (dataAssessed === 0 || p.lifecycleStatus !== "active") score = 0;
  let capped = false;
  const cap = cfg.bands.good - 1; // limite da faixa "moderate"
  if (quality.score < cfg.minQualityForTopBands && score > cap) {
    score = cap;
    capped = true;
  }
  score = Math.round(score);

  // Disponibilidade: só o Brasil tem dado de aceitação no catálogo
  let availability: Availability = "unverified";
  if (profile?.country === "BR") availability = p.acceptsBrazil === "yes" ? "confirmed" : p.acceptsBrazil === "no" ? "denied" : "unverified";
  if (availability === "unverified") warnings.push({ code: "country_unverified", severity: "warning" });

  return {
    quality,
    attractiveness: { score, raw: Math.round(raw), coverage: Math.round(coverage * 100) / 100, band: bandFor(score, cfg), capped, items },
    availability,
    warnings,
  };
}

// ---------- Alertas ----------

export const ALERT_CATEGORIES = [
  "new_programs",
  "new_products",
  "commission_changes",
  "rule_changes",
  "recurring",
  "now_accepts_brazil",
  "closed",
  "broken_links",
  "discontinued_products",
  "outdated",
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export const ALERT_FREQUENCIES = ["instant", "daily", "weekly"] as const;

export const alertPrefsSchema = z.object({
  categories: z.array(z.enum(ALERT_CATEGORIES)).max(ALERT_CATEGORIES.length),
  frequency: z.enum(ALERT_FREQUENCIES),
});
export type AlertPrefs = z.infer<typeof alertPrefsSchema>;
