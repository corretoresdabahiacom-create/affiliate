import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { seasonalIssues } from "@ai/shared";
import { api, type CatalogProgram, type SeasonalEntry } from "../api";
import { useAuth } from "../auth";
import { errorMessage } from "../components/errors";
import { useI18n } from "../i18n";

const monthName = (locale: string, m: number) => new Date(2000, m - 1, 1).toLocaleString(locale, { month: "long" });

function EntryCard({ e }: { e: SeasonalEntry }) {
  const { t } = useI18n();
  return (
    <li className="card space-y-2">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium">{e.niche}</h3>
        {e.metricValue && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-sm font-semibold text-emerald-800">{e.metricValue}</span>}
      </div>
      {e.metricValue ? (
        <p className="text-sm text-slate-600">
          {e.metricLabel} · {t("seasonal.source")}:{" "}
          <a className="text-indigo-700 hover:underline" href={e.sourceUrl ?? "#"} target="_blank" rel="noreferrer noopener">{e.sourceUrl}</a>
        </p>
      ) : (
        <p className="text-xs text-slate-500">{t("seasonal.editorial")}</p>
      )}
      {e.note && <p className="text-sm">{e.note}</p>}
      {e.programs.length > 0 && (
        <p className="text-sm">
          <span className="text-slate-500">{t("seasonal.programs")}: </span>
          {e.programs.map((p, i) => (
            <span key={p.id}>{i > 0 && ", "}<Link className="text-indigo-700 hover:underline" to={`/programs/${p.id}`}>{p.name}</Link></span>
          ))}
        </p>
      )}
    </li>
  );
}

function Manage({ onChange }: { onChange: () => void }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<SeasonalEntry[]>([]);
  const [programs, setPrograms] = useState<CatalogProgram[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState({ month: new Date().getMonth() + 1, niche: "", note: "", metricLabel: "", metricValue: "", sourceUrl: "", status: "draft", programIds: [] as string[] });
  const load = useCallback(() => api.seasonalManage().then((r) => setItems(r.items)).catch(() => {}), []);
  useEffect(() => {
    load();
    api.programs("limit=100").then((r) => setPrograms(r.items)).catch(() => {});
  }, [load]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setMsg(null);
    const body = { ...f, note: f.note || null, metricLabel: f.metricLabel || null, metricValue: f.metricValue || null, sourceUrl: f.sourceUrl || null };
    if (seasonalIssues(body).length) return setMsg({ ok: false, text: t("err.invalid_metric") });
    try {
      await api.seasonalCreate(body);
      setMsg({ ok: true, text: t("seasonal.added") });
      setF({ ...f, niche: "", note: "", metricLabel: "", metricValue: "", sourceUrl: "", programIds: [] });
      load();
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, t) });
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); load(); onChange(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  return (
    <section className="card space-y-4" aria-labelledby="seasonal-manage">
      <h2 id="seasonal-manage" className="font-medium">{t("seasonal.manage")}</h2>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="s-month">{t("seasonal.month")}</label>
          <select id="s-month" className="input" value={f.month} onChange={(e) => setF({ ...f, month: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(locale, i + 1)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="s-niche">{t("seasonal.niche")}</label>
          <input id="s-niche" className="input" required minLength={2} maxLength={80} value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="s-note">{t("seasonal.note")}</label>
          <input id="s-note" className="input" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="s-ml">{t("seasonal.metricLabel")}</label>
          <input id="s-ml" className="input" maxLength={80} value={f.metricLabel} onChange={(e) => setF({ ...f, metricLabel: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="s-mv">{t("seasonal.metricValue")}</label>
          <input id="s-mv" className="input" maxLength={40} value={f.metricValue} onChange={(e) => setF({ ...f, metricValue: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="s-src">{t("seasonal.sourceUrl")}</label>
          <input id="s-src" type="url" className="input" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="s-status">{t("seasonal.status")}</label>
          <select id="s-status" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="draft">{t("seasonal.draft")}</option>
            <option value="published">{t("seasonal.published")}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="s-progs">{t("seasonal.link")}</label>
          <select id="s-progs" multiple className="input h-24" value={f.programIds} onChange={(e) => setF({ ...f, programIds: Array.from(e.target.selectedOptions, (o) => o.value) })}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button className="btn" type="submit">{t("seasonal.add")}</button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
        </div>
      </form>
      <ul className="divide-y divide-slate-100">
        {items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <strong>{monthName(locale, e.month)}</strong> · {e.niche}{e.metricValue ? ` · ${e.metricValue}` : ""}{" "}
              <span className="text-xs text-slate-500">({e.status === "published" ? t("seasonal.published") : t("seasonal.draft")})</span>
            </span>
            <span className="flex gap-2">
              <button className="btn-secondary" onClick={() => act(() => api.seasonalPatch(e.id, { status: e.status === "published" ? "draft" : "published" }))}>
                {e.status === "published" ? t("seasonal.unpublish") : t("seasonal.publish")}
              </button>
              <button className="btn-danger" onClick={() => act(() => api.seasonalDelete(e.id))}>{t("seasonal.delete")}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Seasonal() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [items, setItems] = useState<SeasonalEntry[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    api.seasonal(month).then((r) => setItems(r.items)).catch(() => setError(true));
  }, [month]);
  useEffect(load, [load]);
  const canEdit = me?.user.role === "editor" || me?.user.role === "admin";
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t("seasonal.title")}</h1>
        <p className="text-sm text-slate-600">{t("seasonal.subtitle")}</p>
      </header>
      <div role="tablist" aria-label={t("seasonal.month")} className="flex flex-wrap gap-1">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <button key={m} role="tab" aria-selected={m === month} className={m === month ? "btn" : "btn-secondary"} onClick={() => setMonth(m)}>
            {monthName(locale, m)}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-red-600">{t("common.error")}</p>}
      {items && items.length === 0 && <p className="text-slate-500">{t("seasonal.empty")}</p>}
      <ul className="grid gap-3 md:grid-cols-2">{items?.map((e) => <EntryCard key={e.id} e={e} />)}</ul>
      {canEdit && <Manage onChange={load} />}
    </div>
  );
}
