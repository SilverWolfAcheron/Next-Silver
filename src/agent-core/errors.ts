import { ERROR_CODES, ERROR_CODE_SET, ERROR_PARAM_SEPARATOR } from "../constants/errors.ts";
import type { AppErrorOptions, ErrorCode, ErrorParams, ParsedErrorCode } from "../types/errors";

export { ERROR_CODES };
export type { AppErrorOptions, ErrorCode, ErrorParams, ParsedErrorCode };

function sanitizeParams(raw: unknown): ErrorParams | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const result: ErrorParams = {};
  let hasEntry: boolean = false;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      result[key] = value;
      hasEntry = true;
    }
  }
  return hasEntry ? result : undefined;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

export function encodeErrorCode(code: ErrorCode, params?: ErrorParams): string {
  const clean: ErrorParams | undefined = sanitizeParams(params);
  if (!clean) return code;
  return `${code}${ERROR_PARAM_SEPARATOR}${JSON.stringify(clean)}`;
}

export function decodeErrorCode(raw: string): ParsedErrorCode | null {
  if (isErrorCode(raw)) return { code: raw };
  const separatorIndex: number = raw.indexOf(ERROR_PARAM_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const candidate: string = raw.slice(0, separatorIndex);
  if (!isErrorCode(candidate)) return null;
  const payload: string = raw.slice(separatorIndex + ERROR_PARAM_SEPARATOR.length);
  try {
    const parsed: unknown = JSON.parse(payload);
    return { code: candidate, params: sanitizeParams(parsed) };
  } catch {
    return { code: candidate };
  }
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly params?: ErrorParams;

  constructor(code: ErrorCode, options?: AppErrorOptions) {
    super(
      encodeErrorCode(code, options?.params),
      options?.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = "AppError";
    this.code = code;
    this.params = sanitizeParams(options?.params);
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof AppError) return error.code === ERROR_CODES.API_TIMEOUT;
  if (typeof error === "object" && error !== null) {
    const name: unknown = "name" in error ? error.name : undefined;
    const code: unknown = "code" in error ? error.code : undefined;
    if (name === "TimeoutError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return true;
    }
  }
  return false;
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof AppError) return error.code === ERROR_CODES.REQUEST_ABORTED;
  if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
    return true;
  }
  return false;
}

export function extractErrorCode(
  error: unknown,
  fallback: ErrorCode = ERROR_CODES.UNKNOWN_ERROR
): ParsedErrorCode {
  if (error instanceof AppError) {
    return { code: error.code, params: error.params };
  }
  if (isTimeoutError(error)) {
    return { code: ERROR_CODES.API_TIMEOUT };
  }
  if (isAbortError(error)) {
    return { code: ERROR_CODES.REQUEST_ABORTED };
  }
  if (typeof error === "string") {
    const decoded: ParsedErrorCode | null = decodeErrorCode(error);
    if (decoded) return decoded;
    return { code: fallback };
  }
  if (error instanceof Error) {
    const decoded: ParsedErrorCode | null = decodeErrorCode(error.message);
    if (decoded) return decoded;
    if ("code" in error && typeof error.code === "string") {
      if (error.code === "EACCES" || error.code === "EPERM") {
        return { code: ERROR_CODES.WORKSPACE_PERMISSION_DENIED };
      }
      if (error.code === "ENOENT") {
        return { code: ERROR_CODES.WORKSPACE_FILE_NOT_FOUND };
      }
    }
  }
  if (typeof error === "object" && error !== null) {
    const record: Record<string, unknown> = error as Record<string, unknown>;
    if (isErrorCode(record.code)) {
      return { code: record.code, params: sanitizeParams(record.params) };
    }
    if (typeof record.error === "string") {
      const decoded: ParsedErrorCode | null = decodeErrorCode(record.error);
      if (decoded) return decoded;
    }
  }
  return { code: fallback };
}

export function serializeErrorCode(
  error: unknown,
  fallback: ErrorCode = ERROR_CODES.UNKNOWN_ERROR
): string {
  const parsed: ParsedErrorCode = extractErrorCode(error, fallback);
  return encodeErrorCode(parsed.code, parsed.params);
}
