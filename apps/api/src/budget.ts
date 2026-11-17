/**
 * Orçamento por invocação do Worker.
 *
 * No plano GRATUITO da Cloudflare (docs de nov/2026):
 *  - D1: 50 consultas por invocação (um db.batch() conta como 1);
 *  - subrequests externos (fetch): 50 por invocação.
 * Acima disso a requisição falha ("Too many API requests by single Worker invocation").
 *
 * `metered()` embrulha o D1 e conta as consultas de verdade. As rotas pesadas usam o contador para
 * parar antes do limite e devolver o restante para a próxima chamada. Subrequests externos são
 * estimados por quem chama (`spendFetch`), porque o fetch global é compartilhado entre requisições.
 */
export const FREE_LIMITS = { d1: 45, fetch: 45 } as const;

export interface Budget {
  d1Used(): number;
  d1Left(): number;
  fetchUsed(): number;
  fetchLeft(): number;
  spendFetch(n?: number): void;
  /** Cabe mais uma unidade de trabalho com este custo estimado? */
  can(d1: number, fetch?: number): boolean;
}

/** WORKER_PLAN=paid libera orçamentos maiores (Workers Paid: 1.000 consultas ao D1 e 10.000 subrequests por invocação). */
export const limitsFor = (env: { WORKER_PLAN?: string }) => (env.WORKER_PLAN === "paid" ? { d1: 900, fetch: 900 } : { ...FREE_LIMITS });

/** Uma fatia do orçamento: respeita o teto da fatia e o que sobra no orçamento inteiro. */
export function share(parent: Budget, d1Cap: number, fetchCap: number): Budget {
  const d1Start = parent.d1Used();
  let f = 0;
  const d1Used = () => parent.d1Used() - d1Start;
  return {
    d1Used,
    d1Left: () => Math.min(d1Cap - d1Used(), parent.d1Left()),
    fetchUsed: () => f,
    fetchLeft: () => Math.min(fetchCap - f, parent.fetchLeft()),
    spendFetch: (n = 1) => { f += n; parent.spendFetch(n); },
    can: (d1, fetch = 0) => d1Used() + d1 <= d1Cap && f + fetch <= fetchCap && parent.can(d1, fetch),
  };
}

const RAW = Symbol.for("ai.d1.raw");

export function metered(db: D1Database, limits: { d1: number; fetch: number } = FREE_LIMITS): { db: D1Database; budget: Budget } {
  let q = 0;
  let f = 0;
  const wrap = (st: any): any =>
    new Proxy(st, {
      get(t, p) {
        if (p === RAW) return t;
        if (p === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        if (p === "run" || p === "first" || p === "all" || p === "raw") return (...a: unknown[]) => { q++; return t[p](...a); };
        const v = t[p];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  const proxy = new Proxy(db as any, {
    get(t, p) {
      if (p === RAW) return t;
      if (p === "prepare") return (sql: string) => wrap(t.prepare(sql));
      if (p === "batch") return (sts: any[]) => { q++; return t.batch(sts.map((s) => s?.[RAW] ?? s)); };
      if (p === "exec") return (sql: string) => { q++; return t.exec(sql); };
      const v = t[p];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const budget: Budget = {
    d1Used: () => q,
    d1Left: () => limits.d1 - q,
    fetchUsed: () => f,
    fetchLeft: () => limits.fetch - f,
    spendFetch: (n = 1) => { f += n; },
    can: (d1, fetch = 0) => q + d1 <= limits.d1 && f + fetch <= limits.fetch,
  };
  return { db: proxy as D1Database, budget };
}

/** O D1 original por baixo do medidor (para trabalho que roda depois da resposta, com orçamento próprio). */
export const unwrapDb = (db: D1Database): D1Database => ((db as any)[RAW] as D1Database) ?? db;

/** Já medido? Evita embrulhar duas vezes (cron que chama código de rota, testes que passam env medido). */
export const isMetered = (db: D1Database) => !!(db as any)[RAW] && (db as any)[RAW] !== db;

/** Divide uma lista em pedaços (ex.: IN (...) tem limite de 100 parâmetros por consulta no D1). */
export const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
