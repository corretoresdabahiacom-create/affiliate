import { CONTENT_PLATFORMS } from "@ai/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type ContentInsights, type ContentPlatformId, type ContentPost, type ContentStatus, type ContentWeek } from "../api";
import { useAuth } from "../auth";
import { Icon } from "../components/Icon";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const STATUS_STYLE: Record<ContentStatus, { chip: string; bar: string }> = {
  idea: { chip: "bg-slate-100 text-slate-700 ring-slate-200", bar: "bg-slate-300" },
  approved: { chip: "bg-amber-50 text-amber-800 ring-amber-200", bar: "bg-amber-400" },
  scheduled: { chip: "bg-sky-50 text-sky-800 ring-sky-200", bar: "bg-sky-500" },
  published: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", bar: "bg-emerald-500" },
};
const PLATFORM_DOT: Record<ContentPlatformId, string> = { instagram: "bg-rose-500", tiktok: "bg-slate-900", youtube: "bg-red-600" };


function useFmt() {
  const { locale } = useI18n();
  return useMemo(() => new Intl.NumberFormat(locale), [locale]);
}

function PlatformChips({ platforms }: { platforms: ContentPlatformId[] }) {
  const { t } = useI18n();
  return (
    <>
      {platforms.map((p) => (
        <span key={p} className="chip bg-white text-slate-700 ring-slate-200">
          <span className={`h-2 w-2 rounded-full ${PLATFORM_DOT[p]}`} aria-hidden="true" />
          {t(`week.platform.${p}` as MessageKey)}
        </span>
      ))}
    </>
  );
}

const empty = (weekStart: string, day: number) => ({
  weekStart, day, time: "", title: "", hook: "", script: "", platforms: ["instagram"] as ContentPlatformId[], usesAffiliateLink: false, disclosureConfirmed: false,
});

function PostForm({ initial, id, onDone, onCancel, onError }: {
  initial: ReturnType<typeof empty>; id?: string; onDone: (reapproval: boolean) => void; onCancel: () => void; onError: (e: unknown) => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = (p: ContentPlatformId) =>
    setF((cur) => ({ ...cur, platforms: cur.platforms.includes(p) ? cur.platforms.filter((x) => x !== p) : [...cur.platforms, p] }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        day: f.day, time: f.time || null, title: f.title, hook: f.hook || null, script: f.script || null, platforms: f.platforms,
        usesAffiliateLink: f.usesAffiliateLink, disclosureConfirmed: f.usesAffiliateLink ? f.disclosureConfirmed : false,
      };
      if (id) onDone((await api.contentPatch(id, body)).reapprovalNeeded);
      else {
        await api.contentCreate({ ...body, weekStart: f.weekStart });
        onDone(false);
      }
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card space-y-4 border-indigo-200 bg-indigo-50/40" aria-label={t(id ? "week.action.edit" : "week.add")}>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <div>
          <label className="label" htmlFor="p-title">{t("week.form.title")}</label>
          <input id="p-title" className="input" required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="p-time">{t("week.form.time")}</label>
          <input id="p-time" type="time" className="input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="p-hook">{t("week.form.hook")}</label>
        <input id="p-hook" className="input" maxLength={200} value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="p-script">{t("week.form.script")}</label>
        <textarea id="p-script" className="input min-h-28" maxLength={4000} value={f.script} onChange={(e) => setF({ ...f, script: e.target.value })} />
      </div>
      <fieldset>
        <legend className="label">{t("week.form.platforms")}</legend>
        <div className="flex flex-wrap gap-2">
          {CONTENT_PLATFORMS.map((p) => (
            <label key={p} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium transition ${f.platforms.includes(p) ? "border-indigo-500 bg-white text-indigo-700 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
              <input type="checkbox" className="sr-only" checked={f.platforms.includes(p)} onChange={() => toggle(p)} />
              <span className={`h-2.5 w-2.5 rounded-full ${PLATFORM_DOT[p]}`} aria-hidden="true" />
              {t(`week.platform.${p}` as MessageKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.usesAffiliateLink} onChange={(e) => setF({ ...f, usesAffiliateLink: e.target.checked })} />
          {t("week.form.affiliate")}
        </label>
        {f.usesAffiliateLink && (
          <label className="flex items-center gap-2 pl-6 text-sm text-slate-700">
            <input type="checkbox" checked={f.disclosureConfirmed} onChange={(e) => setF({ ...f, disclosureConfirmed: e.target.checked })} />
            {t("week.form.disclosure")}
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <button className="btn" disabled={busy || f.platforms.length === 0}>{t("week.form.save")}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>{t("week.form.cancel")}</button>
      </div>
    </form>
  );
}

function MetricsForm({ post, onDone, onCancel, onError }: { post: ContentPost; onDone: () => void; onCancel: () => void; onError: (e: unknown) => void }) {
  const { t } = useI18n();
  const m = post.metrics;
  const [f, setF] = useState({
    views: m ? String(m.views) : "", likes: m?.likes?.toString() ?? "", shares: m?.shares?.toString() ?? "", saves: m?.saves?.toString() ?? "",
    clicks: m?.clicks?.toString() ?? "", retentionPct: m?.retentionPct?.toString() ?? "",
  });
  const n = (v: string) => (v === "" ? undefined : Number(v));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.contentMetrics(post.id, { views: Number(f.views), likes: n(f.likes), shares: n(f.shares), saves: n(f.saves), clicks: n(f.clicks), retentionPct: n(f.retentionPct) });
      onDone();
    } catch (err) {
      onError(err);
    }
  }
  const fields: Array<[keyof typeof f, MessageKey, boolean]> = [
    ["views", "week.metrics.views", true], ["likes", "week.metrics.likes", false], ["shares", "week.metrics.shares", false],
    ["saves", "week.metrics.saves", false], ["clicks", "week.metrics.clicks", false], ["retentionPct", "week.metrics.retention", false],
  ];
  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label={t("week.metrics.title")}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {fields.map(([k, label, req]) => (
          <div key={k}>
            <label className="label" htmlFor={`m-${post.id}-${k}`}>{t(label)}</label>
            <input id={`m-${post.id}-${k}`} type="number" min={0} max={k === "retentionPct" ? 100 : undefined} step={k === "retentionPct" ? "0.1" : 1} required={req} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">{t("week.metrics.note")}</p>
      <div className="mt-3 flex gap-2">
        <button className="btn">{t("week.metrics.save")}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>{t("week.form.cancel")}</button>
      </div>
    </form>
  );
}

function PostCard({ post, busy, onAction, onEdit, onMetrics, onDelete }: {
  post: ContentPost; busy: boolean; onAction: (to: ContentStatus) => void; onEdit: () => void; onMetrics: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const st = STATUS_STYLE[post.status];
  const m = post.metrics;
  const fmt = useFmt();
  return (
    <li className="card relative overflow-hidden !p-0">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${st.bar}`} aria-hidden="true" />
      <div className="space-y-3 p-4 pl-6">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug text-slate-900">{post.title}</p>
            {post.hook && <p className="mt-0.5 text-sm italic text-slate-500">“{post.hook}”</p>}
          </div>
          <span className={`chip ${st.chip}`}>{t(`week.status.${post.status}` as MessageKey)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PlatformChips platforms={post.platforms} />
          {post.time && <span className="chip bg-white font-mono text-slate-600 ring-slate-200">{post.time}</span>}
          {post.usesAffiliateLink && <span className="chip bg-amber-50 text-amber-800 ring-amber-200">{t("week.form.affiliate")}</span>}
        </div>
        {post.script && (
          <details className="text-sm text-slate-600">
            <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-500">{t("week.form.script")}</summary>
            <p className="mt-2 whitespace-pre-wrap">{post.script}</p>
          </details>
        )}
        {m && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <div><dt className="inline text-slate-500">{t("week.metrics.views")}: </dt><dd className="inline font-mono font-semibold">{fmt.format(m.views)}</dd></div>
            {m.likes !== null && <div><dt className="inline text-slate-500">{t("week.metrics.likes")}: </dt><dd className="inline font-mono">{fmt.format(m.likes)}</dd></div>}
            {m.shares !== null && <div><dt className="inline text-slate-500">{t("week.metrics.shares")}: </dt><dd className="inline font-mono">{fmt.format(m.shares)}</dd></div>}
            {m.saves !== null && <div><dt className="inline text-slate-500">{t("week.metrics.saves")}: </dt><dd className="inline font-mono">{fmt.format(m.saves)}</dd></div>}
            {m.retentionPct !== null && <div><dt className="inline text-slate-500">{t("week.metrics.retention")}: </dt><dd className="inline font-mono">{m.retentionPct}</dd></div>}
          </dl>
        )}
        <div className="flex flex-wrap gap-2">
          {post.status === "idea" && <button className="btn !py-1.5" disabled={busy} onClick={() => onAction("approved")}><Icon name="check" className="h-4 w-4" />{t("week.action.approve")}</button>}
          {post.status === "approved" && <button className="btn !py-1.5" disabled={busy} onClick={() => onAction("scheduled")}>{t("week.action.schedule")}</button>}
          {(post.status === "approved" || post.status === "scheduled") && <button className="btn-secondary !py-1.5" disabled={busy} onClick={() => onAction("published")}>{t("week.action.publish")}</button>}
          {post.status === "scheduled" && <button className="btn-secondary !py-1.5" disabled={busy} onClick={() => onAction("approved")}>{t("week.action.unschedule")}</button>}
          {post.status === "approved" && <button className="btn-secondary !py-1.5" disabled={busy} onClick={() => onAction("idea")}>{t("week.action.unapprove")}</button>}
          {post.status === "published" && <button className="btn-secondary !py-1.5" onClick={onMetrics}>{t("week.action.metrics")}</button>}
          {post.status !== "published" && <button className="btn-secondary !py-1.5" onClick={onEdit}>{t("week.action.edit")}</button>}
          <button className="ml-auto rounded-xl px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50" disabled={busy} onClick={onDelete}>{t("week.action.delete")}</button>
        </div>
      </div>
    </li>
  );
}

function Bar({ value, max, className = "bg-indigo-500" }: { value: number; max: number; className?: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${max > 0 ? Math.max(4, (value / max) * 100) : 0}%` }} />
    </div>
  );
}

function Insights({ data, weekday }: { data: ContentInsights | null; weekday: (day: number) => string }) {
  const { t } = useI18n();
  const fmt = useFmt();
  if (!data) return null;
  const pct = (x: number | null) => (x === null ? null : `${(x * 100).toFixed(1).replace(".", ",")}%`);
  const maxViews = data.ranking[0]?.views ?? 0;
  const bestParts: string[] = [];
  if (data.best.platform) bestParts.push(t(`week.platform.${data.best.platform}` as MessageKey));
  if (data.best.day !== null) bestParts.push(weekday(data.best.day));
  return (
    <section className="card space-y-5" aria-labelledby="insights-title">
      <h2 id="insights-title" className="text-lg font-semibold">{t("week.insights.title")}</h2>
      {data.sample === 0 ? (
        <p className="text-sm text-slate-600">{t("week.insights.empty")}</p>
      ) : (
        <>
          {!data.enough && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("week.insights.notEnough", { n: data.sample })}</p>}
          {data.enough && bestParts.length > 0 && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("week.insights.best", { what: bestParts.join(" · ") })}</p>}
          <div>
            <h3 className="kicker mb-2">{t("week.insights.ranking")}</h3>
            <ol className="space-y-2">
              {data.ranking.slice(0, 7).map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-right font-mono text-slate-400">{i + 1}</span>
                  <span className="w-40 truncate font-medium sm:w-56" title={r.title}>{r.title}</span>
                  <Bar value={r.views} max={maxViews} className={i === 0 ? "bg-indigo-600" : "bg-slate-400"} />
                  <span className="w-28 text-right font-mono text-xs text-slate-600">
                    {fmt.format(r.views)} {t("week.insights.views")}
                  </span>
                  <span className="hidden w-20 text-right font-mono text-xs text-slate-500 sm:block" title={t("week.insights.engagement")}>{pct(r.engagement) ?? "—"}</span>
                </li>
              ))}
            </ol>
          </div>
          {data.enough && (
            <div className="grid gap-6 sm:grid-cols-2">
              {data.byPlatform.length > 0 && (
                <div>
                  <h3 className="kicker mb-2">{t("week.insights.byPlatform")}</h3>
                  <ul className="space-y-2 text-sm">
                    {data.byPlatform.map((p) => (
                      <li key={p.platform} className="flex items-center gap-3">
                        <span className="w-24 shrink-0">{t(`week.platform.${p.platform}` as MessageKey)}</span>
                        <Bar value={p.avgViews} max={Math.max(...data.byPlatform.map((x) => x.avgViews))} />
                        <span className="w-16 text-right font-mono text-xs">{fmt.format(Math.round(p.avgViews))}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">{t("week.insights.platformNote")}</p>
                </div>
              )}
              {data.byDay.length > 0 && (
                <div>
                  <h3 className="kicker mb-2">{t("week.insights.byDay")}</h3>
                  <ul className="space-y-2 text-sm">
                    {data.byDay.map((d) => (
                      <li key={d.day} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 capitalize">{weekday(d.day)}</span>
                        <Bar value={d.avgViews} max={Math.max(...data.byDay.map((x) => x.avgViews))} />
                        <span className="w-16 text-right font-mono text-xs">{fmt.format(Math.round(d.avgViews))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PromptCard() {
  const { t } = useI18n();
  const { me } = useAuth();
  const [copied, setCopied] = useState(false);
  const niches = me?.profile?.niches?.length ? me.profile.niches.map((n) => t(`niche.${n}` as MessageKey)).join(", ") : "—";
  const text = t("week.prompt.text", { niche: niches, platforms: CONTENT_PLATFORMS.map((p) => t(`week.platform.${p}` as MessageKey)).join(", ") });
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão da área de transferência: o texto continua selecionável */
    }
  }
  return (
    <section className="overflow-hidden rounded-2xl bg-slate-950 text-slate-200 shadow-[0_8px_24px_-12px_rgb(26_25_22/0.5)]" aria-labelledby="prompt-title">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-3">
        <span className="flex gap-1.5" aria-hidden="true"><i className="h-2.5 w-2.5 rounded-full bg-rose-400" /><i className="h-2.5 w-2.5 rounded-full bg-amber-400" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" /></span>
        <h2 id="prompt-title" className="text-sm font-semibold text-white">{t("week.prompt.title")}</h2>
        <button className="ml-auto inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} className="h-4 w-4" />
          {t(copied ? "week.prompt.copied" : "week.prompt.copy")}
        </button>
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm text-slate-400">{t("week.prompt.desc")}</p>
        <pre className="whitespace-pre-wrap rounded-xl bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-slate-200">{text}</pre>
      </div>
    </section>
  );
}

export function Content() {
  const { t, locale } = useI18n();
  const [week, setWeek] = useState<ContentWeek | null>(null);
  const [insights, setInsights] = useState<ContentInsights | null>(null);
  const [start, setStart] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<{ day: number; id?: string } | null>(null);
  const [metricsFor, setMetricsFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    (s?: string) => {
      api.contentWeek(s).then(setWeek).catch(() => setMsg({ ok: false, text: t("common.error") }));
    },
    [t],
  );
  const loadInsights = useCallback(() => {
    api.contentInsights().then(setInsights).catch(() => undefined);
  }, []);
  useEffect(() => load(start), [load, start]);
  useEffect(loadInsights, [loadInsights]);

  const fail = useCallback(
    (e: unknown) => {
      let text = errorMessage(e, t);
      if (e instanceof ApiError) {
        const issue = e.code === "approval_blocked" ? String((e.data.issues as string[] | undefined)?.[0] ?? "") : e.code;
        const key = `week.error.${issue}`;
        if (issue && key in { "week.error.script_missing": 1, "week.error.disclosure_missing": 1, "week.error.week_full": 1, "week.error.published_locked": 1 }) text = t(key as MessageKey);
      }
      setMsg({ ok: false, text });
    },
    [t],
  );

  const weekday = useCallback((day: number) => new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(`${addDays("2026-11-23", day)}T00:00:00Z`)), [locale]);
  const dayDate = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    return (ws: string, day: number) => f.format(new Date(`${addDays(ws, day)}T00:00:00Z`));
  }, [locale]);

  async function act(p: ContentPost, to: ContentStatus) {
    setBusy(true);
    setMsg(null);
    try {
      await api.contentStatus(p.id, to);
      load(week?.weekStart);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  if (!week) return <p className="text-slate-500">{msg?.text ?? t("common.loading")}</p>;
  const total = week.items.length;
  const done = week.items.filter((p) => p.status !== "idea").length;
  const range = `${dayDate(week.weekStart, 0)} – ${dayDate(week.weekStart, 6)}`;

  return (
    <div className="space-y-6">
      <header>
        <p className="kicker">{t("nav.group.content")}</p>
        <h1 className="mt-1 text-3xl font-semibold">{t("week.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{t("week.subtitle")}</p>
        <p className="mt-3 inline-flex max-w-2xl items-start gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">{t("week.honesty")}</p>
      </header>

      <div className="card flex flex-wrap items-center gap-3 !py-3">
        <button className="btn-secondary !px-2.5" aria-label={t("week.prev")} onClick={() => setStart(week.prev)}><Icon name="arrowLeft" /></button>
        <p className="min-w-40 text-center font-mono text-sm font-medium" aria-live="polite">{range}</p>
        <button className="btn-secondary !px-2.5" aria-label={t("week.next")} onClick={() => setStart(week.next)}><Icon name="arrowRight" /></button>
        <button className="btn-secondary" onClick={() => setStart(undefined)}>{t("week.thisWeek")}</button>
        <div className="ml-auto flex min-w-48 flex-1 items-center gap-3 sm:max-w-xs">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: total ? `${(done / total) * 100}%` : "0%" }} />
          </div>
          <span className="whitespace-nowrap text-xs text-slate-600">{t("week.progress", { n: done, total })}</span>
        </div>
      </div>

      {msg && <p role="alert" className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}

      <div className="space-y-4">
        {[0, 1, 2, 3, 4, 5, 6].map((day) => {
          const items = week.items.filter((p) => p.day === day);
          return (
            <section key={day} className="grid gap-3 md:grid-cols-[8rem_1fr]" aria-label={weekday(day)}>
              <div className="flex items-baseline gap-2 md:block md:pt-2">
                <p className="text-sm font-semibold capitalize text-slate-900">{weekday(day)}</p>
                <p className="font-mono text-xs text-slate-500">{dayDate(week.weekStart, day)}</p>
              </div>
              <div className="space-y-3">
                {items.length === 0 && form?.day !== day && (
                  <button className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-4 text-sm text-slate-500 transition hover:border-indigo-400 hover:bg-white hover:text-indigo-700" onClick={() => setForm({ day })} aria-label={`${t("week.addToDay")}: ${weekday(day)}`}>
                    <Icon name="plus" className="h-4 w-4" />{t("week.emptyDay")} · {t("week.addToDay")}
                  </button>
                )}
                {items.length > 0 && (
                  <ul className="space-y-3">
                    {items.map((p) =>
                      form?.id === p.id ? (
                        <li key={p.id}>
                          <PostForm
                            id={p.id}
                            initial={{ weekStart: p.weekStart, day: p.day, time: p.time ?? "", title: p.title, hook: p.hook ?? "", script: p.script ?? "", platforms: p.platforms, usesAffiliateLink: p.usesAffiliateLink, disclosureConfirmed: p.disclosureConfirmed }}
                            onCancel={() => setForm(null)}
                            onError={fail}
                            onDone={(re) => { setForm(null); setMsg(re ? { ok: true, text: t("week.reapproval") } : null); load(week.weekStart); }}
                          />
                        </li>
                      ) : (
                        <div key={p.id}>
                          <PostCard post={p} busy={busy} onAction={(to) => act(p, to)} onEdit={() => { setMsg(null); setForm({ day, id: p.id }); }} onMetrics={() => setMetricsFor(metricsFor === p.id ? null : p.id)}
                            onDelete={async () => { try { await api.contentDelete(p.id); load(week.weekStart); loadInsights(); } catch (e) { fail(e); } }} />
                          {metricsFor === p.id && (
                            <MetricsForm post={p} onCancel={() => setMetricsFor(null)} onError={fail} onDone={() => { setMetricsFor(null); load(week.weekStart); loadInsights(); }} />
                          )}
                        </div>
                      ),
                    )}
                  </ul>
                )}
                {form?.day === day && !form.id && (
                  <PostForm initial={empty(week.weekStart, day)} onCancel={() => setForm(null)} onError={fail} onDone={() => { setForm(null); load(week.weekStart); }} />
                )}
                {items.length > 0 && form?.day !== day && (
                  <button className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-indigo-700" onClick={() => setForm({ day })} aria-label={`${t("week.addToDay")}: ${weekday(day)}`}>
                    <Icon name="plus" className="h-4 w-4" />{t("week.addToDay")}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Insights data={insights} weekday={weekday} />
      <PromptCard />
    </div>
  );
}
