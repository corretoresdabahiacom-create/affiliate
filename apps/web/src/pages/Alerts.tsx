import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ALERT_CATEGORIES, ALERT_FREQUENCIES, type AlertCategory, type AlertPrefs } from "@ai/shared";
import { api, type AlertItem } from "../api";
import { SafeLink, formatDate } from "../components/badges";
import { fieldLabel } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

export function Alerts() {
  const { t, locale } = useI18n();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.alerts(), api.alertPrefs()])
      .then(([a, p]) => {
        setAlerts(a.alerts);
        setUnread(a.unread);
        setPrefs(p.prefs);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  if (error) return <p role="alert">{t("common.error")}</p>;
  if (!prefs) return <p className="text-slate-500">{t("common.loading")}</p>;

  const toggle = (c: AlertCategory) =>
    setPrefs({ ...prefs, categories: prefs.categories.includes(c) ? prefs.categories.filter((x) => x !== c) : [...prefs.categories, c] });

  const describe = (a: AlertItem) => {
    if (a.category === "outdated") return t("alerts.outdatedText");
    const label = a.field && !["created", "products_added", "products_removed"].includes(a.field) ? fieldLabel(t, a.field) : null;
    return label ? `${label}: ${a.oldValue ?? "—"} → ${a.newValue ?? "—"}` : a.field && a.field !== "created" ? `${a.newValue ?? a.oldValue ?? ""}` : "";
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("alerts.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("alerts.subtitle")}</p>
      </div>

      <section className="card space-y-3">
        <h2 className="font-medium">{t("alerts.prefs")}</h2>
        <div>
          <label className="label" htmlFor="freq">{t("alerts.frequency")}</label>
          <select id="freq" className="input max-w-xs" value={prefs.frequency} onChange={(e) => setPrefs({ ...prefs, frequency: e.target.value as AlertPrefs["frequency"] })}>
            {ALERT_FREQUENCIES.map((f) => <option key={f} value={f}>{t(`alerts.freq.${f}` as MessageKey)}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">{t("alerts.freqNote")}</p>
        </div>
        <fieldset>
          <legend className="label">{t("alerts.categories")}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {ALERT_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={prefs.categories.includes(c)} onChange={() => toggle(c)} />
                {t(`alerts.cat.${c}` as MessageKey)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button className="btn" onClick={async () => { await api.saveAlertPrefs(prefs); setSaved(true); load(); }}>{t("alerts.save")}</button>
          {saved && <span role="status" className="text-sm text-emerald-700">{t("common.saved")}</span>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t("alerts.title")} {unread > 0 && <span className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-xs text-white">{t("alerts.unread", { n: unread })}</span>}</h2>
          {unread > 0 && <button className="btn-secondary" onClick={async () => { await api.alertsSeen(); load(); }}>{t("alerts.markSeen")}</button>}
        </div>
        {alerts.length === 0 ? <p className="card text-sm text-slate-600">{t("alerts.none")}</p> : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className={`card text-sm ${a.unread ? "border-indigo-300" : ""}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{t(`alerts.cat.${a.category}` as MessageKey)}</span>
                  <span className="text-slate-500">{formatDate(a.at, locale)}</span>
                </div>
                <Link className="text-indigo-700 hover:underline" to={`/programs/${a.programId}`}>{a.programName}</Link>
                <span className="text-slate-500"> · {a.advertiser}</span>
                {describe(a) && <div className="break-all text-slate-700">{describe(a)}</div>}
                <div className="mt-1 text-xs text-slate-500">
                  {a.sourceUrl ? <>{t("alerts.source")}: <SafeLink href={a.sourceUrl}>{a.sourceUrl}</SafeLink></> : t("alerts.noSource")}
                  {" · "}
                  {a.lastVerifiedAt ? t("alerts.verifiedOn", { date: formatDate(a.lastVerifiedAt, locale) }) : t("alerts.neverVerified")}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">{t("alerts.notYet")}</p>
      </section>
    </div>
  );
}
