import { getCookie } from "hono/cookie";
import type { Role } from "@ai/shared";
import { sha256Hex } from "./crypto";
import type { Env, SessionUser } from "./types";

export const COOKIE = "ai_session";

export async function lookupSession(env: Env, token: string): Promise<{ user: SessionUser; hash: string } | null> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.role, u.plan_id FROM sessions s JOIN users u ON u.id = s.user_id " +
      "WHERE s.token_hash = ? AND s.expires_at > ?",
  )
    .bind(hash, Date.now())
    .first<{ id: string; email: string; role: Role; plan_id: string }>();
  if (!row) return null;
  return { user: { id: row.id, email: row.email, role: row.role, planId: row.plan_id }, hash };
}

export const requireUser = async (c: any, next: any) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: "unauthenticated" }, 401);
  const found = await lookupSession(c.env, token);
  if (!found) return c.json({ error: "unauthenticated" }, 401);
  c.set("user", found.user);
  c.set("sessionHash", found.hash);
  await next();
};

export const requireRole =
  (...roles: Role[]) =>
  async (c: any, next: any) => {
    const user = c.get("user") as SessionUser;
    if (!roles.includes(user.role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };

