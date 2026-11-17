import { useCallback, useEffect, useState } from "react";
import { api, type AdminPayment, type AdminUser, type RevenueOverview } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Msg = { ok: boolean; text: string } | null;

export function BillingTab() {
  const { t, locale } = useI18n();
  const [ov, setOv] = useState<RevenueOverview | null>(null);
  const [pays, setPays] = useState<AdminPayment[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Array<{ id: string; currency: string; monthlyPriceCents: number | null }>>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState({ userId: "", planId: "pro", amount: "", ref: "", months: "1" });
  const [trial, setTrial] = useState("0");
  const [grace, setGrace] = useState("7");
  const money = (cents: number, cur: string) => new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(cents / 100);
  const load = useCallback(() => {
    api.adminRevenue().then((o) => { setOv(o); setTrial(String(o.settings.trialDays)); setGrace(String(o.settings.graceDays)); }).catch(() => {});
    api.adminPayments().then((r) => setPays(r.items)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    api.adminUsers().then((r) => setUsers(r.users)).catch(() => {});
    api.adminPlans().then((r) => setPlans(r.plans.filter((p) => p.id !== "free"))).catch(() => {});
  }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  const plan = plans.find((p) => p.id === f.planId);
  const cents = Math.round(Number(f.amount.replace(",", ".")) * 100);

  return (
    <div className="space-y-5">
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <section className="card space-y-2" aria-labelledby="ab-ov">
        <h2 id="ab-ov" className="font-medium">{t("adminBilling.overview")}</h2>
        <p className="text-xs text-slate-500">{t("adminBilling.manualNote")}</p>
        {ov && (
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div><b>{t("adminBilling.mrr")}</b>{ov.mrrByCurrency.length === 0 ? <div>—</div> : ov.mrrByCurrency.map((m) => <div key={m.currency}>{money(m.cents, m.currency)} ({m.subscriptions})</div>)}</div>
            <div><b>{t("adminBilling.paid30")}</b>{ov.paidLast30dByCurrency.length === 0 ? <div>—</div> : ov.paidLast30dByCurrency.map((m) => <div key={m.currency}>{money(m.cents, m.currency)} ({m.payments})</div>)}</div>
            <div><b>{t("adminBilling.byStatus")}</b>{Object.entries(ov.subscriptionsByStatus).map(([k, v]) => <div key={k}>{t(`billing.status.${k}` as MessageKey)}: {v}</div>)}
              <div>{t("adminBilling.ended30")}: {ov.endedLast30d}</div></div>
          </div>
        )}
      </section>

      <section className="card space-y-3" aria-labelledby="ab-rec">
        <h2 id="ab-rec" className="font-medium">{t("adminBilling.record")}</h2>
        <div className="grid gap-2 sm:grid-cols-5">
          <div><label className="label" htmlFor="ab-user">{t("adminBilling.user")}</label>
            <select id="ab-user" className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="" />{users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}</select></div>
          <div><label className="label" htmlFor="ab-plan">{t("billing.col.plan")}</label>
            <select id="ab-plan" className="input" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}</select></div>
          <div><label className="label" htmlFor="ab-amt">{t("adminBilling.amount", { cur: plan?.currency ?? "" })}</label>
            <input id="ab-amt" className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div><label className="label" htmlFor="ab-ref">{t("adminBilling.ref")}</label>
            <input id="ab-ref" className="input" maxLength={120} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></div>
          <div className="flex items-end gap-2">
            <button className="btn" disabled={!f.userId || !plan || !Number.isFinite(cents) || cents < 0 || f.amount === ""}
              onClick={() => act(() => api.adminRecordPayment({ userId: f.userId, planId: f.planId, amountCents: cents, currency: plan!.currency, providerRef: f.ref.trim() || undefined }), t("adminBilling.recorded"))}>{t("adminBilling.recordBtn")}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
          <div><label className="label" htmlFor="ab-months">{t("adminBilling.grantMonths")}</label>
            <input id="ab-months" type="number" min={1} max={24} className="input w-24" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></div>
          <button className="btn-secondary" disabled={!f.userId || !plan} onClick={() => act(() => api.adminGrant({ userId: f.userId, planId: f.planId, months: Number(f.months) || 1 }), t("adminBilling.granted"))}>{t("adminBilling.grantBtn")}</button>
        </div>
      </section>

      <section className="card space-y-2" aria-labelledby="ab-set">
        <h2 id="ab-set" className="font-medium">{t("adminBilling.settings")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="ab-trial">{t("adminBilling.trialDays")}</label><input id="ab-trial" type="number" min={0} max={90} className="input w-28" value={trial} onChange={(e) => setTrial(e.target.value)} /></div>
          <div><label className="label" htmlFor="ab-grace">{t("adminBilling.graceDays")}</label><input id="ab-grace" type="number" min={0} max={60} className="input w-28" value={grace} onChange={(e) => setGrace(e.target.value)} /></div>
          <button className="btn" onClick={() => act(() => api.adminBillingSettings({ trialDays: Number(trial) || 0, graceDays: Number(grace) || 0 }), t("common.saved"))}>{t("admin.savePlan")}</button>
        </div>
      </section>

      <section className="card overflow-x-auto" aria-labelledby="ab-list">
        <h2 id="ab-list" className="mb-2 font-medium">{t("billing.payments")}</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th>{t("adminBilling.user")}</th><th>{t("billing.col.plan")}</th><th>{t("billing.col.amount")}</th><th>{t("billing.col.status")}</th><th>{t("adminBilling.ref")}</th><th /></tr></thead>
          <tbody>{pays.map((p) => (
            <tr key={p.id}><td>{p.email}</td><td>{p.planId}</td><td>{money(p.amountCents, p.currency)}</td><td>{t(`billing.pay.${p.status}` as MessageKey)}{p.provider === "grant" ? ` · ${t("adminBilling.grant")}` : ""}</td><td>{p.providerRef ?? "—"}</td>
              <td>{p.status === "paid" && <button className="btn-secondary" onClick={() => act(() => api.adminRefund(p.id), t("adminBilling.refunded"))}>{t("adminBilling.refund")}</button>}</td></tr>))}</tbody>
        </table>
      </section>
    </div>
  );
}
