import { PAGE_CATEGORIES, PAGE_TEMPLATES, type PageCategory, type PageTemplate } from "@ai/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PageSummary } from "../api";
import { Icon } from "../components/Icon";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

export const THEME_SWATCH: Record<string, [string, string, string]> = {
  citrus: ["#fff1e0", "#e8590c", "#1f1a14"], impact: ["#0c0c0f", "#ff5a1f", "#f6f4ef"], editorial: ["#f2ebdb", "#8a3b12", "#1d1b16"],
  neon: ["#1d1445", "#8b5cf6", "#f3f0ff"], aurora: ["#e4e6fb", "#4f46e5", "#12132b"], mono: ["#ffffff", "#0a0a0a", "#0a0a0a"],
  trust: ["#e6f0ff", "#1d5fd1", "#0f1d33"], grove: ["#dcf3e2", "#15803d", "#102417"], focus: ["#fffdf9", "#d9480f", "#1a1a1a"],
  vivid: ["#fecdd3", "#e11d74", "#2a0b1c"], compare: ["#e6fffa", "#0f766e", "#111827"], verdict: ["#0b1220", "#22d3ee", "#eef2ff"],
};
const THEME_OF: Record<string, string> = { "drop-vitrine": "citrus", "drop-impacto": "impact", "info-editorial": "editorial", "info-neon": "neon", "saas-aurora": "aurora", "saas-mono": "mono", "serv-confianca": "trust", "serv-local": "grove", "leads-foco": "focus", "leads-vibrante": "vivid", "review-comparativo": "compare", "review-veredito": "verdict" };

function Thumb({ id }: { id: string }) {
  const [bg, ac, tx] = THEME_SWATCH[THEME_OF[id] ?? "citrus"]!;
  return (
    <div className="relative h-28 overflow-hidden rounded-xl border border-slate-200" style={{ background: bg }} aria-hidden="true">
      <div className="absolute left-3 top-4 h-2.5 w-24 rounded" style={{ background: tx }} />
      <div className="absolute left-3 top-9 h-2 w-32 rounded opacity-40" style={{ background: tx }} />
      <div className="absolute left-3 top-14 h-6 w-16 rounded-full" style={{ background: ac }} />
      <div className="absolute bottom-0 right-3 h-16 w-14 rounded-t-lg opacity-80" style={{ background: ac }} />
    </div>
  );
}

export function Pages() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<PageSummary[]>([]);
  const [max, setMax] = useState(10);
  const [cat, setCat] = useState<PageCategory | "all">("all");
  const [picked, setPicked] = useState<PageTemplate | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.pageList();
      setItems(r.items);
      setMax(r.max);
    } catch (e) {
      setError(errorMessage(e, t));
    }
  }, [t]);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.pageCreate(name.trim(), picked.id);
      navigate(`/pages/${r.id}`);
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  }
  async function remove(p: PageSummary) {
    if (!window.confirm(t("pages.deleteConfirm", { name: p.title }))) return;
    try {
      await api.pageDelete(p.id);
      await load();
    } catch (err) {
      setError(errorMessage(err, t));
    }
  }

  const shown = PAGE_TEMPLATES.filter((x) => cat === "all" || x.category === cat);
  return (
    <div className="space-y-8">
      <header>
        <p className="kicker">{t("nav.group.content")}</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("pages.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("pages.subtitle")}</p>
        <p className="mt-3 max-w-2xl rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{t("pages.honesty")}</p>
      </header>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{error}</p>}

      <section aria-labelledby="my-pages" className="space-y-3">
        <h2 id="my-pages" className="text-lg font-semibold text-slate-900">{t("pages.mine")} <span className="text-sm font-normal text-slate-500">({items.length}/{max})</span></h2>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{t("pages.empty")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <li key={p.id} className="card flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-semibold text-slate-900">{p.title}</h3>
                  <span className={`chip shrink-0 ${p.status === "published" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>{t(`pages.status.${p.status}` as MessageKey)}</span>
                </div>
                <p className="truncate font-mono text-xs text-slate-500">/p/{p.slug}</p>
                <div className="mt-auto flex gap-2">
                  <button className="btn" onClick={() => navigate(`/pages/${p.id}`)}>{t("pages.open")}</button>
                  <button className="btn-secondary" onClick={() => remove(p)} aria-label={`${t("pages.delete")}: ${p.title}`}><Icon name="trash" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="tpl" className="space-y-4">
        <h2 id="tpl" className="text-lg font-semibold text-slate-900">{t("pages.templates")}</h2>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("pages.templates")}>
          {(["all", ...PAGE_CATEGORIES] as const).map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset transition ${cat === c ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-300"}`}>
              {t(`pages.cat.${c}` as MessageKey)}
            </button>
          ))}
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((tpl) => (
            <li key={tpl.id} className={`card space-y-3 transition ${picked?.id === tpl.id ? "ring-2 ring-indigo-500" : ""}`}>
              <Thumb id={tpl.id} />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(`pages.cat.${tpl.category}` as MessageKey)}</p>
                <h3 className="font-semibold text-slate-900">{t(`pages.tpl.${tpl.id}` as MessageKey)}</h3>
                <p className="mt-1 text-sm text-slate-600">{t(`pages.tpl.${tpl.id}.d` as MessageKey)}</p>
              </div>
              <button className="btn-secondary w-full" onClick={() => { setPicked(tpl); setName(t(`pages.tpl.${tpl.id}` as MessageKey)); }}>{t("pages.use")}</button>
            </li>
          ))}
        </ul>
        {picked && (
          <form onSubmit={create} className="card flex flex-col gap-3 border-indigo-200 bg-indigo-50/40 sm:flex-row sm:items-end" aria-label={t("pages.create")}>
            <div className="flex-1">
              <label className="label" htmlFor="page-name">{t("pages.nameLabel")}</label>
              <input id="page-name" className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn" disabled={busy || !name.trim()}>{t("pages.create")}</button>
            <button type="button" className="btn-secondary" onClick={() => setPicked(null)}>{t("common.cancel")}</button>
          </form>
        )}
      </section>
    </div>
  );
}
