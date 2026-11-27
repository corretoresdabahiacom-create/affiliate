import { describe, expect, it } from "vitest";
import {
  addDays, buildInsights, canPostTransition, engagementRate, mondayOf, postApprovalIssues, postMetricsSchema, postPatchSchema, postSchema,
  type MetricPost,
} from "./content";

const mp = (o: Partial<MetricPost> & { id: string }): MetricPost => ({
  title: o.id, day: 0, platforms: ["instagram"], views: null, likes: null, shares: null, saves: null, retentionPct: null, ...o,
});

describe("semana de conteúdo", () => {
  it("acha a segunda-feira da semana", () => {
    expect(mondayOf("2026-11-26")).toBe("2026-11-23"); // quinta
    expect(mondayOf("2026-11-23")).toBe("2026-11-23"); // segunda
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // domingo
    expect(mondayOf("2027-01-01")).toBe("2026-12-28"); // virada de ano
    expect(addDays("2026-11-23", 7)).toBe("2026-11-30");
  });

  it("não deixa pular a aprovação humana", () => {
    expect(canPostTransition("idea", "approved")).toBe(true);
    expect(canPostTransition("idea", "scheduled")).toBe(false);
    expect(canPostTransition("idea", "published")).toBe(false);
    expect(canPostTransition("approved", "scheduled")).toBe(true);
    expect(canPostTransition("published", "idea")).toBe(false);
  });

  it("exige roteiro e divulgação confirmada para aprovar", () => {
    expect(postApprovalIssues({ script: "", usesAffiliateLink: false, disclosureConfirmed: false })).toEqual(["script_missing"]);
    expect(postApprovalIssues({ script: "ok", usesAffiliateLink: true, disclosureConfirmed: false })).toEqual(["disclosure_missing"]);
    expect(postApprovalIssues({ script: "ok", usesAffiliateLink: true, disclosureConfirmed: true })).toEqual([]);
  });

  it("valida entradas", () => {
    const base = { weekStart: "2026-11-23", day: 2, title: "Vídeo", platforms: ["tiktok"] };
    expect(postSchema.safeParse(base).success).toBe(true);
    expect(postSchema.safeParse({ ...base, platforms: [] }).success).toBe(false);
    expect(postSchema.safeParse({ ...base, platforms: ["tiktok", "tiktok"] }).success).toBe(false);
    expect(postSchema.safeParse({ ...base, day: 7 }).success).toBe(false);
    expect(postSchema.safeParse({ ...base, weekStart: "2026-13-40" }).success).toBe(false);
    expect(postSchema.safeParse({ ...base, time: "25:00" }).success).toBe(false);
    expect(postMetricsSchema.safeParse({ views: 10, retentionPct: 101 }).success).toBe(false);
    expect(postMetricsSchema.safeParse({ views: -1 }).success).toBe(false);
  });

  it("edição não preenche padrões (não apaga o que não foi enviado)", () => {
    expect(postPatchSchema.parse({ title: "Novo" })).toEqual({ title: "Novo" });
  });

  it("calcula engajamento e não inventa taxa sem visualizações", () => {
    expect(engagementRate({ views: 1000, likes: 50, shares: 30, saves: 20 })).toBeCloseTo(0.1);
    expect(engagementRate({ views: 0, likes: 5, shares: 0, saves: 0 })).toBeNull();
    expect(engagementRate({ views: null, likes: null, shares: null, saves: null })).toBeNull();
  });

  it("só aponta tendência com 3 ou mais posts medidos", () => {
    const two = buildInsights([mp({ id: "a", views: 100 }), mp({ id: "b", views: 200, day: 1 })]);
    expect(two.enough).toBe(false);
    expect(two.best).toEqual({ platform: null, day: null });
    expect(two.ranking.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("ranqueia e agrupa por plataforma e dia, ignorando posts sem métrica e multiplataforma", () => {
    const r = buildInsights([
      mp({ id: "a", views: 1000, likes: 100, day: 0, platforms: ["instagram"] }),
      mp({ id: "b", views: 3000, likes: 90, shares: 10, day: 2, platforms: ["tiktok"] }),
      mp({ id: "c", views: 2000, day: 2, platforms: ["tiktok"] }),
      mp({ id: "d", views: 9999, day: 4, platforms: ["instagram", "youtube"] }),
      mp({ id: "e", day: 5 }),
    ]);
    expect(r.sample).toBe(4);
    expect(r.enough).toBe(true);
    expect(r.ranking[0]!.id).toBe("d");
    expect(r.byPlatform.find((p) => p.platform === "tiktok")).toMatchObject({ posts: 2, avgViews: 2500 });
    expect(r.byPlatform.find((p) => p.platform === "youtube")).toBeUndefined();
    expect(r.best.platform).toBe("tiktok");
    expect(r.best.day).toBe(4);
  });
});
