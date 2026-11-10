import { z } from "zod";
import { APPLICATION_STATUS, COMMISSION_STATUS, type CommissionStatus } from "./statuses";

/** Canais de divulgação e de campanha. Os terminados em "_ads" são tráfego pago. */
export const DISTRIBUTION_CHANNELS = [
  "blog",
  "youtube",
  "instagram",
  "tiktok",
  "pinterest",
  "linkedin",
  "email",
  "seo",
  "organic",
  "google_ads",
  "meta_ads",
  "youtube_ads",
  "pinterest_ads",
  "tiktok_ads",
  "linkedin_ads",
  "other",
] as const;
export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];
export const isPaidChannel = (c: string) => c.endsWith("_ads");

/** De onde veio o registro. Nunca se mistura sem identificar. */
export const ORIGINS = ["manual", "csv", "api", "own_tracking"] as const;
export type Origin = (typeof ORIGINS)[number];
/** Origens que são relatório da rede (não registro próprio). */
export const NETWORK_ORIGINS: readonly Origin[] = ["csv", "api"];

export const CAMPAIGN_STATUS = ["planned", "active", "paused", "ended"] as const;
export const CONVERSION_STATE = ["reported", "confirmed"] as const;
export const ADJUSTMENT_KINDS = ["refund", "cancellation", "chargeback", "adjustment"] as const;

// ---------- Comissões ----------

/** Ciclo financeiro: estimada -> pendente -> aprovada -> paga; rejeitada pode ser reaberta como pendente. */
const TRANSITIONS: Record<CommissionStatus, readonly CommissionStatus[]> = {
  estimated: ["pending", "approved", "rejected"],
  pending: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  paid: [],
  rejected: ["pending"],
};
export const canTransition = (from: CommissionStatus, to: CommissionStatus) => TRANSITIONS[from].includes(to);
export const nextStatuses = (from: CommissionStatus) => TRANSITIONS[from];

/** Valor líquido = valor + ajustes (reembolso, cancelamento e chargeback já entram negativos). */
export function netAmount(amount: number, adjustments: number[]): number {
  return Math.round((amount + adjustments.reduce((a, b) => a + b, 0)) * 100) / 100;
}

// ---------- Conciliação ----------

export interface ReconRow {
  id: string;
  externalRef: string | null;
  amount: number;
  currency: string;
  status: string;
}
export interface ReconResult {
  matched: Array<{ own: ReconRow; report: ReconRow }>;
  amountDiff: Array<{ own: ReconRow; report: ReconRow }>;
  currencyDiff: Array<{ own: ReconRow; report: ReconRow }>;
  statusDiff: Array<{ own: ReconRow; report: ReconRow }>;
  /** Registro próprio com referência que a rede não listou: não confirmado pela rede. */
  missingInReport: ReconRow[];
  /** Registro próprio sem referência: não dá para conciliar. */
  unreferenced: ReconRow[];
  /** A rede listou, mas não há registro próprio. */
  missingInOwn: ReconRow[];
}

const refKey = (r: string | null) => (r ? r.trim().toLowerCase() : "");

/**
 * Compara registros próprios com o relatório da rede, pela referência externa.
 * O relatório da rede é a fonte para confirmar; registro próprio sozinho nunca confirma venda.
 */
export function reconcile(own: ReconRow[], report: ReconRow[]): ReconResult {
  const out: ReconResult = { matched: [], amountDiff: [], currencyDiff: [], statusDiff: [], missingInReport: [], unreferenced: [], missingInOwn: [] };
  const byRef = new Map<string, ReconRow>();
  for (const r of report) if (refKey(r.externalRef)) byRef.set(refKey(r.externalRef), r);
  const used = new Set<string>();
  for (const o of own) {
    const k = refKey(o.externalRef);
    if (!k) {
      out.unreferenced.push(o);
      continue;
    }
    const r = byRef.get(k);
    if (!r) {
      out.missingInReport.push(o);
      continue;
    }
    used.add(k);
    if (o.currency !== r.currency) out.currencyDiff.push({ own: o, report: r });
    else if (Math.abs(o.amount - r.amount) > 0.005) out.amountDiff.push({ own: o, report: r });
    else if (o.status !== r.status) out.statusDiff.push({ own: o, report: r });
    else out.matched.push({ own: o, report: r });
  }
  for (const r of report) if (!used.has(refKey(r.externalRef))) out.missingInOwn.push(r);
  return out;
}

// ---------- Anti-bot ----------

const BOT_RE =
  /bot|crawl|spider|slurp|preview|headless|phantom|curl\/|wget|python-requests|httpclient|okhttp|monitor|pingdom|uptime|facebookexternalhit|embedly|scanner|lighthouse/i;
/** User-Agent vazio ou de robô conhecido: o clique não é contado. */
export const isBotUserAgent = (ua: string | null | undefined) => !ua || ua.length < 8 || BOT_RE.test(ua);

// ---------- Esquemas ----------

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "http(s) only");
const optText = (n: number) => z.string().trim().max(n).nullish();
const ts = z.number().int().positive().nullish();
const money = z.number().min(0).max(1_000_000_000);
const currency = z.string().trim().length(3).toUpperCase();

export const userProgramCreateSchema = z.object({
  programId: z.string().min(1),
  status: z.enum(APPLICATION_STATUS).default("saved"),
});
export const userProgramPatchSchema = z.object({
  status: z.enum(APPLICATION_STATUS).optional(),
  appliedAt: ts,
  approvedAt: ts,
  affiliateId: optText(120),
  acceptedTerms: optText(1000),
  notes: optText(2000),
  nextAction: optText(300),
  nextActionAt: ts,
});
export const userDocSchema = z.object({ title: z.string().trim().min(1).max(120), url: httpUrl });

export const linkSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: httpUrl,
  programId: z.string().min(1).nullish(),
  productId: z.string().min(1).nullish(),
  productName: optText(160),
  campaignId: z.string().min(1).nullish(),
  channel: z.enum(DISTRIBUTION_CHANNELS).default("other"),
  /** Identificador de campanha escolhido pelo usuário (ex.: "black-friday-blog"). */
  campaignTag: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{1,60}$/)
    .nullish(),
  /** "own_redirect" só é aceito se o programa confirmar que permite redirecionamento. */
  trackingMode: z.enum(["none", "own_redirect"]).default("none"),
  active: z.boolean().default(true),
});
export const linkPatchSchema = linkSchema.partial();

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  programId: z.string().min(1).nullish(),
  productName: optText(160),
  channel: z.enum(DISTRIBUTION_CHANNELS),
  keyword: optText(120),
  audience: optText(200),
  budget: money.nullish(),
  adSpend: money.nullish(),
  currency: currency.default("USD"),
  status: z.enum(CAMPAIGN_STATUS).default("planned"),
  startsAt: ts,
  endsAt: ts,
  clicksReported: z.number().int().min(0).max(1_000_000_000).nullish(),
  conversionsReported: z.number().int().min(0).max(100_000_000).nullish(),
  notes: optText(1000),
});
export const campaignPatchSchema = campaignSchema.partial();

export const commissionSchema = z.object({
  programId: z.string().min(1).nullish(),
  linkId: z.string().min(1).nullish(),
  campaignId: z.string().min(1).nullish(),
  productName: optText(160),
  channel: z.enum(DISTRIBUTION_CHANNELS).nullish(),
  amount: money,
  currency,
  /** Começa estimada; nunca nasce aprovada ou paga. */
  occurredAt: z.number().int().positive().optional(),
  externalRef: optText(120),
  conversionState: z.enum(CONVERSION_STATE).default("reported"),
  notes: optText(1000),
});
export const commissionPatchSchema = commissionSchema.partial();
export const commissionStatusSchema = z.object({ status: z.enum(COMMISSION_STATUS), note: optText(300) });
export const adjustmentSchema = z.object({
  kind: z.enum(ADJUSTMENT_KINDS),
  /** Reembolso, cancelamento e chargeback: informe o valor positivo (vira desconto). Ajuste: aceita sinal. */
  amount: z.number().min(-1_000_000_000).max(1_000_000_000),
  note: optText(300),
});
/** Sinal aplicado ao ajuste: só "adjustment" pode somar. */
export const signedAdjustment = (kind: (typeof ADJUSTMENT_KINDS)[number], amount: number) =>
  kind === "adjustment" ? amount : -Math.abs(amount);

export const commissionImportSchema = z.object({
  programId: z.string().min(1),
  csv: z.string().max(500_000),
  dryRun: z.boolean().default(false),
});

/** Mapeia o status do relatório da rede para o ciclo da plataforma. Desconhecido não é aprovado. */
export function mapNetworkStatus(raw: string): CommissionStatus {
  const s = raw.trim().toLowerCase();
  if (["paid", "pago", "paga", "settled", "payed"].includes(s)) return "paid";
  if (["approved", "aprovado", "aprovada", "confirmed", "confirmado", "locked"].includes(s)) return "approved";
  if (["rejected", "rejeitado", "rejeitada", "declined", "reversed", "canceled", "cancelled", "cancelado", "refunded", "chargeback"].includes(s)) return "rejected";
  return "pending";
}
