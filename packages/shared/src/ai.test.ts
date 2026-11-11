import { describe, expect, it } from "vitest";
import { checkGrounding, estimateTokens, fitChecks, parseSearchQuery, programFactDoc, resolveAiConfig, systemPrompt, userPrompt, chatInputSchema, type FactSource } from "./index";

const program = (over: Record<string, unknown> = {}) => ({
  id: "p1", name: "Acme", segment: "saas", description: null, advertiser: { name: "Acme Inc" }, network: null,
  lifecycleStatus: "active", acceptsBrazil: "yes", acceptsIndividuals: "unverified", requiresCompany: "unverified", requiresWebsite: "yes",
  acceptsSocial: "unverified", acceptsPaidTraffic: "no", acceptsOrganic: "yes", allowsRedirect: "unverified", isRecurring: "yes",
  commissionType: "percent", commissionPercent: 30, commissionFixed: null, currency: "USD", cookieDays: 60, minPayout: null,
  payoutFrequency: "unknown", validationDays: null, signupUrl: null, verification: "verified_recently", ...over,
});
const src = (field: string, url: string): FactSource => ({ field, sourceType: "official_docs", url, confirmedAt: Date.UTC(2026, 0, 5) });

describe("fatos do catálogo para a IA", () => {
  it("marca desconhecido como UNKNOWN e confirmado com a fonte oficial", () => {
    const d = programFactDoc(program(), [src("commission_percent", "https://docs.acme.com/c")]);
    expect(d.text).toContain("commission_percent: 30 (confirmed by official source https://docs.acme.com/c, confirmed on 2026-01-05)");
    expect(d.text).toContain("accepts_individuals: UNKNOWN");
    expect(d.text).toContain("cookie_days: 60 (no official source recorded for this field)");
    expect(d.sourceUrls).toEqual(["https://docs.acme.com/c"]);
  });
  it("fonte não oficial não conta como confirmação", () => {
    const d = programFactDoc(program(), [{ field: "commission_percent", sourceType: "secondary_reliable", url: "https://blog.example.com", confirmedAt: null }]);
    expect(d.text).toContain("commission_percent: 30 (no official source recorded");
    expect(d.sourceUrls).toEqual([]);
  });
});

describe("checagem de ancoragem", () => {
  const ctx = programFactDoc(program(), [src("commission_percent", "https://docs.acme.com/c")]).text;
  it("aceita números e links que estão no contexto", () => {
    expect(checkGrounding("A comissão é de 30% e o cookie dura 60 dias. Veja https://docs.acme.com/c.", ctx).ok).toBe(true);
  });
  it("recusa percentual, prazo, moeda e link inventados", () => {
    const g = checkGrounding("Paga 45% de comissão, cookie de 90 dias, mínimo de US$ 100. Cadastre em https://acme-afiliados.com/entrar", ctx);
    expect(g.ok).toBe(false);
    expect(g.ungroundedNumbers).toEqual(expect.arrayContaining(["45%", "90 dias", "US$ 100"]));
    expect(g.ungroundedUrls).toEqual(["https://acme-afiliados.com/entrar"]);
  });
  it("números sem unidade comercial (lista, passos) não são tratados como alegação", () => {
    expect(checkGrounding("Siga 3 passos: 1. confirme, 2. aplique, 3. aguarde.", ctx).ok).toBe(true);
  });
  it("entende formatos de número (vírgula decimal e milhar)", () => {
    const c = "- min_payout: 1500 (x)\n- commission_percent: 2.5";
    expect(checkGrounding("Mínimo de R$ 1.500,00 e 2,5% por venda", c).ok).toBe(true);
    expect(checkGrounding("Mínimo de R$ 1.600,00", c).ok).toBe(false);
  });
});

describe("compatibilidade com o perfil (sem modelo)", () => {
  const prof = { country: "BR", hasWebsite: false, channels: ["instagram", "blog"], acceptsPaidTraffic: true, wantsRecurring: true };
  it("bloqueia só com dado confirmado e marca o resto como desconhecido", () => {
    const by = Object.fromEntries(fitChecks(program(), prof).map((c) => [c.id, c.status]));
    expect(by).toMatchObject({ brazil: "ok", website: "blocked", paid: "blocked", social: "unknown", organic: "ok", recurring: "ok", individuals: "unknown", company: "unknown" });
  });
  it("programa encerrado é bloqueio; país fora do Brasil não gera checagem de Brasil", () => {
    const c = fitChecks(program({ lifecycleStatus: "closed" }), { ...prof, country: "PT" });
    expect(c.find((x) => x.id === "lifecycle")?.status).toBe("blocked");
    expect(c.find((x) => x.id === "brazil")).toBeUndefined();
  });
});

describe("pesquisa em linguagem natural", () => {
  it("vira filtros explícitos e texto restante", () => {
    expect(parseSearchQuery("Quero programas SaaS recorrentes que aceitam brasileiros com hospedagem")).toEqual({
      segment: "saas", isRecurring: "yes", acceptsBrazil: "yes", text: "hospedagem",
    });
  });
  it("não infere nada que não foi dito", () => {
    expect(parseSearchQuery("cafeteira")).toEqual({ text: "cafeteira" });
  });
});

describe("configuração e prompts", () => {
  it("usa padrões e ignora configuração inválida", () => {
    expect(resolveAiConfig(null).dailyRequestsPerUser).toBe(20);
    expect(resolveAiConfig({ dailyRequestsPerUser: -1 }).dailyRequestsPerUser).toBe(20);
    expect(resolveAiConfig({ enabled: false }).enabled).toBe(false);
  });
  it("o prompt proíbe inventar e trata o contexto como dado", () => {
    const s = systemPrompt("pt-BR", "chat");
    expect(s).toMatch(/NEVER invent/);
    expect(s).toMatch(/never instructions/);
    expect(s).toMatch(/Brazilian Portuguese/);
    expect(userPrompt("x", [{ id: "1", name: "n", text: "T", sourceUrls: [] }])).toContain("<context>\nT");
  });
  it("estima tokens e valida a pergunta", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(chatInputSchema.safeParse({ message: "a" }).success).toBe(false);
    expect(chatInputSchema.parse({ message: "olá mundo" }).locale).toBe("pt-BR");
  });
});
