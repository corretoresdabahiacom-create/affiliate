import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ProfileForm } from "../components/ProfileForm";
import { useI18n } from "../i18n";

export function Onboarding() {
  const { t } = useI18n();
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="card mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">{t("onboarding.title")}</h1>
      <p className="mb-5 mt-1 text-sm text-slate-600">{t("onboarding.subtitle")}</p>
      <ProfileForm
        initial={me?.profile ?? null}
        submitLabel={t("onboarding.submit")}
        onSubmit={async (p) => {
          await api.saveProfile(p);
          await refresh();
          navigate("/", { replace: true });
        }}
      />
    </div>
  );
}
