import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@ai/shared";
import { MESSAGES, type MessageKey } from "./messages";

const STORAGE_KEY = "ai.locale";

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    /* armazenamento indisponível */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  if (nav.toLowerCase().startsWith("pt")) return "pt-BR";
  if (nav.toLowerCase().startsWith("es")) return "es";
  if (nav.toLowerCase().startsWith("en")) return "en-US";
  return DEFAULT_LOCALE;
}

/** Traduz uma chave, substituindo {variáveis}. Se faltar a chave, cai no pt-BR. */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = MESSAGES[locale][key] ?? MESSAGES["pt-BR"][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initial ?? detectLocale());

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignora */
    }
    document.documentElement.lang = l;
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n fora do I18nProvider");
  return ctx;
}

export type { MessageKey };
