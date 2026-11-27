import { z } from "zod";

/** Plataformas em que o usuário publica. O sistema só organiza e mede; quem publica é o usuário. */
export const CONTENT_PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

export const POST_STATUSES = ["idea", "approved", "scheduled", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** idea ⇄ approved ⇄ scheduled → published. Nada pula a aprovação humana. */
const NEXT: Record<PostStatus, PostStatus[]> = {
  idea: ["approved"],
  approved: ["idea", "scheduled", "published"],
  scheduled: ["approved", "published"],
  published: [],
};
export function canPostTransition(from: PostStatus, to: PostStatus): boolean {
  return NEXT[from].includes(to);
}

export const MAX_POSTS_PER_WEEK = 21;

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
export const isoDate = z.string().regex(dateRe).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "invalid_date");

/** Segunda-feira (UTC) da semana que contém a data informada, como AAAA-MM-DD. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const postSchema = z.object({
  weekStart: isoDate,
  day: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
  title: z.string().trim().min(1).max(120),
  hook: z.string().trim().max(200).nullish(),
  script: z.string().trim().max(4000).nullish(),
  platforms: z.array(z.enum(CONTENT_PLATFORMS)).min(1).max(3).refine((a) => new Set(a).size === a.length, "duplicate"),
  usesAffiliateLink: z.boolean().default(false),
  disclosureConfirmed: z.boolean().default(false),
  notes: z.string().trim().max(1000).nullish(),
});
export type PostInput = z.infer<typeof postSchema>;
/** Edição: só os campos enviados mudam (sem .default(), para não apagar dados ao editar). */
export const postPatchSchema = z.object({
  day: z.number().int().min(0).max(6).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
  title: z.string().trim().min(1).max(120).optional(),
  hook: z.string().trim().max(200).nullish(),
  script: z.string().trim().max(4000).nullish(),
  platforms: z.array(z.enum(CONTENT_PLATFORMS)).min(1).max(3).refine((a) => new Set(a).size === a.length, "duplicate").optional(),
  usesAffiliateLink: z.boolean().optional(),
  disclosureConfirmed: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullish(),
});
export const postStatusSchema = z.object({ status: z.enum(POST_STATUSES) });

const count = z.number().int().min(0).max(10_000_000_000);
export const postMetricsSchema = z.object({
  views: count,
  likes: count.optional(),
  shares: count.optional(),
  saves: count.optional(),
  clicks: count.optional(),
  retentionPct: z.number().min(0).max(100).optional(),
});

export type ApprovalIssue = "script_missing" | "disclosure_missing";
/** O que falta para aprovar. Post com link de afiliado só é aprovado com a divulgação confirmada. */
export function postApprovalIssues(p: { script?: string | null; usesAffiliateLink: boolean; disclosureConfirmed: boolean }): ApprovalIssue[] {
  const out: ApprovalIssue[] = [];
  if (!p.script || !p.script.trim()) out.push("script_missing");
  if (p.usesAffiliateLink && !p.disclosureConfirmed) out.push("disclosure_missing");
  return out;
}

export interface MetricPost {
  id: string;
  title: string;
  day: number;
  platforms: ContentPlatform[];
  views: number | null;
  likes: number | null;
  shares: number | null;
  saves: number | null;
  retentionPct: number | null;
}
/** Interações (curtidas + compartilhamentos + salvamentos) por visualização. Sem visualizações, não há taxa. */
export function engagementRate(p: Pick<MetricPost, "views" | "likes" | "shares" | "saves">): number | null {
  if (!p.views) return null;
  return ((p.likes ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / p.views;
}

export const MIN_POSTS_FOR_INSIGHTS = 3;

export interface Insights {
  /** Posts com visualizações informadas. */
  sample: number;
  /** Só com 3+ posts medidos o sistema aponta tendências; antes disso mostra apenas o ranking. */
  enough: boolean;
  ranking: Array<{ id: string; title: string; views: number; engagement: number | null; retentionPct: number | null }>;
  /** Só posts de uma única plataforma entram: a métrica é por post, não por plataforma. */
  byPlatform: Array<{ platform: ContentPlatform; posts: number; avgViews: number; avgEngagement: number | null }>;
  byDay: Array<{ day: number; posts: number; avgViews: number }>;
  best: { platform: ContentPlatform | null; day: number | null };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function buildInsights(posts: MetricPost[]): Insights {
  const measured = posts.filter((p) => p.views !== null && p.views !== undefined);
  const ranking = measured
    .map((p) => ({ id: p.id, title: p.title, views: p.views as number, engagement: engagementRate(p), retentionPct: p.retentionPct }))
    .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title));
  const enough = measured.length >= MIN_POSTS_FOR_INSIGHTS;

  const byPlatform = CONTENT_PLATFORMS.map((platform) => {
    const rows = measured.filter((p) => p.platforms.length === 1 && p.platforms[0] === platform);
    const eng = rows.map(engagementRate).filter((x): x is number => x !== null);
    return { platform, posts: rows.length, avgViews: avg(rows.map((r) => r.views as number)), avgEngagement: eng.length ? avg(eng) : null };
  }).filter((r) => r.posts > 0);

  const byDay = [0, 1, 2, 3, 4, 5, 6]
    .map((day) => {
      const rows = measured.filter((p) => p.day === day);
      return { day, posts: rows.length, avgViews: avg(rows.map((r) => r.views as number)) };
    })
    .filter((r) => r.posts > 0);

  const top = <T extends { avgViews: number }>(xs: T[]) => (xs.length ? xs.reduce((a, b) => (b.avgViews > a.avgViews ? b : a)) : null);
  return {
    sample: measured.length,
    enough,
    ranking,
    byPlatform,
    byDay,
    best: enough
      ? { platform: byPlatform.length > 1 ? top(byPlatform)?.platform ?? null : null, day: byDay.length > 1 ? top(byDay)?.day ?? null : null }
      : { platform: null, day: null },
  };
}
