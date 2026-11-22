import type { Locale } from "../types/i18n";

export const LOCALE_STORAGE_KEY: string = "silver.locale";

export const LOCALE_OPTIONS: readonly { id: Locale; label: string }[] = [
  { id: "zh", label: "简体中文" },
  { id: "ja", label: "日本語" },
  { id: "en", label: "English" },
];
