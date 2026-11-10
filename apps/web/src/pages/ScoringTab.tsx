import { useEffect, useState } from "react";
import { CRITERIA, DEFAULT_SCORING, NO_DATA_CRITERIA, scoringConfigSchema, type ScoringConfig } from "@ai/shared";
import { api } from "../api";
import { useI18n, type MessageKey } from "../i18n";

export function ScoringTab() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<ScoringConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.scoringConfig().then((r) => setCfg(r.config)).catch(() => setCfg(DEFAULT_SCORING));
  }, []);
  if (!cfg) return <p className="text-slate-500">{t("common.loading")}</p>;

  const n = (s: string) => (s === "" ? 0 : Number(s));
  const input = (id: string, label: string, value: number, onChange: (v: number) => void) => (
    <div key={id}>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" type="number" min="0" step="any" value={value} onChange={(e) => onChange(n(e.target.value))} />
    </div>
  );

  const save = async () => {
    setMsg(null);
    if (!scoringConfigSchema.safeParse(cfg).success) return setMsg({ ok: false, text: t("admin.scoring.invalid") });
    try {
      await api.adminSaveScoring(cfg);
      setMsg({ ok: true, text: t("admin.scoring.saved") });
    } catch {
      setMsg({ ok: false, text: t("admin.scoring.invalid") });
    }
  };

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-medium">{t("admin.scoring.weights")}</h2>
        <p className="text-xs text-slate-500">{t("admin.scoring.weightsHelp")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CRITERIA.map((c) =>
            input(`w-${c}`, `${t(`crit.${c}` as MessageKey)}${NO_DATA_CRITERIA.includes(c) ? " *" : ""}`, cfg.weights[c], (v) => setCfg({ ...cfg, weights: { ...cfg.weights, [c]: v } })),
          )}
        </div>
        <p className="text-xs text-slate-500">* {t("exp.no_data_source")}</p>
      </section>
      <section className="card space-y-3">
        <h2 className="font-medium">{t("admin.scoring.bands")}</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          {(["excellent", "good", "moderate", "low"] as const).map((b) =>
            input(`b-${b}`, t(`band.${b}` as MessageKey), cfg.bands[b], (v) => setCfg({ ...cfg, bands: { ...cfg.bands, [b]: v } })),
          )}
        </div>
      </section>
      <section className="card space-y-3">
        <h2 className="font-medium">{t("admin.scoring.thresholds")}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {input("t-comm", t("admin.scoring.commissionFull"), cfg.thresholds.commissionPercentFull, (v) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, commissionPercentFull: v } }))}
          {input("t-cookie", t("admin.scoring.cookieFull"), cfg.thresholds.cookieDaysFull, (v) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, cookieDaysFull: v } }))}
          {input("t-rec", t("admin.scoring.recurrenceFull"), cfg.thresholds.recurrenceMonthsFull, (v) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, recurrenceMonthsFull: v } }))}
          {input("t-min", t("admin.scoring.minQuality"), cfg.minQualityForTopBands, (v) => setCfg({ ...cfg, minQualityForTopBands: v }))}
        </div>
        <div>
          <label className="label" htmlFor="policy">{t("admin.scoring.policy")}</label>
          <select id="policy" className="input max-w-sm" value={cfg.paidTrafficPolicy} onChange={(e) => setCfg({ ...cfg, paidTrafficPolicy: e.target.value as ScoringConfig["paidTrafficPolicy"] })}>
            <option value="block">{t("admin.scoring.policy.block")}</option>
            <option value="warn">{t("admin.scoring.policy.warn")}</option>
          </select>
        </div>
      </section>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <button className="btn" onClick={save}>{t("admin.scoring.save")}</button>
    </div>
  );
}
