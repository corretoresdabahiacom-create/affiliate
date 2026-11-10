import { describe, expect, it } from "vitest";
import {
  dedupeKey,
  hostOf,
  isOfficialSource,
  normalizeName,
  programSchema,
  sourceRank,
  sourceSchema,
  verificationState,
} from "./index";

const DAY = 86_400_000;
const base = { lifecycleStatus: "active", verificationFlag: "none", lastVerifiedAt: null } as const;

describe("verificationState", () => {
  const now = 1_000 * DAY;
  it("nunca verificado quando não há data", () => {
    expect(verificationState(base, now)).toBe("never_verified");
  });
  it("verificado recentemente dentro do prazo", () => {
    expect(verificationState({ ...base, lastVerifiedAt: now - 10 * DAY }, now)).toBe("verified_recently");
  });
  it("desatualizado depois do prazo configurado", () => {
    expect(verificationState({ ...base, lastVerifiedAt: now - 91 * DAY }, now)).toBe("outdated");
    expect(verificationState({ ...base, lastVerifiedAt: now - 91 * DAY }, now, 120)).toBe("verified_recently");
  });
  it("sinalizações do editor vencem a data", () => {
    const v = { ...base, lastVerifiedAt: now - DAY };
    expect(verificationState({ ...v, verificationFlag: "divergent" }, now)).toBe("divergent");
    expect(verificationState({ ...v, verificationFlag: "awaiting_update" }, now)).toBe("awaiting_update");
  });
  it("ciclo de vida não ativo vence tudo", () => {
    const v = { ...base, verificationFlag: "divergent" as const, lastVerifiedAt: now };
    expect(verificationState({ ...v, lifecycleStatus: "closed" }, now)).toBe("closed");
    expect(verificationState({ ...v, lifecycleStatus: "suspended" }, now)).toBe("suspended");
    expect(verificationState({ ...v, lifecycleStatus: "unavailable" }, now)).toBe("unavailable");
  });
});

describe("fontes", () => {
  it("só os quatro primeiros tipos são oficiais", () => {
    expect(isOfficialSource("official_docs")).toBe(true);
    expect(isOfficialSource("official_communication")).toBe(true);
    expect(isOfficialSource("secondary_reliable")).toBe(false);
    expect(isOfficialSource("unconfirmed")).toBe(false);
    expect(sourceRank("official_docs")).toBeLessThan(sourceRank("unconfirmed"));
  });
  it("rejeita URL que não seja http(s)", () => {
    expect(sourceSchema.safeParse({ sourceType: "official_docs", url: "javascript:alert(1)" }).success).toBe(false);
    expect(sourceSchema.safeParse({ sourceType: "official_docs", url: "https://example.com/x" }).success).toBe(true);
  });
});

describe("normalização e deduplicação", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(normalizeName("  Programa  Édu-Zz! ")).toBe("programa edu zz");
  });
  it("host sem www", () => {
    expect(hostOf("https://www.Example.com/a")).toBe("example.com");
    expect(hostOf("nope")).toBe("");
  });
  it("mesma chave para variações do mesmo nome", () => {
    expect(dedupeKey("a1", null, "Programa  Afiliados")).toBe(dedupeKey("a1", null, "programa afiliados"));
    expect(dedupeKey("a1", "n1", "X")).not.toBe(dedupeKey("a1", null, "X"));
  });
});

describe("programSchema", () => {
  it("campos de aceitação começam como não verificados", () => {
    const p = programSchema.parse({ advertiserId: "a", name: "P", segment: "saas" });
    expect(p.acceptsBrazil).toBe("unverified");
    expect(p.isRecurring).toBe("unverified");
    expect(p.signupUrlStatus).toBe("unverified");
    expect(p.lifecycleStatus).toBe("active");
  });
  it("rejeita valores fora do tri-estado e comissão absurda", () => {
    expect(programSchema.safeParse({ advertiserId: "a", name: "P", segment: "saas", acceptsBrazil: "maybe" }).success).toBe(false);
    expect(programSchema.safeParse({ advertiserId: "a", name: "P", segment: "saas", commissionPercent: 150 }).success).toBe(false);
  });
});
