import { AppError, ERROR_CODES, isTimeoutError } from "../errors";
import type { ErrorCode } from "../../types/errors";

export interface ChatInput {
  model: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  signal?: AbortSignal;
  onAccepted?: () => void;
}

export interface ModelClient {
  listModels(signal?: AbortSignal): Promise<string[]>;
  streamChat(input: ChatInput): AsyncIterable<string>;
}

export interface ProviderConnection {
  key: string;
  baseUrl: URL;
}

type ErrorKind = "configuration" | "network" | "http" | "response" | "stream";

export class ProviderError extends AppError {
  readonly kind: ErrorKind;
  readonly status?: number;

  constructor(kind: ErrorKind, code: ErrorCode, status?: number) {
    super(code, status === undefined ? undefined : { params: { status } });
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

export function describeProviderError(error: unknown): ErrorCode {
  if (error instanceof ProviderError) return error.code;
  if (isTimeoutError(error)) return ERROR_CODES.API_TIMEOUT;
  return ERROR_CODES.API_REQUEST_FAILED;
}

export function providerAddress(value: string | undefined): URL {
  const trimmed: string = value?.trim() ?? "";
  if (!trimmed) {
    throw new ProviderError("configuration", ERROR_CODES.PROVIDER_ADDRESS_REQUIRED);
  }
  let address: URL;
  try {
    address = new URL(trimmed);
  } catch {
    throw new ProviderError("configuration", ERROR_CODES.PROVIDER_ADDRESS_INVALID);
  }
  if (!["http:", "https:"].includes(address.protocol)) {
    throw new ProviderError("configuration", ERROR_CODES.PROVIDER_ADDRESS_PROTOCOL_INVALID);
  }
  if (address.username || address.password) {
    throw new ProviderError("configuration", ERROR_CODES.PROVIDER_ADDRESS_CREDENTIALS_FORBIDDEN);
  }
  if (address.search || address.hash) {
    throw new ProviderError("configuration", ERROR_CODES.PROVIDER_ADDRESS_INVALID);
  }
  return address;
}

export function endpoint(base: URL, version: string, resource: string): URL {
  const url: URL = new URL(base);
  const path: string = url.pathname.replace(/\/+$/, "");
  url.pathname = `${path.endsWith(`/${version}`) ? path : `${path}/${version}`}/${resource}`;
  return url;
}

export function requireKey(key: string): string {
  if (!key.trim()) throw new ProviderError("configuration", ERROR_CODES.PROVIDER_KEY_REQUIRED);
  return key.trim();
}

export function requireModel(model: string): string {
  if (!model.trim()) throw new ProviderError("configuration", ERROR_CODES.PROVIDER_MODEL_REQUIRED);
  return model.trim();
}

function httpErrorCode(status: number): ErrorCode {
  switch (status) {
    case 401: return ERROR_CODES.API_UNAUTHORIZED;
    case 403: return ERROR_CODES.API_FORBIDDEN;
    case 404: return ERROR_CODES.API_NOT_FOUND;
    case 429: return ERROR_CODES.API_RATE_LIMITED;
    default:
      return status >= 500 ? ERROR_CODES.API_SERVER_ERROR : ERROR_CODES.API_HTTP_ERROR;
  }
}

export async function request(url: URL, options: RequestInit): Promise<Response> {
  if (options.signal?.aborted) {
    if (isTimeoutError(options.signal.reason)) {
      throw new ProviderError("network", ERROR_CODES.API_TIMEOUT);
    }
    options.signal.throwIfAborted();
  }
  let response: Response;
  try {
    response = await fetch(url, { ...options, credentials: "omit", redirect: "error" });
  } catch (error) {
    if (isTimeoutError(error) || (options.signal?.aborted && isTimeoutError(options.signal.reason))) {
      throw new ProviderError("network", ERROR_CODES.API_TIMEOUT);
    }
    options.signal?.throwIfAborted();
    throw new ProviderError("network", ERROR_CODES.API_NETWORK_ERROR);
  }
  if (!response.ok) {
    void response.body?.cancel().catch((): void => undefined);
    throw new ProviderError("http", httpErrorCode(response.status), response.status);
  }
  return response;
}

export async function readModelPage<T>(response: Response, signal?: AbortSignal): Promise<T> {
  let page: unknown;
  try {
    page = await response.json();
  } catch (error) {
    if (isTimeoutError(error) || (signal?.aborted && isTimeoutError(signal.reason))) {
      throw new ProviderError("network", ERROR_CODES.API_TIMEOUT);
    }
    signal?.throwIfAborted();
  }
  if (typeof page !== "object" || page === null || Array.isArray(page) || "error" in page) {
    invalidModelList();
  }
  return page as T;
}

export function modelNames(values: unknown[], key: string): string[] {
  return [...new Set(values.filter(
    (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0 && value !== key
  ))];
}

export function invalidModelList(): never {
  throw new ProviderError("response", ERROR_CODES.API_MODEL_LIST_INVALID);
}

interface ServerEvent {
  type: string;
  data: string;
}

export async function* streamEvents(
  response: Response, signal?: AbortSignal, onAccepted?: () => void
): AsyncIterable<ServerEvent> {
  if (!response.body) {
    throw new ProviderError("response", ERROR_CODES.API_STREAM_MISSING);
  }
  const reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> = response.body.getReader();
  const decoder: TextDecoder = new TextDecoder();
  let buffer: string = "";
  let data: string[] = [];
  let type: string = "";
  let done: boolean = false;
  try {
    if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) onAccepted?.();
    while (!done) {
      const chunk: ReadableStreamReadResult<Uint8Array<ArrayBuffer>> = await reader.read();
      done = chunk.done;
      buffer += decoder.decode(chunk.value, { stream: !done });
      const lines: string[] = buffer.split(/\r\n|\r(?!$)|\n/);
      buffer = lines.pop() ?? "";
      if (done) lines.push(buffer.replace(/\r$/, ""), "");

      for (const line of lines) {
        if (!line) {
          if (data.length) yield { type, data: data.join("\n") };
          data = [];
          type = "";
          continue;
        }
        const separator: number = line.indexOf(":");
        const field: string = separator < 0 ? line : line.slice(0, separator);
        const value: string = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
        if (field === "data") data.push(value);
        if (field === "event") type = value;
      }
    }
  } catch (error) {
    if (isTimeoutError(error) || (signal?.aborted && isTimeoutError(signal.reason))) {
      throw new ProviderError("network", ERROR_CODES.API_TIMEOUT);
    }
    signal?.throwIfAborted();
    throw interruptedStream();
  } finally {
    if (!done) void reader.cancel().catch((): void => undefined);
    reader.releaseLock();
  }
}

export function interruptedStream(): ProviderError {
  return new ProviderError("stream", ERROR_CODES.API_STREAM_INTERRUPTED);
}

export function readStreamEvent<T>(event: ServerEvent): T {
  if (event.type === "error") {
    throw new ProviderError("stream", ERROR_CODES.API_STREAM_ERROR);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    throw new ProviderError("response", ERROR_CODES.API_RESPONSE_INVALID);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ProviderError("response", ERROR_CODES.API_RESPONSE_INVALID);
  }
  if ("error" in payload && payload.error !== null && payload.error !== undefined) {
    throw new ProviderError("stream", ERROR_CODES.API_STREAM_ERROR);
  }
  return payload as T;
}
