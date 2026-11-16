import { z } from "zod";

/**
 * Fase 7 — automações: webhooks de saída (n8n e similares), entrada por token, notificações e monitoramento de fontes.
 * Regras: nada aqui altera o catálogo oficial; achados do monitor só avisam. Nenhum dado de comprador sai.
 */

export const WEBHOOK_EVENTS = ["listing.published", "listing.updated", "order.new", "ad.approved", "alert.new", "monitor.finding", "test.ping"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookCreateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
});
export type WebhookCreate = z.infer<typeof webhookCreateSchema>;

export const webhookPatchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

export const INBOUND_ACTIONS = ["notify", "supplier.import"] as const;
export const inboundHookCreateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  actions: z.array(z.enum(INBOUND_ACTIONS)).min(1),
});

export const inboundBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("notify"), title: z.string().trim().min(1).max(120), body: z.string().trim().max(500).optional(), link: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("supplier.import"), connectionId: z.string().min(1), format: z.enum(["csv", "json"]), data: z.string().min(1).max(2_000_000), dryRun: z.boolean().optional() }),
]);

/** Só links internos (começam com "/"): notificação não vira vetor de phishing. */
export const safeInternalLink = (l: string | null | undefined): string | null => (l && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(l) && !l.startsWith("//") ? l : null);

// ---------- Assinatura e reenvio ----------

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
/** Assinatura HMAC-SHA256 de `${timestamp}.${corpo}`. O receptor recalcula e compara; recusa timestamps antigos. */
export async function signPayload(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

export const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 30, 120, 360];
/** Espera antes da tentativa seguinte (1ª falha → 1 min … 5ª → 6 h). null = desistir. */
export const backoffMs = (attemptsDone: number): number | null => (attemptsDone >= MAX_ATTEMPTS ? null : BACKOFF_MIN[Math.max(attemptsDone - 1, 0)]! * 60_000);

// ---------- Monitor de fontes oficiais ----------

/** Texto estável da página: sem scripts, estilos, tags e espaços repetidos, para que ruído não pareça mudança. */
export function normalizeContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 200_000);
}

export type CheckState = { status: number | null; hash: string | null; failures: number };
export type Finding = { kind: "source_changed" | "source_down" | "source_back" } | null;
/**
 * Compara a verificação anterior com a atual.
 * Falha isolada não alarma (só a 2ª seguida); mudança de conteúdo avisa para REVISÃO humana, nunca altera o catálogo.
 * A primeira leitura só cria a base.
 */
export function classifyCheck(prev: CheckState | null, now: { status: number | null; hash: string | null }): { finding: Finding; next: CheckState } {
  const ok = now.status != null && now.status >= 200 && now.status < 300 && now.hash != null;
  if (!ok) {
    const failures = (prev?.failures ?? 0) + 1;
    return { finding: failures === 2 ? { kind: "source_down" } : null, next: { status: now.status, hash: prev?.hash ?? null, failures } };
  }
  const next = { status: now.status, hash: now.hash, failures: 0 };
  if (!prev || prev.hash == null) return { finding: (prev?.failures ?? 0) >= 2 ? { kind: "source_back" } : null, next };
  if (prev.failures >= 2) return { finding: { kind: "source_back" }, next };
  return { finding: prev.hash !== now.hash ? { kind: "source_changed" } : null, next };
}

// ---------- Resumo por e-mail ----------

export type DigestAlert = { programName: string; advertiser: string; category: string; sourceUrl: string | null };
const DIGEST_COPY = {
  "pt-BR": { subject: (n: number) => `${n} novidade(s) nos programas de afiliados`, intro: "Mudanças registradas no catálogo desde o último resumo. Confirme sempre na fonte oficial.", none: "Fonte oficial não registrada", off: "Para parar de receber estes e-mails:", cat: "categoria" },
  "en-US": { subject: (n: number) => `${n} update(s) in affiliate programs`, intro: "Changes recorded in the catalog since the last digest. Always confirm at the official source.", none: "No official source recorded", off: "To stop receiving these emails:", cat: "category" },
  es: { subject: (n: number) => `${n} novedad(es) en programas de afiliados`, intro: "Cambios registrados en el catálogo desde el último resumen. Confirme siempre en la fuente oficial.", none: "Fuente oficial no registrada", off: "Para dejar de recibir estos correos:", cat: "categoría" },
} as const;
export function digestEmail(locale: keyof typeof DIGEST_COPY, alerts: DigestAlert[], unsubscribeUrl: string): { subject: string; text: string } {
  const c = DIGEST_COPY[locale] ?? DIGEST_COPY["pt-BR"];
  const lines = alerts.slice(0, 30).map((a) => `- ${a.programName} (${a.advertiser}) · ${c.cat}: ${a.category} · ${a.sourceUrl ?? c.none}`);
  return { subject: c.subject(alerts.length), text: `${c.intro}\n\n${lines.join("\n")}\n\n${c.off}\n${unsubscribeUrl}` };
}
