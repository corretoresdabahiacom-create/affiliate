import { Hono } from "hono";
import { AGING_BUCKETS, epc, money2, rate, roi, toCsv } from "@ai/shared";
import { checkPlanLimit } from "./billing";
import { requireUser } from "./middleware";
import type { AppBindings } from "./types";

/**
 * Rentabilidade e relatórios (Fase 8). Regras:
 * - ROI "realizado" só conta comissão aprovada ou paga; "projetado" inclui pendente e estimada e nunca é apresentado como recebido.
 * - Custo e comissão em moedas diferentes não se misturam: sem mesma moeda, não há ROI.
 * - Cliques aqui são só os do redirecionamento próprio; clique não é venda e não prova conversão.
 * - Sem base de cálculo (zero cliques, zero custo), o indicador é null.
 */

type Row = Record<string, any>;
const DAY = 86_400_000;
const uid = (c: any) => c.get("user").id as string;

export const analytics = new Hono<AppBindings>();
analytics.use("*", requireUser);

function range(c: any): { from: number; to: number } | null {
  const to = c.req.query("to") ? Number(c.req.query("to")) : Date.now();
  const from = c.req.query("from") ? Number(c.req.query("from")) : to - 90 * DAY;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 366 * DAY) return null;
  return { from, to };
}

// Valor líquido: comissão + ajustes (reembolso/cancelamento/chargeback entram negativos).
const NET = "m.amount + COALESCE((SELECT SUM(x.amount) FROM commission_adjustments x WHERE x.commission_id = m.id), 0)";
type Money = { estimated: number; pending: number; approved: number; paid: number; rejected: number };
const zero = (): Money => ({ estimated: 0, pending: 0, approved: 0, paid: 0, rejected: 0 });

analytics.get("/profitability", async (c) => {
  const r = range(c);
  if (!r) return c.json({ error: "invalid_range" }, 400);
  const u = uid(c);
  const db = c.env.DB;
  const [camps, clicks, comm] = await Promise.all([
    db.prepare("SELECT id, name, channel, status, currency, ad_spend, clicks_reported, conversions_reported FROM campaigns WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").bind(u).all<Row>(),
    db.prepare(
      `SELECT l.campaign_id, COUNT(*) AS n FROM link_clicks k JOIN affiliate_links l ON l.id = k.link_id
       WHERE k.user_id = ? AND k.at >= ? AND k.at < ? GROUP BY l.campaign_id`,
    ).bind(u, r.from, r.to).all<Row>(),
    db.prepare(
      `SELECT campaign_id, status, currency, conversion_state, COUNT(*) AS cnt, SUM(net) AS net FROM
         (SELECT m.campaign_id, m.status, m.currency, m.conversion_state, ${NET} AS net FROM commissions m WHERE m.user_id = ? AND m.occurred_at >= ? AND m.occurred_at < ?)
       GROUP BY campaign_id, status, currency, conversion_state`,
    ).bind(u, r.from, r.to).all<Row>(),
  ]);
  const clickBy = new Map(clicks.results.map((x) => [x.campaign_id as string | null, x.n as number]));
  type Agg = { byCur: Map<string, Money>; confirmed: number };
  const agg = new Map<string | null, Agg>();
  for (const x of comm.results) {
    const a = agg.get(x.campaign_id) ?? { byCur: new Map(), confirmed: 0 };
    const m = a.byCur.get(x.currency) ?? zero();
    m[x.status as keyof Money] += x.net;
    a.byCur.set(x.currency, m);
    if (x.conversion_state === "confirmed" && x.status !== "rejected") a.confirmed += x.cnt;
    agg.set(x.campaign_id, a);
  }
  const realizedOf = (m: Money) => m.approved + m.paid;
  const projectedOf = (m: Money) => m.approved + m.paid + m.pending + m.estimated;
  const totals = new Map<string, { spend: number; realized: number; projected: number }>();
  const bump = (cur: string, k: "spend" | "realized" | "projected", v: number) => {
    const t = totals.get(cur) ?? { spend: 0, realized: 0, projected: 0 };
    t[k] += v;
    totals.set(cur, t);
  };

  const campaigns = camps.results.map((cp) => {
    const a = agg.get(cp.id);
    const cur = cp.currency as string;
    const own = a?.byCur.get(cur) ?? zero();
    const spend = cp.ad_spend as number | null;
    const own_clicks = clickBy.get(cp.id) ?? 0;
    const realized = money2(realizedOf(own));
    const projected = money2(projectedOf(own));
    if (spend) bump(cur, "spend", spend);
    for (const [k, m] of a?.byCur ?? []) { bump(k, "realized", realizedOf(m)); bump(k, "projected", projectedOf(m)); }
    return {
      id: cp.id, name: cp.name, channel: cp.channel, status: cp.status, currency: cur, spend,
      clicksOwnTracking: own_clicks, clicksReported: cp.clicks_reported, conversionsReported: cp.conversions_reported,
      commissions: Object.fromEntries(Object.entries(own).map(([k, v]) => [k, money2(v)])) as Money,
      realized, projected,
      roiRealized: roi(realized, spend), roiProjected: roi(projected, spend),
      epcRealized: epc(realized, own_clicks),
      confirmedConversions: a?.confirmed ?? 0,
      conversionRate: rate(a?.confirmed ?? 0, own_clicks),
      // Comissões da campanha em outra moeda não entram no ROI.
      otherCurrencies: [...(a?.byCur.keys() ?? [])].filter((k) => k !== cur),
    };
  });
  const unattributed = agg.get(null);
  if (unattributed) for (const [k, m] of unattributed.byCur) { bump(k, "realized", realizedOf(m)); bump(k, "projected", projectedOf(m)); }
  return c.json({
    range: r,
    campaigns,
    totalsByCurrency: [...totals].map(([currency, t]) => ({
      currency, spend: money2(t.spend), realized: money2(t.realized), projected: money2(t.projected),
      roiRealized: roi(t.realized, t.spend), roiProjected: roi(t.projected, t.spend),
    })),
    unattributedClicks: clickBy.get(null) ?? 0,
    notes: ["realized = aprovada + paga; projected inclui pendente e estimada e não é valor recebido", "cliques: apenas redirecionamento próprio; clique não é venda"],
  });
});

const BUCKET = { day: "%Y-%m-%d", week: "%Y-W%W", month: "%Y-%m" } as const;

analytics.get("/report", async (c) => {
  const blocked = await checkPlanLimit(c, "reports");
  if (blocked) return blocked;
  const r = range(c);
  if (!r) return c.json({ error: "invalid_range" }, 400);
  const g = (c.req.query("groupBy") ?? "day") as keyof typeof BUCKET;
  if (!(g in BUCKET)) return c.json({ error: "invalid_input" }, 400);
  const section = c.req.query("section") ?? "series";
  if (!["series", "programs", "aging"].includes(section)) return c.json({ error: "invalid_input" }, 400);
  const u = uid(c);
  const db = c.env.DB;
  const t = Date.now();
  const fmt = BUCKET[g];

  const [clicks, comm, programs, aging] = await Promise.all([
    db.prepare(`SELECT strftime('${fmt}', at/1000, 'unixepoch') AS period, COUNT(*) AS n FROM link_clicks WHERE user_id = ? AND at >= ? AND at < ? GROUP BY period ORDER BY period`).bind(u, r.from, r.to).all<Row>(),
    db.prepare(
      `SELECT period, status, currency, COUNT(*) AS cnt, SUM(net) AS net FROM
         (SELECT strftime('${fmt}', m.occurred_at/1000, 'unixepoch') AS period, m.status, m.currency, ${NET} AS net FROM commissions m WHERE m.user_id = ? AND m.occurred_at >= ? AND m.occurred_at < ?)
       GROUP BY period, status, currency ORDER BY period`,
    ).bind(u, r.from, r.to).all<Row>(),
    db.prepare(
      `SELECT name, status, currency, COUNT(*) AS cnt, SUM(net) AS net FROM
         (SELECT COALESCE(p.name, '—') AS name, m.status, m.currency, ${NET} AS net FROM commissions m LEFT JOIN affiliate_programs p ON p.id = m.program_id
          WHERE m.user_id = ? AND m.occurred_at >= ? AND m.occurred_at < ?)
       GROUP BY name, status, currency ORDER BY name`,
    ).bind(u, r.from, r.to).all<Row>(),
    // Pendentes e estimadas por idade desde a ocorrência: ajuda a cobrar a rede depois do período de validação.
    db.prepare(
      `SELECT bucket, currency, status, COUNT(*) AS cnt, SUM(net) AS net FROM
         (SELECT CASE WHEN (?1 - m.occurred_at) <= ${30 * DAY} THEN '0-30' WHEN (?1 - m.occurred_at) <= ${60 * DAY} THEN '31-60'
                      WHEN (?1 - m.occurred_at) <= ${90 * DAY} THEN '61-90' ELSE '90+' END AS bucket, m.currency, m.status, ${NET} AS net
          FROM commissions m WHERE m.user_id = ?2 AND m.status IN ('estimated','pending'))
       GROUP BY bucket, currency, status`,
    ).bind(t, u).all<Row>(),
  ]);

  const body = {
    range: r, groupBy: g,
    clicksOwnTracking: clicks.results.map((x) => ({ period: x.period, clicks: x.n })),
    commissions: comm.results.map((x) => ({ period: x.period, status: x.status, currency: x.currency, count: x.cnt, amount: money2(x.net) })),
    byProgram: programs.results.map((x) => ({ program: x.name, status: x.status, currency: x.currency, count: x.cnt, amount: money2(x.net) })),
    aging: AGING_BUCKETS.flatMap((b) => aging.results.filter((x) => x.bucket === b).map((x) => ({ bucket: b, status: x.status, currency: x.currency, count: x.cnt, amount: money2(x.net) }))),
    notes: ["comissão estimada ≠ aprovada ≠ paga; cada moeda é mostrada separadamente", "cliques: apenas redirecionamento próprio; clique não é venda"],
  };
  if (c.req.query("format") !== "csv") return c.json(body);

  const csv =
    section === "programs"
      ? toCsv(["program", "status", "currency", "count", "amount"], body.byProgram.map((x) => [x.program, x.status, x.currency, x.count, x.amount]))
      : section === "aging"
        ? toCsv(["age_days", "status", "currency", "count", "amount"], body.aging.map((x) => [x.bucket, x.status, x.currency, x.count, x.amount]))
        : toCsv(["period", "metric", "status", "currency", "value"], [
            ...body.clicksOwnTracking.map((x) => [x.period, "clicks_own_tracking", "", "", x.clicks]),
            ...body.commissions.map((x) => [x.period, "commission", x.status, x.currency, x.amount]),
          ]);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="report-${section}.csv"`, "cache-control": "no-store" } });
});
