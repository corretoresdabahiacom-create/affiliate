import type { Role } from "@ai/shared";

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  APP_URL: string;
  ADMIN_EMAILS?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
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
