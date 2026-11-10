import { useEffect, useState } from "react";
import type { Band, ExplanationItem, ScoreResult } from "@ai/shared";
import { api } from "../api";
import { fieldLabel } from "./errors";
import { useI18n, type MessageKey } from "../i18n";

const bandStyle: Record<Band, string> = {
  excellent: "bg-emerald-100 text-emerald-900",
  good: "bg-green-100 text-green-900",
  moderate: "bg-amber-100 text-amber-900",
  low: "bg-orange-100 text-orange-900",
  insufficient: "bg-slate-200 text-slate-700",
};

export function BandBadge({ band, score }: { band: Band; score: number }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${bandStyle[band]}`}>
      <span className="font-semibold">{score}</span>
      <span>{t(`band.${band}` as MessageKey)}</span>
    </span>
  );
}

export function Warnings({ warnings }: { warnings: ScoreResult["warnings"] }) {
  const { t } = useI18n();
  const shown = warnings.filter((w) => w.code !== "country_unverified");
  if (!shown.length) return null;
  return (
    <ul className="space-y-1 text-sm">
      {shown.map((w) => (
        <li key={w.code} className={w.severity === "blocker" ? "text-red-700" : "text-amber-700"}>
          <strong>{t(`sev.${w.severity}` as MessageKey)}:</strong> {t(`warn.${w.code}` as MessageKey)}
        </li>
      ))}
    </ul>
  );
}

export function AvailabilityLine({ availability }: { availability: ScoreResult["availability"] }) {
  const { t } = useI18n();
  const tone = availability === "confirmed" ? "text-emerald-700" : availability === "denied" ? "text-red-700" : "text-slate-600";
  return <span className={`text-sm ${tone}`}>{t(`avail.${availability}` as MessageKey)}</span>;
}

function Explanation({ item }: { item: ExplanationItem }) {
  const { t } = useI18n();
  return (
    <li className="text-sm">
      <span className="font-medium">{t(`crit.${item.criterion}` as MessageKey)}</span>
      {item.value !== null && (
        <span className="ml-2 text-xs text-slate-500">{t("score.points", { pct: Math.round(item.value * 100) })}</span>
      )}
      <div className="text-slate-600">{t(`exp.${item.code}` as MessageKey, item.params)}</div>
    </li>
  );
}

/** Justificativa separada em dados confirmados, interpretações e não verificado/sem dado. */
export function ExplanationGroups({ items }: { items: ExplanationItem[] }) {
  const { t } = useI18n();
  const groups: Array<[string, ExplanationItem[]]> = [
    [t("score.confirmedTitle"), items.filter((i) => i.status === "confirmed")],
    [t("score.interpretationTitle"), items.filter((i) => i.status === "interpretation")],
    [t("score.unverifiedTitle"), items.filter((i) => i.status === "unverified" || i.status === "no_data")],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {groups.map(([title, list]) => (
        <div key={title}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
          {list.length === 0 ? <p className="text-sm text-slate-400">—</p> : <ul className="space-y-2">{list.map((i) => <Explanation key={i.criterion} item={i} />)}</ul>}
        </div>
      ))}
    </div>
  );
}

export function ScoreCard({ programId }: { programId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<{ score: ScoreResult; profileMissing: boolean } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.intelScore(programId).then(setData).catch(() => setError(true));
  }, [programId]);
  if (error) return <p className="text-sm text-red-600">{t("common.error")}</p>;
  if (!data) return null;
  const { score } = data;
  const a = score.attractiveness;
  return (
    <section className="card space-y-4" aria-label={t("score.title")}>
      <h2 className="font-medium">{t("score.title")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-sm text-slate-500">{t("score.attractiveness")}</div>
          <BandBadge band={a.band} score={a.score} />
          <p className="mt-1 text-xs text-slate-500">{t("score.attractivenessHelp")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("score.coverage", { pct: Math.round(a.coverage * 100) })}</p>
          {a.capped && <p className="mt-1 text-xs text-amber-700">{t("score.capped")}</p>}
        </div>
        <div>
          <div className="text-sm text-slate-500">{t("score.quality")}</div>
          <div className="text-2xl font-semibold">{score.quality.score}<span className="text-sm text-slate-400">/100</span></div>
          <p className="mt-1 text-xs text-slate-500">{t("score.qualityHelp")}</p>
          {score.quality.missing.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">
              {t("score.missing")} {score.quality.missing.map((f) => fieldLabel(t, f)).join(", ")}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1">
        <AvailabilityLine availability={score.availability} />
        <Warnings warnings={score.warnings} />
        {data.profileMissing && <p className="text-xs text-slate-500">{t("score.noProfile")}</p>}
      </div>
      <ExplanationGroups items={a.items} />
      <p className="text-xs text-slate-500">{t("score.disclaimer")}</p>
    </section>
  );
}
