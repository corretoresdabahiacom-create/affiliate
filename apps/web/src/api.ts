import type { AlertCategory, AlertPrefs, ProfileInput, Role, ScoreResult, ScoringConfig } from "@ai/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "x-requested-with": "fetch",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown_error", data);
  return data as T;
}

export interface Me {
  user: { id: string; email: string; role: Role; planId: string };
  profile: {
    displayName: string | null;
    locale: string;
    country: string | null;
    experience: string | null;
    niches: string[];
    channels: string[];
    hasWebsite: boolean;
    monthlyBudgetUsd: number | null;
    wantsRecurring: boolean;
    acceptsPaidTraffic: boolean;
    onboarded: boolean;
  } | null;
}

export interface AdminUser {
  id: string;
  email: string;
  role: Role;
  planId: string;
  createdAt: number;
  lastLoginAt: number | null;
}
export interface AdminPlan {
  id: string;
  name: string;
  monthlyPriceCents: number | null;
  currency: string;
  limits: Record<string, number>;
  active: boolean;
}
export interface AuditEntry {
  id: number;
  userId: string | null;
  action: string;
  target: string | null;
  createdAt: number;
}

export type Tri = "yes" | "no" | "unverified";
export interface CatalogProgram {
  id: string;
  name: string;
  segment: string;
  description: string | null;
  advertiser: { id: string; name: string };
  network: { id: string; name: string } | null;
  category: { id: string; slug: string } | null;
  acceptsBrazil: Tri;
  acceptsIndividuals: Tri;
  requiresCompany: Tri;
  requiresWebsite: Tri;
  acceptsSocial: Tri;
  acceptsPaidTraffic: Tri;
  acceptsOrganic: Tri;
  commissionType: string;
  commissionPercent: number | null;
  commissionFixed: number | null;
  currency: string | null;
  isRecurring: Tri;
  recurringDurationMonths: number | null;
  cookieDays: number | null;
  minPayout: number | null;
  payoutCurrency: string | null;
  payoutFrequency: string;
  validationDays: number | null;
  officialUrl: string | null;
  signupUrl: string | null;
  signupUrlStatus: "verified" | "unverified" | "unavailable";
  docsUrl: string | null;
  lifecycleStatus: string;
  verificationFlag: string;
  lastVerifiedAt: number | null;
  verification: string;
  updatedAt: number;
}
export interface CatalogMeta {
  segments: string[];
  networks: { id: string; name: string; kind: string; websiteUrl: string | null; websiteUrlStatus: string; operationalStatus: string; notes: string | null }[];
  categories: { id: string; slug: string; segment: string; namePt: string; nameEn: string; nameEs: string }[];
  staleAfterDays: number;
}
export interface ProgramSource {
  id: string;
  sourceType: string;
  field: string | null;
  url: string;
  note: string | null;
  consultedAt: number;
  confirmedAt: number | null;
}
export interface ProgramHistory {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  note: string | null;
  changedAt: number;
}
export interface ProgramDetail {
  program: CatalogProgram;
  sources: ProgramSource[];
  history: ProgramHistory[];
  products: { id: string; name: string; url: string | null; description: string | null }[];
  offers: { id: string; title: string; details: string | null; url: string | null }[];
}
export interface ImportReport {
  created: number;
  duplicates: { line: number; reason: string }[];
  errors: { line: number; error: string }[];
  dryRun: boolean;
}

export interface ScoredProgram {
  program: CatalogProgram;
  score: ScoreResult;
}
export interface RecommendationsResponse {
  recommended: ScoredProgram[];
  toVerify: ScoredProgram[];
  excludedDenied: number;
  evaluated: number;
  profileMissing: boolean;
  country: string | null;
}
export interface AlertItem {
  id: string;
  category: AlertCategory;
  programId: string;
  programName: string;
  advertiser: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  at: number;
  lastVerifiedAt: number | null;
  sourceUrl: string | null;
  unread: boolean;
}

export const api = {
  me: () => request<Me>("GET", "/api/me"),
  requestLogin: (email: string, locale: string) =>
    request<{ ok: true; devLink?: string }>("POST", "/api/auth/login", { email, locale }),
  verify: (token: string) => request<{ ok: true }>("POST", "/api/auth/verify", { token }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  saveProfile: (p: Partial<ProfileInput>) => request<{ ok: true }>("PUT", "/api/me/profile", p),
  exportData: () => request<Record<string, unknown>>("GET", "/api/me/export"),
  deleteAccount: () => request<{ ok: true }>("DELETE", "/api/me"),
  adminUsers: () => request<{ users: AdminUser[]; total: number }>("GET", "/api/admin/users"),
  adminSetRole: (id: string, role: Role) => request<{ ok: true }>("PATCH", `/api/admin/users/${id}/role`, { role }),
  adminPlans: () => request<{ plans: AdminPlan[] }>("GET", "/api/admin/plans"),
  adminSavePlan: (id: string, body: Partial<Omit<AdminPlan, "id">>) =>
    request<{ ok: true }>("PUT", `/api/admin/plans/${id}`, body),
  adminAudit: () => request<{ entries: AuditEntry[] }>("GET", "/api/admin/audit"),
  catalogMeta: () => request<CatalogMeta>("GET", "/api/catalog/meta"),
  programs: (query: string) => request<{ items: CatalogProgram[]; total: number }>("GET", `/api/catalog/programs?${query}`),
  program: (id: string) => request<ProgramDetail>("GET", `/api/catalog/programs/${id}`),
  createProgram: (body: Record<string, unknown>) => request<{ ok: true; id: string }>("POST", "/api/catalog/programs", body),
  patchProgram: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true; changed: string[] }>("PATCH", `/api/catalog/programs/${id}`, body),
  setProgramStatus: (id: string, lifecycleStatus: string) =>
    request<{ ok: true }>("POST", `/api/catalog/programs/${id}/status`, { lifecycleStatus }),
  addSource: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>("POST", `/api/catalog/programs/${id}/sources`, body),
  verifyProgram: (id: string, action: string) =>
    request<{ ok: true }>("POST", `/api/catalog/programs/${id}/verify`, { action }),
  advertisers: (q: string) =>
    request<{ advertisers: { id: string; name: string }[] }>("GET", `/api/catalog/advertisers?q=${encodeURIComponent(q)}`),
  createAdvertiser: (body: Record<string, unknown>) => request<{ ok: true; id: string }>("POST", "/api/catalog/advertisers", body),
  createNetwork: (body: Record<string, unknown>) => request<{ ok: true; id: string }>("POST", "/api/catalog/networks", body),
  importCsv: (csv: string, dryRun: boolean) => request<ImportReport>("POST", "/api/catalog/import", { csv, dryRun }),
  intelScore: (id: string) => request<{ score: ScoreResult; profileMissing: boolean }>("GET", `/api/intel/programs/${id}/score`),
  compare: (ids: string[]) => request<{ items: ScoredProgram[]; profileMissing: boolean }>("GET", `/api/intel/compare?ids=${ids.join(",")}`),
  recommendations: () => request<RecommendationsResponse>("GET", "/api/intel/recommendations"),
  scoringConfig: () => request<{ config: ScoringConfig }>("GET", "/api/intel/config"),
  adminSaveScoring: (c: ScoringConfig) => request<{ ok: true }>("PUT", "/api/intel/admin/scoring", c),
  alerts: () => request<{ alerts: AlertItem[]; unread: number }>("GET", "/api/intel/alerts?days=60"),
  alertPrefs: () => request<{ prefs: AlertPrefs }>("GET", "/api/intel/alerts/prefs"),
  saveAlertPrefs: (p: AlertPrefs) => request<{ ok: true }>("PUT", "/api/intel/alerts/prefs", p),
  alertsSeen: () => request<{ ok: true }>("POST", "/api/intel/alerts/seen"),
};
