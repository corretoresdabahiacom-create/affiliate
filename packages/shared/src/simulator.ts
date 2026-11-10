import { z } from "zod";

/**
 * Simulador financeiro. Todo resultado é uma SIMULAÇÃO baseada nos números informados pelo usuário;
 * não é previsão nem promessa de ganho.
 */

const money = z.number().min(0).max(1_000_000_000);
const pct = z.number().min(0).max(100);

const common = {
  productPrice: money.refine((v) => v > 0, "must_be_positive"),
  /** Percentual do preço que o afiliado recebe por venda. */
  commissionPercent: pct.optional(),
  /** Comissão fixa por venda (use este OU o percentual). */
  commissionFixed: money.optional(),
  trafficCostMonthly: money.default(0),
  contentCostMonthly: money.default(0),
};

export const simInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("clicks"), clicksMonthly: z.number().min(0).max(1_000_000_000), conversionPercent: pct, ...common }),
  z.object({ mode: z.literal("sales"), salesMonthly: z.number().min(0).max(100_000_000), ...common }),
  z.object({ mode: z.literal("goal"), goalMonthly: money.refine((v) => v > 0, "must_be_positive"), conversionPercent: pct.optional(), ...common }),
]);
export type SimInput = z.infer<typeof simInputSchema>;

export interface SimResult {
  isSimulation: true;
  commissionPerSale: number;
  salesMonthly: number;
  clicksMonthly: number | null;
  salesValueMonthly: number;
  commissionMonthly: number;
  commissionAnnual: number;
  costMonthly: number;
  profitMonthly: number;
  profitAnnual: number;
  /** Lucro / custo; null quando não há custo informado. */
  roi: number | null;
  /** Vendas por mês para cobrir os custos; null se a comissão por venda for zero. */
  breakEvenSales: number | null;
}

export type SimError = "commission_required" | "conversion_required" | "commission_zero";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function simulate(input: SimInput): SimResult | { error: SimError } {
  const hasPct = input.commissionPercent !== undefined;
  const hasFix = input.commissionFixed !== undefined;
  if (!hasPct && !hasFix) return { error: "commission_required" };
  const perSale = hasFix ? (input.commissionFixed as number) : (input.productPrice * (input.commissionPercent as number)) / 100;
  if (perSale <= 0 && input.mode === "goal") return { error: "commission_zero" };

  const cost = (input.trafficCostMonthly ?? 0) + (input.contentCostMonthly ?? 0);
  let sales: number;
  let clicks: number | null = null;

  if (input.mode === "clicks") {
    sales = (input.clicksMonthly * input.conversionPercent) / 100;
    clicks = input.clicksMonthly;
  } else if (input.mode === "sales") {
    sales = input.salesMonthly;
  } else {
    // Meta financeira: vendas inteiras necessárias (arredonda para cima)
    sales = Math.ceil(input.goalMonthly / perSale);
    if (input.conversionPercent !== undefined) {
      if (input.conversionPercent <= 0) return { error: "conversion_required" };
      clicks = Math.ceil(sales / (input.conversionPercent / 100));
    }
  }

  const commission = sales * perSale;
  const profit = commission - cost;
  return {
    isSimulation: true,
    commissionPerSale: r2(perSale),
    salesMonthly: r2(sales),
    clicksMonthly: clicks === null ? null : Math.ceil(clicks),
    salesValueMonthly: r2(sales * input.productPrice),
    commissionMonthly: r2(commission),
    commissionAnnual: r2(commission * 12),
    costMonthly: r2(cost),
    profitMonthly: r2(profit),
    profitAnnual: r2(profit * 12),
    roi: cost > 0 ? r2(profit / cost) : null,
    breakEvenSales: perSale > 0 ? Math.ceil(cost / perSale) : null,
  };
}

// ---------- SaaS recorrente ----------

export const recurringInputSchema = z
  .object({
    subscribers: z.number().int().min(0).max(10_000_000),
    monthlyPrice: money.refine((v) => v > 0, "must_be_positive"),
    commissionPercent: pct,
    /** Meses de recorrência segundo as regras oficiais. Obrigatório, salvo se lifetimeConfirmed. */
    durationMonths: z.number().int().min(1).max(600).optional(),
    /** O usuário confirma que as regras oficiais pagam enquanto o cliente continuar assinando. */
    lifetimeConfirmed: z.boolean().default(false),
    monthlyChurnPercent: pct,
    /** Dias de validação antes de a comissão ser liberada. */
    validationDays: z.number().int().min(0).max(3650).default(0),
    horizonMonths: z.number().int().min(1).max(120).default(12),
  })
  .refine((v) => v.lifetimeConfirmed || v.durationMonths !== undefined, { message: "duration_required", path: ["durationMonths"] });
export type RecurringInput = z.infer<typeof recurringInputSchema>;

export interface RecurringScenario {
  churnPercent: number;
  /** Comissão gerada em cada mês (1..horizonte). */
  earnedByMonth: number[];
  /** Total gerado no horizonte. */
  earnedTotal: number;
  /** Total já liberado no horizonte, considerando a validação. */
  releasedTotal: number;
  activeAtEnd: number;
}
export interface RecurringResult {
  isSimulation: true;
  recurrenceBasis: "limited" | "lifetime_confirmed_by_user";
  validationDelayMonths: number;
  scenarios: { none: RecurringScenario; base: RecurringScenario; high: RecurringScenario };
}

function runScenario(i: RecurringInput, churn: number): RecurringScenario {
  const delay = Math.ceil(i.validationDays / 30);
  const limit = i.lifetimeConfirmed ? Infinity : (i.durationMonths as number);
  const earned: number[] = [];
  let active = i.subscribers;
  for (let m = 1; m <= i.horizonMonths; m++) {
    const gen = m <= limit ? active * i.monthlyPrice * (i.commissionPercent / 100) : 0;
    earned.push(r2(gen));
    active = active * (1 - churn / 100);
  }
  const earnedTotal = earned.reduce((a, b) => a + b, 0);
  // A comissão do mês m só é liberada depois da validação.
  const released = earned.slice(0, Math.max(0, i.horizonMonths - delay)).reduce((a, b) => a + b, 0);
  return { churnPercent: churn, earnedByMonth: earned, earnedTotal: r2(earnedTotal), releasedTotal: r2(released), activeAtEnd: Math.round(active * 100) / 100 };
}

export function simulateRecurring(i: RecurringInput): RecurringResult {
  return {
    isSimulation: true,
    recurrenceBasis: i.lifetimeConfirmed ? "lifetime_confirmed_by_user" : "limited",
    validationDelayMonths: Math.ceil(i.validationDays / 30),
    scenarios: {
      none: runScenario(i, 0),
      base: runScenario(i, i.monthlyChurnPercent),
      high: runScenario(i, Math.min(100, i.monthlyChurnPercent * 2)),
    },
  };
}
