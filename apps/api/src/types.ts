import type { Role } from "@ai/shared";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  APP_URL: string;
  ADMIN_EMAILS?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  CLICK_SALT?: string;
  /** 32 bytes em base64. Cifra as credenciais de integrações. Sem ela, o cofre fica desativado. */
  CREDENTIALS_KEY?: string;
  /** Workers AI (opcional). Sem ele, a IA responde só com os fatos do sistema. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  planId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { user: SessionUser; sessionHash: string };
};
