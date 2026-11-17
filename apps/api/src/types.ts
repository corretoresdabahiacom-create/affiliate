import type { Role } from "@ai/shared";
import type { Budget } from "./budget";

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
  /** Só em testes: "1" faz qualquer requisição que passe do orçamento do plano gratuito falhar. */
  STRICT_BUDGET?: string;
  /** "paid" quando a conta da Cloudflare está no Workers Paid: os orçamentos por invocação ficam maiores. */
  WORKER_PLAN?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  planId: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { user: SessionUser; sessionHash: string; budget: Budget };
};
