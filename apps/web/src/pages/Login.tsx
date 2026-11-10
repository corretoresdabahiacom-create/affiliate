import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { LanguageSelect } from "../components/Layout";
import { useI18n } from "../i18n";

export function Login() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (me) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.requestLogin(email.trim(), locale);
      setSent(true);
      setDevLink(res.devLink ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError(t("login.error.invalid"));
      else if (err instanceof ApiError && err.status === 429) setError(t("login.error.rate"));
      else setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-4 flex justify-end">
        <LanguageSelect />
      </div>
      <div className="card">
        <h1 className="text-xl font-semibold">{t("app.name")}</h1>
        <h2 className="mt-4 text-lg font-medium">{t("login.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("login.subtitle")}</p>

        {sent ? (
          <div className="mt-5 space-y-3" role="status">
            <p className="text-sm text-slate-700">{t("login.sent")}</p>
            {devLink && (
              <a className="btn-secondary" href={devLink}>
                {t("login.devLink")}
              </a>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                {t("login.email")}
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button className="btn w-full" disabled={busy}>
              {busy ? t("login.sending") : t("login.submit")}
            </button>
          </form>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">{t("app.disclaimer")}</p>
    </div>
  );
}
