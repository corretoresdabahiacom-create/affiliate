import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { ProfileForm } from "../components/ProfileForm";
import { useI18n } from "../i18n";

export function Settings() {
  const { t } = useI18n();
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);

  async function exportData() {
    const data = await api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meus-dados.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (!window.confirm(t("settings.deleteConfirm"))) return;
    await api.deleteAccount();
    await refresh();
    navigate("/login", { replace: true });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <section className="card">
        <ProfileForm
          initial={me?.profile ?? null}
          submitLabel={t("common.save")}
          onSubmit={async (p) => {
            await api.saveProfile(p);
            await refresh();
            setSaved(true);
          }}
        />
        {saved && (
          <p role="status" className="mt-3 text-sm text-green-700">
            {t("common.saved")}
          </p>
        )}
      </section>
      <section className="card">
        <h2 className="font-medium">{t("settings.privacy")}</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <button className="btn-secondary" onClick={exportData}>
            {t("settings.export")}
          </button>
          <button className="btn-danger" onClick={deleteAccount}>
            {t("settings.deleteAccount")}
          </button>
        </div>
      </section>
    </div>
  );
}
