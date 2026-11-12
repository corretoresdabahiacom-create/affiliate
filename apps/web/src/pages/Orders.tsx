import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Connection, type Order, type SupplierSheet } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-sm ${m.ok ? "text-emerald-700" : "text-red-600"}`}>{m.text}</p> : null);
const STATUSES = ["not_placed", "placed", "shipped", "delivered", "problem"] as const;

function OrderCard({ o, onChange }: { o: Order; onChange: () => void }) {
  const { t, locale } = useI18n();
  const money = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: o.currency || "BRL" }).format(n);
  const [status, setStatus] = useState<Order["supplierStatus"]>(o.supplierStatus);
  const [ref, setRef] = useState(o.supplierRef ?? "");
  const [trk, setTrk] = useState(o.supplierTracking ?? "");
  const [sheet, setSheet] = useState<SupplierSheet | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); onChange(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{t("orders.order", { sn: o.orderSn })}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{o.status}</span>
      </div>
      <p className="text-xs text-slate-500">{new Date(o.orderedAt).toLocaleString(locale)}{o.total != null ? ` · ${t("orders.total", { v: money(o.total) })}` : ""}</p>
      <ul className="text-sm">{o.items.map((i, k) => <li key={k}>{t("orders.item", { q: i.quantity, name: i.name ?? i.itemId })}{i.sku ? <span className="text-xs text-slate-500"> ({i.sku})</span> : null}</li>)}</ul>

      <div className="space-y-1 border-t border-slate-100 pt-2">
        <h4 className="text-sm font-medium">{t("orders.tracking")}</h4>
        {o.trackingCheckedAt == null ? <p className="text-xs text-slate-500">{t("orders.tracking.none")}</p> : (
          <>
            <p className="text-sm">{o.trackingNumber ? t("orders.tracking.number", { n: o.trackingNumber }) : ""} {o.trackingStatus ?? ""}</p>
            <ul className="text-xs text-slate-600">{o.trackingEvents.map((e, k) => <li key={k}>{new Date(e.at).toLocaleString(locale)} · {e.description}</li>)}</ul>
          </>
        )}
        <button className="btn-secondary" onClick={() => run(() => api.orderTracking(o.id))}>{t("orders.tracking.refresh")}</button>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-2">
        <h4 className="text-sm font-medium">{t("orders.supplier")}</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor={`ss-${o.id}`}>{t("orders.supplier")}</label>
            <select id={`ss-${o.id}`} className="input" value={status} onChange={(e) => setStatus(e.target.value as Order["supplierStatus"])}>{STATUSES.map((s) => <option key={s} value={s}>{t(`orders.sup.${s}` as MessageKey)}</option>)}</select></div>
          <div><label className="label" htmlFor={`sr-${o.id}`}>{t("orders.supplierRef")}</label><input id={`sr-${o.id}`} className="input" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <div><label className="label" htmlFor={`st-${o.id}`}>{t("orders.supplierTracking")}</label><input id={`st-${o.id}`} className="input" maxLength={120} value={trk} onChange={(e) => setTrk(e.target.value)} /></div>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => run(() => api.orderPatch(o.id, { supplierStatus: status, supplierRef: ref.trim() || null, supplierTracking: trk.trim() || null }), t("common.saved"))}>{t("orders.save")}</button>
          <button className="btn-secondary" onClick={() => run(async () => setSheet(await api.orderSheet(o.id)))}>{t("orders.sheet")}</button>
        </div>
        {sheet && (
          <div className="rounded-md bg-slate-50 p-2 text-sm" role="region" aria-label={t("orders.sheet")}>
            <p className="text-xs text-slate-500">{t("orders.sheet.help")}</p>
            <ul>{sheet.lines.map((l, k) => <li key={k}>{l.quantity}× {l.productName}{l.sku ? ` (${l.sku})` : ""}{l.supplierExternalId ? ` · ${l.supplierExternalId}` : ""}{l.unitCost != null ? ` · ${t("orders.sheet.cost", { v: money(l.unitCost) })}` : ""}</li>)}</ul>
            {sheet.unmatched > 0 && <p className="text-amber-800">{t("orders.sheet.unmatched", { n: sheet.unmatched })}</p>}
            <p className="font-medium">{sheet.totalCost != null ? t("orders.sheet.total", { v: money(sheet.totalCost) }) : t("orders.sheet.totalUnknown")}</p>
          </div>
        )}
      </div>
      <Note m={msg} />
    </li>
  );
}

export function Orders() {
  const { t } = useI18n();
  const [conns, setConns] = useState<Connection[]>([]);
  const [shopId, setShopId] = useState("");
  const [days, setDays] = useState("7");
  const [items, setItems] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const shops = conns.filter((c) => c.provider === "shopee" && c.status === "connected");
  useEffect(() => { api.connections().then((r) => { setConns(r.items); const s = r.items.find((c) => c.provider === "shopee" && c.status === "connected"); if (s) setShopId(s.id); }).catch(() => {}); }, []);
  const load = useCallback(() => { if (shopId) api.orders(shopId).then((r) => setItems(r.items)).catch(() => {}); }, [shopId]);
  useEffect(load, [load]);
  const sync = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api.ordersSync(shopId, Number(days)); setMsg({ ok: true, text: t("orders.synced", { c: r.created, u: r.updated }) }); load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); } finally { setBusy(false); }
  };
  if (shops.length === 0) return <div className="space-y-3"><h1 className="text-xl font-semibold">{t("orders.title")}</h1><p className="text-slate-600">{t("orders.noShop")} <Link className="text-indigo-700 hover:underline" to="/integrations">{t("nav.integrations")}</Link></p></div>;
  return (
    <div className="space-y-5">
      <header><h1 className="text-xl font-semibold">{t("orders.title")}</h1><p className="text-sm text-slate-600">{t("orders.subtitle")}</p></header>
      <section className="card flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="o-shop">{t("orders.shop")}</label><select id="o-shop" className="input" value={shopId} onChange={(e) => setShopId(e.target.value)}>{shops.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        <div><label className="label" htmlFor="o-days">{t("orders.days")}</label><input id="o-days" className="input w-24" type="number" min="1" max="15" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        <button className="btn" disabled={busy || !(Number(days) >= 1 && Number(days) <= 15)} onClick={sync}>{busy ? t("orders.syncing") : t("orders.sync")}</button>
        <Note m={msg} />
      </section>
      {items.length === 0 ? <p className="text-slate-500">{t("orders.empty")}</p> : <ul className="space-y-3">{items.map((o) => <OrderCard key={`${o.id}-${o.status}-${o.supplierStatus}-${o.trackingCheckedAt}`} o={o} onChange={load} />)}</ul>}
    </div>
  );
}
