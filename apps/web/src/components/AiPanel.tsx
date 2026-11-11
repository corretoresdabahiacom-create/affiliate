import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type AiAnalysis, type AiGenerated, type AiStrategy } from "../api";
import { ModeBadge } from "../pages/Assistant";
import { errorMessage, fieldLabel } from "./errors";
import { useI18n, type MessageKey } from "../i18n";

function Narrative({ n }: { n: AiGenerated }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2"><span className="font-medium">{t("aip.suggestion")}</span><ModeBadge mode={n.mode} /></div>
      {n.answer ? <p className="whitespace-pre-wrap">{n.answer}</p> : <p>{t(`ai.reason.${n.reason ?? "no_model"}` as MessageKey)}</p>}
    </div>
  );
}

/** Análise e estratégia: a parte factual vem do sistema; o texto do modelo é só sugestão. */
export function AiPanel({ programId }: { programId: string }) {
  const { t, locale } = useI18n();
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [strategy, setStrategy] = useState<AiStrategy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"a" | "s" | null>(null);

  const run = async (kind: "a" | "s") => {
    setErr(null); setBusy(kind);
    try {
      if (kind === "a") setAnalysis(await api.aiAnalysis(programId, locale));
      else setStrategy(await api.aiStrategy(programId, locale));
    } catch (e) { setErr(errorMessage(e, t)); }
    finally { setBusy(null); }
  };
  const list = (fields: string[]) => fields.length === 0 ? <span className="text-slate-500">{t("aip.none")}</span> : fields.map((f) => fieldLabel(t, f)).join(", ");

  return (
    <section className="card space-y-3" aria-label={t("aip.title")}>
      <h2 className="font-medium">{t("aip.title")}</h2>
      <p className="text-xs text-slate-500">{t("aip.note")}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={busy !== null} onClick={() => run("a")}>{busy === "a" ? t("ai.asking") : t("aip.analyze")}</button>
        <button className="btn-secondary" disabled={busy !== null} onClick={() => run("s")}>{busy === "s" ? t("ai.asking") : t("aip.strategy")}</button>
        <Link to="/assistant" className="self-center text-sm text-indigo-700 hover:underline">{t("nav.assistant")}</Link>
      </div>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {analysis && (
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">{t("aip.confirmed")}:</span> {list(analysis.confirmedFields)}</p>
          <p><span className="font-medium">{t("aip.missing")}:</span> {list(analysis.missingFields)}</p>
          <Narrative n={analysis.narrative} />
        </div>
      )}
      {strategy && (
        <div className="space-y-2 text-sm">
          <h3 className="font-medium">{t("aip.fit")}</h3>
          <p className="text-xs text-slate-500">{t("aip.fitNote")}</p>
          <ul className="space-y-1">
            {strategy.fit.map((f) => (
              <li key={f.id}><span className="font-medium">{t(`fit.${f.id}` as MessageKey)}:</span> {t(`fit.status.${f.status}` as MessageKey)}</li>
            ))}
          </ul>
          <Narrative n={strategy.narrative} />
        </div>
      )}
    </section>
  );
}
