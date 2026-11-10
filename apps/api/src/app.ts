import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  DEFAULT_LOCALE,
  loginRequestSchema,
  profileSchema,
  roleUpdateSchema,
  verifyRequestSchema,
  type Locale,
  type Role,
} from "@ai/shared";
import { audit } from "./audit";
import { randomToken, sha256Hex } from "./crypto";
import { sendMagicLink } from "./mailer";
import { COOKIE, requireRole, requireUser } from "./middleware";
import { catalog } from "./catalog";
import { intel } from "./intel";
import { allow } from "./ratelimit";
import { ops } from "./ops";
import { isBotUserAgent } from "@ai/shared";
import type { AppBindings, Env, SessionUser } from "./types";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_TTL_MS = 15 * 60 * 1000;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const app = new Hono<AppBindings>();

app.use("*", secureHeaders());

/**
 * Proteção CSRF: o cookie é SameSite=Lax e toda requisição que altera dados
 * precisa do cabeçalho X-Requested-With (um formulário de outro site não consegue enviá-lo)
 * e, se houver Origin, ele deve ser o do app.
 */
app.use("/api/*", async (c, next) => {
  if (MUTATING.has(c.req.method)) {
    if (c.req.header("x-requested-with") !== "fetch") {
      return c.json({ error: "csrf_header_missing" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.env.APP_URL).origin) {
      return c.json({ error: "origin_not_allowed" }, 403);
    }
  }
  await next();
});

const isHttps = (env: Env) => env.APP_URL.startsWith("https://");
const adminEmails = (env: Env) =>
  (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

app.get("/api/health", (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT }));

// ---------- Autenticação por link mágico ----------

app.post("/api/auth/login", async (c) => {
  const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const { email } = parsed.data;
  const locale: Locale = parsed.data.locale ?? DEFAULT_LOCALE;

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const okIp = await allow(c.env.DB, `login:ip:${ip}`, 10, 3600);
  const okEmail = await allow(c.env.DB, `login:email:${email}`, 5, 3600);
  if (!okIp || !okEmail) return c.json({ error: "rate_limited" }, 429);

  const now = Date.now();
  await c.env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now).run();

  const token = randomToken();
  await c.env.DB.prepare(
    "INSERT INTO login_tokens (token_hash, email, locale, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(await sha256Hex(token), email, locale, now, now + LOGIN_TTL_MS)
    .run();

  const url = `${c.env.APP_URL.replace(/\/$/, "")}/auth/verify?token=${token}`;
  await sendMagicLink(c.env, email, url, locale);

  // Resposta idêntica exista ou não a conta: sem enumeração de usuários.
  // O link só é devolvido em desenvolvimento, nunca em produção.
  return c.json({ ok: true, ...(c.env.ENVIRONMENT === "development" ? { devLink: url } : {}) });
});

app.post("/api/auth/verify", async (c) => {
  const parsed = verifyRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);

  const now = Date.now();
  const hash = await sha256Hex(parsed.data.token);

  // Consumo atômico: só um dos pedidos concorrentes consegue marcar used_at.
  const consumed = await c.env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
  )
    .bind(now, hash, now)
    .run();
  if (consumed.meta.changes !== 1) return c.json({ error: "invalid_or_expired_token" }, 400);

  const tokenRow = await c.env.DB.prepare("SELECT email, locale FROM login_tokens WHERE token_hash = ?")
    .bind(hash)
    .first<{ email: string; locale: Locale }>();
  if (!tokenRow) return c.json({ error: "invalid_or_expired_token" }, 400);

  const shouldBeAdmin = adminEmails(c.env).includes(tokenRow.email);
  let user = await c.env.DB.prepare("SELECT id, email, role, plan_id FROM users WHERE email = ?")
    .bind(tokenRow.email)
    .first<{ id: string; email: string; role: Role; plan_id: string }>();

  if (!user) {
    const id = crypto.randomUUID();
    const role: Role = shouldBeAdmin ? "admin" : "user";
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO users (id, email, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)").bind(
        id,
        tokenRow.email,
        role,
        now,
        now,
      ),
      c.env.DB.prepare("INSERT INTO user_profiles (user_id, locale, updated_at) VALUES (?, ?, ?)").bind(
        id,
        tokenRow.locale,
        now,
      ),
    ]);
    user = { id, email: tokenRow.email, role, plan_id: "free" };
    await audit(c.env.DB, id, "user.created", id);
  } else {
    if (shouldBeAdmin && user.role !== "admin") {
      await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
      user.role = "admin";
      await audit(c.env.DB, user.id, "user.role_bootstrap", user.id, { role: "admin" });
    }
    await c.env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, user.id).run();
  }

  const sessionToken = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(sessionToken), user.id, now, now + SESSION_TTL_MS)
    .run();
  await audit(c.env.DB, user.id, "auth.login", user.id);

  setCookie(c, COOKIE, sessionToken, {
    httpOnly: true,
    secure: isHttps(c.env),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.json({ ok: true, user: { id: user.id, email: user.email, role: user.role } });
});

app.post("/api/auth/logout", requireUser, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(c.get("sessionHash")).run();
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---------- Conta e perfil ----------

type ProfileRow = {
  display_name: string | null;
  locale: Locale;
  country: string | null;
  experience: string | null;
  niches: string;
  channels: string;
  has_website: number;
  monthly_budget_usd: number | null;
  wants_recurring: number;
  accepts_paid_traffic: number;
  languages?: string | null;
  audience_size?: number | null;
  weekly_hours?: number | null;
  prefers_physical?: number;
  prefers_saas?: number;
  onboarded_at: number | null;
};

const toProfile = (r: ProfileRow | null) =>
  r && {
    displayName: r.display_name,
    locale: r.locale,
    country: r.country,
    experience: r.experience,
    niches: JSON.parse(r.niches) as string[],
    channels: JSON.parse(r.channels) as string[],
    hasWebsite: !!r.has_website,
    monthlyBudgetUsd: r.monthly_budget_usd,
    wantsRecurring: !!r.wants_recurring,
    acceptsPaidTraffic: !!r.accepts_paid_traffic,
    languages: JSON.parse(r.languages ?? "[]") as string[],
    audienceSize: r.audience_size ?? null,
    weeklyHours: r.weekly_hours ?? null,
    prefersPhysical: !!r.prefers_physical,
    prefersSaas: !!r.prefers_saas,
    onboarded: r.onboarded_at !== null,
  };

async function loadProfile(db: D1Database, userId: string) {
  const row = await db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").bind(userId).first<ProfileRow>();
  return toProfile(row);
}

app.get("/api/me", requireUser, async (c) => {
  const user = c.get("user");
  return c.json({ user, profile: await loadProfile(c.env.DB, user.id) });
});

app.put("/api/me/profile", requireUser, async (c) => {
  const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const user = c.get("user");
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO user_profiles (user_id, display_name, locale, country, experience, niches, channels,
       has_website, monthly_budget_usd, wants_recurring, accepts_paid_traffic, languages, audience_size,
       weekly_hours, prefers_physical, prefers_saas, onboarded_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = excluded.display_name, locale = excluded.locale, country = excluded.country,
       experience = excluded.experience, niches = excluded.niches, channels = excluded.channels,
       has_website = excluded.has_website, monthly_budget_usd = excluded.monthly_budget_usd,
       wants_recurring = excluded.wants_recurring, accepts_paid_traffic = excluded.accepts_paid_traffic,
       languages = excluded.languages, audience_size = excluded.audience_size, weekly_hours = excluded.weekly_hours,
       prefers_physical = excluded.prefers_physical, prefers_saas = excluded.prefers_saas,
       onboarded_at = COALESCE(user_profiles.onboarded_at, excluded.onboarded_at),
       updated_at = excluded.updated_at`,
  )
    .bind(
      user.id,
      p.displayName ?? null,
      p.locale,
      p.country ?? null,
      p.experience ?? null,
      JSON.stringify(p.niches),
      JSON.stringify(p.channels),
      p.hasWebsite ? 1 : 0,
      p.monthlyBudgetUsd ?? null,
      p.wantsRecurring ? 1 : 0,
      p.acceptsPaidTraffic ? 1 : 0,
      JSON.stringify(p.languages),
      p.audienceSize ?? null,
      p.weeklyHours ?? null,
      p.prefersPhysical ? 1 : 0,
      p.prefersSaas ? 1 : 0,
      now,
      now,
    )
    .run();
  await audit(c.env.DB, user.id, "profile.updated", user.id);
  return c.json({ ok: true, profile: await loadProfile(c.env.DB, user.id) });
});

// LGPD/GDPR: exportação e exclusão da própria conta.
async function exportOps(db: D1Database, userId: string) {
  const q = async (table: string) => (await db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).bind(userId).all()).results;
  const [programs, programHistory, programDocs, links, linkClicks, campaigns, commissions, adjustments] = await Promise.all(
    ["user_programs", "user_program_history", "user_program_docs", "affiliate_links", "link_clicks", "campaigns", "commissions", "commission_adjustments"].map(q),
  );
  return { programs, programHistory, programDocs, links, linkClicks, campaigns, commissions, adjustments };
}

app.get("/api/me/export", requireUser, async (c) => {
  const user = c.get("user");
  const created = await c.env.DB.prepare("SELECT created_at, last_login_at FROM users WHERE id = ?")
    .bind(user.id)
    .first();
  return c.json({
    exportedAt: new Date().toISOString(),
    user: { ...user, ...created },
    profile: await loadProfile(c.env.DB, user.id),
    ...(await exportOps(c.env.DB, user.id)),
  });
});

app.delete("/api/me", requireUser, async (c) => {
  const user = c.get("user");
  await audit(c.env.DB, user.id, "user.deleted", user.id);
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run(); // cascata: perfil e sessões
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---------- Administração ----------

const admin = new Hono<AppBindings>();
admin.use("*", requireUser, requireRole("admin"));

admin.get("/users", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, role, plan_id AS planId, created_at AS createdAt, last_login_at AS lastLoginAt " +
      "FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
  )
    .bind(limit, offset)
    .all();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return c.json({ users: results, total: total?.n ?? 0 });
});

admin.patch("/users/:id/role", async (c) => {
  const parsed = roleUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const actor = c.get("user");
  const id = c.req.param("id");
  if (id === actor.id) return c.json({ error: "cannot_change_own_role" }, 400);
  const res = await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(parsed.data.role, id).run();
  if (res.meta.changes !== 1) return c.json({ error: "not_found" }, 404);
  await audit(c.env.DB, actor.id, "user.role_changed", id, { role: parsed.data.role });
  return c.json({ ok: true });
});

admin.get("/audit", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const { results } = await c.env.DB.prepare(
    "SELECT id, user_id AS userId, action, target, metadata, created_at AS createdAt " +
      "FROM audit_logs ORDER BY id DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return c.json({ entries: results });
});

const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  monthlyPriceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  limits: z.record(z.number().int().min(0)).optional(),
  active: z.boolean().optional(),
});

admin.get("/plans", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, monthly_price_cents AS monthlyPriceCents, currency, limits, active FROM plans ORDER BY sort_order",
  ).all<{ limits: string; active: number }>();
  return c.json({
    plans: results.map((p) => ({ ...p, limits: JSON.parse(p.limits), active: !!p.active })),
  });
});

admin.put("/plans/:id", async (c) => {
  const parsed = planUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);
  const id = c.req.param("id");
  const p = parsed.data;
  const res = await c.env.DB.prepare(
    `UPDATE plans SET
       name = COALESCE(?, name),
       monthly_price_cents = CASE WHEN ? = 1 THEN ? ELSE monthly_price_cents END,
       currency = COALESCE(?, currency),
       limits = COALESCE(?, limits),
       active = COALESCE(?, active)
     WHERE id = ?`,
  )
    .bind(
      p.name ?? null,
      p.monthlyPriceCents === undefined ? 0 : 1,
      p.monthlyPriceCents ?? null,
      p.currency ?? null,
      p.limits ? JSON.stringify(p.limits) : null,
      p.active === undefined ? null : p.active ? 1 : 0,
      id,
    )
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "not_found" }, 404);
  await audit(c.env.DB, c.get("user").id, "plan.updated", id, p as Record<string, unknown>);
  return c.json({ ok: true });
});

app.route("/api/admin", admin);
app.route("/api/catalog", catalog);
app.route("/api/intel", intel);
app.route("/api/ops", ops);

// ---------- Redirecionamento próprio (/r/:code) ----------
// Só funciona para links "own_redirect" de programas que CONFIRMARAM permitir redirecionamento.
// Redireciona para a URL exata cadastrada (sem alterar parâmetros de rastreamento). Não usa cookies nem guarda IP.
const CLICK_DEDUPE_MS = 30 * 60 * 1000;
const CLICK_CAP_PER_HOUR = 500;

app.get("/r/:code", async (c) => {
  const link = await c.env.DB.prepare(
    `SELECT l.id, l.user_id, l.url, l.active, l.tracking_mode, p.allows_redirect, p.lifecycle_status
     FROM affiliate_links l LEFT JOIN affiliate_programs p ON p.id = l.program_id WHERE l.code = ?`,
  )
    .bind(c.req.param("code"))
    .first<Record<string, any>>();
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (!link) return c.text("Link not found", 404, headers);
  if (!link.active || link.tracking_mode !== "own_redirect" || link.allows_redirect !== "yes" || link.lifecycle_status !== "active") {
    return c.text("Link unavailable", 410, headers);
  }
  const ua = c.req.header("user-agent") ?? "";
  if (!isBotUserAgent(ua)) {
    const t = Date.now();
    const day = new Date(t).toISOString().slice(0, 10);
    const ip = c.req.header("cf-connecting-ip") ?? "";
    // Hash diário com sal: não identifica a pessoa e não permite rastrear entre dias.
    const visitor = (await sha256Hex(`${ip}|${ua}|${day}|${c.env.CLICK_SALT ?? "dev-salt"}`)).slice(0, 32);
    const recent = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n, SUM(visitor_hash = ? AND at > ?) AS dup FROM link_clicks WHERE link_id = ? AND at > ?",
    )
      .bind(visitor, t - CLICK_DEDUPE_MS, link.id, t - 3_600_000)
      .first<{ n: number; dup: number | null }>();
    if ((recent?.n ?? 0) < CLICK_CAP_PER_HOUR && !(recent?.dup ?? 0)) {
      await c.env.DB.prepare("INSERT INTO link_clicks (id, link_id, user_id, at, source, visitor_hash) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), link.id, link.user_id, t, (c.req.query("s") ?? "").slice(0, 40) || null, visitor)
        .run();
    }
  }
  return c.redirect(link.url as string, 302);
});


app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not_found" }, 404) : c.text("Not found", 404)));
app.onError((err, c) => {
  console.error("[api] erro não tratado:", err);
  return c.json({ error: "internal_error" }, 500);
});
