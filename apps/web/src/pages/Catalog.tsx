import { useEffect, useState } from "react";
import { NETWORK_KINDS, OPERATIONAL_STATUS, SEGMENTS } from "@ai/shared";
import { api, type CatalogMeta, type ImportReport } from "../api";
import { useAuth } from "../auth";
import { categoryName } from "../components/badges";
import { errorMessage } from "../components/errors";
import { useI18n, type MessageKey } from "../i18n";

type Tab = "program" | "networks" | "advertisers" | "import";

export function Catalog() {
  const { t } = useI18n();
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>("program");
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const reload = () => api.catalogMeta().then(setMeta);
  useEffect(() => {
    reload();
  }, []);

  if (me?.user.role !== "editor" && me?.user.role !== "admin") return <p role="alert">{t("error.forbidden")}</p>;
  const tabs: Tab[] = ["program", "networks", "advertisers", "import"];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("catalog.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("catalog.subtitle")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map((x) => (
          <button key={x} aria-pressed={tab === x} className={tab === x ? "btn" : "btn-secondary"} onClick={() => setTab(x)}>
            {t(`catalog.tab.${x}` as MessageKey)}
          </button>
        ))}
      </div>
      {tab === "program" && meta && <NewProgram meta={meta} />}
      {tab === "networks" && meta && <Networks meta={meta} onSaved={reload} />}
      {tab === "advertisers" && <Advertisers />}
      {tab === "import" && <Import />}
    </div>
  );
}

function useAction() {
  const { t } = useI18n();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e, t) });
      return false;
    }
  };
  const view = msg && (
    <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
      {msg.text}
    </p>
  );
  return { run, view };
}

function NewProgram({ meta }: { meta: CatalogMeta }) {
  const { t, locale } = useI18n();
  const { run, view } = useAction();
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [advertiserId, setAdvertiserId] = useState("");
  const [f, setF] = useState({ name: "", segment: "saas", networkId: "", categoryId: "", officialUrl: "", signupUrl: "", docsUrl: "" });

  useEffect(() => {
    const id = setTimeout(() => api.advertisers(term).then((r) => setFound(r.advertisers)).catch(() => setFound([])), 250);
    return () => clearTimeout(id);
  }, [term]);

  const ch = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!advertiserId) return;
        const body: Record<string, unknown> = { advertiserId, name: f.name, segment: f.segment };
        for (const k of ["networkId", "categoryId", "officialUrl", "signupUrl", "docsUrl"] as const) if (f[k]) body[k] = f[k];
        if (await run(() => api.createProgram(body), t("catalog.created"))) setF({ ...f, name: "" });
      }}
    >
      <div>
        <label className="label" htmlFor="adv-search">{t("catalog.searchCompany")}</label>
        <input id="adv-search" className="input" value={term} onChange={(e) => setTerm(e.target.value)} />
        <label className="label mt-2" htmlFor="adv">{t("catalog.company")}</label>
        <select id="adv" className="input" value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)} required>
          <option value="">—</option>
          {found.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {!advertiserId && <p className="mt-1 text-xs text-slate-500">{t("catalog.needCompany")}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="p-name">{t("catalog.name")}</label>
          <input id="p-name" className="input" value={f.name} onChange={ch("name")} required maxLength={160} />
        </div>
        <div>
          <label className="label" htmlFor="p-seg">{t("programs.segment")}</label>
          <select id="p-seg" className="input" value={f.segment} onChange={ch("segment")}>
            {SEGMENTS.map((s) => <option key={s} value={s}>{t(`segment.${s}` as MessageKey)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-net">{t("programs.network")}</label>
          <select id="p-net" className="input" value={f.networkId} onChange={ch("networkId")}>
            <option value="">{t("catalog.noNetwork")}</option>
            {meta.networks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-cat">{t("programs.category")}</label>
          <select id="p-cat" className="input" value={f.categoryId} onChange={ch("categoryId")}>
            <option value="">{t("catalog.noCategory")}</option>
            {meta.categories.filter((c) => c.segment === f.segment).map((c) => <option key={c.id} value={c.id}>{categoryName(c, locale)}</option>)}
          </select>
        </div>
        {(["officialUrl", "signupUrl", "docsUrl"] as const).map((k) => (
          <div key={k}>
            <label className="label" htmlFor={`p-${k}`}>{t(`detail.${k}` as MessageKey)}</label>
            <input id={`p-${k}`} className="input" type="url" value={f[k]} onChange={ch(k)} />
          </div>
        ))}
      </div>
      {view}
      <button className="btn" type="submit" disabled={!advertiserId}>{t("catalog.create")}</button>
    </form>
  );
}

function Networks({ meta, onSaved }: { meta: CatalogMeta; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, view } = useAction();
  const [f, setF] = useState({ name: "", kind: "network", websiteUrl: "", operationalStatus: "unverified" });
  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-slate-100 text-sm">
        {meta.networks.map((n) => (
          <li key={n.id} className="flex flex-wrap justify-between gap-2 py-2">
            <span className="font-medium">{n.name}</span>
            <span className="text-slate-500">
              {t(`catalog.kind.${n.kind}` as MessageKey)} · {t(`catalog.op.${n.operationalStatus}` as MessageKey)}
              {n.notes ? ` · ${n.notes}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="card space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { name: f.name, kind: f.kind, operationalStatus: f.operationalStatus };
          if (f.websiteUrl) body.websiteUrl = f.websiteUrl;
          if (await run(() => api.createNetwork(body), t("catalog.created"))) {
            setF({ ...f, name: "", websiteUrl: "" });
            onSaved();
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="n-name">{t("catalog.name")}</label>
            <input id="n-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="n-kind">{t("catalog.kind")}</label>
            <select id="n-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {NETWORK_KINDS.map((k) => <option key={k} value={k}>{t(`catalog.kind.${k}` as MessageKey)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="n-url">{t("catalog.website")}</label>
            <input id="n-url" className="input" type="url" value={f.websiteUrl} onChange={(e) => setF({ ...f, websiteUrl: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="n-op">{t("catalog.opStatus")}</label>
            <select id="n-op" className="input" value={f.operationalStatus} onChange={(e) => setF({ ...f, operationalStatus: e.target.value })}>
              {OPERATIONAL_STATUS.map((k) => <option key={k} value={k}>{t(`catalog.op.${k}` as MessageKey)}</option>)}
            </select>
          </div>
        </div>
        {view}
        <button className="btn" type="submit">{t("catalog.create")}</button>
      </form>
    </div>
  );
}

function Advertisers() {
  const { t } = useI18n();
  const { run, view } = useAction();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, unknown> = { name };
        if (url) body.websiteUrl = url;
        if (await run(() => api.createAdvertiser(body), t("catalog.created"))) {
          setName("");
          setUrl("");
        }
      }}
    >
      <div>
        <label className="label" htmlFor="a-name">{t("catalog.name")}</label>
        <input id="a-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="a-url">{t("catalog.website")}</label>
        <input id="a-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      {view}
      <button className="btn" type="submit">{t("catalog.create")}</button>
    </form>
  );
}

function Import() {
  const { t } = useI18n();
  const { run, view } = useAction();
  const [csv, setCsv] = useState("advertiser,program,segment,network,category\n");
  const [report, setReport] = useState<ImportReport | null>(null);
  const go = (dryRun: boolean) =>
    run(async () => setReport(await api.importCsv(csv, dryRun)), t("editor.ok"));
  return (
    <div className="card space-y-3">
      <p className="text-sm text-slate-600">{t("catalog.import.help")}</p>
      <label className="label" htmlFor="csv">{t("catalog.import.csv")}</label>
      <textarea id="csv" className="input font-mono" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => go(true)}>{t("catalog.import.dryRun")}</button>
        <button className="btn" onClick={() => go(false)}>{t("catalog.import.run")}</button>
      </div>
      {view}
      {report && (
        <div className="space-y-1 text-sm" role="status">
          {report.dryRun && <p className="text-amber-700">{t("catalog.import.dryNote")}</p>}
          <p className="font-medium">
            {t("catalog.import.report", { created: report.created, dups: report.duplicates.length, errors: report.errors.length })}
          </p>
          <ul className="list-disc pl-5 text-slate-600">
            {report.duplicates.map((d) => <li key={`d${d.line}`}>{t("catalog.import.line", { line: d.line, reason: d.reason })}</li>)}
            {report.errors.map((d) => <li key={`e${d.line}`}>{t("catalog.import.line", { line: d.line, reason: d.error })}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
