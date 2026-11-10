import { LOCALES, type Locale } from "@ai/shared";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

const LOCALE_LABEL: Record<Locale, string> = { "pt-BR": "Português", "en-US": "English", es: "Español (beta)" };

export function LanguageSelect({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`flex items-center gap-2 text-sm text-slate-600 ${className}`}>
      <span className="sr-only">{t("common.language")}</span>
      <select
        aria-label={t("common.language")}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
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

export function Layout() {
  const { me, logout } = useAuth();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="mr-2 text-base font-semibold text-indigo-700">{t("app.name")}</span>
          <nav className="flex flex-wrap gap-1" aria-label="principal">
            <NavLink to="/" end className={link}>
              {t("nav.dashboard")}
            </NavLink>
            <NavLink to="/settings" className={link}>
              {t("nav.settings")}
            </NavLink>
            {me?.user.role === "admin" && (
              <NavLink to="/admin" className={link}>
                {t("nav.admin")}
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LanguageSelect />
            <span className="hidden text-sm text-slate-500 sm:inline">{me?.user.email}</span>
            <button
              className="btn-secondary"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>
        {locale === "es" && (
          <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">{t("common.betaSpanish")}</p>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-slate-500">{t("app.disclaimer")}</footer>
    </div>
  );
}
