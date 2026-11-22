import {
  AppError,
  decodeErrorCode,
  encodeErrorCode,
  ERROR_CODES,
  extractErrorCode,
} from "../agent-core/errors.ts";
import type { ErrorCode, ParsedErrorCode } from "../types/errors";
import type { Locale, Messages } from "../types/i18n";
import { formatError, formatErrorCode, formatErrorLog, formatLocalizedText } from "./errors.ts";
import { getMessages } from "./index.ts";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, body: () => void): void {
  try {
    body();
    console.log(`PASS ${name}`);
  } catch (cause: unknown) {
    throw new Error(name, { cause });
  }
}

test("all error codes resolve to localized non-empty text in zh, ja, and en", (): void => {
  const locales: Locale[] = ["zh", "ja", "en"];
  const codes: ErrorCode[] = Object.values(ERROR_CODES);

  for (const locale of locales) {
    const messages: Messages = getMessages(locale);
    for (const code of codes) {
      const text: string = formatErrorCode(
        { code, params: { path: "src/app.ts", detailCode: ERROR_CODES.API_TIMEOUT } },
        messages
      );
      expect(text.trim().length > 0, `Empty message for ${locale}.${code}`);
      expect(text !== code, `Untranslated code returned for ${locale}.${code}`);
    }
  }
});

test("AppError emits status codes only and formats localized UI and log output", (): void => {
  const timeout: AppError = new AppError(ERROR_CODES.API_TIMEOUT);
  expect(timeout.code === "API_TIMEOUT", "AppError stores status code");
  expect(timeout.message === "API_TIMEOUT", "AppError message stays pure status code");

  expect(
    formatError(timeout, getMessages("zh")) === "请求超时，请检查网络或稍后重试。",
    "zh error text matches"
  );
  expect(
    formatError(timeout, getMessages("ja")) ===
      "リクエストがタイムアウトしました。ネットワークを確認して再試行してください。",
    "ja error text matches"
  );
  expect(
    formatError(timeout, getMessages("en")) ===
      "Request timed out. Check your network and try again.",
    "en error text matches"
  );

  expect(
    formatErrorLog(timeout, "en") ===
      "[API_TIMEOUT] Request timed out. Check your network and try again.",
    "en log output includes status code and localized message"
  );
  expect(
    formatErrorLog(timeout, "zh") === "[API_TIMEOUT] 请求超时，请检查网络或稍后重试。",
    "zh log output includes status code and localized message"
  );
});

test("encoded parameters and nested detailCode localize across languages", (): void => {
  const encoded: string = encodeErrorCode(ERROR_CODES.WORKSPACE_ATTACHMENT_READ_FAILED, {
    path: "src/index.ts",
    detailCode: ERROR_CODES.WORKSPACE_FILE_NOT_FOUND,
  });
  const decoded: ParsedErrorCode | null = decodeErrorCode(encoded);
  expect(
    decoded?.code === "WORKSPACE_ATTACHMENT_READ_FAILED" &&
      decoded.params?.path === "src/index.ts" &&
      decoded.params?.detailCode === "WORKSPACE_FILE_NOT_FOUND",
    "decodeErrorCode restores code and params"
  );

  const zhText: string = formatLocalizedText(encoded, getMessages("zh"));
  expect(zhText.includes("src/index.ts") && zhText.includes("不存在"), "zh formats nested detailCode");

  const enText: string = formatLocalizedText(encoded, getMessages("en"));
  expect(
    enText.includes("src/index.ts") && enText.includes("does not exist"),
    "en formats nested detailCode"
  );

  expect(
    formatLocalizedText("Completed refactor of button styles", getMessages("en")) ===
      "Completed refactor of button styles",
    "freeform non-code text remains untouched"
  );

  const extracted: ParsedErrorCode = extractErrorCode(
    { code: ERROR_CODES.SEAT_SCOPE_EXCEEDED, params: { path: "src/a.ts" } },
    ERROR_CODES.UNKNOWN_ERROR
  );
  expect(
    extracted.code === "SEAT_SCOPE_EXCEEDED" && extracted.params?.path === "src/a.ts",
    "structured host response object preserves code and params"
  );
});
