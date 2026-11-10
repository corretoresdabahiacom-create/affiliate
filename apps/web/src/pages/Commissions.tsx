import { DISTRIBUTION_CHANNELS, ADJUSTMENT_KINDS, formatCurrency, nextStatuses, type CommissionStatus } from "@ai/shared";
import { useCallback, useEffect, useState } from "react";
import { api, type Commission, type ImportResult, type Reconciliation, type UserProgram } from "../api";
import { formatDate } from "../components/badges";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

const STATUSES: CommissionStatus[] = ["estimated", "pending", "approved", "paid", "rejected"];

function Import({ programs, onDone }: { programs: UserProgram[]; onDone: () => void }) {
  const { t } = useI18n();
  const [programId, setProgramId] = useState("");
  const [csv, setCsv] = useState("external_ref,amount,currency,status,date,product\n");
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (dryRun: boolean) => {
    setErr(null);
    try { const r = await api.importCommissions(programId, csv, dryRun); setRes(r); if (!dryRun) onDone(); }
    catch (e) { setRes(null); setErr(errorMessage(e, t)); }
  };
  return (
    <section className="card space-y-3">
      <h2 className="font-medium">{t("com.import.title")}</h2>
      <p className="text-xs text-slate-500">{t("com.import.hint")}</p>
      <div>
        <label className="label" htmlFor="imp-prog">{t("com.program")}</label>
        <select id="imp-prog" className="input" value={programId} onChange={(e) => setProgramId(e.target.value)}>
          <option value="" />
          {programs.map((p) => <option key={p.id} value={p.programId}>{p.programName}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="imp-csv">{t("com.import.csv")}</label>
        <textarea id="imp-csv" className="input font-mono text-xs" rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={!programId} onClick={() => run(true)}>{t("com.import.dry")}</button>
        <button className="btn" disabled={!programId} onClick={() => run(false)}>{t("com.import.run")}</button>
      </div>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {res && (
        <div role="status" className="text-sm">
          <p>{t("com.import.report", { created: res.created, updated: res.updated, unchanged: res.unchanged })} {res.dryRun && t("com.import.dryDone")}</p>
          <ul className="mt-1 list-disc pl-5 text-red-700">
            {res.errors.map((e, i) => <li key={i}>{t("com.import.line", { line: e.line, error: t(`imperr.${e.error}` as MessageKey) })}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}

function Recon({ programs }: { programs: UserProgram[] }) {
  const { t } = useI18n();
  const [programId, setProgramId] = useState("");
  const [r, setR] = useState<Reconciliation | null>(null);
  const keys = ["matched", "amountDiff", "currencyDiff", "statusDiff", "missingInReport", "unreferenced", "missingInOwn"] as const;
  return (
    <section className="card space-y-3">
      <h2 className="font-medium">{t("com.recon.title")}</h2>
      <p className="text-xs text-slate-500">{t("com.recon.hint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="rec-prog">{t("com.program")}</label>
          <select id="rec-prog" className="input" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            <option value="" />
            {programs.map((p) => <option key={p.id} value={p.programId}>{p.programName}</option>)}
          </select>
        </div>
        <button className="btn" disabled={!programId} onClick={async () => setR(await api.reconciliation(programId))}>{t("com.recon.run")}</button>
      </div>
      {r && (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {keys.map((k) => (
            <div key={k} className="flex justify-between rounded bg-slate-50 px-3 py-2">
              <dt>{t(`com.recon.${k}` as MessageKey)}</dt>
              <dd className="font-semibold">{r.counts[k]}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function Commissions() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Commission[] | null>(null);
  const [programs, setPrograms] = useState<UserProgram[]>([]);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [adj, setAdj] = useState<{ id: string; kind: string; amount: string } | null>(null);
  const [f, setF] = useState({ amount: "", currency: "USD", programId: "", productName: "", channel: "", externalRef: "", notes: "" });

  const load = useCallback(() => {
    Promise.all([api.commissions(filter), api.myPrograms()]).then(([c, p]) => { setItems(c.items); setPrograms(p.items); }).catch(() => setMsg(t("common.error")));
  }, [filter, t]);
  useEffect(load, [load]);

  const guard = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); load(); } catch (e) { setMsg(errorMessage(e, t)); }
  };

  if (!items) return <p className="text-slate-500">{t("common.loading")}</p>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("com.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("com.subtitle")}</p>
        <p className="mt-1 text-xs text-slate-500">{t("com.notice")}</p>
      </div>

      <form className="card space-y-3" aria-label={t("com.add")} onSubmit={(e) => {
        e.preventDefault();
        guard(async () => {
          await api.createCommission({
            amount: Number(f.amount), currency: f.currency, programId: f.programId || null, productName: f.productName || null,
            channel: f.channel || null, externalRef: f.externalRef || null, notes: f.notes || null,
          });
          setF({ ...f, amount: "", productName: "", externalRef: "", notes: "" });
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="m-amt">{t("com.amount")}</label><input id="m-amt" required type="number" step="0.01" min={0} className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div><label className="label" htmlFor="m-cur">{t("com.currency")}</label><input id="m-cur" required maxLength={3} className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
          <div>
            <label className="label" htmlFor="m-prog">{t("com.program")}</label>
            <select id="m-prog" className="input" value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })}>
              <option value="">{t("links.noProgram")}</option>
              {programs.map((p) => <option key={p.id} value={p.programId}>{p.programName}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="m-prod">{t("com.product")}</label><input id="m-prod" className="input" value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="m-ch">{t("com.channel")}</label>
            <select id="m-ch" className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              <option value="" />
              {DISTRIBUTION_CHANNELS.map((c) => <option key={c} value={c}>{t(`dch.${c}` as MessageKey)}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="m-ref">{t("com.ref")}</label><input id="m-ref" className="input" value={f.externalRef} onChange={(e) => setF({ ...f, externalRef: e.target.value })} /></div>
        </div>
        {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
        <button className="btn">{t("com.add")}</button>
      </form>

      <div className="flex items-center gap-2">
        <label className="text-sm" htmlFor="m-filter">{t("com.filterStatus")}</label>
        <select id="m-filter" className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">{t("com.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`commStatus.${s}` as MessageKey)}</option>)}
        </select>
      </div>

      {items.length === 0 ? <p className="card text-sm text-slate-600">{t("com.empty")}</p> : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{formatCurrency(c.amount, c.currency, locale)}</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">{t(`commStatus.${c.status}` as MessageKey)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t(`origin.${c.origin}` as MessageKey)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t(`conv.${c.conversionState}` as MessageKey)}</span>
                {c.adjustments !== 0 && <span className="text-sm text-slate-600">{t("com.net", { n: formatCurrency(c.netAmount, c.currency, locale) })}</span>}
              </div>
              <p className="text-xs text-slate-500">
                {formatDate(c.occurredAt, locale)}{c.programName ? ` · ${c.programName}` : ""}{c.productName ? ` · ${c.productName}` : ""}
                {c.channel ? ` · ${t(`dch.${c.channel}` as MessageKey)}` : ""}{c.externalRef ? ` · #${c.externalRef}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {nextStatuses(c.status).length > 0 && c.status !== "paid" && <span className="text-sm text-slate-600">{t("com.moveTo")}:</span>}
                {nextStatuses(c.status).map((s) => (
                  <button key={s} className="btn-secondary" onClick={() => guard(() => api.setCommissionStatus(c.id, s))}>{t(`commStatus.${s}` as MessageKey)}</button>
                ))}
                <button className="btn-secondary" onClick={() => setAdj(adj?.id === c.id ? null : { id: c.id, kind: "refund", amount: "" })}>{t("com.adjust")}</button>
                <button className="btn-danger" onClick={() => guard(() => api.deleteCommission(c.id))}>{t("com.delete")}</button>
              </div>
              {adj?.id === c.id && (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="label" htmlFor={`ak-${c.id}`}>{t("com.adjKind")}</label>
                    <select id={`ak-${c.id}`} className="input" value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}>
                      {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{t(`adj.${k}` as MessageKey)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor={`aa-${c.id}`}>{t("com.adjAmount")}</label>
                    <input id={`aa-${c.id}`} type="number" step="0.01" className="input" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
                  </div>
                  <button className="btn" onClick={() => guard(async () => { await api.addAdjustment(c.id, { kind: adj.kind, amount: Number(adj.amount) }); setAdj(null); })}>{t("com.addAdj")}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Import programs={programs} onDone={load} />
      <Recon programs={programs} />
    </div>
  );
}
