import type { ComposerModeItem } from "../types/composer";

const COMPOSER_LINE_HEIGHT: number = 22;
export const MIN_TEXTAREA_HEIGHT: number = COMPOSER_LINE_HEIGHT * 2;
export const MAX_TEXTAREA_HEIGHT: number = COMPOSER_LINE_HEIGHT * 5;
export const MAX_COMPOSER_ATTACHMENTS: number = 8;
export const MAX_COMPOSER_TEXT_LENGTH: number = 100_000;
export const DRAFT_AUTOSAVE_DELAY_MS: number = 250;
export const MENTION_SEARCH_DEBOUNCE_MS: number = 100;
export const MENTION_SEARCH_LIMIT: number = 24;

// Mode names are intentionally kept in English across all locales.
export const COMPOSER_MODES: readonly ComposerModeItem[] = [
  { id: "develop", label: "Agent" },
  { id: "review", label: "Plan" },
  { id: "explain", label: "Explain" },
  { id: "academic", label: "Discussion" },
];
