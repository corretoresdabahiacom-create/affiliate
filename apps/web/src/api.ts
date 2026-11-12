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
    languages: string[];
    audienceSize: number | null;
    weeklyHours: number | null;
    prefersPhysical: boolean;
    prefersSaas: boolean;
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
  allowsRedirect: Tri;
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

// ---------- Fase 4: gestão do afiliado ----------
export interface UserProgram {
  id: string; programId: string; programName: string; advertiser: string; network: string | null;
  status: string; appliedAt: number | null; approvedAt: number | null; affiliateId: string | null;
  acceptedTerms: string | null; notes: string | null; nextAction: string | null; nextActionAt: number | null;
  catalogStatus: string; needsReview: boolean; signupUrl: string | null; signupUrlStatus: string; officialUrl: string | null;
}
export interface UserProgramDetail {
  item: UserProgram;
  history: { from: string | null; to: string; note: string | null; at: number }[];
  docs: { id: string; title: string; url: string; createdAt: number }[];
}
export interface AffLink {
  id: string; code: string; label: string; url: string; programId: string | null; programName: string | null;
  productId: string | null; productName: string | null; campaignId: string | null; channel: string; campaignTag: string | null;
  trackingMode: "none" | "own_redirect"; active: boolean; redirectAllowed: boolean; trackUrl: string | null; clicks: number; clicks30d: number;
}
export interface Campaign {
  id: string; name: string; programId: string | null; programName: string | null; productName: string | null; channel: string;
  keyword: string | null; audience: string | null; budget: number | null; adSpend: number | null; currency: string; status: string;
  startsAt: number | null; endsAt: number | null; clicksReported: number | null; conversionsReported: number | null; notes: string | null; paid: boolean;
}
export interface Commission {
  id: string; programId: string | null; programName: string | null; linkId: string | null; campaignId: string | null;
  productName: string | null; channel: string | null; amount: number; adjustments: number; netAmount: number; currency: string;
  status: "estimated" | "pending" | "approved" | "paid" | "rejected"; conversionState: "reported" | "confirmed";
  occurredAt: number; approvedAt: number | null; paidAt: number | null; origin: string; externalRef: string | null; notes: string | null;
}
export interface ImportResult { created: number; updated: number; unchanged: number; errors: { line: number; error: string }[]; dryRun: boolean }
type ReconRow = { id: string; externalRef: string | null; amount: number; currency: string; status: string };
export interface Reconciliation {
  counts: Record<"own" | "report" | "matched" | "amountDiff" | "currencyDiff" | "statusDiff" | "missingInReport" | "unreferenced" | "missingInOwn", number>;
  matched: { own: ReconRow; report: ReconRow }[]; amountDiff: { own: ReconRow; report: ReconRow }[];
  currencyDiff: { own: ReconRow; report: ReconRow }[]; statusDiff: { own: ReconRow; report: ReconRow }[];
  missingInReport: ReconRow[]; unreferenced: ReconRow[]; missingInOwn: ReconRow[];
}
type MoneyRow = { estimated: number; pending: number; approved: number; paid: number };
export interface OpsDashboard {
  programs: { discoveredInCatalog: number; saved: number; interested: number; pendingApplications: number; approved: number; active: number; rejected: number; byStatus: Record<string, number> };
  productsPromoted: number; linksRegistered: number;
  clicks: { ownTracking: number; manualReported: number; ownTrackingByChannel: { channel: string; clicks: number }[] };
  conversions: { confirmedByNetwork: number; reportedByUser: number; manualReportedInCampaigns: number };
  commissionsByCurrency: Record<string, MoneyRow & { rejected: number }>;
  commissionsByOrigin: Record<string, number>;
  byProduct: ({ name: string; currency: string } & MoneyRow)[];
  byCategory: ({ name: string; currency: string } & MoneyRow)[];
  byChannel: ({ name: string; currency: string } & MoneyRow)[];
  nextActions: { id: string; programId: string; programName: string; nextAction: string | null; at: number }[];
}

// ---------- Fase 5: IA ----------
export type AiMode = "llm" | "cached" | "facts_only";
export interface AiGenerated { answer: string | null; mode: AiMode; reason: string | null; grounding: { ok: boolean; ungroundedNumbers: string[]; ungroundedUrls: string[] } | null }
export interface AiCitation { programId: string; name: string; sourceUrls: string[] }
export interface AiChat extends AiGenerated { citations: AiCitation[] }
export interface AiStatus { enabled: boolean; modelAvailable: boolean; limit: string | null; usedToday: number; tokensToday: number; dailyRequests: number; dailyTokens: number }
export interface AiConfig {
  enabled: boolean; model: string; dailyRequestsPerUser: number; dailyTokensPerUser: number; monthlyRequestsGlobal: number;
  maxQuestionChars: number; maxContextPrograms: number; maxOutputTokens: number; cacheTtlHours: number;
}
export interface FitCheck { id: string; status: "ok" | "blocked" | "attention" | "unknown"; field: string }
export interface AiAnalysis {
  score: { attractiveness: { score: number; band: string }; quality: { score: number } };
  confirmedFields: string[]; missingFields: string[]; verification: string; lifecycleStatus: string;
  narrative: AiGenerated; citations: AiCitation[]; note: string;
}
export interface AiStrategy { fit: FitCheck[]; narrative: AiGenerated; citations: AiCitation[]; suggestionOnly: true }
export interface AiSearch { interpreted: Record<string, string>; onlyConfirmed: true; items: { id: string; name: string; advertiser: { name: string }; segment: string }[] }
export interface AiUsageAdmin { totals: { requests: number; llm: number; cached: number; inTok: number; outTok: number; discarded: number; users: number }; byDay: { day: string; n: number; tokens: number }[] }

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

export interface SeasonalEntry {
  id: string; month: number; niche: string; note: string | null; metricLabel: string | null; metricValue: string | null;
  sourceUrl: string | null; status: "draft" | "published"; programs: Array<{ id: string; name: string; lifecycleStatus: string }>; updatedAt: number;
}
export interface AdDraft {
  id: string; programId: string | null; programName: string; channel: string; locale: string; title: string; description: string; disclosure: string;
  userLink: string | null; officialUrl: string | null; channelField: string | null; channelCheck: "ok" | "unverified" | "blocked" | "none";
  textSource: "catalog" | "model" | "user"; status: "draft" | "approved" | "discarded"; issues: string[]; createdAt: number; updatedAt: number;
}
export interface AdGenerated { items: AdDraft[]; skipped: Array<{ programId: string; reason: string }>; ai: Array<{ programId: string; mode: string; reason: string | null }>; publishedAnywhere: false }

export interface Connection { id: string; provider: "shopee" | "supplier"; label: string; status: "pending" | "connected" | "error"; statusDetail: string | null; config: Record<string, any>; hasSecrets: boolean; createdAt: number }
export interface VariantModel { tierIndex: number[]; sku?: string | null; costPrice: number; stock?: number | null; price?: number }
export interface Variants { tiers: Array<{ name: string; options: string[] }>; models: VariantModel[] }
export interface AttributeDef { id: number; name: string; mandatory: boolean; inputType: string; values: Array<{ id: number; name: string }> }
export interface AttributeValue { attributeId: number; valueId?: number; customValue?: string }
export interface SyncProposal { stock?: { from: number | null; to: number }; price?: { from: number; to: number }; models?: Array<{ key: string; stock?: { from: number | null; to: number }; price?: { from: number | undefined; to: number } }>; costChanged: boolean }
export interface OrderItem { itemId: string; modelId: string | null; name: string | null; sku: string | null; quantity: number; price: number }
export interface Order {
  id: string; connectionId: string; orderSn: string; status: string; orderedAt: number; currency: string; total: number | null; items: OrderItem[];
  trackingNumber: string | null; trackingStatus: string | null; trackingEvents: Array<{ at: number; description: string; status: string | null }>; trackingCheckedAt: number | null;
  supplierStatus: "not_placed" | "placed" | "shipped" | "delivered" | "problem"; supplierRef: string | null; supplierTracking: string | null; syncedAt: number;
}
export interface SupplierSheet { orderSn: string; lines: Array<{ productName: string; supplierExternalId: string | null; sku: string | null; quantity: number; unitCost: number | null; lineCost: number | null; matched: boolean }>; totalCost: number | null; unmatched: number; note: "manual_purchase" }
export interface SupplierProduct { id: string; variants?: Variants | null; connectionId: string; externalId: string; sku: string | null; name: string; description: string | null; costPrice: number; currency: string; stock: number | null; images: string[]; category: string | null; weightKg: number | null; source: string; syncedAt: number }
export interface Listing {
  id: string; connectionId: string; productId: string | null; productName: string; title: string; description: string; price: number; costPrice: number; currency: string;
  margin: { amount: number; percentOfPrice: number; feesIncluded: false }; stock: number | null; weightKg: number | null; categoryId: number | null; logisticsChannelIds: number[]; images: string[];
  variants: Variants | null; attributes: AttributeValue[]; attributeSchema: AttributeDef[] | null; priceRule: { markupPercent?: number; fixedPrice?: number } | null; updateStatus: "dirty" | "authorized" | null; lastSyncedAt: number | null;
  textSource: "supplier" | "model" | "user"; status: "draft" | "approved" | "publishing" | "published" | "failed" | "discarded"; externalItemId: string | null; lastError: string | null; issues: string[];
}
export interface PublishResult { id: string; ok: boolean; itemId?: string; error?: string; issues?: string[]; updated?: boolean }

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
  myPrograms: () => request<{ items: UserProgram[] }>("GET", "/api/ops/programs"),
  saveToMyPrograms: (programId: string, status = "saved") => request<{ ok: true; id: string }>("POST", "/api/ops/programs", { programId, status }),
  myProgram: (id: string) => request<UserProgramDetail>("GET", `/api/ops/programs/${id}`),
  patchMyProgram: (id: string, body: Record<string, unknown>) => request<{ ok: true }>("PATCH", `/api/ops/programs/${id}`, body),
  removeMyProgram: (id: string) => request<{ ok: true }>("DELETE", `/api/ops/programs/${id}`),
  addDoc: (id: string, body: { title: string; url: string }) => request<{ ok: true }>("POST", `/api/ops/programs/${id}/docs`, body),
  removeDoc: (id: string, docId: string) => request<{ ok: true }>("DELETE", `/api/ops/programs/${id}/docs/${docId}`),
  links: () => request<{ items: AffLink[] }>("GET", "/api/ops/links"),
  createLink: (body: Record<string, unknown>) => request<{ ok: true; id: string; code: string }>("POST", "/api/ops/links", body),
  patchLink: (id: string, body: Record<string, unknown>) => request<{ ok: true }>("PATCH", `/api/ops/links/${id}`, body),
  deleteLink: (id: string) => request<{ ok: true }>("DELETE", `/api/ops/links/${id}`),
  campaigns: () => request<{ items: Campaign[] }>("GET", "/api/ops/campaigns"),
  createCampaign: (body: Record<string, unknown>) => request<{ ok: true; id: string; warnings: string[] }>("POST", "/api/ops/campaigns", body),
  deleteCampaign: (id: string) => request<{ ok: true }>("DELETE", `/api/ops/campaigns/${id}`),
  commissions: (status = "") => request<{ items: Commission[] }>("GET", `/api/ops/commissions${status ? `?status=${status}` : ""}`),
  createCommission: (body: Record<string, unknown>) => request<{ ok: true; id: string }>("POST", "/api/ops/commissions", body),
  setCommissionStatus: (id: string, status: string) => request<{ ok: true }>("POST", `/api/ops/commissions/${id}/status`, { status }),
  addAdjustment: (id: string, body: { kind: string; amount: number }) => request<{ ok: true }>("POST", `/api/ops/commissions/${id}/adjustments`, body),
  deleteCommission: (id: string) => request<{ ok: true }>("DELETE", `/api/ops/commissions/${id}`),
  importCommissions: (programId: string, csv: string, dryRun: boolean) =>
    request<ImportResult>("POST", "/api/ops/commissions/import", { programId, csv, dryRun }),
  reconciliation: (programId: string) => request<Reconciliation>("GET", `/api/ops/reconciliation?programId=${programId}`),
  opsDashboard: () => request<OpsDashboard>("GET", "/api/ops/dashboard"),
  aiStatus: () => request<AiStatus>("GET", "/api/ai/status"),
  aiChat: (message: string, locale: string, programId?: string) => request<AiChat>("POST", "/api/ai/chat", { message, locale, programId: programId ?? null }),
  aiSearch: (q: string) => request<AiSearch>("GET", `/api/ai/search?q=${encodeURIComponent(q)}`),
  aiAnalysis: (id: string, locale: string) => request<AiAnalysis>("POST", `/api/ai/programs/${id}/analysis`, { locale }),
  aiStrategy: (id: string, locale: string) => request<AiStrategy>("POST", `/api/ai/programs/${id}/strategy`, { locale }),
  aiAdminConfig: () => request<{ config: AiConfig; modelAvailable: boolean }>("GET", "/api/ai/admin/config"),
  aiAdminSave: (config: AiConfig) => request<{ ok: true }>("PUT", "/api/ai/admin/config", config),
  aiAdminUsage: () => request<AiUsageAdmin>("GET", "/api/ai/admin/usage"),
  seasonal: (month: number) => request<{ items: SeasonalEntry[] }>("GET", `/api/studio/seasonal?month=${month}`),
  seasonalManage: () => request<{ items: SeasonalEntry[] }>("GET", "/api/studio/seasonal/manage"),
  seasonalCreate: (body: Record<string, unknown>) => request<{ ok: true; id: string }>("POST", "/api/studio/seasonal", body),
  seasonalPatch: (id: string, body: Record<string, unknown>) => request<{ ok: true }>("PATCH", `/api/studio/seasonal/${id}`, body),
  seasonalDelete: (id: string) => request<{ ok: true }>("DELETE", `/api/studio/seasonal/${id}`),
  adGenerate: (body: Record<string, unknown>) => request<AdGenerated>("POST", "/api/studio/ads/generate", body),
  ads: () => request<{ items: AdDraft[] }>("GET", "/api/studio/ads"),
  adPatch: (id: string, body: Record<string, unknown>) => request<{ item: AdDraft }>("PATCH", `/api/studio/ads/${id}`, body),
  adStatus: (id: string, status: string, acknowledgeUnverified = false) => request<{ item: AdDraft }>("POST", `/api/studio/ads/${id}/status`, { status, acknowledgeUnverified }),
  adExport: (id: string) => request<{ text: string; published: false }>("GET", `/api/studio/ads/${id}/export`),
  integStatus: () => request<{ vaultReady: boolean; hosts: string[] }>("GET", "/api/integrations/status"),
  connections: () => request<{ items: Connection[] }>("GET", "/api/integrations/connections"),
  connectionCreate: (body: Record<string, unknown>) => request<{ item: Connection }>("POST", "/api/integrations/connections", body),
  connectionDelete: (id: string) => request<{ ok: true }>("DELETE", `/api/integrations/connections/${id}`),
  shopeeAuthUrl: (id: string) => request<{ url: string }>("GET", `/api/integrations/connections/${id}/shopee/auth-url`),
  shopeeCategories: (id: string, q: string) => request<{ items: Array<{ id: number; name: string }> }>("GET", `/api/integrations/connections/${id}/shopee/categories?q=${encodeURIComponent(q)}`),
  shopeeChannels: (id: string) => request<{ items: Array<{ id: number; name: string; enabled: boolean }> }>("GET", `/api/integrations/connections/${id}/shopee/channels`),
  supplierImport: (body: Record<string, unknown>) => request<{ created?: number; updated?: number; valid?: number; dryRun?: boolean; errors: Array<{ row: number; error: string }> }>("POST", "/api/integrations/supplier/import", body),
  supplierSync: (id: string) => request<{ created: number; updated: number; errors: Array<{ row: number; error: string }> }>("POST", `/api/integrations/connections/${id}/supplier/sync`),
  supplierProducts: (connectionId?: string) => request<{ items: SupplierProduct[] }>("GET", `/api/integrations/supplier/products${connectionId ? `?connectionId=${connectionId}` : ""}`),
  storeBuild: (body: Record<string, unknown>) => request<{ items: Listing[]; skipped: Array<{ productId: string; reason: string }>; published: false }>("POST", "/api/market/store/build", body),
  listings: (connectionId?: string) => request<{ items: Listing[] }>("GET", `/api/market/listings${connectionId ? `?connectionId=${connectionId}` : ""}`),
  listingPatch: (id: string, body: Record<string, unknown>) => request<{ item: Listing }>("PATCH", `/api/market/listings/${id}`, body),
  listingBulk: (body: Record<string, unknown>) => request<{ updated: number }>("POST", "/api/market/listings/bulk-patch", body),
  listingAuthorize: (listingIds: string[], confirmCount: number) => request<{ authorized: string[]; rejected: Array<{ id: string; issues: string[] }> }>("POST", "/api/market/listings/authorize", { listingIds, confirmCount }),
  listingStatus: (id: string, status: string) => request<{ item: Listing }>("POST", `/api/market/listings/${id}/status`, { status }),
  listingPublish: (listingIds: string[]) => request<{ results: PublishResult[] }>("POST", "/api/market/listings/publish", { listingIds }),
  listingDelete: (id: string) => request<{ ok: true }>("DELETE", `/api/market/listings/${id}`),
  connectionPatch: (id: string, body: { autoStock: boolean }) => request<{ item: Connection }>("PATCH", `/api/integrations/connections/${id}`, body),
  syncPreview: (connectionId: string) => request<{ items: Array<{ listingId: string; productName: string; proposal: SyncProposal }>; checked: number }>("POST", "/api/market/sync/preview", { connectionId }),
  syncApply: (connectionId: string, listingIds: string[], kinds: Array<"stock" | "price">) => request<{ applied: number; requiresAuthorization: true }>("POST", "/api/market/sync/apply", { connectionId, listingIds, kinds }),
  orders: (connectionId?: string) => request<{ items: Order[] }>("GET", `/api/orders${connectionId ? `?connectionId=${connectionId}` : ""}`),
  ordersSync: (connectionId: string, days: number) => request<{ created: number; updated: number }>("POST", "/api/orders/sync", { connectionId, days }),
  orderSheet: (id: string) => request<SupplierSheet>("GET", `/api/orders/${id}/supplier-sheet`),
  orderPatch: (id: string, body: Record<string, unknown>) => request<{ item: Order }>("PATCH", `/api/orders/${id}`, body),
  orderTracking: (id: string) => request<{ item: Order }>("POST", `/api/orders/${id}/tracking/refresh`),
  adDelete: (id: string) => request<{ ok: true }>("DELETE", `/api/studio/ads/${id}`),
};
