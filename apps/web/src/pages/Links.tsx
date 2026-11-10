import { DISTRIBUTION_CHANNELS } from "@ai/shared";
import qrcode from "qrcode-generator";
import { useCallback, useEffect, useState } from "react";
import { api, type AffLink, type Campaign, type UserProgram } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

/** QR gerado no navegador (SVG): a URL não sai do aparelho. */
function QrCode({ value, name }: { value: string; name: string }) {
  const { t } = useI18n();
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ scalable: true, margin: 2 });
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <div className="mt-2 flex items-center gap-3">
      <img src={href} alt={t("links.qrAlt", { name })} className="h-32 w-32 rounded border border-slate-200 bg-white" />
      <a className="btn-secondary" href={href} download={`qr-${name.replace(/\W+/g, "-").toLowerCase()}.svg`}>SVG</a>
    </div>
  );
}

export function Links() {
  const { t } = useI18n();
  const [items, setItems] = useState<AffLink[] | null>(null);
  const [programs, setPrograms] = useState<UserProgram[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ label: "", url: "", programId: "", campaignId: "", productName: "", channel: "other", campaignTag: "", trackingMode: "none" });

  const load = useCallback(() => {
    Promise.all([api.links(), api.myPrograms(), api.campaigns()])
      .then(([l, p, c]) => { setItems(l.items); setPrograms(p.items); setCampaigns(c.items); })
      .catch(() => setMsg(t("common.error")));
  }, [t]);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.createLink({
        label: f.label, url: f.url, channel: f.channel, trackingMode: f.trackingMode,
        programId: f.programId || null, campaignId: f.campaignId || null,
        productName: f.productName || null, campaignTag: f.campaignTag || null,
      });
      setF({ ...f, label: "", url: "", productName: "", campaignTag: "" });
      load();
    } catch (err) { setMsg(errorMessage(err, t)); }
  }

  if (!items) return <p className="text-slate-500">{t("common.loading")}</p>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("links.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("links.subtitle")}</p>
        <p className="mt-1 text-xs text-slate-500">{t("links.notice")}</p>
      </div>

      <form onSubmit={add} className="card space-y-3" aria-label={t("links.add")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="l-label">{t("links.label")}</label><input id="l-label" required className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
          <div><label className="label" htmlFor="l-url">{t("links.url")}</label><input id="l-url" required type="url" className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="l-prog">{t("links.program")}</label>
            <select id="l-prog" className="input" value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })}>
              <option value="">{t("links.noProgram")}</option>
              {programs.map((p) => <option key={p.id} value={p.programId}>{p.programName}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="l-camp">{t("links.campaign")}</label>
            <select id="l-camp" className="input" value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
              <option value="">{t("links.noCampaign")}</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="l-prod">{t("links.product")}</label><input id="l-prod" className="input" value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="l-ch">{t("links.channel")}</label>
            <select id="l-ch" className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              {DISTRIBUTION_CHANNELS.map((c) => <option key={c} value={c}>{t(`dch.${c}` as MessageKey)}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="l-tag">{t("links.tag")}</label><input id="l-tag" className="input" pattern="[A-Za-z0-9_\-]{1,60}" value={f.campaignTag} onChange={(e) => setF({ ...f, campaignTag: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="l-mode">{t("links.mode")}</label>
            <select id="l-mode" className="input" value={f.trackingMode} onChange={(e) => setF({ ...f, trackingMode: e.target.value })}>
              <option value="none">{t("links.mode.none")}</option>
              <option value="own_redirect">{t("links.mode.own_redirect")}</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">{t("links.redirectHint")}</p>
          </div>
        </div>
        {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}
        <button className="btn">{t("links.add")}</button>
      </form>

      {items.length === 0 ? <p className="card text-sm text-slate-600">{t("links.empty")}</p> : (
        <ul className="space-y-3">
          {items.map((l) => (
            <li key={l.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{l.label}</span>
                {!l.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{t("links.inactive")}</span>}
                {l.redirectAllowed && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{t("links.redirectOk")}</span>}
                <span className="text-xs text-slate-500">{t(`dch.${l.channel}` as MessageKey)}{l.programName ? ` · ${l.programName}` : ""}{l.campaignTag ? ` · #${l.campaignTag}` : ""}</span>
              </div>
              <p className="break-all text-xs text-slate-600">{l.url}</p>
              {l.trackUrl ? (
                <>
                  <p className="break-all text-sm"><span className="font-medium">{t("links.trackUrl")}:</span> {l.trackUrl}</p>
                  <p className="text-sm">{t("links.clicks", { n: l.clicks, n30: l.clicks30d })}</p>
                </>
              ) : <p className="text-xs text-slate-500">{t("links.noTracking")}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={async () => { await navigator.clipboard?.writeText(l.trackUrl ?? l.url).catch(() => {}); setCopied(l.id); }}>{t("links.copy")}</button>
                <button className="btn-secondary" aria-expanded={qrFor === l.id} onClick={() => setQrFor(qrFor === l.id ? null : l.id)}>{qrFor === l.id ? t("links.qrHide") : t("links.qr")}</button>
                <button className="btn-secondary" onClick={async () => { try { await api.patchLink(l.id, { active: !l.active }); load(); } catch (err) { setMsg(errorMessage(err, t)); } }}>{l.active ? t("links.deactivate") : t("links.activate")}</button>
                <button className="btn-danger" onClick={async () => { await api.deleteLink(l.id); load(); }}>{t("links.delete")}</button>
                {copied === l.id && <span role="status" className="self-center text-sm text-emerald-700">{t("links.copied")}</span>}
              </div>
              {qrFor === l.id && <QrCode value={l.trackUrl ?? l.url} name={l.label} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
