import { useCallback, useEffect, useState } from "react";
import { api, WEBHOOK_EVENT_LIST, type InboundHook, type Webhook, type WebhookDelivery } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-sm ${m.ok ? "text-emerald-700" : "text-red-600"}`}>{m.text}</p> : null);

function WebhookCard({ w, onChange }: { w: Webhook; onChange: () => void }) {
  const { t, locale } = useI18n();
  const [msg, setMsg] = useState<Msg>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setMsg(null); try { await fn(); onChange(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); } };
  const test = async () => {
    setMsg(null);
    try {
      const r = await api.webhookTest(w.id);
      setMsg(r.status === "delivered" ? { ok: true, text: t("auto.out.tested", { status: r.status, code: r.responseStatus ?? "—" }) } : { ok: false, text: t("auto.out.testFail", { status: r.status, err: r.error ?? "" }) });
      if (deliveries) setDeliveries((await api.webhookDeliveries(w.id)).items);
    } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium">{w.label}</p><p className="break-all text-xs text-slate-500">{w.url}</p></div>
        {!w.active && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{t("auto.out.disabled")}</span>}
      </div>
      <ul className="flex flex-wrap gap-1">{w.events.map((e) => <li key={e} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t(`auto.event.${e}` as MessageKey)}</li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={test}>{t("auto.out.test")}</button>
        <button className="btn-secondary" onClick={async () => setDeliveries(deliveries ? null : (await api.webhookDeliveries(w.id)).items)}>{t("auto.out.deliveries")}</button>
        <button className="btn-secondary" onClick={() => run(() => api.webhookPatch(w.id, { active: !w.active }))}>{w.active ? t("auto.out.disable") : t("auto.out.enable")}</button>
        <button className="btn-secondary" onClick={() => run(() => api.webhookDelete(w.id))}>{t("auto.out.delete")}</button>
      </div>
      <Note m={msg} />
      {deliveries && (
        <ul className="text-xs text-slate-600">
          {deliveries.map((d) => <li key={d.id}>{new Date(d.createdAt).toLocaleString(locale)} · {t(`auto.event.${d.event}` as MessageKey)} · {d.status} ({d.attempts}){d.error ? ` · ${d.error}` : ""}</li>)}
        </ul>
      )}
    </li>
  );
}

function Webhooks() {
  const { t } = useI18n();
  const [items, setItems] = useState<Webhook[]>([]);
  const [vaultReady, setVaultReady] = useState(true);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["order.new"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(() => { api.webhooks().then((r) => { setItems(r.items); setVaultReady(r.vaultReady); }).catch(() => {}); }, []);
  useEffect(load, [load]);
  const create = async () => {
    setMsg(null); setSecret(null);
    try { const r = await api.webhookCreate({ label, url, events }); setSecret(r.secret); setLabel(""); setUrl(""); load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("auto.out.title")}</h2>
      <p className="text-sm text-slate-600">{t("auto.out.help")}</p>
      {!vaultReady && <p role="alert" className="text-sm text-amber-800">{t("auto.vaultOff")}</p>}
      <div className="card space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div><label className="label" htmlFor="wh-label">{t("auto.out.label")}</label><input id="wh-label" className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div><label className="label" htmlFor="wh-url">{t("auto.out.url")}</label><input id="wh-url" className="input" type="url" maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} /></div>
        </div>
        <fieldset><legend className="label">{t("auto.out.events")}</legend>
          <div className="flex flex-wrap gap-3">
            {WEBHOOK_EVENT_LIST.map((e) => (
              <label key={e} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={events.includes(e)} onChange={() => setEvents((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]))} />{t(`auto.event.${e}` as MessageKey)}</label>
            ))}
          </div>
        </fieldset>
        <button className="btn" disabled={!vaultReady || !label.trim() || !url.trim() || events.length === 0} onClick={create}>{t("auto.out.create")}</button>
        <Note m={msg} />
        {secret && <p className="rounded bg-amber-50 p-2 text-sm">{t("auto.out.secret")} <code className="break-all font-mono">{secret}</code></p>}
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-500">{t("auto.out.empty")}</p> : <ul className="space-y-3">{items.map((w) => <WebhookCard key={`${w.id}-${w.active}-${w.events.join()}`} w={w} onChange={load} />)}</ul>}
    </section>
  );
}

const ACTIONS = ["notify", "supplier.import"] as const;
function Inbound() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<InboundHook[]>([]);
  const [label, setLabel] = useState("");
  const [actions, setActions] = useState<string[]>(["notify"]);
  const [created, setCreated] = useState<{ token: string; url: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(() => { api.inboundList().then((r) => setItems(r.items)).catch(() => {}); }, []);
  useEffect(load, [load]);
  const create = async () => {
    setMsg(null); setCreated(null);
    try { const r = await api.inboundCreate({ label, actions }); setCreated({ token: r.token, url: r.url }); setLabel(""); load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t("auto.in.title")}</h2>
      <p className="text-sm text-slate-600">{t("auto.in.help")}</p>
      <div className="card space-y-2">
        <div><label className="label" htmlFor="ih-label">{t("auto.out.label")}</label><input id="ih-label" className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div className="flex flex-wrap gap-3">
          {ACTIONS.map((a) => <label key={a} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={actions.includes(a)} onChange={() => setActions((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]))} />{t(`auto.action.${a}` as MessageKey)}</label>)}
        </div>
        <button className="btn" disabled={!label.trim() || actions.length === 0} onClick={create}>{t("auto.in.create")}</button>
        <Note m={msg} />
        {created && (
          <div className="space-y-1 rounded bg-amber-50 p-2 text-sm">
            <p>{t("auto.in.token")} <code className="break-all font-mono">{created.token}</code></p>
            <p>{t("auto.in.url")} <code className="break-all font-mono">{created.url}</code></p>
          </div>
        )}
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-500">{t("auto.in.empty")}</p> : (
        <ul className="space-y-2">
          {items.map((h) => (
            <li key={h.id} className="card flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{h.label}</p>
                <p className="text-xs text-slate-500">{h.actions.map((a) => t(`auto.action.${a}` as MessageKey)).join(" · ")} · {h.lastUsedAt ? t("auto.in.lastUsed", { d: new Date(h.lastUsedAt).toLocaleString(locale) }) : t("auto.in.never")}</p>
              </div>
              <button className="btn-secondary" onClick={async () => { await api.inboundDelete(h.id).catch(() => {}); load(); }}>{t("auto.out.delete")}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Automations() {
  const { t } = useI18n();
  return (
    <div className="space-y-8">
      <header><h1 className="text-xl font-semibold">{t("auto.title")}</h1><p className="text-sm text-slate-600">{t("auto.subtitle")}</p></header>
      <Webhooks />
      <Inbound />
    </div>
  );
}
