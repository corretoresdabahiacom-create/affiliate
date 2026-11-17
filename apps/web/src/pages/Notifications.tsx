import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type MonitorItem, type Notice } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-sm ${m.ok ? "text-emerald-700" : "text-red-600"}`}>{m.text}</p> : null);

function Monitor() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<MonitorItem[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(() => { api.monitor().then((r) => setItems(r.items)).catch(() => {}); }, []);
  useEffect(load, [load]);
  const check = async (programId: string) => {
    setMsg(null);
    try { const r = await api.monitorCheck(programId); setMsg({ ok: true, text: t("notif.monitor.result", { n: r.checked, f: r.findings.length }) }); load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const d = (n: number) => new Date(n).toLocaleString(locale);
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{t("notif.monitor.title")}</h2>
      <p className="text-sm text-slate-600">{t("notif.monitor.help")}</p>
      {items.length === 0 ? <p className="text-sm text-slate-500">{t("notif.monitor.empty")}</p> : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.sourceId} className="card flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <Link className="font-medium text-indigo-700 hover:underline" to={`/programs/${i.programId}`}>{i.programName}</Link>
                <p className="break-all text-xs text-slate-500">{i.url}</p>
                <p className="text-xs text-slate-600">
                  {i.lastCheckedAt == null ? t("notif.monitor.never") : t("notif.monitor.checked", { d: d(i.lastCheckedAt), s: i.lastStatus ?? "—" })}
                  {i.failures >= 2 ? ` · ${t("notif.monitor.down")}` : ""}{i.changedAt ? ` · ${t("notif.monitor.changed", { d: d(i.changedAt) })}` : ""}
                </p>
              </div>
              <button className="btn-secondary" onClick={() => check(i.programId)}>{t("notif.monitor.check")}</button>
            </li>
          ))}
        </ul>
      )}
      <Note m={msg} />
    </section>
  );
}

/** Notificação no idioma de quem lê: usa `notice.<kind>` com os valores guardados; se não houver tradução, mostra o texto salvo. */
function useNoticeText() {
  const { t } = useI18n();
  const has = (k: string) => t(k as MessageKey) !== k;
  return (n: Notice) => {
    const key = `notice.${n.kind}`;
    if (!n.data || !has(key)) return { title: n.title, body: n.body };
    const vars = Object.fromEntries(Object.entries(n.data).map(([k, v]) => [k, String(v ?? "")]));
    return { title: t(key as MessageKey, vars), body: has(`${key}.body`) ? t(`${key}.body` as MessageKey, vars) : n.body };
  };
}

export function Notifications() {
  const text = useNoticeText();
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [emailOn, setEmailOn] = useState(false);
  const [freq, setFreq] = useState("daily");
  const [emailAvailable, setEmailAvailable] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(() => { api.notices().then((r) => { setItems(r.items); setUnread(r.unread); setEmailOn(r.prefs.emailEnabled); setFreq(r.prefs.frequency); setEmailAvailable(r.emailAvailable); }).catch(() => {}); }, []);
  useEffect(load, [load]);
  const toggle = async (on: boolean) => { setMsg(null); try { await api.noticePrefs(on); load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); } };
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div><h1 className="text-xl font-semibold">{t("notif.title")}</h1><p className="text-sm text-slate-600">{t("notif.unread", { n: unread })}</p></div>
        {unread > 0 && <button className="btn-secondary" onClick={async () => { await api.noticesRead().catch(() => {}); load(); }}>{t("notif.markAll")}</button>}
      </header>
      {items.length === 0 ? <p className="text-slate-500">{t("notif.empty")}</p> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`card ${n.read ? "opacity-70" : ""}`}>
              <p className="font-medium">{text(n).title}</p>
              {text(n).body && <p className="text-sm text-slate-600">{text(n).body}</p>}
              <p className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleString(locale)}{n.link ? <> · <Link className="text-indigo-700 hover:underline" to={n.link} onClick={() => api.noticesRead([n.id]).catch(() => {})}>→</Link></> : null}</p>
            </li>
          ))}
        </ul>
      )}
      <section className="card space-y-2">
        <h2 className="text-lg font-semibold">{t("notif.email.title")}</h2>
        <p className="text-sm text-slate-600">{t("notif.email.help", { f: freq })}</p>
        {!emailAvailable && <p className="text-sm text-amber-800">{t("notif.email.unavailable")}</p>}
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={emailOn} onChange={(e) => toggle(e.target.checked)} />{t("notif.email.toggle")}</label>
        <Note m={msg} />
      </section>
      <Monitor />
    </div>
  );
}
