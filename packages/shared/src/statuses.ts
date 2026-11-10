// Constantes compartilhadas sem dependências (evita importação circular entre index e ops).
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
