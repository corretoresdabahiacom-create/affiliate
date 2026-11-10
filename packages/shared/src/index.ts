import { z } from "zod";

/** Papéis de acesso. Chaves internas em inglês; a interface traduz. */
export const ROLES = ["user", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const LOCALES = ["pt-BR", "en-US", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";

/** Campos de aceitação com três estados: ausência de dado nunca vira "yes". */
export const TRI_STATE = ["yes", "no", "unverified"] as const;
export type TriState = (typeof TRI_STATE)[number];

/** Status internos de inscrição do usuário em um programa. */
export const APPLICATION_STATUS = [
  "interested",
  "saved",
  "application_pending",
  "approved",
  "rejected",
  "active",
  "suspended",
  "closed",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUS)[number];

/** Ciclo financeiro da comissão. Clique nunca vira venda sem confirmação. */
export const COMMISSION_STATUS = ["estimated", "pending", "approved", "paid", "rejected"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUS)[number];

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

export const loginRequestSchema = z.object({
  email: emailSchema,
  locale: z.enum(LOCALES).optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const verifyRequestSchema = z.object({
  token: z.string().min(20).max(200),
});

export const CHANNELS = ["blog", "youtube", "instagram", "tiktok", "email", "other"] as const;
export const NICHES = ["saas", "ai_tools", "physical_products", "digital_products", "services"] as const;
export const EXPERIENCE = ["none", "beginner", "intermediate", "advanced"] as const;

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(LOCALES).default(DEFAULT_LOCALE),
  country: z.string().trim().length(2).toUpperCase().optional(),
  experience: z.enum(EXPERIENCE).optional(),
  niches: z.array(z.enum(NICHES)).max(10).default([]),
  channels: z.array(z.enum(CHANNELS)).max(10).default([]),
  hasWebsite: z.boolean().default(false),
  monthlyBudgetUsd: z.number().int().min(0).max(1_000_000).optional(),
  wantsRecurring: z.boolean().default(false),
  acceptsPaidTraffic: z.boolean().default(false),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const roleUpdateSchema = z.object({ role: z.enum(ROLES) });

/** Formata moeda e data conforme a localidade. */
export function formatCurrency(value: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
}
export * from "./catalog";
export * from "./intel";
export * from "./simulator";
