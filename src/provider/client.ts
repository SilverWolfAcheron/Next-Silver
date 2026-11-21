export interface ChatInput {
  model: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  signal?: AbortSignal;
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

export class ProviderError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(status === undefined ? message : `HTTP ${status} · ${message}`);
    this.name = "ProviderError";
  }
}

export function describeProviderError(error: unknown): string {
  return error instanceof ProviderError ? error.message : "供应商请求失败，请重试。";
}

export function providerAddress(value: string | undefined): URL {
  const message = "请输入有效的 HTTP 或 HTTPS 供应商地址。";
  let address: URL;
  try {
    address = new URL(value?.trim() ?? "");
  } catch {
    throw new ProviderError("configuration", message);
  }
  if (
    !["http:", "https:"].includes(address.protocol) ||
    address.username || address.password || address.search || address.hash
  ) {
    throw new ProviderError("configuration", message);
  }
  return address;
}

export function endpoint(base: URL, version: string, resource: string): URL {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = `${path.endsWith(`/${version}`) ? path : `${path}/${version}`}/${resource}`;
  return url;
}

export function requireKey(key: string): string {
  if (!key.trim()) throw new ProviderError("configuration", "请填写供应商密钥。");
  return key.trim();
}

export function requireModel(model: string): string {
  if (!model.trim()) throw new ProviderError("configuration", "请选择供应商模型。");
  return model.trim();
}

function httpReason(status: number): string {
  switch (status) {
    case 400: return "供应商拒绝了请求，请核对模型或地址。";
    case 401: return "验证失败，请检查密钥。";
    case 403: return "当前密钥无权执行此请求。";
    case 404: return "找不到接口或模型，请核对地址和模型。";
    case 429: return "供应商限制了请求频率或额度。";
    default:
      return status >= 500 ? "供应商暂时不可用，请稍后重试。" : "供应商拒绝了此请求。";
  }
}

export async function request(url: URL, options: RequestInit): Promise<Response> {
  options.signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { ...options, credentials: "omit", redirect: "error" });
  } catch {
    options.signal?.throwIfAborted();
    throw new ProviderError("network", "无法连接供应商，请检查地址、网络和跨域设置。");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderError("http", httpReason(response.status), response.status);
  }
  return response;
}

export async function readModelPage<T>(response: Response, signal?: AbortSignal): Promise<T> {
  let page: unknown;
  try {
    page = await response.json();
  } catch {
    signal?.throwIfAborted();
  }
  if (typeof page !== "object" || page === null || Array.isArray(page) || "error" in page) {
    invalidModelList();
  }
  return page as T;
}

export function modelNames(values: unknown[], key: string): string[] {
  return [...new Set(values.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0 && value !== key,
  ))];
}

export function invalidModelList(): never {
  throw new ProviderError("response", "供应商返回的模型列表格式有误。");
}

interface ServerEvent {
  type: string;
  data: string;
}

export async function* streamEvents(response: Response, signal?: AbortSignal): AsyncIterable<ServerEvent> {
  if (!response.body) {
    throw new ProviderError("response", "供应商没有返回回复流。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let type = "";
  let done = false;
  try {
    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      buffer += decoder.decode(chunk.value, { stream: !done });
      const lines = buffer.split(/\r\n|\r(?!$)|\n/);
      buffer = lines.pop() ?? "";
      if (done) lines.push(buffer.replace(/\r$/, ""), "");

      for (const line of lines) {
        if (!line) {
          if (data.length) yield { type, data: data.join("\n") };
          data = [];
          type = "";
          continue;
        }
        const separator = line.indexOf(":");
        const field = separator < 0 ? line : line.slice(0, separator);
        const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
        if (field === "data") data.push(value);
        if (field === "event") type = value;
      }
    }
  } catch {
    signal?.throwIfAborted();
    throw interruptedStream();
  } finally {
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function interruptedStream() {
  return new ProviderError("stream", "供应商回复中断，可以重试。");
}

export function readStreamEvent<T>(event: ServerEvent): T {
  if (event.type === "error") {
    throw new ProviderError("stream", "供应商在生成回复时返回了错误，可以重试。");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    throw new ProviderError("response", "供应商返回的回复格式有误。");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ProviderError("response", "供应商返回的回复格式有误。");
  }
  if ("error" in payload && payload.error != null) {
    throw new ProviderError("stream", "供应商在生成回复时返回了错误，可以重试。");
  }
  return payload as T;
}
