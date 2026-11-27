import { LOCALES, type Locale } from "@ai/shared";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useI18n, type MessageKey } from "../i18n";
import { BrandMark, Icon, type IconName } from "./Icon";

const LOCALE_LABEL: Record<Locale, string> = { "pt-BR": "Português", "en-US": "English", es: "Español (beta)" };

export function LanguageSelect({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`flex items-center gap-2 text-sm text-slate-500 ${className}`}>
      <span className="sr-only">{t("common.language")}</span>
      <select
        aria-label={t("common.language")}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-200 focus:outline-none"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABEL[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

type Item = { to: string; label: MessageKey; icon: IconName; end?: boolean; role?: "editor" | "admin" };
type Group = { label: MessageKey | null; items: Item[] };

const GROUPS: Group[] = [
  { label: null, items: [{ to: "/", label: "nav.dashboard", icon: "home", end: true }] },
  {
    label: "nav.group.discover",
    items: [
      { to: "/programs", label: "nav.programs", icon: "grid" },
      { to: "/my-programs", label: "nav.myPrograms", icon: "bookmark" },
      { to: "/recommendations", label: "nav.recommendations", icon: "target" },
      { to: "/simulator", label: "nav.simulator", icon: "calc" },
      { to: "/seasonal", label: "nav.seasonal", icon: "sun" },
    ],
  },
  {
    label: "nav.group.operate",
    items: [
      { to: "/links", label: "nav.links", icon: "link" },
      { to: "/campaigns", label: "nav.campaigns", icon: "megaphone" },
      { to: "/commissions", label: "nav.commissions", icon: "coins" },
      { to: "/orders", label: "nav.orders", icon: "box" },
      { to: "/reports", label: "nav.reports", icon: "chart" },
    ],
  },
  {
    label: "nav.group.content",
    items: [
      { to: "/week", label: "nav.week", icon: "calendar" },
      { to: "/studio", label: "nav.studio", icon: "film" },
      { to: "/store", label: "nav.store", icon: "store" },
      { to: "/assistant", label: "nav.assistant", icon: "sparkles" },
    ],
  },
  {
    label: "nav.group.automate",
    items: [
      { to: "/automations", label: "nav.automations", icon: "bolt" },
      { to: "/integrations", label: "nav.integrations", icon: "plug" },
      { to: "/notifications", label: "nav.notifications", icon: "bell" },
      { to: "/alerts", label: "nav.alerts", icon: "alert" },
    ],
  },
  {
    label: "nav.group.account",
    items: [
      { to: "/billing", label: "nav.billing", icon: "card" },
      { to: "/catalog", label: "nav.catalog", icon: "database", role: "editor" },
      { to: "/settings", label: "nav.settings", icon: "sliders" },
      { to: "/admin", label: "nav.admin", icon: "shield", role: "admin" },
    ],
  },
];

export function Layout() {
  const { me, logout } = useAuth();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const role = me?.user.role;
  const allowed = (i: Item) => !i.role || role === "admin" || (i.role === "editor" && role === "editor");
  const link = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
      isActive ? "bg-white/10 text-white shadow-inner shadow-white/5" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
    }`;

  return (
    <div className="min-h-screen lg:pl-64">
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur lg:hidden">
        <button className="btn-secondary !px-2.5" aria-label={t("nav.menu")} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "close" : "menu"} />
        </button>
        <BrandMark className="h-6 w-6" />
        <span className="text-sm font-semibold">{t("app.name")}</span>
      </div>

      {open && <div className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        id="sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-950 text-slate-200 transition-transform duration-200 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-3 px-5 pb-4 pt-6">
          <BrandMark className="h-8 w-8" />
          <span className="text-[15px] font-semibold leading-tight tracking-tight text-white">{t("app.name")}</span>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="principal">
          {GROUPS.map((g, gi) => {
            const items = g.items.filter(allowed);
            if (!items.length) return null;
            return (
              <div key={gi}>
                {g.label && <p className="mb-1.5 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">{t(g.label)}</p>}
                <div className="space-y-0.5">
                  {items.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.end} className={link}>
                      <Icon name={i.icon} />
                      {t(i.label)}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-white/10 p-4">
          <LanguageSelect />
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-600 text-sm font-semibold uppercase text-white">{(me?.user.email ?? "?").slice(0, 1)}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-400" title={me?.user.email}>{me?.user.email}</span>
            <button
              className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label={t("nav.logout")}
              title={t("nav.logout")}
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      {locale === "es" && <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">{t("common.betaSpanish")}</p>}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500 sm:px-8">
        {t("app.disclaimer")} · <NavLink className="underline" to="/privacy">{t("legal.privacy")}</NavLink> · <NavLink className="underline" to="/terms">{t("legal.terms")}</NavLink>
      </footer>
    </div>
  );
}
