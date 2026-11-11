import { ROLES, type Role } from "@ai/shared";
import { useCallback, useEffect, useState } from "react";
import { api, type AdminPlan, type AdminUser, type AuditEntry } from "../api";
import { useAuth } from "../auth";
import { useI18n, type MessageKey } from "../i18n";
import { ScoringTab } from "./ScoringTab";
import { AiTab } from "./AiTab";

type Tab = "users" | "plans" | "audit" | "scoring" | "ai";

export function Admin() {
  const { t } = useI18n();
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>("users");

  if (me?.user.role !== "admin") {
    return <p role="alert">{t("error.forbidden")}</p>;
  }

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={tab === id ? "btn" : "btn-secondary"}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("admin.title")}</h1>
      <div className="flex gap-2">
        {tabBtn("users", t("admin.users"))}
        {tabBtn("plans", t("admin.plans"))}
        {tabBtn("audit", t("admin.audit"))}
        {tabBtn("scoring", t("admin.scoring"))}
        {tabBtn("ai", t("admin.ai"))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "plans" && <PlansTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "scoring" && <ScoringTab />}
      {tab === "ai" && <AiTab />}
    </div>
  );
}

const fmtDate = (ms: number | null, locale: string) => (ms ? new Date(ms).toLocaleString(locale) : "—");

function UsersTab() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.adminUsers();
      setUsers(r.users);
      setTotal(r.total);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(id: string, role: Role) {
    try {
      await api.adminSetRole(id, role);
      await load();
    } catch {
      setError(true);
    }
  }

  return (
    <div className="card overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-red-600">{t("common.error")}</p>}
      <p className="mb-3 text-sm text-slate-500">{t("admin.totalUsers", { n: total })}</p>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-2 pr-4">{t("admin.col.email")}</th>
            <th className="py-2 pr-4">{t("admin.col.role")}</th>
            <th className="py-2 pr-4">{t("admin.col.plan")}</th>
            <th className="py-2 pr-4">{t("admin.col.createdAt")}</th>
            <th className="py-2">{t("admin.col.lastLogin")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-slate-100">
              <td className="py-2 pr-4">{u.email}</td>
              <td className="py-2 pr-4">
                <select
                  aria-label={`${t("admin.col.role")} ${u.email}`}
                  className="rounded border border-slate-300 px-2 py-1"
                  value={u.role}
                  disabled={u.id === me?.user.id}
                  onChange={(e) => changeRole(u.id, e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-4">{u.planId}</td>
              <td className="py-2 pr-4">{fmtDate(u.createdAt, locale)}</td>
              <td className="py-2">{fmtDate(u.lastLoginAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlansTab() {
  const { t } = useI18n();
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api.adminPlans().then((r) => setPlans(r.plans)).catch(() => undefined);
  }, []);

  const patch = (id: string, change: Partial<AdminPlan>) =>
    setPlans((ps) => ps.map((p) => (p.id === id ? { ...p, ...change } : p)));

  async function save(p: AdminPlan) {
    await api.adminSavePlan(p.id, {
      name: p.name,
      monthlyPriceCents: p.monthlyPriceCents,
      currency: p.currency,
      active: p.active,
    });
    setSaved(p.id);
  }

  return (
    <div className="space-y-3">
      {plans.map((p) => (
        <div key={p.id} className="card grid items-end gap-3 sm:grid-cols-5">
          <div>
            <label className="label" htmlFor={`name-${p.id}`}>{t("admin.col.name")}</label>
            <input id={`name-${p.id}`} className="input" value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor={`price-${p.id}`}>{t("admin.col.price")}</label>
            <input
              id={`price-${p.id}`}
              type="number"
              min={0}
              className="input"
              placeholder={t("admin.noPrice")}
              value={p.monthlyPriceCents ?? ""}
              onChange={(e) => patch(p.id, { monthlyPriceCents: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`cur-${p.id}`}>{t("admin.col.currency")}</label>
            <input id={`cur-${p.id}`} className="input" maxLength={3} value={p.currency} onChange={(e) => patch(p.id, { currency: e.target.value.toUpperCase() })} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={p.active} onChange={(e) => patch(p.id, { active: e.target.checked })} />
            {t("admin.col.active")}
          </label>
          <div className="flex items-center gap-3">
            <button className="btn" onClick={() => save(p)}>{t("admin.savePlan")}</button>
            {saved === p.id && <span role="status" className="text-sm text-green-700">{t("common.saved")}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditTab() {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  useEffect(() => {
    api.adminAudit().then((r) => setEntries(r.entries)).catch(() => undefined);
  }, []);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="py-2 pr-4">{t("admin.col.date")}</th>
            <th className="py-2 pr-4">{t("admin.col.action")}</th>
            <th className="py-2">{t("admin.col.target")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-slate-100">
              <td className="py-2 pr-4">{fmtDate(e.createdAt, locale)}</td>
              <td className="py-2 pr-4 font-mono text-xs">{e.action}</td>
              <td className="py-2 font-mono text-xs">{e.target ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
