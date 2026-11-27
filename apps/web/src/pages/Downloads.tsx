import { Icon } from "../components/Icon";
import { useI18n, type MessageKey } from "../i18n";

const PLATFORMS = [
  { id: "instagram", link: "https://accountscenter.instagram.com/info_and_permissions/dyi/" },
  { id: "tiktok", link: null },
  { id: "youtube", link: "https://studio.youtube.com/" },
] as const;

export function Downloads() {
  const { t } = useI18n();
  return (
    <div className="space-y-8">
      <header>
        <p className="kicker">{t("nav.group.content")}</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("downloads.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("downloads.subtitle")}</p>
      </header>

      <section className="card max-w-3xl space-y-2 border-amber-200 bg-amber-50/60" aria-labelledby="why-h">
        <h2 id="why-h" className="font-semibold text-amber-950">{t("downloads.whyTitle")}</h2>
        <p className="text-sm text-amber-900">{t("downloads.why")}</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {PLATFORMS.map((p) => (
          <section key={p.id} className="card flex flex-col gap-3" aria-labelledby={`dl-${p.id}`}>
            <h2 id={`dl-${p.id}`} className="text-lg font-semibold text-slate-900">{t(`downloads.${p.id}` as MessageKey)}</h2>
            <p className="text-sm text-slate-600">{t(`downloads.${p.id}.what` as MessageKey)}</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              {[1, 2, 3, 4].map((n) => <li key={n}>{t(`downloads.${p.id}.s${n}` as MessageKey)}</li>)}
            </ol>
            {p.link && (
              <a className="btn-secondary mt-auto self-start" href={p.link} target="_blank" rel="noopener noreferrer">
                <Icon name="external" />{t("downloads.open")}
              </a>
            )}
          </section>
        ))}
      </div>

      <section className="card max-w-3xl space-y-2" aria-labelledby="camp-h">
        <h2 id="camp-h" className="font-semibold text-slate-900">{t("downloads.campaignsTitle")}</h2>
        <p className="text-sm text-slate-600">{t("downloads.campaigns")}</p>
      </section>
      <section className="card max-w-3xl space-y-2" aria-labelledby="others-h">
        <h2 id="others-h" className="font-semibold text-slate-900">{t("downloads.othersTitle")}</h2>
        <p className="text-sm text-slate-600">{t("downloads.others")}</p>
      </section>
    </div>
  );
}
