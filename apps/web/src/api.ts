import type { ProfileInput, Role } from "@ai/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown_error");
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
};
