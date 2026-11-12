import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Connection } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-sm ${m.ok ? "text-emerald-700" : "text-red-600"}`}>{m.text}</p> : null);

function ImportBox({ conn }: { conn: Connection }) {
  const { t } = useI18n();
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [data, setData] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const run = async (dryRun: boolean) => {
    setMsg(null);
    try {
      const r = await api.supplierImport({ connectionId: conn.id, format, data, dryRun });
      setMsg({ ok: r.errors.length === 0, text: dryRun ? t("integ.previewResult", { v: r.valid ?? 0, e: r.errors.length }) : t("integ.importResult", { c: r.created ?? 0, u: r.updated ?? 0, e: r.errors.length }) });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, t) });
    }
  };
  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <h4 className="text-sm font-medium">{t("integ.import")}</h4>
      <p className="text-xs text-slate-500">{t("integ.importHelp")}</p>
      <div className="flex items-center gap-2">
        <label className="label" htmlFor={`fmt-${conn.id}`}>{t("integ.format")}</label>
        <select id={`fmt-${conn.id}`} className="input w-28" value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
      </div>
      <label className="label" htmlFor={`data-${conn.id}`}>{t("integ.data")}</label>
      <textarea id={`data-${conn.id}`} className="input font-mono text-xs" rows={5} value={data} onChange={(e) => setData(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={!data.trim()} onClick={() => run(true)}>{t("integ.preview")}</button>
        <button className="btn" disabled={!data.trim()} onClick={() => run(false)}>{t("integ.importNow")}</button>
      </div>
      <Note m={msg} />
    </div>
  );
}

function ConnCard({ c, onChange }: { c: Connection; onChange: () => void }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState<Msg>(null);
  const authorize = async () => {
    try { window.location.assign((await api.shopeeAuthUrl(c.id)).url); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const sync = async () => {
    setMsg(null);
    try { const r = await api.supplierSync(c.id); setMsg({ ok: true, text: t("integ.synced", { c: r.created, u: r.updated, e: r.errors.length }) }); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const remove = async () => { try { await api.connectionDelete(c.id); onChange(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); } };
  return (
    <li className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{c.label} <span className="text-xs text-slate-500">· {c.provider === "shopee" ? "Shopee" : t("store.supplier")}</span></h3>
          <p className="text-xs text-slate-500">
            {t(`integ.status.${c.status}` as MessageKey)}
            {c.status === "error" && c.statusDetail ? `: ${c.statusDetail}` : ""}
            {c.provider === "shopee" && c.config.shopId ? ` · shop ${c.config.shopId}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {c.provider === "shopee" && <button className="btn" onClick={authorize}>{t("integ.authorize")}</button>}
          {c.provider === "supplier" && c.config.url && <button className="btn-secondary" onClick={sync}>{t("integ.sync")}</button>}
          <button className="btn-danger" onClick={remove}>{t("integ.delete")}</button>
        </div>
      </div>
      <Note m={msg} />
      {c.provider === "supplier" && <ImportBox conn={c} />}
    </li>
  );
}

function AddShopee({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [hosts, setHosts] = useState<string[]>(["https://partner.shopeemobile.com"]);
  const [f, setF] = useState({ label: "", partnerId: "", partnerKey: "", host: "https://partner.shopeemobile.com" });
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { api.integStatus().then((s) => setHosts(s.hosts)).catch(() => {}); }, []);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setMsg(null);
    try { await api.connectionCreate({ provider: "shopee", ...f }); setF({ ...f, label: "", partnerId: "", partnerKey: "" }); setMsg({ ok: true, text: t("integ.saved") }); onDone(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  return (
    <form onSubmit={submit} className="card space-y-3" aria-labelledby="add-shopee">
      <h3 id="add-shopee" className="font-medium">{t("integ.addShopee")}</h3>
      <p className="text-xs text-slate-500">{t("integ.shopeeHelp")}</p>
      <div><label className="label" htmlFor="sh-label">{t("integ.label")}</label><input id="sh-label" className="input" required maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
      <div><label className="label" htmlFor="sh-pid">{t("integ.partnerId")}</label><input id="sh-pid" className="input" required inputMode="numeric" pattern="\d{1,20}" value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })} /></div>
      <div><label className="label" htmlFor="sh-key">{t("integ.partnerKey")}</label><input id="sh-key" className="input" type="password" autoComplete="off" required minLength={8} value={f.partnerKey} onChange={(e) => setF({ ...f, partnerKey: e.target.value })} /></div>
      <div>
        <label className="label" htmlFor="sh-host">{t("integ.host")}</label>
        <select id="sh-host" className="input" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })}>{hosts.map((h) => <option key={h} value={h}>{h}</option>)}</select>
      </div>
      <button className="btn" type="submit">{t("integ.add")}</button>
      <Note m={msg} />
    </form>
  );
}

function AddSupplier({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ label: "", url: "", authHeader: "Authorization", token: "", mapping: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setMsg(null);
    let mapping: unknown = undefined;
    if (f.mapping.trim()) {
      try { mapping = JSON.parse(f.mapping); } catch { return setMsg({ ok: false, text: t("integ.mappingInvalid") }); }
    }
    try {
      await api.connectionCreate({ provider: "supplier", label: f.label, url: f.url.trim() || null, authHeader: f.authHeader, token: f.token || null, ...(mapping ? { mapping } : {}) });
      setF({ label: "", url: "", authHeader: "Authorization", token: "", mapping: "" });
      setMsg({ ok: true, text: t("integ.saved") });
      onDone();
    } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  return (
    <form onSubmit={submit} className="card space-y-3" aria-labelledby="add-sup">
      <h3 id="add-sup" className="font-medium">{t("integ.addSupplier")}</h3>
      <p className="text-xs text-slate-500">{t("integ.supplierHelp")}</p>
      <div><label className="label" htmlFor="su-label">{t("integ.label")}</label><input id="su-label" className="input" required maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
      <div><label className="label" htmlFor="su-url">{t("integ.url")}</label><input id="su-url" className="input" type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>
      <div><label className="label" htmlFor="su-hdr">{t("integ.authHeader")}</label><input id="su-hdr" className="input" pattern="[A-Za-z0-9\-]{1,40}" value={f.authHeader} onChange={(e) => setF({ ...f, authHeader: e.target.value })} /></div>
      <div><label className="label" htmlFor="su-tok">{t("integ.token")}</label><input id="su-tok" className="input" type="password" autoComplete="off" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} /></div>
      <div><label className="label" htmlFor="su-map">{t("integ.mapping")}</label><textarea id="su-map" className="input font-mono text-xs" rows={3} placeholder='{"externalId":"id","name":"title","costPrice":"price.value"}' value={f.mapping} onChange={(e) => setF({ ...f, mapping: e.target.value })} /></div>
      <button className="btn" type="submit">{t("integ.add")}</button>
      <Note m={msg} />
    </form>
  );
}

export function Integrations() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [items, setItems] = useState<Connection[]>([]);
  const [vault, setVault] = useState(true);
  const load = useCallback(() => {
    api.connections().then((r) => setItems(r.items)).catch(() => {});
  }, []);
  useEffect(() => { load(); api.integStatus().then((s) => setVault(s.vaultReady)).catch(() => {}); }, [load]);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t("integ.title")}</h1>
        <p className="text-sm text-slate-600">{t("integ.subtitle")}</p>
      </header>
      {!vault && <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("integ.vaultOff")}</p>}
      {params.get("connected") && <p role="status" className="text-sm text-emerald-700">{t("integ.connected")}</p>}
      {params.get("error") && <p role="alert" className="text-sm text-red-600">{t("integ.callbackError")}</p>}
      <section aria-labelledby="conns" className="space-y-3">
        <h2 id="conns" className="font-medium">{t("integ.connections")}</h2>
        {items.length === 0 && <p className="text-slate-500">{t("integ.empty")}</p>}
        <ul className="space-y-3">{items.map((c) => <ConnCard key={c.id} c={c} onChange={load} />)}</ul>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <AddShopee onDone={load} />
        <AddSupplier onDone={load} />
      </div>
    </div>
  );
}
