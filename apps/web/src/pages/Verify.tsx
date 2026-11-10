import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

export function Verify() {
  const { t } = useI18n();
  const { refresh, me } = useAuth();
  const [params] = useSearchParams();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // o token é de uso único: não repetir em StrictMode
    started.current = true;
    const token = params.get("token");
    if (!token) {
      setFailed(true);
      return;
    }
    api
      .verify(token)
      .then(() => refresh())
      .catch(() => setFailed(true));
  }, [params, refresh]);

  if (me) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="card text-center">
        {failed ? (
          <>
            <p role="alert" className="text-sm text-red-600">
              {t("verify.failed")}
            </p>
            <Link className="btn mt-4" to="/login">
              {t("verify.back")}
            </Link>
          </>
        ) : (
          <p role="status" className="text-sm text-slate-600">
            {t("verify.checking")}
          </p>
        )}
      </div>
    </div>
  );
}
