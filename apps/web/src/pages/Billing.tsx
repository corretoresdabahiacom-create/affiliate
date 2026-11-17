import { useCallback, useEffect, useState } from "react";
import { api, type BillingInfo } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Msg = { ok: boolean; text: string } | null;
const LIMIT_KEYS = ["savedPrograms", "links", "campaigns", "aiRequestsMonthly", "reports"] as const;

export function Billing() {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(() => { api.billing().then(setInfo).catch((e) => setMsg({ ok: false, text: errorMessage(e, t) })); }, [t]);
  useEffect(load, [load]);
  const money = (cents: number, cur: string) => new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(cents / 100);
  const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(locale) : "—");
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e, t) }); }
  };
  if (!info) return msg ? <p role="alert" className="text-red-600">{msg.text}</p> : <p>{t("common.loading")}</p>;
  const sub = info.subscription;
  const pending = info.payments.find((p) => p.status === "pending");
  const busy = !!sub && ["active", "trialing", "past_due"].includes(sub.status);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("billing.title")}</h1>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}

      <section className="card space-y-2" aria-labelledby="bl-cur">
        <h2 id="bl-cur" className="font-medium">{t("billing.current")}</h2>
        <p className="text-lg">{info.plan?.name ?? info.subscription?.planId ?? "Free"}
          {sub && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`billing.status.${sub.status}` as MessageKey)}</span>}
        </p>
        {sub?.status === "trialing" && <p className="text-sm">{t("billing.trialEnds", { d: date(sub.trialEndsAt) })}</p>}
        {sub?.status === "active" && <p className="text-sm">{sub.cancelAtPeriodEnd ? t("billing.endsOn", { d: date(sub.currentPeriodEnd) }) : t("billing.renewsOn", { d: date(sub.currentPeriodEnd) })}</p>}
        {sub?.status === "past_due" && <p role="alert" className="text-sm text-amber-800">{t("billing.pastDue", { d: date(sub.graceUntil) })}</p>}
        {pending && <p className="text-sm text-amber-800">{t("billing.pending", { v: money(pending.amountCents, pending.currency) })}</p>}
        <div className="flex flex-wrap gap-2">
          {sub?.status === "active" && !sub.cancelAtPeriodEnd && <button className="btn-secondary" onClick={() => act(api.billingCancel, t("billing.cancelScheduled"))}>{t("billing.cancel")}</button>}
          {sub?.status === "active" && sub.cancelAtPeriodEnd && <button className="btn-secondary" onClick={() => act(api.billingResume, t("common.saved"))}>{t("billing.resume")}</button>}
          {sub && ["incomplete", "trialing", "past_due"].includes(sub.status) && <button className="btn-secondary" onClick={() => act(api.billingCancel, t("billing.canceled"))}>{t("billing.cancelNow")}</button>}
        </div>
      </section>

      <section className="card space-y-2" aria-labelledby="bl-use">
        <h2 id="bl-use" className="font-medium">{t("billing.usage")}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {LIMIT_KEYS.map((k) => {
            const lim = info.plan?.limits[k];
            const used = info.usage[k];
            const label = t(`billing.limit.${k}` as MessageKey);
            if (k === "reports") return <li key={k} className="text-sm">{label}: <b>{lim === 0 ? t("billing.off") : t("billing.on")}</b></li>;
            return (
              <li key={k} className="text-sm">
                {label}: <b>{used ?? 0}</b> / {lim === undefined ? t("billing.unlimited") : lim === 0 ? t("billing.off") : lim}
                {lim ? <progress className="mt-1 block w-full" max={lim} value={Math.min(used ?? 0, lim)} aria-label={label} /> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="bl-plans">
        <h2 id="bl-plans" className="font-medium">{t("billing.plans")}</h2>
        <p className="text-xs text-slate-500">{t("billing.manualInfo")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {info.plans.map((p) => (
            <div key={p.id} className="card space-y-2">
              <h3 className="font-medium">{p.name}</h3>
              <p className="text-sm">{p.priceCents == null ? t("billing.priceNotSet") : t("billing.perMonth", { v: money(p.priceCents, p.currency) })}</p>
              <ul className="text-xs text-slate-600">
                {LIMIT_KEYS.map((k) => <li key={k}>{t(`billing.limit.${k}` as MessageKey)}: {p.limits[k] === undefined ? t("billing.unlimited") : p.limits[k] === 0 ? t("billing.off") : k === "reports" ? t("billing.on") : p.limits[k]}</li>)}
              </ul>
              {p.id !== "free" && (
                <button className="btn" disabled={p.priceCents == null || busy || info.plan?.id === p.id} onClick={() => act(() => api.billingSubscribe(p.id), info.trialAvailable ? t("billing.trialStarted") : t("billing.requested"))}>
                  {info.trialAvailable ? t("billing.startTrial", { n: info.trialDays }) : t("billing.subscribe")}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-2" aria-labelledby="bl-pay">
        <h2 id="bl-pay" className="font-medium">{t("billing.payments")}</h2>
        {info.payments.length === 0 ? <p className="text-sm text-slate-500">{t("billing.noPayments")}</p> : (
          <table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th>{t("billing.col.date")}</th><th>{t("billing.col.plan")}</th><th>{t("billing.col.amount")}</th><th>{t("billing.col.status")}</th></tr></thead>
            <tbody>{info.payments.map((p) => <tr key={p.id}><td>{date(p.paidAt ?? null)}</td><td>{p.planId}</td><td>{money(p.amountCents, p.currency)}</td><td>{t(`billing.pay.${p.status}` as MessageKey)}</td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}
