import { useCallback, useEffect, useState } from "react";
import { CONTENT_CHANNELS } from "@ai/shared";
import { api, type AdDraft, type CatalogProgram } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

function Draft({ d, onChange }: { d: AdDraft; onChange: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description);
  const [ack, setAck] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const dirty = title !== d.title || description !== d.description;
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); onChange(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const copy = async () => {
    try {
      const r = await api.adExport(d.id);
      setExported(r.text);
      try { await navigator.clipboard.writeText(r.text); setMsg({ ok: true, text: t("studio.copied") }); }
      catch { setMsg({ ok: false, text: t("studio.copyFail") }); }
    } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const checkKey = `studio.check.${d.channelCheck}` as MessageKey;
  const tone = d.channelCheck === "blocked" ? "bg-red-50 text-red-800" : d.channelCheck === "unverified" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800";
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{d.programName} <span className="text-xs text-slate-500">· {t(`ch.${d.channel}` as MessageKey)}</span></h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`studio.status.${d.status}` as MessageKey)}</span>
      </div>
      <p className={`rounded-md px-3 py-1.5 text-sm ${tone}`}>{t(checkKey)}</p>
      <p className="text-xs text-slate-500">{t(`studio.src.${d.textSource}` as MessageKey)}</p>
      {d.issues.map((i) => <p key={i} role="alert" className="text-sm text-red-600">{t(`studio.issue.${i}` as MessageKey)}</p>)}
      <div>
        <label className="label" htmlFor={`t-${d.id}`}>{t("studio.titleField")}</label>
        <input id={`t-${d.id}`} className="input" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} disabled={d.status === "discarded"} />
      </div>
      <div>
        <label className="label" htmlFor={`d-${d.id}`}>{t("studio.descField")}</label>
        <textarea id={`d-${d.id}`} className="input" rows={4} maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} disabled={d.status === "discarded"} />
      </div>
      <p className="text-xs text-slate-500"><strong>{t("studio.disclosure")}:</strong> {d.disclosure}</p>
      {d.channelCheck === "unverified" && d.status !== "approved" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          {t("studio.ack")}
        </label>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        {dirty && <button className="btn-secondary" onClick={() => run(() => api.adPatch(d.id, { title, description }), t("studio.saved"))}>{t("studio.save")}</button>}
        {d.status === "draft" && <button className="btn" disabled={dirty} onClick={() => run(() => api.adStatus(d.id, "approved", ack))}>{t("studio.approve")}</button>}
        {d.status === "approved" && <button className="btn" onClick={copy}>{t("studio.copy")}</button>}
        {d.status !== "draft" && <button className="btn-secondary" onClick={() => run(() => api.adStatus(d.id, "draft"))}>{t("studio.reopen")}</button>}
        {d.status !== "discarded" && <button className="btn-secondary" onClick={() => run(() => api.adStatus(d.id, "discarded"))}>{t("studio.discard")}</button>}
        <button className="btn-danger" onClick={() => run(() => api.adDelete(d.id))}>{t("studio.delete")}</button>
      </div>
      {exported && <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm" aria-label="export">{exported}</pre>}
    </li>
  );
}

export function AdStudio() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [programs, setPrograms] = useState<CatalogProgram[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [channel, setChannel] = useState<(typeof CONTENT_CHANNELS)[number]>("blog");
  const [withModel, setWithModel] = useState(true);
  const [userLink, setUserLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drafts, setDrafts] = useState<AdDraft[]>([]);
  const loadDrafts = useCallback(() => api.ads().then((r) => setDrafts(r.items)).catch(() => {}), []);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);
  useEffect(() => {
    const id = setTimeout(() => {
      api.programs(`limit=30${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`).then((r) => setPrograms(r.items)).catch(() => {});
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 10 ? p : [...p, id]));
  const generate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.adGenerate({ programIds: picked, channel, locale, withModel, userLink: userLink.trim() || null });
      if (r.skipped.length) setMsg({ ok: false, text: t("studio.skipped", { n: r.skipped.length }) });
      setPicked([]);
      await loadDrafts();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t("studio.title")}</h1>
        <p className="text-sm text-slate-600">{t("studio.subtitle")}</p>
      </header>
      <section className="card space-y-3">
        <div>
          <label className="label" htmlFor="st-q">{t("studio.search")}</label>
          <input id="st-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <fieldset>
          <legend className="label">{t("studio.pick")} ({picked.length}/10)</legend>
          <ul className="grid max-h-56 gap-1 overflow-auto sm:grid-cols-2">
            {programs.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                  {p.name} <span className="text-xs text-slate-500">· {p.advertiser.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="st-ch">{t("studio.channel")}</label>
            <select id="st-ch" className="input" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
              {CONTENT_CHANNELS.map((c) => <option key={c} value={c}>{t(`ch.${c}` as MessageKey)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="st-link">{t("studio.userLink")}</label>
            <input id="st-link" type="url" className="input" value={userLink} onChange={(e) => setUserLink(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withModel} onChange={(e) => setWithModel(e.target.checked)} />
          {t("studio.useModel")}
        </label>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
        <button className="btn" disabled={busy || picked.length === 0} onClick={generate}>{busy ? t("studio.generating") : t("studio.generate")}</button>
      </section>
      <section aria-labelledby="st-drafts" className="space-y-3">
        <h2 id="st-drafts" className="font-medium">{t("studio.drafts")}</h2>
        {drafts.length === 0 && <p className="text-slate-500">{t("studio.empty")}</p>}
        <ul className="space-y-3">{drafts.map((d) => <Draft key={`${d.id}-${d.updatedAt}`} d={d} onChange={loadDrafts} />)}</ul>
      </section>
    </div>
  );
}
