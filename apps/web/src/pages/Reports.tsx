import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api, type Profitability, type ReportData } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

const DAY = 86_400_000;

export function Reports() {
  const { t, locale } = useI18n();
  const [days, setDays] = useState(90);
  const [groupBy, setGroupBy] = useState("month");
  const [profit, setProfit] = useState<Profitability | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const to = Date.now();
    const q = `from=${to - days * DAY}&to=${to}`;
    setErr(null);
    api.profitability(q).then(setProfit).catch((e) => setErr(errorMessage(e, t)));
    api.report(`${q}&groupBy=${groupBy}`)
      .then((r) => { setReport(r); setLocked(false); })
      .catch((e) => { if (e instanceof ApiError && e.code === "plan_limit") { setLocked(true); setReport(null); } else setErr(errorMessage(e, t)); });
  }, [days, groupBy, t]);

  const money = (n: number, cur: string) => new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(n);
  const pct = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(n));
  const num = (n: number | null, cur: string) => (n == null ? "—" : money(n, cur));
  const csv = (section: string) => { const to = Date.now(); return `/api/analytics/report?format=csv&section=${section}&groupBy=${groupBy}&from=${to - days * DAY}&to=${to}`; };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{t("rep.title")}</h1><p className="text-sm text-slate-600">{t("rep.intro")}</p></div>
        <div className="flex gap-2">
          <div><label className="label" htmlFor="rep-days">{t("rep.period")}</label>
            <select id="rep-days" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 90, 180, 365].map((d) => <option key={d} value={d}>{t("rep.days", { n: d })}</option>)}</select></div>
          <div><label className="label" htmlFor="rep-group">{t("rep.groupBy")}</label>
            <select id="rep-group" className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>{["day", "week", "month"].map((g) => <option key={g} value={g}>{t(`rep.group.${g}` as MessageKey)}</option>)}</select></div>
        </div>
      </header>
      {err && <p role="alert" className="text-red-600">{err}</p>}

      <section className="card space-y-3" aria-labelledby="rep-profit">
        <h2 id="rep-profit" className="font-medium">{t("rep.profit.title")}</h2>
        <p className="text-xs text-slate-500">{t("rep.profit.note")}</p>
        {profit && profit.totalsByCurrency.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {profit.totalsByCurrency.map((x) => (
              <li key={x.currency} className="rounded-md bg-slate-50 p-3 text-sm">
                <b>{x.currency}</b>
                <div>{t("rep.spend")}: {money(x.spend, x.currency)}</div>
                <div>{t("rep.realized")}: {money(x.realized, x.currency)} · ROI {pct(x.roiRealized)}</div>
                <div className="text-slate-500">{t("rep.projected")}: {money(x.projected, x.currency)} · ROI {pct(x.roiProjected)}</div>
              </li>
            ))}
          </ul>
        )}
        {profit && profit.campaigns.length === 0 && <p className="text-sm text-slate-500">{t("rep.noCampaigns")}</p>}
        {profit && profit.campaigns.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr>
                <th>{t("rep.col.campaign")}</th><th>{t("rep.spend")}</th><th>{t("rep.col.clicks")}</th><th>{t("rep.realized")}</th><th>{t("rep.projected")}</th><th>ROI</th><th>EPC</th><th>{t("rep.col.conv")}</th>
              </tr></thead>
              <tbody>{profit.campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}{c.otherCurrencies.length > 0 && <span className="ml-1 text-xs text-amber-800" title={t("rep.otherCur")}>⚠ {c.otherCurrencies.join(", ")}</span>}</td>
                  <td>{num(c.spend, c.currency)}</td><td>{c.clicksOwnTracking}</td>
                  <td>{money(c.realized, c.currency)}</td><td className="text-slate-500">{money(c.projected, c.currency)}</td>
                  <td>{pct(c.roiRealized)}</td><td>{num(c.epcRealized, c.currency)}</td><td>{pct(c.conversionRate)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>

      {locked && (
        <section className="card" role="status">
          <p>{t("rep.locked")}</p>
          <Link className="btn mt-2 inline-block" to="/billing">{t("rep.seePlans")}</Link>
        </section>
      )}

      {report && (
        <>
          <section className="card space-y-3" aria-labelledby="rep-series">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="rep-series" className="font-medium">{t("rep.series.title")}</h2><a className="btn-secondary" href={csv("series")}>{t("rep.csv")}</a></div>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr><th>{t("rep.col.period")}</th><th>{t("rep.col.clicks")}</th><th>{t("rep.col.status")}</th><th>{t("rep.col.amount")}</th></tr></thead>
              <tbody>
                {report.clicksOwnTracking.map((x) => <tr key={`c${x.period}`}><td>{x.period}</td><td>{x.clicks}</td><td /><td /></tr>)}
                {report.commissions.map((x, i) => <tr key={`m${i}`}><td>{x.period}</td><td /><td>{t(`commStatus.${x.status}` as MessageKey)}</td><td>{money(x.amount, x.currency)}</td></tr>)}
              </tbody></table></div>
          </section>
          <section className="card space-y-3" aria-labelledby="rep-prog">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="rep-prog" className="font-medium">{t("rep.prog.title")}</h2><a className="btn-secondary" href={csv("programs")}>{t("rep.csv")}</a></div>
            <table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th>{t("rep.col.program")}</th><th>{t("rep.col.status")}</th><th>{t("rep.col.amount")}</th></tr></thead>
              <tbody>{report.byProgram.map((x, i) => <tr key={i}><td>{x.program}</td><td>{t(`commStatus.${x.status}` as MessageKey)}</td><td>{money(x.amount, x.currency)}</td></tr>)}</tbody></table>
          </section>
          <section className="card space-y-3" aria-labelledby="rep-aging">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="rep-aging" className="font-medium">{t("rep.aging.title")}</h2><a className="btn-secondary" href={csv("aging")}>{t("rep.csv")}</a></div>
            <p className="text-xs text-slate-500">{t("rep.aging.note")}</p>
            {report.aging.length === 0 ? <p className="text-sm text-slate-500">{t("rep.aging.none")}</p> : (
              <table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th>{t("rep.col.age")}</th><th>{t("rep.col.status")}</th><th>{t("rep.col.amount")}</th></tr></thead>
                <tbody>{report.aging.map((x, i) => <tr key={i}><td>{x.bucket}</td><td>{t(`commStatus.${x.status}` as MessageKey)}</td><td>{money(x.amount, x.currency)} ({x.count})</td></tr>)}</tbody></table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
