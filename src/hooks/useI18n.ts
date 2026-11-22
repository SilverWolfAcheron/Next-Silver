import { useMemo } from "react";
import { getMessages } from "../i18n";
import { useLocaleStore } from "../stores/localeStore";
import type { Locale, Messages } from "../types/i18n";
import type { LocaleStore } from "../types/stores";

export function useI18n(): { locale: Locale; setLocale: (locale: Locale) => void; t: Messages } {
  const locale: Locale = useLocaleStore((s: LocaleStore): Locale => s.locale);
  const setLocale: (locale: Locale) => void = useLocaleStore(
    (s: LocaleStore): ((locale: Locale) => void) => s.setLocale
  );
  const t: Messages = useMemo((): Messages => getMessages(locale), [locale]);
  return { locale, setLocale, t };
}
