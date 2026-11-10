import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCORING,
  bandFor,
  dataQuality,
  recurringInputSchema,
  resolveScoringConfig,
  scoreProgram,
  simInputSchema,
  simulate,
  simulateRecurring,
  type ProgramLike,
} from "./index";

const DAY = 86_400_000;
const now = 1_000 * DAY;
const ctx = (o = {}) => ({ officialSources: 0, now, staleDays: 90, ...o });
const empty = (): ProgramLike => ({
  segment: "saas", acceptsBrazil: "unverified", acceptsIndividuals: "unverified", requiresCompany: "unverified",
  requiresWebsite: "unverified", acceptsSocial: "unverified", acceptsPaidTraffic: "unverified", acceptsOrganic: "unverified",
  isRecurring: "unverified", recurringDurationMonths: null, commissionType: "unknown", commissionPercent: null, commissionFixed: null,
  cookieDays: null, minPayout: null, payoutCurrency: null, payoutFrequency: "unknown", validationDays: null, officialUrl: null,
  signupUrlStatus: "unverified", lifecycleStatus: "active", verificationFlag: "none", lastVerifiedAt: null,
});
const full = (): ProgramLike => ({
  ...empty(), acceptsBrazil: "yes", acceptsIndividuals: "yes", requiresCompany: "no", requiresWebsite: "no", acceptsSocial: "yes",
  acceptsPaidTraffic: "yes", acceptsOrganic: "yes", isRecurring: "yes", recurringDurationMonths: 24, commissionType: "percent",
  commissionPercent: 40, cookieDays: 60, minPayout: 20, payoutCurrency: "USD", payoutFrequency: "weekly", validationDays: 30,
  officialUrl: "https://x.example.com", signupUrlStatus: "verified", lastVerifiedAt: now - DAY,
});
const profile = { country: "BR", niches: ["saas"], channels: ["blog"], hasWebsite: true, wantsRecurring: true, acceptsPaidTraffic: false };

describe("qualidade dos dados", () => {
  it("programa vazio = zero; programa completo e recém-verificado = 100", () => {
    expect(dataQuality(empty(), ctx()).score).toBe(0);
    expect(dataQuality(full(), ctx({ officialSources: 2 })).score).toBe(100);
  });
  it("lista o que falta confirmar", () => {
    const q = dataQuality(empty(), ctx());
    expect(q.missing).toContain("accepts_brazil");
    expect(q.missing).toContain("official_source");
    expect(q.missing).toContain("verification");
  });
  it("divergência reduz e encerrado zera", () => {
    const f = { ...full(), verificationFlag: "divergent" };
    expect(dataQuality(f, ctx({ officialSources: 2 })).score).toBeLessThan(dataQuality(full(), ctx({ officialSources: 2 })).score);
    expect(dataQuality(f, ctx({ officialSources: 2 })).score).toBeLessThan(70);
    expect(dataQuality({ ...full(), lifecycleStatus: "closed" }, ctx({ officialSources: 2 })).score).toBe(0);
  });
  it("dado velho perde pontos", () => {
    const old = { ...full(), lastVerifiedAt: now - 200 * DAY };
    expect(dataQuality(old, ctx({ officialSources: 1 })).score).toBeLessThan(dataQuality(full(), ctx({ officialSources: 1 })).score);
  });
});

describe("atratividade", () => {
  it("programa sem dados não recebe nota alta: nada avaliado = 0 e faixa de dados insuficientes", () => {
    const r = scoreProgram(empty(), profile, DEFAULT_SCORING, ctx());
    expect(r.attractiveness.band).toBe("insufficient");
    expect(r.attractiveness.score).toBe(0);
  });
  it("critérios sem fonte de dados nunca são avaliados, mesmo no programa completo", () => {
    const r = scoreProgram(full(), profile, DEFAULT_SCORING, ctx({ officialSources: 2 }));
    const noData = r.attractiveness.items.filter((i) => i.status === "no_data");
    expect(noData.map((i) => i.criterion).sort()).toEqual(["competition", "content_potential", "conversion", "demand", "reputation"]);
    expect(noData.every((i) => i.value === null)).toBe(true);
    expect(r.attractiveness.coverage).toBeLessThan(1);
  });
  it("programa completo e verificado fica em faixa alta, sem passar de 100", () => {
    const r = scoreProgram(full(), profile, DEFAULT_SCORING, ctx({ officialSources: 2 }));
    expect(r.attractiveness.score).toBeGreaterThanOrEqual(70);
    expect(r.attractiveness.score).toBeLessThanOrEqual(100);
  });
  it("baixa qualidade de dados limita a faixa a 'moderada'", () => {
    const p = { ...empty(), commissionType: "percent", commissionPercent: 40, acceptsBrazil: "yes" as const, isRecurring: "yes" as const, cookieDays: 90 };
    const r = scoreProgram(p, profile, { ...DEFAULT_SCORING, minQualityForTopBands: 90 }, ctx());
    expect(r.attractiveness.score).toBeLessThanOrEqual(69);
    expect(r.attractiveness.capped).toBe(true);
  });
  it("recorrência nunca é presumida: não verificado fica sem nota", () => {
    const r = scoreProgram(empty(), profile, DEFAULT_SCORING, ctx());
    const rec = r.attractiveness.items.find((i) => i.criterion === "recurrence")!;
    expect(rec.status).toBe("unverified");
    expect(rec.value).toBeNull();
  });
  it("comissão fixa não é comparada a percentual", () => {
    const r = scoreProgram({ ...empty(), commissionType: "fixed", commissionFixed: 50 }, profile, DEFAULT_SCORING, ctx());
    expect(r.attractiveness.items.find((i) => i.criterion === "commission")!.value).toBeNull();
  });
  it("programa encerrado tem nota zero", () => {
    expect(scoreProgram({ ...full(), lifecycleStatus: "closed" }, profile, DEFAULT_SCORING, ctx({ officialSources: 1 })).attractiveness.score).toBe(0);
  });
  it("pesos configuráveis mudam o resultado", () => {
    const heavy = { ...DEFAULT_SCORING, weights: { ...DEFAULT_SCORING.weights, commission: 100 } };
    const p = { ...empty(), commissionType: "percent", commissionPercent: 40 };
    const a = scoreProgram(p, profile, DEFAULT_SCORING, ctx()).attractiveness.score;
    const b = scoreProgram(p, profile, heavy, ctx()).attractiveness.score;
    expect(b).toBeGreaterThan(a);
  });
});

describe("compatibilidade e avisos", () => {
  it("BR: só 'sim' confirmado é disponível; não verificado nunca", () => {
    expect(scoreProgram(full(), profile, DEFAULT_SCORING, ctx()).availability).toBe("confirmed");
    expect(scoreProgram(empty(), profile, DEFAULT_SCORING, ctx()).availability).toBe("unverified");
    expect(scoreProgram({ ...empty(), acceptsBrazil: "no" }, profile, DEFAULT_SCORING, ctx()).availability).toBe("denied");
  });
  it("outro país: sem dado de aceitação, fica não verificado", () => {
    expect(scoreProgram(full(), { ...profile, country: "PT" }, DEFAULT_SCORING, ctx()).availability).toBe("unverified");
  });
  it("tráfego pago sem permissão confirmada bloqueia ou avisa conforme a política", () => {
    const wants = { ...profile, acceptsPaidTraffic: true };
    const block = scoreProgram(empty(), wants, DEFAULT_SCORING, ctx());
    expect(block.warnings.find((w) => w.code === "paid_traffic_not_confirmed")!.severity).toBe("blocker");
    const warn = scoreProgram(empty(), wants, { ...DEFAULT_SCORING, paidTrafficPolicy: "warn" }, ctx());
    expect(warn.warnings.find((w) => w.code === "paid_traffic_not_confirmed")!.severity).toBe("warning");
    expect(scoreProgram({ ...empty(), acceptsPaidTraffic: "no" }, wants, DEFAULT_SCORING, ctx()).warnings.some((w) => w.code === "paid_traffic_forbidden")).toBe(true);
  });
  it("não exige site quando o programa aceita outros canais; avisa quando exige e o usuário não tem", () => {
    const noSite = { ...profile, hasWebsite: false };
    expect(scoreProgram({ ...empty(), requiresWebsite: "no" }, noSite, DEFAULT_SCORING, ctx()).warnings.some((w) => w.code === "website_required")).toBe(false);
    expect(scoreProgram({ ...empty(), requiresWebsite: "yes" }, noSite, DEFAULT_SCORING, ctx()).warnings.some((w) => w.code === "website_required")).toBe(true);
  });
});

describe("configuração", () => {
  it("faixas padrão do prompt e configuráveis", () => {
    expect([90, 75, 55, 35, 10].map((s) => bandFor(s, DEFAULT_SCORING))).toEqual(["excellent", "good", "moderate", "low", "insufficient"]);
    expect(bandFor(60, { ...DEFAULT_SCORING, bands: { excellent: 90, good: 80, moderate: 60, low: 40 } })).toBe("moderate");
  });
  it("configuração inválida volta ao padrão", () => {
    expect(resolveScoringConfig({ bands: { excellent: 10, good: 20, moderate: 30, low: 40 } })).toEqual(DEFAULT_SCORING);
    expect(resolveScoringConfig(null)).toEqual(DEFAULT_SCORING);
    expect(resolveScoringConfig({ paidTrafficPolicy: "warn" }).paidTrafficPolicy).toBe("warn");
  });
});

describe("simulador", () => {
  const base = { productPrice: 100, commissionPercent: 20, trafficCostMonthly: 0, contentCostMonthly: 0 };
  it("modo A: cliques e conversão", () => {
    const r: any = simulate(simInputSchema.parse({ mode: "clicks", clicksMonthly: 1000, conversionPercent: 2, ...base, trafficCostMonthly: 100, contentCostMonthly: 50 }));
    expect(r.salesMonthly).toBe(20);
    expect(r.commissionPerSale).toBe(20);
    expect(r.commissionMonthly).toBe(400);
    expect(r.commissionAnnual).toBe(4800);
    expect(r.costMonthly).toBe(150);
    expect(r.profitMonthly).toBe(250);
    expect(r.roi).toBeCloseTo(1.67, 2);
    expect(r.breakEvenSales).toBe(8);
    expect(r.isSimulation).toBe(true);
  });
  it("modo B: vendas esperadas, comissão fixa", () => {
    const r: any = simulate(simInputSchema.parse({ mode: "sales", salesMonthly: 10, productPrice: 100, commissionFixed: 15 }));
    expect(r.commissionMonthly).toBe(150);
    expect(r.roi).toBeNull();
  });
  it("modo C: meta financeira calcula vendas e cliques necessários", () => {
    const r: any = simulate(simInputSchema.parse({ mode: "goal", goalMonthly: 1000, conversionPercent: 2, ...base }));
    expect(r.salesMonthly).toBe(50);
    expect(r.clicksMonthly).toBe(2500);
  });
  it("modo C sem conversão não calcula cliques; com conversão zero dá erro", () => {
    expect((simulate(simInputSchema.parse({ mode: "goal", goalMonthly: 1000, ...base })) as any).clicksMonthly).toBeNull();
    expect(simulate(simInputSchema.parse({ mode: "goal", goalMonthly: 1000, conversionPercent: 0, ...base }))).toEqual({ error: "conversion_required" });
  });
  it("exige comissão e rejeita entradas absurdas", () => {
    expect(simulate(simInputSchema.parse({ mode: "sales", salesMonthly: 1, productPrice: 10 }))).toEqual({ error: "commission_required" });
    expect(simInputSchema.safeParse({ mode: "sales", salesMonthly: -1, ...base }).success).toBe(false);
    expect(simInputSchema.safeParse({ mode: "clicks", clicksMonthly: 10, conversionPercent: 150, ...base }).success).toBe(false);
  });
});

describe("simulador de SaaS recorrente", () => {
  const input = { subscribers: 100, monthlyPrice: 50, commissionPercent: 20, monthlyChurnPercent: 10, horizonMonths: 12 };
  it("exige duração, a menos que o usuário confirme recorrência vitalícia", () => {
    expect(recurringInputSchema.safeParse(input).success).toBe(false);
    expect(recurringInputSchema.safeParse({ ...input, durationMonths: 12 }).success).toBe(true);
    expect(recurringInputSchema.safeParse({ ...input, lifetimeConfirmed: true }).success).toBe(true);
  });
  it("sem cancelamento, comissão limitada para no fim da duração", () => {
    const r = simulateRecurring(recurringInputSchema.parse({ ...input, durationMonths: 6 }));
    expect(r.scenarios.none.earnedByMonth.slice(0, 6).every((v) => v === 1000)).toBe(true);
    expect(r.scenarios.none.earnedByMonth.slice(6).every((v) => v === 0)).toBe(true);
    expect(r.scenarios.none.earnedTotal).toBe(6000);
    expect(r.recurrenceBasis).toBe("limited");
  });
  it("cancelamento reduz o acumulado; cenário alto dobra o cancelamento", () => {
    const r = simulateRecurring(recurringInputSchema.parse({ ...input, lifetimeConfirmed: true }));
    expect(r.scenarios.base.earnedTotal).toBeLessThan(r.scenarios.none.earnedTotal);
    expect(r.scenarios.high.earnedTotal).toBeLessThan(r.scenarios.base.earnedTotal);
    expect(r.scenarios.high.churnPercent).toBe(20);
    expect(r.recurrenceBasis).toBe("lifetime_confirmed_by_user");
  });
  it("validação atrasa a liberação da comissão", () => {
    const r = simulateRecurring(recurringInputSchema.parse({ ...input, durationMonths: 12, monthlyChurnPercent: 0, validationDays: 60 }));
    expect(r.validationDelayMonths).toBe(2);
    expect(r.scenarios.base.releasedTotal).toBe(10000);
    expect(r.scenarios.base.earnedTotal).toBe(12000);
  });
});
