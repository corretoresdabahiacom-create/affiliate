import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type ScoredProgram } from "../api";
import { TriBadge, VerificationBadge } from "../components/badges";
import { AvailabilityLine, BandBadge } from "../components/ScoreCard";
import { useI18n, type MessageKey } from "../i18n";

export function Compare() {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const [items, setItems] = useState<ScoredProgram[] | null>(null);
  const [error, setError] = useState(false);
  const valid = ids.length >= 2 && ids.length <= 4;
  useEffect(() => {
    if (!valid) return;
    api.compare(ids).then((r) => setItems(r.items)).catch(() => setError(true));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!valid) return <p>{t("cmp.invalid")} <Link className="underline" to="/programs">{t("nav.programs")}</Link></p>;
  if (error) return <p role="alert">{t("common.error")}</p>;
  if (!items) return <p className="text-slate-500">{t("common.loading")}</p>;

  const none = <span className="text-slate-400">—</span>;
  const num = (v: number | null, suffix = "") => (v === null ? none : `${v}${suffix}`);
  const money = (v: number | null, cur: string | null) =>
    v === null ? none : cur ? new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(v) : String(v);
  const commission = (p: ScoredProgram["program"]) =>
    p.commissionType === "percent" ? num(p.commissionPercent, "%") : p.commissionType === "fixed" ? money(p.commissionFixed, p.currency) : none;

  const rows: Array<[string, (x: ScoredProgram) => React.ReactNode]> = [
    [t("cmp.row.score"), (x) => <BandBadge band={x.score.attractiveness.band} score={x.score.attractiveness.score} />],
    [t("cmp.row.quality"), (x) => `${x.score.quality.score}/100`],
    [t("cmp.row.availability"), (x) => <AvailabilityLine availability={x.score.availability} />],
    [t("cmp.row.verification"), (x) => <VerificationBadge state={x.program.verification} />],
    [t("f.accepts_brazil"), (x) => <TriBadge value={x.program.acceptsBrazil} />],
    [t("f.is_recurring"), (x) => <TriBadge value={x.program.isRecurring} />],
    [t("detail.commission"), (x) => commission(x.program)],
    [t("detail.cookie"), (x) => num(x.program.cookieDays, "d")],
    [t("detail.minPayout"), (x) => money(x.program.minPayout, x.program.payoutCurrency)],
    [t("detail.payoutFrequency"), (x) => (x.program.payoutFrequency === "unknown" ? none : x.program.payoutFrequency)],
    [t("detail.validation"), (x) => num(x.program.validationDays, "d")],
    [t("f.requires_company"), (x) => <TriBadge value={x.program.requiresCompany} />],
    [t("f.requires_website"), (x) => <TriBadge value={x.program.requiresWebsite} />],
    [t("f.accepts_paid_traffic"), (x) => <TriBadge value={x.program.acceptsPaidTraffic} />],
    [t("cmp.row.warnings"), (x) => (x.score.warnings.length ? x.score.warnings.map((w) => t(`warn.${w.code}` as MessageKey)).join(" · ") : t("cmp.none"))],
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("cmp.title")}</h1>
      <p className="text-sm text-slate-600">{t("cmp.hint")}</p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-4" />
              {items.map((x) => (
                <th key={x.program.id} className="py-2 pr-4 align-top">
                  <Link className="text-indigo-700 hover:underline" to={`/programs/${x.program.id}`}>{x.program.name}</Link>
                  <div className="text-xs font-normal text-slate-500">{x.program.advertiser.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, cell]) => (
              <tr key={label} className="border-t border-slate-100 align-top">
                <th scope="row" className="py-2 pr-4 font-medium text-slate-600">{label}</th>
                {items.map((x) => <td key={x.program.id} className="py-2 pr-4">{cell(x)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t("score.disclaimer")}</p>
    </div>
  );
}
