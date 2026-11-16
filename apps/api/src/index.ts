import { app } from "./app";
import { processDeliveries, purgeOld, runAlertsPass, runMonitor } from "./automation";
import { runAutoStock } from "./market";
import type { Env } from "./types";

export { app };

/**
 * Agendador (a cada hora). Cada tarefa é isolada: uma falha não derruba as outras.
 * - toda hora: reenvio de webhooks, resumos/eventos de alerta, monitor de fontes (lote pequeno);
 * - a cada 6 h: estoque automático (só conexões com a opção ligada);
 * - 1 vez por dia (03h UTC): limpeza.
 */
export async function runScheduled(env: Env, at = new Date()) {
  const safe = async <T>(name: string, fn: () => Promise<T>) => { try { return await fn(); } catch (e) { console.error(`[cron] ${name} falhou`, (e as Error).message); return null; } };
  const out: Record<string, unknown> = {};
  out.deliveries = await safe("deliveries", () => processDeliveries(env));
  out.alerts = await safe("alerts", () => runAlertsPass(env, at.getTime()));
  out.monitor = await safe("monitor", () => runMonitor(env));
  if (at.getUTCHours() % 6 === 0) out.autoStock = await safe("autoStock", () => runAutoStock(env));
  if (at.getUTCHours() === 3) out.purge = await safe("purge", () => purgeOld(env));
  return out;
}

export default {
  fetch: app.fetch,
  async scheduled(event: { scheduledTime?: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduled(env, new Date(event.scheduledTime ?? Date.now())));
  },
};
