import { useEffect, useState } from "react";
import { aiConfigSchema } from "@ai/shared";
import { api, type AiConfig, type AiUsageAdmin } from "../api";
import { useI18n, type MessageKey } from "../i18n";

const NUMS = ["dailyRequestsPerUser", "dailyTokensPerUser", "monthlyRequestsGlobal", "maxQuestionChars", "maxContextPrograms", "maxOutputTokens", "cacheTtlHours"] as const;

export function AiTab() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [model, setModel] = useState(true);
  const [usage, setUsage] = useState<AiUsageAdmin | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.aiAdminConfig().then((r) => { setCfg(r.config); setModel(r.modelAvailable); }).catch(() => setMsg({ ok: false, text: t("common.error") }));
    api.aiAdminUsage().then(setUsage).catch(() => {});
  }, [t]);
  if (!cfg) return <p className="text-slate-500">{t("common.loading")}</p>;

  const save = async () => {
    setMsg(null);
    if (!aiConfigSchema.safeParse(cfg).success) return setMsg({ ok: false, text: t("admin.ai.invalid") });
    try { await api.aiAdminSave(cfg); setMsg({ ok: true, text: t("admin.ai.saved") }); }
    catch { setMsg({ ok: false, text: t("admin.ai.invalid") }); }
  };
  const tot = usage?.totals;
  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-medium">{t("admin.ai.title")}</h2>
        {!model && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("admin.ai.noModel")}</p>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
          {t("admin.ai.enabled")}
        </label>
        <div>
          <label className="label" htmlFor="ai-model">{t("admin.ai.model")}</label>
          <input id="ai-model" className="input" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NUMS.map((k) => (
            <div key={k}>
              <label className="label" htmlFor={`ai-${k}`}>{t(`admin.ai.${k}` as MessageKey)}</label>
              <input id={`ai-${k}`} type="number" min={0} className="input" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
        <button className="btn" onClick={save}>{t("admin.ai.save")}</button>
      </section>
      {tot && (
        <section className="card space-y-2">
          <h2 className="font-medium">{t("admin.ai.usage")}</h2>
          <p className="text-xs text-slate-500">{t("admin.ai.usageNote")}</p>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ["admin.ai.requests", tot.requests], ["admin.ai.llm", tot.llm], ["admin.ai.cached", tot.cached], ["admin.ai.tokens", tot.inTok + tot.outTok],
              ["admin.ai.discarded", tot.discarded], ["admin.ai.users", tot.users],
            ] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><dd className="text-xl font-semibold">{v}</dd><dt className="text-xs text-slate-600">{t(k)}</dt></div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
