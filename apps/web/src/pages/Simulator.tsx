import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { recurringInputSchema, simInputSchema, simulate, simulateRecurring, type SimResult } from "@ai/shared";
import { api, type CatalogProgram } from "../api";
import { useI18n, type MessageKey } from "../i18n";

type Mode = "clicks" | "sales" | "goal" | "recurring";
const num = (s: string | undefined): number | undefined => (s === undefined || s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));

export function Simulator() {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>("clicks");
  const [v, setV] = useState<Record<string, string>>({
    clicksMonthly: "1000", conversionPercent: "2", productPrice: "100", commissionPercent: "", commissionFixed: "",
    trafficCostMonthly: "0", contentCostMonthly: "0", salesMonthly: "10", goalMonthly: "1000",
    subscribers: "50", monthlyPrice: "30", durationMonths: "", monthlyChurnPercent: "5", validationDays: "0", horizonMonths: "12",
  });
  const [lifetime, setLifetime] = useState(false);
  const [program, setProgram] = useState<CatalogProgram | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  // Preenche só com dados CONFIRMADOS do catálogo; o usuário confere e ajusta.
  const programId = params.get("program");
  useEffect(() => {
    if (!programId) return;
    api.program(programId).then(({ program: p }) => {
      setProgram(p);
      setV((prev) => ({
        ...prev,
        ...(p.commissionType === "percent" && p.commissionPercent !== null ? { commissionPercent: String(p.commissionPercent) } : {}),
        ...(p.commissionType === "fixed" && p.commissionFixed !== null ? { commissionFixed: String(p.commissionFixed) } : {}),
        ...(p.recurringDurationMonths !== null ? { durationMonths: String(p.recurringDurationMonths) } : {}),
        ...(p.validationDays !== null ? { validationDays: String(p.validationDays) } : {}),
      }));
      if (p.isRecurring === "yes") setMode("recurring");
    }).catch(() => undefined);
  }, [programId]);

  const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);

  const result = useMemo(() => {
    if (mode === "recurring") {
      const parsed = recurringInputSchema.safeParse({
        subscribers: num(v.subscribers), monthlyPrice: num(v.monthlyPrice), commissionPercent: num(v.commissionPercent),
        durationMonths: num(v.durationMonths), lifetimeConfirmed: lifetime, monthlyChurnPercent: num(v.monthlyChurnPercent),
        validationDays: num(v.validationDays) ?? 0, horizonMonths: num(v.horizonMonths) ?? 12,
      });
      if (!parsed.success) {
        const duration = parsed.error.issues.some((i) => i.message === "duration_required");
        return { kind: "error" as const, text: duration ? t("sim.err.duration_required") : null };
      }
      return { kind: "recurring" as const, data: simulateRecurring(parsed.data) };
    }
    const base = {
      productPrice: num(v.productPrice), commissionPercent: num(v.commissionPercent), commissionFixed: num(v.commissionFixed),
      trafficCostMonthly: num(v.trafficCostMonthly) ?? 0, contentCostMonthly: num(v.contentCostMonthly) ?? 0,
    };
    const input =
      mode === "clicks" ? { mode, clicksMonthly: num(v.clicksMonthly), conversionPercent: num(v.conversionPercent), ...base }
      : mode === "sales" ? { mode, salesMonthly: num(v.salesMonthly), ...base }
      : { mode, goalMonthly: num(v.goalMonthly), conversionPercent: num(v.conversionPercent), ...base };
    const parsed = simInputSchema.safeParse(input);
    if (!parsed.success) return { kind: "error" as const, text: null };
    const r = simulate(parsed.data);
    if ("error" in r) return { kind: "error" as const, text: t(`sim.err.${r.error}` as MessageKey) };
    return { kind: "simple" as const, data: r };
  }, [mode, v, lifetime, t]);

  const field = (k: string, label: string, step = "any") => (
    <div key={k}>
      <label className="label" htmlFor={`sim-${k}`}>{label}</label>
      <input id={`sim-${k}`} className="input" type="number" inputMode="decimal" min="0" step={step} value={v[k] ?? ""} onChange={set(k)} />
    </div>
  );
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0"><dt className="text-slate-600">{label}</dt><dd className="font-medium">{value}</dd></div>
  );

  const paidBlock = program && program.acceptsPaidTraffic !== "yes" && (num(v.trafficCostMonthly) ?? 0) > 0;
  const modes: Mode[] = ["clicks", "sales", "goal", "recurring"];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("sim.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("sim.subtitle")}</p>
      </div>
      {program && (
        <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
          {t("sim.fromCatalog", { name: program.name })} <Link className="underline" to={`/programs/${program.id}`}>→</Link>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {modes.map((m) => (
          <button key={m} aria-pressed={mode === m} className={mode === m ? "btn" : "btn-secondary"} onClick={() => setMode(m)}>
            {t(`sim.mode.${m}` as MessageKey)}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3">
          {mode !== "recurring" ? (
            <>
              {mode === "clicks" && field("clicksMonthly", t("sim.clicksMonthly"))}
              {mode === "sales" && field("salesMonthly", t("sim.salesMonthly"))}
              {mode === "goal" && field("goalMonthly", t("sim.goalMonthly"))}
              {(mode === "clicks" || mode === "goal") && field("conversionPercent", t("sim.conversionPercent"))}
              {field("productPrice", t("sim.productPrice"))}
              {field("commissionPercent", t("sim.commissionPercent"))}
              {field("commissionFixed", t("sim.commissionFixed"))}
              {field("trafficCostMonthly", t("sim.trafficCost"))}
              {field("contentCostMonthly", t("sim.contentCost"))}
            </>
          ) : (
            <>
              {field("subscribers", t("sim.subscribers"), "1")}
              {field("monthlyPrice", t("sim.monthlyPrice"))}
              {field("commissionPercent", t("sim.commissionPercent"))}
              {field("durationMonths", t("sim.durationMonths"), "1")}
              <label className="flex items-start gap-2 text-sm">
                <input className="mt-1" type="checkbox" checked={lifetime} onChange={(e) => setLifetime(e.target.checked)} />
                {t("sim.lifetime")}
              </label>
              {field("monthlyChurnPercent", t("sim.churn"))}
              {field("validationDays", t("sim.validationDays"), "1")}
              {field("horizonMonths", t("sim.horizon"), "1")}
            </>
          )}
        </section>

        <section className="card" aria-live="polite">
          <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">{t("sim.disclaimer")}</p>
          {paidBlock && <p role="alert" className="mb-2 text-sm text-red-700">{t("sim.paidBlock")}</p>}
          {result.kind === "error" && result.text && <p role="alert" className="text-sm text-red-600">{result.text}</p>}
          {result.kind === "simple" && <SimpleResult r={result.data} fmt={fmt} row={row} mode={mode} />}
          {result.kind === "recurring" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">{t(result.data.recurrenceBasis === "limited" ? "sim.basis.limited" : "sim.basis.lifetime")}</p>
              {(["none", "base", "high"] as const).map((k) => {
                const s = result.data.scenarios[k];
                return (
                  <div key={k} className="rounded-lg bg-slate-50 p-3">
                    <h3 className="text-sm font-semibold">{t(`sim.scenario.${k}` as MessageKey)} ({s.churnPercent}%)</h3>
                    <dl>
                      {row(t("sim.r.earned"), fmt(s.earnedTotal))}
                      {row(t("sim.r.released"), fmt(s.releasedTotal))}
                      {row(t("sim.r.activeEnd"), fmt(s.activeAtEnd))}
                    </dl>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SimpleResult({ r, fmt, row, mode }: { r: SimResult; fmt: (n: number) => string; row: (l: string, v: React.ReactNode) => React.ReactNode; mode: Mode }) {
  const { t } = useI18n();
  return (
    <dl>
      {row(t("sim.r.commissionPerSale"), fmt(r.commissionPerSale))}
      {row(t("sim.r.sales"), fmt(r.salesMonthly))}
      {(mode === "goal" || mode === "clicks") && r.clicksMonthly !== null && row(t("sim.r.clicksNeeded"), fmt(r.clicksMonthly))}
      {row(t("sim.r.salesValue"), fmt(r.salesValueMonthly))}
      {row(t("sim.r.commissionMonthly"), fmt(r.commissionMonthly))}
      {row(t("sim.r.commissionAnnual"), fmt(r.commissionAnnual))}
      {row(t("sim.r.costMonthly"), fmt(r.costMonthly))}
      {row(t("sim.r.profitMonthly"), fmt(r.profitMonthly))}
      {row(t("sim.r.profitAnnual"), fmt(r.profitAnnual))}
      {row(t("sim.r.roi"), r.roi === null ? t("sim.r.noCost") : `${fmt(r.roi * 100)}%`)}
      {row(t("sim.r.breakEven"), r.breakEvenSales === null ? "—" : fmt(r.breakEvenSales))}
    </dl>
  );
}
