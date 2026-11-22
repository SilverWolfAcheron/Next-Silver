import {
  decodeErrorCode,
  extractErrorCode,
  isErrorCode,
} from "../agent-core/errors.ts";
import { ERROR_CODES } from "../constants/errors.ts";
import { LOCALE_STORAGE_KEY } from "../constants/i18n.ts";
import type {
  ErrorCode,
  ErrorMessageEntry,
  ErrorParams,
  ParsedErrorCode,
} from "../types/errors";
import type { Locale, Messages } from "../types/i18n";
import { getMessages } from "./index.ts";

function normalizeLocaleTag(tag: string | undefined): Locale | null {
  if (!tag) return null;
  const lower: string = tag.toLowerCase();
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("zh")) return "zh";
  return null;
}

function readRuntimeEnv(): Record<string, string | undefined> | undefined {
  const runtimeGlobal: { process?: { env?: Record<string, string | undefined> } } =
    globalThis as { process?: { env?: Record<string, string | undefined> } };
  return runtimeGlobal.process?.env;
}

export function resolveSystemLocale(): Locale {
  try {
    const stored: string | null | undefined = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh" || stored === "ja" || stored === "en") return stored;
  } catch {
    // Ignore storage read errors in restricted environments.
  }
  const env: Record<string, string | undefined> | undefined = readRuntimeEnv();
  if (env) {
    const fromEnv: Locale | null =
      normalizeLocaleTag(env.SILVER_LANG) ??
      normalizeLocaleTag(env.LC_ALL) ??
      normalizeLocaleTag(env.LANG);
    if (fromEnv) return fromEnv;
  }
  if (typeof navigator !== "undefined") {
    const fromNavigator: Locale | null = normalizeLocaleTag(navigator.language);
    if (fromNavigator) return fromNavigator;
  }
  return "zh";
}

export function formatErrorCode(parsed: ParsedErrorCode, messages: Messages): string {
  const entry: ErrorMessageEntry = messages.errors[parsed.code] ?? messages.errors.UNKNOWN_ERROR;
  if (typeof entry === "string") return entry;

  const resolvedParams: ErrorParams = parsed.params ? { ...parsed.params } : {};
  const detailCode: string | number | undefined = resolvedParams.detailCode;
  if (typeof detailCode === "string" && isErrorCode(detailCode)) {
    resolvedParams.detail = formatErrorCode({ code: detailCode }, messages);
  }
  return entry(resolvedParams);
}

export function formatError(
  error: unknown,
  messages: Messages,
  fallback: ErrorCode = ERROR_CODES.UNKNOWN_ERROR
): string {
  const parsed: ParsedErrorCode = extractErrorCode(error, fallback);
  return formatErrorCode(parsed, messages);
}

export function formatLocalizedText(text: string, messages: Messages): string {
  if (!text) return "";
  const parsed: ParsedErrorCode | null = decodeErrorCode(text);
  if (!parsed) return text;
  return formatErrorCode(parsed, messages);
}

export function formatErrorLog(
  error: unknown,
  locale?: Locale,
  fallback: ErrorCode = ERROR_CODES.UNKNOWN_ERROR
): string {
  const parsed: ParsedErrorCode = extractErrorCode(error, fallback);
  const messages: Messages = getMessages(locale ?? resolveSystemLocale());
  return `[${parsed.code}] ${formatErrorCode(parsed, messages)}`;
}

export function logError(
  error: unknown,
  locale?: Locale,
  fallback: ErrorCode = ERROR_CODES.UNKNOWN_ERROR
): void {
  console.error(formatErrorLog(error, locale, fallback));
}
