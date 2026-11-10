import { formatCurrency } from "@ai/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OpsDashboard as Data } from "../api";
import { formatDate } from "../components/badges";
import { useI18n, type MessageKey } from "../i18n";

const STATUS = ["estimated", "pending", "approved", "paid"] as const;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dd className="text-xl font-semibold">{value}</dd>
      <dt className="text-xs text-slate-600">{label}</dt>
    </div>
  );
}

function Money({ title, rows }: { title: string; rows: Data["byProduct"] }) {
  const { t, locale } = useI18n();
  if (rows.length === 0) return null;
  return (
    <section className="card">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1 pr-2">&nbsp;</th>
              {STATUS.map((s) => <th key={s} className="py-1 pr-2">{t(`commStatus.${s}` as MessageKey)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.name}-${r.currency}`} className="border-t border-slate-100">
                <td className="py-1 pr-2">{r.name === "—" ? "—" : title === t("dash.byChannel") ? t(`dch.${r.name}` as MessageKey) : r.name} <span className="text-slate-400">({r.currency})</span></td>
                {STATUS.map((s) => <td key={s} className="py-1 pr-2">{formatCurrency(r[s], r.currency, locale)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OpsDashboard() {
  const { t, locale } = useI18n();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { api.opsDashboard().then(setD).catch(() => setError(true)); }, []);
  if (error) return <p role="alert" className="text-sm text-red-600">{t("common.error")}</p>;
  if (!d) return <p className="text-slate-500">{t("common.loading")}</p>;
  const currencies = Object.entries(d.commissionsByCurrency);

  return (
    <section className="space-y-4" aria-label={t("dash.ops")}>
      <div>
        <h2 className="text-lg font-semibold">{t("dash.ops")}</h2>
        <p className="text-xs text-slate-500">{t("dash.sepNote")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("dash.discovered")} value={d.programs.discoveredInCatalog} />
        <Stat label={t("dash.saved")} value={d.programs.saved} />
        <Stat label={t("dash.interested")} value={d.programs.interested} />
        <Stat label={t("dash.pending")} value={d.programs.pendingApplications} />
        <Stat label={t("dash.approved")} value={d.programs.approved} />
        <Stat label={t("dash.rejected")} value={d.programs.rejected} />
        <Stat label={t("dash.products")} value={d.productsPromoted} />
        <Stat label={t("dash.links")} value={d.linksRegistered} />
        <Stat label={t("dash.clicksOwn")} value={d.clicks.ownTracking} />
        <Stat label={t("dash.clicksManual")} value={d.clicks.manualReported} />
        <Stat label={t("dash.convConfirmed")} value={d.conversions.confirmedByNetwork} />
        <Stat label={t("dash.convReported")} value={d.conversions.reportedByUser} />
      </dl>

      <section className="card">
        <h3 className="mb-2 text-sm font-semibold">{t("dash.comm")}</h3>
        {currencies.length === 0 ? <p className="text-sm text-slate-600">{t("dash.noComm")}</p> : (
          <div className="space-y-3">
            {currencies.map(([cur, m]) => (
              <div key={cur}>
                <p className="text-xs font-medium text-slate-500">{cur}</p>
                <dl className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {STATUS.map((s) => (
                    <div key={s} className="rounded-lg bg-slate-50 px-3 py-2">
                      <dd className="font-semibold">{formatCurrency(m[s], cur, locale)}</dd>
                      <dt className="text-xs text-slate-600">{t(`commStatus.${s}` as MessageKey)}</dt>
                    </div>
                  ))}
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dd className="font-semibold">{formatCurrency(m.rejected, cur, locale)}</dd>
                    <dt className="text-xs text-slate-600">{t("commStatus.rejected")}</dt>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
        {Object.keys(d.commissionsByOrigin).length > 0 && (
          <p className="mt-3 text-xs text-slate-600">
            {t("dash.byOrigin")}: {Object.entries(d.commissionsByOrigin).map(([o, n]) => `${t(`origin.${o}` as MessageKey)} (${n})`).join(" · ")}
          </p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Money title={t("dash.byProduct")} rows={d.byProduct} />
        <Money title={t("dash.byCategory")} rows={d.byCategory} />
        <Money title={t("dash.byChannel")} rows={d.byChannel} />
        {d.clicks.ownTrackingByChannel.length > 0 && (
          <section className="card">
            <h3 className="mb-2 text-sm font-semibold">{t("dash.clicksChannel")}</h3>
            <ul className="text-sm">
              {d.clicks.ownTrackingByChannel.map((c) => <li key={c.channel}>{t(`dch.${c.channel}` as MessageKey)}: {c.clicks}</li>)}
            </ul>
          </section>
        )}
      </div>

      <section className="card">
        <h3 className="mb-2 text-sm font-semibold">{t("dash.next")}</h3>
        {d.nextActions.length === 0 ? <p className="text-sm text-slate-600">{t("dash.noNext")}</p> : (
          <ul className="space-y-1 text-sm">
            {d.nextActions.map((a) => (
              <li key={a.id}><Link to="/my-programs" className="text-indigo-700 hover:underline">{a.programName}</Link> — {a.nextAction} ({formatDate(a.at, locale)})</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
