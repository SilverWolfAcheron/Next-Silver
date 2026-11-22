import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { LOCALE_STORAGE_KEY } from "../constants/i18n";
import { getMessages, isLocale } from "../i18n";
import type { Locale } from "../types/i18n";
import type { LocaleStore } from "../types/stores";

function readInitialLocale(): Locale {
  try {
    const stored: string | null | undefined = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Ignore storage read errors in restricted environments.
  }

  const nav: string = globalThis.navigator?.language?.toLowerCase() ?? "";
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("en")) return "en";
  return "zh";
}

function syncHtmlLang(locale: Locale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = getMessages(locale).htmlLang;
  }
}

const initialLocale: Locale = readInitialLocale();
syncHtmlLang(initialLocale);

export const useLocaleStore: UseBoundStore<StoreApi<LocaleStore>> = create<LocaleStore>(
  (set: StoreApi<LocaleStore>["setState"]): LocaleStore => ({
    locale: initialLocale,
    setLocale: (locale: Locale): void => {
      syncHtmlLang(locale);
      try {
        globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {
        // Ignore storage write errors.
      }
      set({ locale });
    },
  })
);
