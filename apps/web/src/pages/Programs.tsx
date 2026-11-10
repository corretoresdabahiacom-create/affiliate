import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CatalogMeta, type CatalogProgram } from "../api";
import { VerificationBadge, categoryName, TriBadge } from "../components/badges";
import { useI18n, type MessageKey } from "../i18n";

const PAGE = 25;

export function Programs() {
  const { t, locale } = useI18n();
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [f, setF] = useState({ q: "", segment: "", category: "", network: "", accepts_brazil: "", recurring: "", traffic: "", verified: false });
  const [items, setItems] = useState<CatalogProgram[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.catalogMeta().then(setMeta).catch(() => setError(true));
  }, []);

  const query = useCallback(
    (offset: number) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) p.set(k, v === true ? "1" : String(v));
      p.set("limit", String(PAGE));
      p.set("offset", String(offset));
      return p.toString();
    },
    [f],
  );

  useEffect(() => {
    // Pequena espera para não consultar a cada tecla digitada.
    const id = setTimeout(() => {
      setLoading(true);
      setError(false);
      api
        .programs(query(0))
        .then((r) => {
          setItems(r.items);
          setTotal(r.total);
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const more = async () => {
    const r = await api.programs(query(items.length));
    setItems((prev) => [...prev, ...r.items]);
    setTotal(r.total);
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const categories = (meta?.categories ?? []).filter((c) => !f.segment || c.segment === f.segment);

  const select = (id: string, label: string, value: string, onChange: any, options: [string, string][]) => (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={onChange}>
        <option value="">{t("programs.all")}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
  const confirmed: [string, string][] = [["yes", t("tri.yes")]];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("programs.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("programs.subtitle")}</p>
      </div>

      <section className="card space-y-4">
        <div>
          <label htmlFor="q" className="label">
            {t("programs.search")}
          </label>
          <input id="q" type="search" className="input" value={f.q} onChange={set("q")} maxLength={80} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {select("segment", t("programs.segment"), f.segment, (e: any) => setF((p) => ({ ...p, segment: e.target.value, category: "" })),
            (meta?.segments ?? []).map((s) => [s, t(`segment.${s}` as MessageKey)]))}
          {select("category", t("programs.category"), f.category, set("category"),
            categories.map((c) => [c.slug, categoryName(c, locale)]))}
          {select("network", t("programs.network"), f.network, set("network"),
            (meta?.networks ?? []).map((n) => [n.id, n.name]))}
          {select("accepts_brazil", t("programs.acceptsBrazil"), f.accepts_brazil, set("accepts_brazil"), confirmed)}
          {select("recurring", t("programs.recurring"), f.recurring, set("recurring"), confirmed)}
          {select("traffic", t("programs.traffic"), f.traffic, set("traffic"),
            (["paid", "organic", "social"] as const).map((x) => [x, t(`traffic.${x}` as MessageKey)]))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.verified} onChange={set("verified")} />
          {t("programs.verifiedOnly")}
        </label>
      </section>

      {error && <p role="alert" className="text-sm text-red-600">{t("common.error")}</p>}
      {loading ? (
        <p className="text-slate-500">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="card text-sm text-slate-600">{t("programs.empty")}</p>
      ) : (
        <>
          <p className="text-sm text-slate-500">{t("programs.total", { n: total })}</p>
          <ul className="space-y-3">
            {items.map((p) => (
              <li key={p.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link to={`/programs/${p.id}`} className="text-base font-medium text-indigo-700 hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-sm text-slate-600">
                      {p.advertiser.name} · {p.network?.name ?? t("programs.direct")} · {t(`segment.${p.segment}` as MessageKey)}
                    </p>
                  </div>
                  <VerificationBadge state={p.verification} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>{t("f.accepts_brazil")}: <TriBadge value={p.acceptsBrazil} /></span>
                  <span>{t("f.is_recurring")}: <TriBadge value={p.isRecurring} /></span>
                  <span>{t("f.accepts_individuals")}: <TriBadge value={p.acceptsIndividuals} /></span>
                </div>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <button className="btn-secondary" onClick={more}>
              {t("programs.more")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
