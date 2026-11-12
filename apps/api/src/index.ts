import { app } from "./app";
import { runAutoStock } from "./market";
import type { Env } from "./types";

export { app };

export default {
  fetch: app.fetch,
  /** Sincronização automática de ESTOQUE (só conexões com autoStock ligado). Preço nunca muda aqui. */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runAutoStock(env).catch(() => undefined));
  },
};
