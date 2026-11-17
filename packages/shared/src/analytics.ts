/**
 * Cálculos de indicadores, receita e limites. Funções puras: nada aqui lê banco ou relógio.
 * Regras de honestidade: indicador sem base de cálculo é `null` (nunca zero nem infinito),
 * e moedas diferentes nunca são somadas nem comparadas.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Retorno sobre o investimento: (resultado - custo) / custo. Sem custo informado, não existe ROI. */
export function roi(result: number, spend: number | null | undefined): number | null {
  if (spend == null || !(spend > 0)) return null;
  return r2(((result - spend) / spend) * 100) / 100;
}

/** Ganho por clique. Sem cliques medidos, não existe EPC. */
export function epc(result: number, clicks: number): number | null {
  return clicks > 0 ? Math.round((result / clicks) * 10_000) / 10_000 : null;
}

/** Taxa em fração (0–1). Sem base, null. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}

export const money2 = r2;

/** Soma meses no calendário UTC; dia 31 + 1 mês cai no último dia do mês seguinte. */
export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const day = d.getUTCDate();
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  const last = new Date(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 0)).getUTCDate();
  return t + (Math.min(day, last) - 1) * 86_400_000;
}

export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export function agingBucket(days: number): AgingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/** Célula de CSV segura: aspas escapadas e proteção contra injeção de fórmula em planilhas. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = typeof v === "number" ? String(v) : String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/**
 * Limite do plano: chave ausente = ilimitado; 0 = recurso desligado.
 * Retorna null para ilimitado.
 */
export function planLimit(limits: Record<string, number> | null | undefined, key: string): number | null {
  const v = limits?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export const withinLimit = (limit: number | null, used: number) => limit === null || used < limit;

/** Chaves de limite reconhecidas pelo sistema (o administrador define os valores por plano). */
export const PLAN_LIMIT_KEYS = ["savedPrograms", "links", "campaigns", "aiRequestsMonthly", "reports"] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const SUBSCRIPTION_STATUSES = ["incomplete", "trialing", "active", "past_due", "canceled", "expired"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
