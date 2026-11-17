import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { LEGAL } from "./legalText";

/** Páginas públicas de Privacidade e Termos. {operator} e {contact} vêm do administrador (/api/legal). */
export function Legal({ kind }: { kind: "privacy" | "terms" }) {
  const { t, locale } = useI18n();
  const [who, setWho] = useState<{ operatorName: string | null; contactEmail: string | null } | null>(null);
  useEffect(() => { fetch("/api/legal").then((r) => r.json()).then(setWho).catch(() => setWho({ operatorName: null, contactEmail: null })); }, []);
  const doc = LEGAL[locale][kind];
  const fill = (s: string) => s.replace("{operator}", who?.operatorName ?? t("legal.operatorUnset")).replace("{contact}", who?.contactEmail ?? t("legal.contactUnset"));
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <nav className="flex flex-wrap gap-3 text-sm"><Link className="underline" to="/">{t("legal.back")}</Link><Link className="underline" to="/privacy">{LEGAL[locale].privacy.title}</Link><Link className="underline" to="/terms">{LEGAL[locale].terms.title}</Link></nav>
      <h1 className="text-2xl font-semibold">{doc.title}</h1>
      <p className="text-sm text-slate-500">{doc.updated}</p>
      {who && !who.operatorName && <p role="note" className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">{t("legal.unset")}</p>}
      {doc.sections.map((s) => (
        <section key={s.h} className="space-y-1">
          <h2 className="font-medium">{s.h}</h2>
          {s.p.map((p, i) => <p key={i} className="text-sm text-slate-700">{fill(p)}</p>)}
        </section>
      ))}
    </main>
  );
}
