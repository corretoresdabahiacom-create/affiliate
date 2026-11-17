import { app } from "./app";
import { processDeliveries, purgeOld, runAlertsPass, runMonitor } from "./automation";
import { limitsFor, metered, share } from "./budget";
import { runBilling } from "./billing";
import { runAutoStock } from "./market";
import type { Env } from "./types";

export { app };

/**
 * Agendador (a cada 10 minutos). Cada execução é uma invocação do Worker, com o mesmo orçamento de uma requisição
 * (plano gratuito: 50 consultas ao D1 e 50 chamadas externas). Por isso cada tarefa recebe uma fatia e faz
 * só o que cabe; o resto fica para a execução seguinte, em rodízio. Uma falha não derruba as outras tarefas.
 */
export async function runScheduled(env: Env, at = new Date()) {
  const m = metered(env.DB, limitsFor(env));
  const menv: Env = { ...env, DB: m.db };
  const safe = async <T>(name: string, fn: () => Promise<T>) => { try { return await fn(); } catch (e) { console.error(`[cron] ${name} falhou`, (e as Error).message); return null; } };
  const out: Record<string, unknown> = {};
  const L = limitsFor(env);
  out.deliveries = await safe("deliveries", () => processDeliveries(menv, { budget: share(m.budget, Math.round(L.d1 * 0.3), Math.round(L.fetch * 0.3)) }));
  out.monitor = await safe("monitor", () => runMonitor(menv, 40, share(m.budget, Math.round(L.d1 * 0.25), Math.round(L.fetch * 0.3))));
  out.alerts = await safe("alerts", () => runAlertsPass(menv, Date.now(), share(m.budget, Math.round(L.d1 * 0.25), Math.round(L.fetch * 0.1))));
  out.billing = await safe("billing", () => runBilling(menv, at.getTime(), share(m.budget, Math.round(L.d1 * 0.1), 0)));
  if (at.getUTCHours() === 3 && at.getUTCMinutes() < 10) out.purge = await safe("purge", () => purgeOld(menv));
  out.autoStock = await safe("autoStock", () => runAutoStock(menv, m.budget));
  out.d1 = m.budget.d1Used();
  out.fetch = m.budget.fetchUsed();
  return out;
}

export default {
  fetch: app.fetch,
  async scheduled(event: { scheduledTime?: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduled(env, new Date(event.scheduledTime ?? Date.now())));
  },
};
