import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AiChat, type AiSearch, type AiStatus } from "../api";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

export function Citations({ items }: { items: AiChat["citations"] }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="mt-3 border-t border-slate-100 pt-2">
      <p className="text-xs font-medium text-slate-500">{t("ai.citations")}</p>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((c) => (
          <li key={c.programId}>
            <Link to={`/programs/${c.programId}`} className="text-indigo-700 hover:underline">{c.name}</Link>
            {c.sourceUrls.length === 0 ? (
              <span className="ml-2 text-xs text-slate-500">{t("ai.noSources")}</span>
            ) : (
              c.sourceUrls.map((u) => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="ml-2 break-all text-xs text-slate-600 underline">{u}</a>
              ))
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rótulo do modo da resposta: deixa claro o que veio do modelo e o que veio só do sistema. */
export function ModeBadge({ mode }: { mode: "llm" | "cached" | "facts_only" }) {
  const { t } = useI18n();
  const key = mode === "llm" ? "ai.badge.llm" : mode === "cached" ? "ai.badge.cached" : "ai.badge.facts";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${mode === "facts_only" ? "bg-slate-100 text-slate-700" : "bg-indigo-50 text-indigo-800"}`}>{t(key)}</span>;
}

type Turn = { role: "user"; text: string } | { role: "ai"; data: AiChat };

function SearchPanel() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<AiSearch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const filters = res ? Object.entries(res.interpreted).filter(([, v]) => v) : [];
  return (
    <section className="card space-y-3" aria-label={t("ai.search.title")}>
      <h2 className="font-medium">{t("ai.search.title")}</h2>
      <p className="text-xs text-slate-500">{t("ai.search.hint")}</p>
      <form className="flex gap-2" onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try { setRes(await api.aiSearch(q)); } catch (x) { setRes(null); setErr(errorMessage(x, t)); }
      }}>
        <label className="sr-only" htmlFor="ai-search">{t("ai.search.title")}</label>
        <input id="ai-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ai.placeholder")} />
        <button className="btn" disabled={q.trim().length < 2}>{t("ai.search.run")}</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {res && (
        <div>
          <p className="text-xs text-slate-600">
            {t("ai.search.understood")}{" "}
            {filters.length === 0 ? t("ai.search.nothingParsed") : filters.map(([k, v]) => (
              <span key={k} className="mr-1 inline-block rounded-full bg-slate-100 px-2 py-0.5">
                {k === "segment" ? t("ai.filter.segment", { v: t(`segment.${v}` as MessageKey) }) : k === "text" ? t("ai.filter.text", { v }) : t(`ai.filter.${k}` as MessageKey)}
              </span>
            ))}
          </p>
          {res.items.length === 0 ? <p className="mt-2 text-sm text-slate-600">{t("ai.search.empty")}</p> : (
            <ul className="mt-2 space-y-1 text-sm">
              {res.items.map((p) => (
                <li key={p.id}><Link to={`/programs/${p.id}`} className="text-indigo-700 hover:underline">{p.name}</Link> <span className="text-xs text-slate-500">· {p.advertiser.name}</span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function Assistant() {
  const { t, locale } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => api.aiStatus().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (q.length < 2) return;
    setErr(null); setBusy(true); setText("");
    setTurns((x) => [...x, { role: "user", text: q }]);
    try {
      const data = await api.aiChat(q, locale);
      setTurns((x) => [...x, { role: "ai", data }]);
    } catch (x) { setErr(errorMessage(x, t)); }
    finally { setBusy(false); refresh(); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("ai.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("ai.subtitle")}</p>
        <p className="mt-1 text-xs text-slate-500">{t("ai.rules")}</p>
        {status && <p className="mt-1 text-xs text-slate-500">{t("ai.usage", { n: status.usedToday, max: status.dailyRequests })}</p>}
      </div>

      <section className="card space-y-3" aria-label={t("ai.title")}>
        <ul className="space-y-3" aria-live="polite">
          {turns.map((m, i) => m.role === "user" ? (
            <li key={i} className="text-sm"><span className="font-medium">{t("ai.you")}: </span>{m.text}</li>
          ) : (
            <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2"><span className="font-medium">{t("ai.assistant")}</span><ModeBadge mode={m.data.mode} /></div>
              {m.data.answer ? <p className="whitespace-pre-wrap">{m.data.answer}</p> : (
                <p>{t(`ai.reason.${m.data.reason ?? "no_model"}` as MessageKey)} {m.data.citations.length > 0 && t("ai.factsHint")}</p>
              )}
              <Citations items={m.data.citations} />
            </li>
          ))}
        </ul>
        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
        <form onSubmit={ask} className="flex gap-2">
          <label className="sr-only" htmlFor="ai-q">{t("ai.title")}</label>
          <input id="ai-q" className="input" value={text} maxLength={600} onChange={(e) => setText(e.target.value)} placeholder={t("ai.placeholder")} />
          <button className="btn" disabled={busy || text.trim().length < 2}>{busy ? t("ai.asking") : t("ai.ask")}</button>
        </form>
      </section>
      <SearchPanel />
    </div>
  );
}
