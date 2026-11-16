import { Hono } from "hono";
import {
  MAX_ATTEMPTS, backoffMs, classifyCheck, digestEmail, inboundBodySchema, inboundHookCreateSchema, normalizeContent, safeInternalLink, signPayload,
  webhookCreateSchema, webhookPatchSchema, type CheckState, type Locale, type WebhookEvent,
} from "@ai/shared";
import { audit } from "./audit";
import type { Row } from "./catalog";
import { blockedHost, importSupplier } from "./integrations";
import { buildAlerts } from "./intel";
import { sendMail } from "./mailer";
import { requireUser } from "./middleware";
import { allow } from "./ratelimit";
import type { AppBindings, Env } from "./types";
import { open, seal, vaultReady } from "./vault";

/**
 * Fase 7 — automações.
 * - Saída: webhooks assinados (HMAC) com reenvio; serve para n8n, Make, Zapier ou código próprio.
 * - Entrada: gancho com token (só o hash fica guardado) que aceita "notify" e "supplier.import".
 * - O sistema não publica em redes por conta própria: a publicação social fica a cargo do fluxo que você monta no n8n, a partir do evento `ad.approved`.
 * - O monitor de fontes só AVISA mudança; nunca altera o catálogo oficial.
 */
const now = () => Date.now();
const uid = (c: any) => c.get("user").id as string;
const j = <T>(s: unknown, d: T): T => { try { return s ? (JSON.parse(s as string) as T) : d; } catch { return d; } };
const DAY = 86_400_000;
const MAX_ENDPOINTS = 10;
const MAX_INBOUND = 10;

const sha256hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomToken = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const urlAllowed = (raw: string) => { try { const u = new URL(raw); return u.protocol === "https:" && !blockedHost(u.hostname); } catch { return false; } };

// ---------- Notificações internas ----------

export async function notify(db: D1Database, userId: string, kind: string, title: string, body?: string | null, link?: string | null) {
  await db.prepare("INSERT INTO notifications (id, user_id, kind, title, body, link, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), userId, kind, title.slice(0, 120), body?.slice(0, 500) ?? null, safeInternalLink(link), now()).run();
}

// ---------- Webhooks de saída ----------

/** Enfileira o evento para cada endpoint ativo que o assina. A entrega acontece em processDeliveries (e o cron reenvia o que falhar). */
export async function emit(env: Env, userId: string, event: WebhookEvent, data: Record<string, unknown>, ctx?: { waitUntil(p: Promise<unknown>): void } | null): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, events FROM webhook_endpoints WHERE user_id = ? AND active = 1").bind(userId).all<Row>();
  let n = 0;
  for (const e of results) {
    if (!j<string[]>(e.events, []).includes(event)) continue;
    const id = crypto.randomUUID();
    const payload = JSON.stringify({ id, event, createdAt: new Date().toISOString(), data });
    await env.DB.prepare("INSERT INTO webhook_deliveries (id, user_id, endpoint_id, event, payload, next_attempt_at, created_at) VALUES (?,?,?,?,?,?,?)").bind(id, userId, e.id, event, payload, now(), now()).run();
    n++;
  }
  if (n && ctx) ctx.waitUntil(processDeliveries(env, 20, userId).catch(() => undefined));
  return n;
}
const tryEmit = (c: any, event: WebhookEvent, data: Record<string, unknown>, userId?: string) => {
  let ctx: any = null;
  try { ctx = c.executionCtx; } catch { /* sem contexto (testes) */ }
  return emit(c.env, userId ?? uid(c), event, data, ctx).catch(() => 0);
};
export { tryEmit as emitFrom };

/** Tenta entregar o que está vencido. Resposta 2xx = entregue; qualquer outra coisa gera nova tentativa com espera crescente, até MAX_ATTEMPTS. */
export async function processDeliveries(env: Env, limit = 50, userId?: string): Promise<{ delivered: number; retried: number; dead: number }> {
  const stats = { delivered: 0, retried: 0, dead: 0 };
  if (!(await vaultReady(env))) return stats;
  const { results } = await env.DB.prepare(
    `SELECT d.*, e.url, e.secret_enc, e.active FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ? ${userId ? "AND d.user_id = ?" : ""} ORDER BY d.next_attempt_at LIMIT ?`,
  ).bind(...[now(), ...(userId ? [userId] : []), limit]).all<Row>();
  for (const d of results) {
    // reserva atômica: dois processos não enviam o mesmo evento
    const claim = await env.DB.prepare("UPDATE webhook_deliveries SET next_attempt_at = ? WHERE id = ? AND status = 'pending' AND next_attempt_at = ?").bind(now() + 120_000, d.id, d.next_attempt_at).run();
    if (!claim.meta.changes) continue;
    let status: number | null = null;
    let error: string | null = null;
    try {
      if (!d.active) throw new Error("endpoint_inactive");
      if (!urlAllowed(d.url as string)) throw new Error("endpoint_not_allowed");
      const sec = await open<{ secret: string }>(env, d.secret_enc as string);
      if (!sec) throw new Error("secret_unavailable");
      const ts = Math.floor(now() / 1000);
      const body = d.payload as string;
      const res = await fetch(d.url as string, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "content-type": "application/json", "user-agent": "AffiliateIntelligence-Webhook/1.0", "x-ai-event": d.event as string, "x-ai-delivery": d.id as string, "x-ai-timestamp": String(ts), "x-ai-signature": await signPayload(sec.secret, ts, body) },
        body,
      });
      status = res.status;
      if (!(res.status >= 200 && res.status < 300)) error = `http_${res.status}`;
    } catch (e) {
      error = (e as Error).message?.slice(0, 120) || "network_error";
    }
    const attempts = (d.attempts as number) + 1;
    if (!error) {
      await env.DB.prepare("UPDATE webhook_deliveries SET status='delivered', attempts=?, response_status=?, error=NULL, delivered_at=? WHERE id=?").bind(attempts, status, now(), d.id).run();
      await env.DB.prepare("UPDATE webhook_endpoints SET consecutive_dead=0, last_delivery_at=? WHERE id=?").bind(now(), d.endpoint_id).run();
      stats.delivered++;
      continue;
    }
    const wait = error === "endpoint_not_allowed" || error === "endpoint_inactive" ? null : backoffMs(attempts);
    if (wait == null) {
      await env.DB.prepare("UPDATE webhook_deliveries SET status='dead', attempts=?, response_status=?, error=? WHERE id=?").bind(attempts, status, error, d.id).run();
      const ep = await env.DB.prepare("UPDATE webhook_endpoints SET consecutive_dead = consecutive_dead + 1 WHERE id = ? RETURNING consecutive_dead, label, user_id").bind(d.endpoint_id).first<Row>();
      stats.dead++;
      if (ep && (ep.consecutive_dead as number) >= 10) {
        await env.DB.prepare("UPDATE webhook_endpoints SET active = 0 WHERE id = ?").bind(d.endpoint_id).run();
        await notify(env.DB, ep.user_id as string, "webhook.disabled", `Webhook desativado: ${ep.label}`, "10 entregas seguidas falharam. Corrija o endereço e reative.", "/automations");
      }
    } else {
      await env.DB.prepare("UPDATE webhook_deliveries SET attempts=?, next_attempt_at=?, response_status=?, error=? WHERE id=?").bind(attempts, now() + wait, status, error, d.id).run();
      stats.retried++;
    }
  }
  return stats;
}

export const automation = new Hono<AppBindings>();
automation.use("*", requireUser);

const epOut = (r: Row) => ({ id: r.id, label: r.label, url: r.url, events: j<string[]>(r.events, []), active: !!r.active, consecutiveDead: r.consecutive_dead, lastDeliveryAt: r.last_delivery_at, createdAt: r.created_at });

automation.get("/webhooks", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM webhook_endpoints WHERE user_id = ? ORDER BY created_at DESC").bind(uid(c)).all<Row>();
  return c.json({ items: results.map(epOut), vaultReady: await vaultReady(c.env) });
});

automation.post("/webhooks", async (c) => {
  const p = webhookCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input", issues: p.error.issues }, 400);
  if (!(await vaultReady(c.env))) return c.json({ error: "vault_not_configured" }, 503);
  if (!urlAllowed(p.data.url)) return c.json({ error: "endpoint_not_allowed" }, 422);
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM webhook_endpoints WHERE user_id = ?").bind(uid(c)).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_ENDPOINTS) return c.json({ error: "limit_reached", max: MAX_ENDPOINTS }, 409);
  const id = crypto.randomUUID();
  const secret = "whsec_" + randomToken(24);
  await c.env.DB.prepare("INSERT INTO webhook_endpoints (id, user_id, label, url, secret_enc, events, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, uid(c), p.data.label, p.data.url, await seal(c.env, { secret }), JSON.stringify([...new Set(p.data.events)]), now()).run();
  await audit(c.env.DB, uid(c), "webhook.created", id, { events: p.data.events });
  const row = await c.env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id = ?").bind(id).first<Row>();
  return c.json({ item: epOut(row!), secret, note: "secret_shown_once" }, 201);
});

async function ownEndpoint(c: any): Promise<Row | null> {
  return c.env.DB.prepare("SELECT * FROM webhook_endpoints WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).first();
}

automation.patch("/webhooks/:id", async (c) => {
  const e = await ownEndpoint(c);
  if (!e) return c.json({ error: "not_found" }, 404);
  const p = webhookPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const d = p.data;
  await c.env.DB.prepare("UPDATE webhook_endpoints SET label=?, events=?, active=?, consecutive_dead=? WHERE id=?")
    .bind(d.label ?? e.label, d.events ? JSON.stringify([...new Set(d.events)]) : e.events, d.active === undefined ? e.active : d.active ? 1 : 0, d.active ? 0 : e.consecutive_dead, e.id).run();
  return c.json({ item: epOut((await ownEndpoint(c))!) });
});

automation.delete("/webhooks/:id", async (c) => {
  const e = await ownEndpoint(c);
  if (!e) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM webhook_endpoints WHERE id = ?").bind(e.id).run();
  await audit(c.env.DB, uid(c), "webhook.deleted", e.id as string);
  return c.json({ ok: true });
});

/** Envia um evento de teste e já tenta entregar, para a pessoa ver se o n8n recebeu. */
automation.post("/webhooks/:id/test", async (c) => {
  const e = await ownEndpoint(c);
  if (!e) return c.json({ error: "not_found" }, 404);
  if (!(await allow(c.env.DB, `webhook-test:${uid(c)}`, 10, 60))) return c.json({ error: "rate_limited" }, 429);
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ id, event: "test.ping", createdAt: new Date().toISOString(), data: { message: "ping" } });
  await c.env.DB.prepare("INSERT INTO webhook_deliveries (id, user_id, endpoint_id, event, payload, next_attempt_at, created_at) VALUES (?,?,?,?,?,?,?)").bind(id, uid(c), e.id, "test.ping", payload, now(), now()).run();
  await processDeliveries(c.env, 5, uid(c));
  const d = await c.env.DB.prepare("SELECT status, attempts, response_status, error FROM webhook_deliveries WHERE id = ?").bind(id).first<Row>();
  return c.json({ status: d?.status, responseStatus: d?.response_status, error: d?.error });
});

automation.get("/webhooks/:id/deliveries", async (c) => {
  const e = await ownEndpoint(c);
  if (!e) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare("SELECT id, event, status, attempts, response_status, error, created_at, delivered_at FROM webhook_deliveries WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT 30").bind(e.id).all<Row>();
  return c.json({ items: results.map((r) => ({ id: r.id, event: r.event, status: r.status, attempts: r.attempts, responseStatus: r.response_status, error: r.error, createdAt: r.created_at, deliveredAt: r.delivered_at })), maxAttempts: MAX_ATTEMPTS });
});

// ---------- Entrada (n8n → sistema) ----------

automation.get("/inbound", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, label, actions, last_used_at, created_at FROM inbound_hooks WHERE user_id = ? ORDER BY created_at DESC").bind(uid(c)).all<Row>();
  return c.json({ items: results.map((r) => ({ id: r.id, label: r.label, actions: j<string[]>(r.actions, []), lastUsedAt: r.last_used_at, createdAt: r.created_at })) });
});

automation.post("/inbound", async (c) => {
  const p = inboundHookCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid_input" }, 400);
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM inbound_hooks WHERE user_id = ?").bind(uid(c)).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_INBOUND) return c.json({ error: "limit_reached", max: MAX_INBOUND }, 409);
  const id = crypto.randomUUID();
  const token = "ihk_" + randomToken(24);
  await c.env.DB.prepare("INSERT INTO inbound_hooks (id, user_id, label, token_hash, actions, created_at) VALUES (?,?,?,?,?,?)").bind(id, uid(c), p.data.label, await sha256hex(token), JSON.stringify([...new Set(p.data.actions)]), now()).run();
  await audit(c.env.DB, uid(c), "inbound_hook.created", id, { actions: p.data.actions });
  return c.json({ item: { id, label: p.data.label, actions: p.data.actions }, token, url: `${c.env.APP_URL}/api/hooks/in/${id}`, note: "token_shown_once" }, 201);
});

automation.delete("/inbound/:id", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM inbound_hooks WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid(c)).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  await audit(c.env.DB, uid(c), "inbound_hook.deleted", c.req.param("id"));
  return c.json({ ok: true });
});

/** Rota pública do gancho: autenticada só pelo token (Authorization: Bearer). Fora da proteção CSRF por ser chamada de servidor. */
export const inbound = new Hono<AppBindings>();
inbound.post("/:id", async (c) => {
  const id = c.req.param("id");
  const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!(await allow(c.env.DB, `inbound:${id}`, 60, 60))) return c.json({ error: "rate_limited" }, 429);
  const h = await c.env.DB.prepare("SELECT * FROM inbound_hooks WHERE id = ?").bind(id).first<Row>();
  // mesma resposta para gancho inexistente e token errado
  if (!h || !token || (await sha256hex(token)) !== h.token_hash) return c.json({ error: "unauthorized" }, 401);
  const body = inboundBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_input", issues: body.error.issues }, 400);
  if (!j<string[]>(h.actions, []).includes(body.data.action)) return c.json({ error: "action_not_allowed" }, 403);
  await c.env.DB.prepare("UPDATE inbound_hooks SET last_used_at = ? WHERE id = ?").bind(now(), id).run();
  if (body.data.action === "notify") {
    await notify(c.env.DB, h.user_id as string, "inbound.notify", body.data.title, body.data.body, body.data.link);
    return c.json({ ok: true });
  }
  c.set("user", { id: h.user_id as string, email: "", role: "user", planId: "free" });
  const r = await importSupplier(c, body.data);
  return c.json(r.body, r.status as any);
});

// ---------- Notificações e e-mail ----------

automation.get("/notifications", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(uid(c)).all<Row>();
  const u = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(uid(c)).first<{ n: number }>();
  const pr = await c.env.DB.prepare("SELECT email_enabled, frequency FROM alert_prefs WHERE user_id = ?").bind(uid(c)).first<Row>();
  return c.json({
    items: results.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, createdAt: r.created_at, read: r.read_at != null })),
    unread: u?.n ?? 0,
    prefs: { emailEnabled: !!pr?.email_enabled, frequency: (pr?.frequency as string) ?? "daily" },
    emailAvailable: !!c.env.RESEND_API_KEY && !!c.env.CLICK_SALT,
  });
});

automation.post("/notifications/read", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { ids?: string[] } | null;
  if (b?.ids?.length) {
    for (const id of b.ids.slice(0, 100)) await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL").bind(now(), id, uid(c)).run();
  } else {
    await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now(), uid(c)).run();
  }
  return c.json({ ok: true });
});

automation.put("/notifications/prefs", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { emailEnabled?: unknown } | null;
  if (!b || typeof b.emailEnabled !== "boolean") return c.json({ error: "invalid_input" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO alert_prefs (user_id, categories, frequency, seen_at, updated_at, email_enabled, last_digest_at, last_event_at) VALUES (?, ?, 'daily', 0, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET email_enabled = excluded.email_enabled, updated_at = excluded.updated_at, last_digest_at = CASE WHEN excluded.email_enabled = 1 AND alert_prefs.email_enabled = 0 THEN excluded.last_digest_at ELSE alert_prefs.last_digest_at END`,
  ).bind(uid(c), JSON.stringify(["new_programs", "new_products", "discontinued_products", "commission_changes", "rule_changes", "recurring", "now_accepts_brazil", "closed", "broken_links", "outdated"]), now(), b.emailEnabled ? 1 : 0, now(), now()).run();
  await audit(c.env.DB, uid(c), b.emailEnabled ? "notify.email_on" : "notify.email_off", uid(c));
  return c.json({ ok: true });
});

const unsubSig = async (env: Env, userId: string) => (await sha256hex(`unsub:${userId}:${env.CLICK_SALT ?? ""}`)).slice(0, 32);
/** Cancelar o e-mail com um clique, sem login. */
export const unsubscribe = new Hono<AppBindings>();
unsubscribe.get("/", async (c) => {
  const u = c.req.query("u") ?? "";
  if (!c.env.CLICK_SALT || !u || c.req.query("sig") !== (await unsubSig(c.env, u))) return c.text("Link inválido.", 400);
  await c.env.DB.prepare("UPDATE alert_prefs SET email_enabled = 0 WHERE user_id = ?").bind(u).run();
  return c.text("Pronto: você não receberá mais estes e-mails. / Done: you will no longer receive these emails.");
});

// ---------- Monitor de fontes oficiais ----------

const OFFICIAL_TYPES = "('official_docs','official_page','official_api','official_communication')";
const UA = "AffiliateIntelligence-Monitor/1.0 (+verificacao de pagina oficial)";

async function fetchSource(url: string): Promise<{ status: number | null; hash: string | null }> {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!urlAllowed(cur)) return { status: null, hash: null };
    try {
      const res = await fetch(cur, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": UA, accept: "text/html,*/*" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { cur = new URL(res.headers.get("location")!, cur).toString(); continue; }
      if (res.status < 200 || res.status >= 300) return { status: res.status, hash: null };
      const text = (await res.text()).slice(0, 1_000_000);
      return { status: res.status, hash: await sha256hex(normalizeContent(text)) };
    } catch {
      return { status: null, hash: null };
    }
  }
  return { status: null, hash: null };
}

/** Verifica uma fonte, guarda o estado e, se houve transição relevante, avisa quem segue o programa. Nunca mexe no catálogo. */
async function checkSource(env: Env, s: Row): Promise<string | null> {
  const prevRow = await env.DB.prepare("SELECT last_status, last_hash, failures FROM source_checks WHERE source_id = ?").bind(s.id).first<Row>();
  const prev: CheckState | null = prevRow ? { status: prevRow.last_status as number | null, hash: prevRow.last_hash as string | null, failures: prevRow.failures as number } : null;
  const got = await fetchSource(s.url as string);
  const { finding, next } = classifyCheck(prev, got);
  await env.DB.prepare(
    `INSERT INTO source_checks (source_id, last_status, last_hash, failures, last_checked_at, changed_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET last_status=excluded.last_status, last_hash=excluded.last_hash, failures=excluded.failures, last_checked_at=excluded.last_checked_at, changed_at=COALESCE(excluded.changed_at, source_checks.changed_at)`,
  ).bind(s.id, next.status, next.hash, next.failures, now(), finding?.kind === "source_changed" ? now() : null).run();
  if (!finding) return null;
  const { results: followers } = await env.DB.prepare("SELECT user_id FROM user_programs WHERE program_id = ?").bind(s.program_id).all<Row>();
  const title = { source_changed: `Fonte oficial mudou: ${s.program_name}`, source_down: `Fonte oficial fora do ar: ${s.program_name}`, source_back: `Fonte oficial voltou: ${s.program_name}` }[finding.kind];
  const body = finding.kind === "source_changed" ? "O texto da página oficial mudou. Revise as regras e a comissão antes de divulgar; o catálogo não foi alterado." : "Verifique a página oficial.";
  for (const f of followers) {
    await notify(env.DB, f.user_id as string, `monitor.${finding.kind}`, title, body, `/programs/${s.program_id}`);
    await emit(env, f.user_id as string, "monitor.finding", { kind: finding.kind, programId: s.program_id, programName: s.program_name, sourceUrl: s.url });
  }
  return finding.kind;
}

/** Cron: até `limit` fontes oficiais de programas seguidos, as mais antigas primeiro, no máximo 1 vez por 24 h cada. */
export async function runMonitor(env: Env, limit = 40): Promise<{ checked: number; findings: number }> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.url, s.program_id, p.name AS program_name FROM program_sources s
       JOIN affiliate_programs p ON p.id = s.program_id
       LEFT JOIN source_checks k ON k.source_id = s.id
      WHERE s.source_type IN ${OFFICIAL_TYPES} AND p.lifecycle_status = 'active'
        AND EXISTS (SELECT 1 FROM user_programs up WHERE up.program_id = s.program_id)
        AND (k.last_checked_at IS NULL OR k.last_checked_at < ?)
      ORDER BY COALESCE(k.last_checked_at, 0) ASC LIMIT ?`,
  ).bind(now() - DAY + 60_000, limit).all<Row>();
  let findings = 0;
  for (const s of results) if (await checkSource(env, s)) findings++;
  return { checked: results.length, findings };
}

automation.get("/monitor", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.program_id, p.name AS program_name, k.last_status, k.failures, k.last_checked_at, k.changed_at
       FROM user_programs up JOIN affiliate_programs p ON p.id = up.program_id
       JOIN program_sources s ON s.program_id = p.id AND s.source_type IN ${OFFICIAL_TYPES}
       LEFT JOIN source_checks k ON k.source_id = s.id
      WHERE up.user_id = ? ORDER BY p.name LIMIT 100`,
  ).bind(uid(c)).all<Row>();
  return c.json({ items: results.map((r) => ({ sourceId: r.id, programId: r.program_id, programName: r.program_name, url: r.url, lastStatus: r.last_status, failures: r.failures ?? 0, lastCheckedAt: r.last_checked_at, changedAt: r.changed_at })) });
});

automation.post("/monitor/check/:programId", async (c) => {
  const f = await c.env.DB.prepare("SELECT 1 FROM user_programs WHERE user_id = ? AND program_id = ?").bind(uid(c), c.req.param("programId")).first();
  if (!f) return c.json({ error: "not_found" }, 404);
  if (!(await allow(c.env.DB, `monitor-check:${uid(c)}`, 6, 60))) return c.json({ error: "rate_limited" }, 429);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.program_id, p.name AS program_name FROM program_sources s JOIN affiliate_programs p ON p.id = s.program_id
      WHERE s.program_id = ? AND s.source_type IN ${OFFICIAL_TYPES} LIMIT 5`,
  ).bind(c.req.param("programId")).all<Row>();
  const out: Array<string | null> = [];
  for (const s of results) out.push(await checkSource(c.env, s));
  return c.json({ checked: results.length, findings: out.filter(Boolean) });
});

// ---------- Resumo por e-mail e evento alert.new (cron) ----------

/**
 * Passa pelos usuários com e-mail ligado ou com webhook de alerta.
 * E-mail: respeita a frequência de alert_prefs; só marca como enviado se o provedor aceitou.
 * Evento alert.new: um lote por passada, com o que apareceu desde o último marco.
 */
export async function runAlertsPass(env: Env, at = now()): Promise<{ emails: number; events: number }> {
  const out = { emails: 0, events: 0 };
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, COALESCE(pr.locale, 'pt-BR') AS locale, a.email_enabled, a.frequency, a.last_digest_at, a.last_event_at,
            EXISTS (SELECT 1 FROM webhook_endpoints w WHERE w.user_id = u.id AND w.active = 1 AND w.events LIKE '%"alert.new"%') AS has_hook
       FROM users u LEFT JOIN user_profiles pr ON pr.user_id = u.id LEFT JOIN alert_prefs a ON a.user_id = u.id
      WHERE COALESCE(a.email_enabled, 0) = 1 OR EXISTS (SELECT 1 FROM webhook_endpoints w WHERE w.user_id = u.id AND w.active = 1 AND w.events LIKE '%"alert.new"%')
      LIMIT 200`,
  ).all<Row>();
  for (const u of results) {
    const userId = u.id as string;
    const { alerts } = await buildAlerts(env.DB, userId, 8);
    const real = alerts.filter((a) => a.category !== "outdated");
    if (u.has_hook) {
      const cursor = (u.last_event_at as number | null) || 0;
      if (cursor === 0) {
        await env.DB.prepare("INSERT INTO alert_prefs (user_id, categories, frequency, seen_at, updated_at, last_event_at) VALUES (?, ?, 'daily', 0, ?, ?) ON CONFLICT(user_id) DO UPDATE SET last_event_at = excluded.last_event_at").bind(userId, JSON.stringify(["new_programs", "new_products", "discontinued_products", "commission_changes", "rule_changes", "recurring", "now_accepts_brazil", "closed", "broken_links", "outdated"]), at, at).run();
      } else {
        const fresh = real.filter((a) => a.at > cursor).slice(0, 20);
        if (fresh.length) {
          await emit(env, userId, "alert.new", { alerts: fresh.map((a) => ({ programId: a.programId, programName: a.programName, category: a.category, field: a.field, oldValue: a.oldValue, newValue: a.newValue, at: a.at, sourceUrl: a.sourceUrl })) });
          out.events++;
        }
        await env.DB.prepare("UPDATE alert_prefs SET last_event_at = ? WHERE user_id = ?").bind(at, userId).run();
      }
    }
    if (u.email_enabled && env.RESEND_API_KEY && env.CLICK_SALT) {
      const gap = { instant: 0, daily: DAY - 3_600_000, weekly: 7 * DAY - 3_600_000 }[u.frequency as "instant" | "daily" | "weekly"] ?? DAY;
      const last = u.last_digest_at as number;
      if (at - last < gap) continue;
      const fresh = real.filter((a) => a.at > last);
      if (!fresh.length) continue;
      const url = `${env.APP_URL}/api/unsubscribe?u=${userId}&sig=${await unsubSig(env, userId)}`;
      const mail = digestEmail(u.locale as Locale, fresh.map((a) => ({ programName: a.programName, advertiser: a.advertiser, category: a.category, sourceUrl: a.sourceUrl })), url);
      const r = await sendMail(env, u.email as string, mail.subject, mail.text);
      if (r.delivered) {
        await env.DB.prepare("UPDATE alert_prefs SET last_digest_at = ? WHERE user_id = ?").bind(at, userId).run();
        out.emails++;
      }
    }
  }
  return out;
}

/** Limpeza: entregas com mais de 30 dias e notificações lidas com mais de 90. */
export async function purgeOld(env: Env) {
  await env.DB.prepare("DELETE FROM webhook_deliveries WHERE status != 'pending' AND created_at < ?").bind(now() - 30 * DAY).run();
  await env.DB.prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?").bind(now() - 90 * DAY).run();
}
