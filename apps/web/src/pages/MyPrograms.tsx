import { APPLICATION_STATUS } from "@ai/shared";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type UserProgram, type UserProgramDetail } from "../api";
import { SafeLink, formatDate } from "../components/badges";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

const toInputDate = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
const fromInputDate = (v: string) => (v ? Date.parse(`${v}T12:00:00Z`) : null);

function Manage({ item, onChanged }: { item: UserProgram; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [detail, setDetail] = useState<UserProgramDetail | null>(null);
  const [f, setF] = useState({
    affiliateId: item.affiliateId ?? "", acceptedTerms: item.acceptedTerms ?? "", notes: item.notes ?? "",
    nextAction: item.nextAction ?? "", nextActionAt: toInputDate(item.nextActionAt),
    appliedAt: toInputDate(item.appliedAt), approvedAt: toInputDate(item.approvedAt),
  });
  const [doc, setDoc] = useState({ title: "", url: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => { api.myProgram(item.id).then(setDetail).catch(() => setMsg({ ok: false, text: t("common.error") })); }, [item.id, t]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    try { await fn(); setMsg({ ok: true, text: t("common.saved") }); after?.(); load(); onChanged(); }
    catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const text = (id: string, label: string, key: keyof typeof f, type = "text") => (
    <div>
      <label className="label" htmlFor={`${id}-${item.id}`}>{label}</label>
      <input id={`${id}-${item.id}`} type={type} className="input" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-medium">{t("myp.signup")}</p>
        {item.signupUrl ? (
          <>
            <SafeLink href={item.signupUrl}>{item.signupUrl}</SafeLink>
            {item.signupUrlStatus !== "verified" && <p className="mt-1 text-amber-800">{t("myp.signupUnverified")}</p>}
          </>
        ) : <p className="text-slate-600">{t("myp.signupNone")}</p>}
        <p className="mt-1 text-xs text-slate-500">{t("myp.signupNote")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("aid", t("myp.affiliateId"), "affiliateId")}
        {text("na", t("myp.nextAction"), "nextAction")}
        {text("nad", t("myp.nextActionAt"), "nextActionAt", "date")}
        {text("ap", t("myp.appliedAt"), "appliedAt", "date")}
        {text("apr", t("myp.approvedAt"), "approvedAt", "date")}
      </div>
      <div>
        <label className="label" htmlFor={`terms-${item.id}`}>{t("myp.acceptedTerms")}</label>
        <textarea id={`terms-${item.id}`} className="input" rows={2} value={f.acceptedTerms} onChange={(e) => setF({ ...f, acceptedTerms: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor={`notes-${item.id}`}>{t("myp.notes")}</label>
        <textarea id={`notes-${item.id}`} className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <button className="btn" onClick={() => run(() => api.patchMyProgram(item.id, {
        affiliateId: f.affiliateId || null, acceptedTerms: f.acceptedTerms || null, notes: f.notes || null,
        nextAction: f.nextAction || null, nextActionAt: fromInputDate(f.nextActionAt),
        appliedAt: fromInputDate(f.appliedAt), approvedAt: fromInputDate(f.approvedAt),
      }))}>{t("myp.save")}</button>

      <section>
        <h3 className="text-sm font-semibold">{t("myp.docs")}</h3>
        <p className="text-xs text-slate-500">{t("myp.docsNote")}</p>
        <ul className="my-2 space-y-1 text-sm">
          {detail?.docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <SafeLink href={d.url}>{d.title}</SafeLink>
              <button className="text-xs text-red-600 hover:underline" aria-label={`${t("common.delete")} ${d.title}`} onClick={() => run(() => api.removeDoc(item.id, d.id))}>{t("common.delete")}</button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input aria-label={t("myp.docTitle")} placeholder={t("myp.docTitle")} className="input" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
          <input aria-label={t("myp.docUrl")} placeholder={t("myp.docUrl")} className="input" value={doc.url} onChange={(e) => setDoc({ ...doc, url: e.target.value })} />
          <button className="btn-secondary" onClick={() => run(() => api.addDoc(item.id, doc), () => setDoc({ title: "", url: "" }))}>{t("myp.addDoc")}</button>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">{t("myp.history")}</h3>
        <ul className="mt-1 space-y-1 text-sm text-slate-700">
          {detail?.history.map((h, i) => (
            <li key={i}>{formatDate(h.at, locale)} — {h.from ? `${t(`appStatus.${h.from}` as MessageKey)} → ` : ""}{t(`appStatus.${h.to}` as MessageKey)}</li>
          ))}
        </ul>
      </section>
      <button className="btn-danger" onClick={() => run(() => api.removeMyProgram(item.id))}>{t("myp.remove")}</button>
    </div>
  );
}

export function MyPrograms() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<UserProgram[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.myPrograms().then((r) => setItems(r.items)).catch(() => setError(t("common.error"))); }, [t]);
  useEffect(load, [load]);

  if (error) return <p role="alert">{error}</p>;
  if (!items) return <p className="text-slate-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("myp.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("myp.subtitle")}</p>
      </div>
      {items.length === 0 ? <p className="card text-sm text-slate-600">{t("myp.empty")}</p> : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="card">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/programs/${it.programId}`} className="font-medium text-indigo-700 hover:underline">{it.programName}</Link>
                  <p className="text-xs text-slate-500">{it.advertiser} · {it.network ?? t("programs.direct")} · {t("myp.catalogStatus")}: {t(`verif.${it.catalogStatus}` as MessageKey)}</p>
                  {it.nextAction && <p className="text-xs text-slate-600">{t("myp.nextAction")}: {it.nextAction}{it.nextActionAt ? ` (${formatDate(it.nextActionAt, locale)})` : ""}</p>}
                </div>
                <label className="sr-only" htmlFor={`st-${it.id}`}>{t("myp.status")}</label>
                <select id={`st-${it.id}`} className="input w-auto" value={it.status}
                  onChange={async (e) => { try { await api.patchMyProgram(it.id, { status: e.target.value }); setError(null); load(); } catch (err) { setError(errorMessage(err, t)); } }}>
                  {APPLICATION_STATUS.map((s) => <option key={s} value={s}>{t(`appStatus.${s}` as MessageKey)}</option>)}
                </select>
                <button className="btn-secondary" aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>{t("myp.details")}</button>
              </div>
              {it.needsReview && <p role="alert" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("myp.review")}</p>}
              {open === it.id && <Manage item={it} onChanged={load} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
