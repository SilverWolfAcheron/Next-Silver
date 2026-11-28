import { LOCALE_OPTIONS } from "../constants/i18n.ts";
import type { Locale, Messages } from "../types/i18n";
import { enMessages } from "./languages/en.ts";
import { jaMessages } from "./languages/ja.ts";
import { zhMessages } from "./languages/zh.ts";

export { LOCALE_OPTIONS };
export type { Locale, Messages };

const MESSAGES_BY_LOCALE: Record<Locale, Messages> = {
  zh: zhMessages,
  ja: jaMessages,
  en: enMessages,
};

export function getMessages(locale: Locale): Messages {
  return MESSAGES_BY_LOCALE[locale] ?? zhMessages;
}

export function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "ja" || value === "en";
}
