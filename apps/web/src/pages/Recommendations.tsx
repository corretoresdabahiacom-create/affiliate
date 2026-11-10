import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RecommendationsResponse, type ScoredProgram } from "../api";
import { VerificationBadge } from "../components/badges";
import { AvailabilityLine, BandBadge, Warnings } from "../components/ScoreCard";
import { useI18n, type MessageKey } from "../i18n";

function Card({ x }: { x: ScoredProgram }) {
  const { t } = useI18n();
  const reasons = x.score.attractiveness.items.filter((i) => i.status === "confirmed" && i.value !== null && i.value > 0).slice(0, 4);
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link to={`/programs/${x.program.id}`} className="text-base font-medium text-indigo-700 hover:underline">{x.program.name}</Link>
          <p className="text-sm text-slate-600">{x.program.advertiser.name} · {t(`segment.${x.program.segment}` as MessageKey)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <BandBadge band={x.score.attractiveness.band} score={x.score.attractiveness.score} />
          <VerificationBadge state={x.program.verification} />
        </div>
      </div>
      <AvailabilityLine availability={x.score.availability} />
      <Warnings warnings={x.score.warnings} />
      {reasons.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("rec.why")}</div>
          <ul className="list-disc pl-5 text-sm text-slate-700">
            {reasons.map((i) => <li key={i.criterion}>{t(`exp.${i.code}` as MessageKey, i.params)}</li>)}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-500">{t("score.quality")}: {x.score.quality.score}/100</p>
    </li>
  );
}

export function Recommendations() {
  const { t } = useI18n();
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.recommendations().then(setData).catch(() => setError(true));
  }, []);
  if (error) return <p role="alert">{t("common.error")}</p>;
  if (!data) return <p className="text-slate-500">{t("common.loading")}</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("rec.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("rec.subtitle")}</p>
        {data.profileMissing && (
          <p className="mt-2 text-sm text-amber-700">
            {t("rec.noProfile")} <Link className="underline" to="/settings">{t("nav.settings")}</Link>
          </p>
        )}
      </div>
      <section className="space-y-3">
        <h2 className="font-medium">{t("rec.recommended")}</h2>
        {data.recommended.length === 0 ? <p className="card text-sm text-slate-600">{t("rec.none")}</p> : <ul className="space-y-3">{data.recommended.map((x) => <Card key={x.program.id} x={x} />)}</ul>}
        {data.excludedDenied > 0 && <p className="text-xs text-slate-500">{t("rec.denied", { n: data.excludedDenied })}</p>}
      </section>
      {data.toVerify.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">{t("rec.toVerify")}</h2>
          <p className="text-sm text-amber-700">{t("rec.toVerifyHelp")}</p>
          <ul className="space-y-3">{data.toVerify.map((x) => <Card key={x.program.id} x={x} />)}</ul>
        </section>
      )}
    </div>
  );
}
