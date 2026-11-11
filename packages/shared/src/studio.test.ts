import { describe, expect, it } from "vitest";
import {
  adApprovalIssues,
  adClaimIssues,
  adExportText,
  buildAdCopy,
  canAdTransition,
  channelCheck,
  confirmedValue,
  seasonalEntrySchema,
  seasonalIssues,
} from "./studio";

const facts = [
  "PROGRAM: Mail Pro (advertiser: X; network: direct; segment: saas)",
  "- accepts_organic: yes (confirmed by official source https://docs.example.com/a, confirmed on 2026-01-01)",
  "- accepts_social: no (no official source recorded for this field)",
  "- accepts_paid_traffic: UNKNOWN (no confirmed data; do not guess)",
  "- signup_url: https://mailpro.example.com/aff (confirmed by official source https://docs.example.com/s)",
].join("\n");

describe("sazonalidade", () => {
  it("métrica exige rótulo, valor e fonte", () => {
    expect(seasonalIssues({})).toEqual([]);
    expect(seasonalIssues({ metricLabel: "Buscas", metricValue: "+10%" })).toEqual(["metric_needs_source"]);
    expect(seasonalIssues({ metricValue: "+10%", sourceUrl: "https://a.example.com" })).toContain("metric_incomplete");
    expect(seasonalIssues({ metricLabel: "Buscas", metricValue: "+10%", sourceUrl: "https://a.example.com" })).toEqual([]);
  });
  it("esquema valida mês e fonte http(s)", () => {
    expect(seasonalEntrySchema.safeParse({ month: 13, niche: "Moda" }).success).toBe(false);
    expect(seasonalEntrySchema.safeParse({ month: 5, niche: "Moda", sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(seasonalEntrySchema.parse({ month: 5, niche: "Moda" }).status).toBe("draft");
  });
});

describe("rascunhos", () => {
  it("canal exige o campo confirmado", () => {
    expect(channelCheck("blog", facts).check).toBe("ok");
    expect(channelCheck("instagram", facts).check).toBe("blocked");
    expect(channelCheck("other", facts).check).toBe("none");
    expect(channelCheck("youtube", "- accepts_social: no").check).toBe("blocked");
    expect(channelCheck("youtube", "- accepts_social: UNKNOWN").check).toBe("unverified");
  });
  it("link de cadastro só com fonte oficial", () => {
    expect(confirmedValue(facts, "signup_url")?.value).toBe("https://mailpro.example.com/aff");
    expect(confirmedValue(facts, "accepts_social")).toBeNull();
    expect(buildAdCopy({ name: "Mail Pro" }, facts, "en-US").officialUrl).toBe("https://mailpro.example.com/aff");
    expect(buildAdCopy({ name: "Mail Pro" }, "- signup_url: https://x.example.com (no official source recorded for this field)", "pt-BR").officialUrl).toBeNull();
  });
  it("texto traz divulgação no idioma e usa a descrição do catálogo", () => {
    expect(buildAdCopy({ name: "A", description: "Descrição X" }, facts, "es").description).toBe("Descrição X");
    expect(buildAdCopy({ name: "A" }, facts, "es").disclosure).toMatch(/afiliado/);
    expect(buildAdCopy({ name: "A" }, facts, "xx").disclosure).toMatch(/afiliado/);
  });
  it("bloqueia promessa de ganho e número fora do contexto", () => {
    for (const t of ["Renda garantida!", "100% risk-free", "Gana $ 500 al mes", "Ganhe R$ 1000 por dia", "sem risco nenhum"]) expect(adClaimIssues(t)).toEqual(["forbidden_claim"]);
    expect(adClaimIssues("Uma ferramenta de e-mail para criadores.")).toEqual([]);
    expect(adApprovalIssues("Cookie de 90 dias", facts)).toContain("ungrounded");
    expect(adApprovalIssues("Veja https://outro.example.com", facts)).toContain("ungrounded");
    expect(adApprovalIssues("Conheça a ferramenta", facts)).toEqual([]);
  });
  it("transições e exportação", () => {
    expect(canAdTransition("draft", "approved")).toBe(true);
    expect(canAdTransition("discarded", "approved")).toBe(false);
    expect(adExportText({ title: "T", description: "D", disclosure: "Div", link: "https://l.example.com" })).toBe("T\n\nD\n\nhttps://l.example.com\n\nDiv");
    expect(adExportText({ title: "T", description: "D", disclosure: "Div", link: null })).toBe("T\n\nD\n\nDiv");
  });
});
