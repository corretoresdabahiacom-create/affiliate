import { DISTRIBUTION_CHANNELS, isPaidChannel } from "@ai/shared";
import { useCallback, useEffect, useState } from "react";
import { api, type Campaign, type UserProgram } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

const num = (v: string) => (v === "" ? null : Number(v));

export function Campaigns() {
  const { t } = useI18n();
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [programs, setPrograms] = useState<UserProgram[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState({
    name: "", programId: "", productName: "", channel: "seo", keyword: "", audience: "", budget: "", adSpend: "", currency: "USD",
    status: "planned", clicksReported: "", conversionsReported: "",
  });
  const load = useCallback(() => {
    Promise.all([api.campaigns(), api.myPrograms()]).then(([c, p]) => { setItems(c.items); setPrograms(p.items); }).catch(() => setMsg({ ok: false, text: t("common.error") }));
  }, [t]);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api.createCampaign({
        name: f.name, programId: f.programId || null, productName: f.productName || null, channel: f.channel,
        keyword: f.keyword || null, audience: f.audience || null, budget: num(f.budget), adSpend: num(f.adSpend),
        currency: f.currency, status: f.status, clicksReported: num(f.clicksReported), conversionsReported: num(f.conversionsReported),
      });
      if (r.warnings.includes("paid_traffic_not_confirmed")) setMsg({ ok: false, text: t("camp.warn") });
      setF({ ...f, name: "", keyword: "", audience: "", budget: "", adSpend: "", clicksReported: "", conversionsReported: "" });
      load();
    } catch (err) { setMsg({ ok: false, text: errorMessage(err, t) }); }
  }
  const inp = (id: string, label: string, key: keyof typeof f, type = "text") => (
    <div><label className="label" htmlFor={id}>{label}</label><input id={id} type={type} min={type === "number" ? 0 : undefined} className="input" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} /></div>
  );

  if (!items) return <p className="text-slate-500">{t("common.loading")}</p>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("camp.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("camp.subtitle")}</p>
        <p className="mt-1 text-xs text-slate-500">{t("camp.paidNote")}</p>
      </div>
      <form onSubmit={add} className="card space-y-3" aria-label={t("camp.add")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="c-name">{t("camp.name")}</label><input id="c-name" required className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="c-prog">{t("links.program")}</label>
            <select id="c-prog" className="input" value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })}>
              <option value="">{t("links.noProgram")}</option>
              {programs.map((p) => <option key={p.id} value={p.programId}>{p.programName}</option>)}
            </select>
          </div>
          {inp("c-prod", t("links.product"), "productName")}
          <div>
            <label className="label" htmlFor="c-ch">{t("links.channel")}</label>
            <select id="c-ch" className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              {DISTRIBUTION_CHANNELS.map((c) => <option key={c} value={c}>{t(`dch.${c}` as MessageKey)}</option>)}
            </select>
          </div>
          {inp("c-kw", t("camp.keyword"), "keyword")}
          {inp("c-aud", t("camp.audience"), "audience")}
          {inp("c-bud", t("camp.budget"), "budget", "number")}
          {inp("c-spend", t("camp.adSpend"), "adSpend", "number")}
          {inp("c-cur", t("camp.currency"), "currency")}
          <div>
            <label className="label" htmlFor="c-st">{t("camp.status")}</label>
            <select id="c-st" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {["planned", "active", "paused", "ended"].map((s) => <option key={s} value={s}>{t(`camp.status.${s}` as MessageKey)}</option>)}
            </select>
          </div>
          {inp("c-cl", t("camp.clicksReported"), "clicksReported", "number")}
          {inp("c-cv", t("camp.conversionsReported"), "conversionsReported", "number")}
        </div>
        <p className="text-xs text-slate-500">{t("camp.manualNote")}</p>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
        <button className="btn">{t("camp.add")}</button>
      </form>

      {items.length === 0 ? <p className="card text-sm text-slate-600">{t("camp.empty")}</p> : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.id} className="card flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{c.name} {isPaidChannel(c.channel) && <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{t("camp.paid")}</span>}</p>
                <p className="text-xs text-slate-500">
                  {t(`dch.${c.channel}` as MessageKey)} · {t(`camp.status.${c.status}` as MessageKey)}{c.programName ? ` · ${c.programName}` : ""}{c.keyword ? ` · ${c.keyword}` : ""}
                </p>
                <p className="text-xs text-slate-600">
                  {c.budget !== null ? `${t("camp.budget")}: ${c.budget} ${c.currency} · ` : ""}{c.adSpend !== null ? `${t("camp.adSpend")}: ${c.adSpend} ${c.currency} · ` : ""}
                  {c.clicksReported !== null ? `${t("camp.clicksReported")}: ${c.clicksReported} · ` : ""}{c.conversionsReported !== null ? `${t("camp.conversionsReported")}: ${c.conversionsReported}` : ""}
                </p>
              </div>
              <button className="btn-danger" onClick={async () => { await api.deleteCampaign(c.id); load(); }}>{t("camp.delete")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
