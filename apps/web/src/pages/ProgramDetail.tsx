import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LIFECYCLE_STATUS, SOURCE_TYPES, SOURCED_FIELDS, TRI_FIELDS } from "@ai/shared";
import { api, ApiError, type ProgramDetail as Detail, type Tri } from "../api";
import { useAuth } from "../auth";
import { SafeLink, TriBadge, VerificationBadge, formatDate } from "../components/badges";
import { errorMessage, fieldLabel } from "../components/errors";
import { AiPanel } from "../components/AiPanel";
import { ScoreCard } from "../components/ScoreCard";
import { useI18n, type MessageKey } from "../i18n";

const TRI_CAMEL: Record<string, string> = {
  accepts_brazil: "acceptsBrazil",
  accepts_individuals: "acceptsIndividuals",
  requires_company: "requiresCompany",
  requires_website: "requiresWebsite",
  accepts_social: "acceptsSocial",
  accepts_paid_traffic: "acceptsPaidTraffic",
  accepts_organic: "acceptsOrganic",
  allows_redirect: "allowsRedirect",
  is_recurring: "isRecurring",
};

export function ProgramDetail() {
  const { id = "" } = useParams();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const [data, setData] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const isEditor = me?.user.role === "editor" || me?.user.role === "admin";

  const load = useCallback(() => {
    api
      .program(id)
      .then(setData)
      .catch((e) => e instanceof ApiError && e.status === 404 && setMissing(true));
  }, [id]);
  useEffect(load, [load]);

  if (missing) return <p role="alert">{t("detail.notFound")}</p>;
  if (!data) return <p className="text-slate-500">{t("common.loading")}</p>;
  const { program: p } = data;
  const none = <span className="text-slate-400">{t("detail.noValue")}</span>;
  const num = (v: number | null, fmt?: (n: number) => string) => (v === null ? none : fmt ? fmt(v) : String(v));
  const money = (v: number | null, cur: string | null) =>
    v === null ? none : cur ? new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(v) : String(v);

  const commission =
    p.commissionType === "percent" && p.commissionPercent !== null
      ? `${p.commissionPercent}%`
      : p.commissionType === "fixed" && p.commissionFixed !== null
        ? money(p.commissionFixed, p.currency)
        : p.commissionType === "tiered"
          ? t("detail.commission") + " (tiered)"
          : none;

  const link = (url: string | null) => (url ? <SafeLink href={url}>{url}</SafeLink> : <span className="text-slate-400">{t("detail.noLink")}</span>);
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-5">
      <Link to="/programs" className="text-sm text-indigo-600 hover:underline">
        ← {t("detail.back")}
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="text-sm text-slate-600">
          {p.advertiser.name} · {p.network?.name ?? t("programs.direct")} · {t(`segment.${p.segment}` as MessageKey)}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <VerificationBadge state={p.verification} />
          <span className="text-slate-500">
            {t("detail.lastVerified")}: {p.lastVerifiedAt ? formatDate(p.lastVerifiedAt, locale) : t("detail.never")}
          </span>
        </div>
        {p.description && <p className="text-sm">{p.description}</p>}
        <p className="text-xs text-slate-500">{t("detail.disclaimer")}</p>
      </header>

      <ScoreCard programId={p.id} />
      <AiPanel programId={p.id} />
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/simulator?program=${p.id}`} className="btn-secondary">{t("sim.simulateWith")}</Link>
        <TrackButton programId={p.id} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-medium">{t("detail.acceptance")}</h2>
          <dl>
            {TRI_FIELDS.map((f) => row(t(`f.${f}` as MessageKey), <TriBadge value={(p as any)[TRI_CAMEL[f]!] as Tri} />))}
          </dl>
        </section>
        <section className="card">
          <h2 className="mb-2 font-medium">{t("detail.commercial")}</h2>
          <dl>
            {row(t("detail.commission"), commission)}
            {row(t("detail.cookie"), num(p.cookieDays, (n) => t("detail.cookieDays", { n })))}
            {row(t("detail.minPayout"), money(p.minPayout, p.payoutCurrency))}
            {row(t("detail.payoutFrequency"), p.payoutFrequency === "unknown" ? none : p.payoutFrequency)}
            {row(t("detail.validation"), num(p.validationDays, (n) => t("detail.cookieDays", { n })))}
          </dl>
        </section>
      </div>

      <section className="card">
        <h2 className="mb-2 font-medium">{t("detail.links")}</h2>
        <dl>
          {row(t("detail.officialUrl"), link(p.officialUrl))}
          {row(
            t("detail.signupUrl"),
            <span>
              {link(p.signupUrl)}{" "}
              <span className="ml-1 text-xs text-slate-500">({t(`urlstatus.${p.signupUrlStatus}` as MessageKey)})</span>
            </span>,
          )}
          {row(t("detail.docsUrl"), link(p.docsUrl))}
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-2 font-medium">{t("detail.sources")}</h2>
        {data.sources.length === 0 ? (
          <p className="text-sm text-slate-600">{t("detail.noSources")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.sources.map((s) => (
              <li key={s.id} className="rounded-lg bg-slate-50 p-3">
                <div className="font-medium">{t(`source.${s.sourceType}` as MessageKey)}</div>
                <SafeLink href={s.url}>{s.url}</SafeLink>
                <div className="text-xs text-slate-500">
                  {s.field ? t("detail.coversField", { field: fieldLabel(t, s.field) }) : t("detail.coversGeneral")} ·{" "}
                  {t("detail.consulted", { date: formatDate(s.consultedAt, locale) })}
                  {s.confirmedAt ? ` · ${t("detail.confirmed", { date: formatDate(s.confirmedAt, locale) })}` : ""}
                </div>
                {s.note && <div className="text-xs">{s.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-medium">{t("detail.products")}</h2>
          {data.products.length === 0 ? (
            <p className="text-sm text-slate-500">{t("detail.none")}</p>
          ) : (
            <ul className="list-disc pl-5 text-sm">{data.products.map((x) => <li key={x.id}>{x.name}</li>)}</ul>
          )}
        </section>
        <section className="card">
          <h2 className="mb-2 font-medium">{t("detail.offers")}</h2>
          {data.offers.length === 0 ? (
            <p className="text-sm text-slate-500">{t("detail.none")}</p>
          ) : (
            <ul className="list-disc pl-5 text-sm">{data.offers.map((x) => <li key={x.id}>{x.title}</li>)}</ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="mb-2 font-medium">{t("detail.history")}</h2>
        <ul className="space-y-1 text-sm">
          {data.history.map((h) => (
            <li key={h.id} className="flex flex-wrap gap-x-2 text-slate-700">
              <span className="text-slate-500">{formatDate(h.changedAt, locale)}</span>
              <span className="font-medium">{fieldLabel(t, h.field)}</span>
              {h.oldValue !== null || h.newValue !== null ? (
                <span className="break-all">
                  {h.oldValue ?? "—"} → {h.newValue ?? "—"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {isEditor && <EditorPanel detail={data} onChanged={load} />}
    </div>
  );
}

function EditorPanel({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const { t } = useI18n();
  const p = detail.program;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: t("editor.ok") });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, t) });
    }
  };

  // ---- fonte
  const [src, setSrc] = useState({ sourceType: "official_docs", field: "", url: "", confirmed: false });
  // ---- dados
  type Draft = Record<string, string>;
  const initial = (): Draft => ({
    ...Object.fromEntries(TRI_FIELDS.map((f) => [f, (p as any)[TRI_CAMEL[f]!] as string])),
    commissionType: p.commissionType,
    commissionPercent: p.commissionPercent?.toString() ?? "",
    commissionFixed: p.commissionFixed?.toString() ?? "",
    cookieDays: p.cookieDays?.toString() ?? "",
    minPayout: p.minPayout?.toString() ?? "",
    validationDays: p.validationDays?.toString() ?? "",
    signupUrl: p.signupUrl ?? "",
    signupUrlStatus: p.signupUrlStatus,
  });
  const [draft, setDraft] = useState<Draft>(initial);
  useEffect(() => setDraft(initial()), [p.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [status, setStatus] = useState(p.lifecycleStatus);

  const save = () =>
    run(() => {
      const patch: Record<string, unknown> = {};
      const base = initial();
      for (const f of TRI_FIELDS) if (draft[f] !== base[f]) patch[TRI_CAMEL[f]!] = draft[f];
      for (const k of ["commissionType", "signupUrlStatus"]) if (draft[k] !== base[k]) patch[k] = draft[k];
      for (const k of ["commissionPercent", "commissionFixed", "cookieDays", "minPayout", "validationDays"])
        if (draft[k] !== base[k]) patch[k] = draft[k] === "" ? null : Number(draft[k]);
      if (draft.signupUrl !== base.signupUrl) patch.signupUrl = draft.signupUrl === "" ? null : draft.signupUrl;
      return api.patchProgram(p.id, patch);
    });

  const sel = (k: string, label: string, options: [string, string][]) => (
    <div key={k}>
      <label className="label" htmlFor={`d-${k}`}>{label}</label>
      <select id={`d-${k}`} className="input" value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
  const inp = (k: string, label: string, type = "number") => (
    <div key={k}>
      <label className="label" htmlFor={`d-${k}`}>{label}</label>
      <input id={`d-${k}`} className="input" type={type} step="any" value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
    </div>
  );
  const triOpts: [string, string][] = (["unverified", "yes", "no"] as const).map((v) => [v, t(`tri.${v}` as MessageKey)]);

  return (
    <section className="card space-y-6 border-indigo-200">
      <h2 className="font-medium">{t("editor.panel")}</h2>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("editor.addSource")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="s-type">{t("editor.sourceType")}</label>
            <select id="s-type" className="input" value={src.sourceType} onChange={(e) => setSrc({ ...src, sourceType: e.target.value })}>
              {SOURCE_TYPES.map((s) => <option key={s} value={s}>{t(`source.${s}` as MessageKey)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s-field">{t("editor.field")}</label>
            <select id="s-field" className="input" value={src.field} onChange={(e) => setSrc({ ...src, field: e.target.value })}>
              <option value="">{t("editor.fieldGeneral")}</option>
              {SOURCED_FIELDS.map((f) => <option key={f} value={f}>{fieldLabel(t, f)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="s-url">{t("editor.url")}</label>
          <input id="s-url" className="input" type="url" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={src.confirmed} onChange={(e) => setSrc({ ...src, confirmed: e.target.checked })} />
          {t("editor.confirmed")}
        </label>
        <button
          className="btn"
          disabled={!src.url}
          onClick={() =>
            run(async () => {
              await api.addSource(p.id, {
                sourceType: src.sourceType,
                field: src.field || null,
                url: src.url,
                ...(src.confirmed ? { confirmedAt: Date.now() } : {}),
              });
              setSrc({ ...src, url: "", confirmed: false });
            })
          }
        >
          {t("editor.add")}
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("editor.facts")}</h3>
        <p className="text-xs text-slate-500">{t("editor.factsHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRI_FIELDS.map((f) => sel(f, t(`f.${f}` as MessageKey), triOpts))}
          {sel("commissionType", t("editor.commissionType"), (["unknown", "percent", "fixed", "tiered"] as const).map((v) => [v, v]))}
          {inp("commissionPercent", t("f.commission_percent"))}
          {inp("commissionFixed", t("f.commission_fixed"))}
          {inp("cookieDays", t("f.cookie_days"))}
          {inp("minPayout", t("f.min_payout"))}
          {inp("validationDays", t("f.validation_days"))}
          {inp("signupUrl", t("f.signup_url"), "url")}
          {sel("signupUrlStatus", t("editor.signupStatus"), (["unverified", "verified", "unavailable"] as const).map((v) => [v, t(`urlstatus.${v}` as MessageKey)]))}
        </div>
        <button className="btn" onClick={save}>{t("editor.saveFacts")}</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => run(() => api.verifyProgram(p.id, "verify"))}>{t("editor.verify")}</button>
        <button className="btn-secondary" onClick={() => run(() => api.verifyProgram(p.id, "flag_divergent"))}>{t("editor.flagDivergent")}</button>
        <button className="btn-secondary" onClick={() => run(() => api.verifyProgram(p.id, "flag_awaiting"))}>{t("editor.flagAwaiting")}</button>
        <button className="btn-secondary" onClick={() => run(() => api.verifyProgram(p.id, "clear_flag"))}>{t("editor.clearFlag")}</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="lc">{t("editor.status")}</label>
          <select id="lc" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {LIFECYCLE_STATUS.map((s) => <option key={s} value={s}>{t(`lifecycle.${s}` as MessageKey)}</option>)}
          </select>
        </div>
        <button className="btn-secondary" onClick={() => run(() => api.setProgramStatus(p.id, status))}>{t("editor.applyStatus")}</button>
      </div>
    </section>
  );
}

/** Salva o programa em "Meus programas" (ou mostra que já está lá). */
function TrackButton({ programId }: { programId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.myPrograms().then((r) => { if (r.items.some((i) => i.programId === programId)) setState("saved"); }).catch(() => {});
  }, [programId]);
  if (state === "saved") return <Link to="/my-programs" className="text-sm text-emerald-700 hover:underline">{t("myp.tracked")}</Link>;
  return (
    <>
      <button className="btn" onClick={async () => {
        try { await api.saveToMyPrograms(programId); setState("saved"); }
        catch (e) { setState("error"); setMsg(e instanceof ApiError && e.code === "already_saved" ? null : errorMessage(e, t)); if (e instanceof ApiError && e.code === "already_saved") setState("saved"); }
      }}>{t("myp.saveProgram")}</button>
      {state === "error" && msg && <span role="alert" className="text-sm text-red-600">{msg}</span>}
    </>
  );
}
