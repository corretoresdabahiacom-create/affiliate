import type { Locale } from "@ai/shared";
import { useI18n, type MessageKey } from "../i18n";
import type { Tri } from "../api";

const triStyle: Record<Tri, string> = {
  yes: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  no: "bg-rose-50 text-rose-800 ring-rose-200",
  unverified: "bg-slate-100 text-slate-600 ring-slate-200",
};

/** Sempre mostra o texto (não só a cor): "não verificado" nunca parece "sim". */
export function TriBadge({ value }: { value: Tri }) {
  const { t } = useI18n();
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${triStyle[value]}`}>
      {t(`tri.${value}` as MessageKey)}
    </span>
  );
}

const verifStyle: Record<string, string> = {
  verified_recently: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  awaiting_update: "bg-amber-50 text-amber-800 ring-amber-200",
  outdated: "bg-amber-50 text-amber-800 ring-amber-200",
  divergent: "bg-orange-50 text-orange-800 ring-orange-200",
  closed: "bg-rose-50 text-rose-800 ring-rose-200",
  suspended: "bg-rose-50 text-rose-800 ring-rose-200",
  unavailable: "bg-rose-50 text-rose-800 ring-rose-200",
  never_verified: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function VerificationBadge({ state }: { state: string }) {
  const { t } = useI18n();
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${verifStyle[state] ?? verifStyle.never_verified}`}>
      {t(`verif.${state}` as MessageKey)}
    </span>
  );
}

export function categoryName(c: { namePt: string; nameEn: string; nameEs: string }, locale: Locale): string {
  return locale === "en-US" ? c.nameEn : locale === "es" ? c.nameEs : c.namePt;
}

export function formatDate(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ms));
}

/** Só renderiza como link clicável URLs http(s); o resto vira texto. */
export function SafeLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-indigo-600 hover:underline">
      {children}
    </a>
  );
}
