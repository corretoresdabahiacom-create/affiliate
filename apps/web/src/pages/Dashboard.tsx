import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { useI18n, type MessageKey } from "../i18n";

export function Dashboard() {
  const { t } = useI18n();
  const { me } = useAuth();
  if (!me) return null;
  const p = me.profile;
  const none = t("dashboard.noValue");
  const list = (prefix: string, values: string[] | undefined) =>
    values && values.length ? values.map((v) => t(`${prefix}.${v}` as MessageKey)).join(", ") : none;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("dashboard.welcome", { name: p?.displayName || me.user.email })}</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t("dashboard.profileTitle")}</h2>
            <Link to="/settings" className="text-sm text-indigo-600 hover:underline">
              {t("dashboard.editProfile")}
            </Link>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">{t("profile.country")}</dt>
              <dd>{p?.country ?? none}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("profile.experience")}</dt>
              <dd>{p?.experience ? t(`experience.${p.experience}` as MessageKey) : none}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("profile.niches")}</dt>
              <dd>{list("niche", p?.niches)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("profile.channels")}</dt>
              <dd>{list("channel", p?.channels)}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2 className="font-medium">{t("dashboard.planTitle")}</h2>
          <p className="mt-3 text-2xl font-semibold capitalize">{me.user.planId}</p>
          <p className="mt-1 text-sm text-slate-500">{t(`role.${me.user.role}` as MessageKey)}</p>
        </section>
      </div>

      <section className="card">
        <h2 className="font-medium">{t("dashboard.nextTitle")}</h2>
        <p className="mt-2 text-sm text-slate-600">{t("dashboard.catalogSoon")}</p>
      </section>
    </div>
  );
}
