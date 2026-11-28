import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { open, readFile, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import { createServer as createPipe } from "node:net";
import type { AddressInfo, Server as PipeServer, Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { AppError, encodeErrorCode, ERROR_CODES, extractErrorCode } from "../src/agent-core/errors.ts";
import { logError } from "../src/i18n/errors.ts";
import type { ErrorCode, ParsedErrorCode } from "../src/types/errors.ts";

const LOOPBACK: string = "127.0.0.1";
const ENDPOINT_FILE: string = "endpoint.json";
const STATE_FILE: string = "sessions.json";
const LOCK_FILE: string = "host.lock";
const MAX_BODY_BYTES: number = 32 * 1024 * 1024;
// The running host may come from an older build: endpoint.json is written when
// the host starts, so a descriptor older than this script was spawned from an
// outdated runtime and must be replaced instead of reused.
const RUNTIME_ENTRY: string = fileURLToPath(import.meta.url);

export interface Endpoint {
  port: number;
  token: string;
  pid: number;
}

interface Runtime {
  getState(): unknown;
  action(name: string, args: unknown[]): unknown;
  shutdown(): void | Promise<void>;
  subscribe?(listener: (state: unknown) => void): () => void;
}

export interface RunningHost {
  endpoint: Endpoint;
  reused: boolean;
  publish(state: unknown): void;
  close(): Promise<void>;
}

export function appDataDir(): string {
  const override: string | undefined = process.env.SILVER_DATA_DIR;
  if (override) return resolve(override);
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Silver");
  }
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Silver");
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code : undefined;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export function writePrivateJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary: string = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const fd: number = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value) + "\n", "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function loadState<T = unknown>(dataDir: string = appDataDir()): Promise<T | undefined> {
  return await readJson(join(dataDir, STATE_FILE)) as T | undefined;
}

export function saveStateSync(dataDir: string, value: unknown): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writePrivateJson(join(dataDir, STATE_FILE), value);
}

export async function readEndpoint(dataDir: string = appDataDir()): Promise<Endpoint | undefined> {
  const value: unknown = await readJson(join(dataDir, ENDPOINT_FILE)).catch((): undefined => undefined);
  if (typeof value !== "object" || value === null) return;
  const { port, token, pid }: Partial<Endpoint> = value as Partial<Endpoint>;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535 ||
    typeof token !== "string" || !/^[0-9a-f]{64}$/u.test(token) ||
    typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return;
  return { port, token, pid };
}

export function endpointUrl(endpoint: Endpoint): string {
  return `http://${LOOPBACK}:${endpoint.port}`;
}

async function healthMatches(endpoint: Endpoint): Promise<boolean> {
  try {
    const response: Response = await fetch(`${endpointUrl(endpoint)}/health`, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
      signal: AbortSignal.timeout(600),
      redirect: "error",
    });
    const health: { pid?: number; } | undefined = response.ok ? await response.json() as { pid?: number } : undefined;
    return health?.pid === endpoint.pid;
  } catch {
    return false;
  }
}

async function endpointIsCurrent(dataDir: string): Promise<boolean> {
  const descriptor: Stats | undefined = await stat(join(dataDir, ENDPOINT_FILE)).catch((): undefined => undefined);
  const runtime: Stats | undefined = await stat(RUNTIME_ENTRY).catch((): undefined => undefined);
  if (!descriptor || !runtime) return true;
  return descriptor.mtimeMs >= runtime.mtimeMs;
}

async function retireEndpoint(endpoint: Endpoint): Promise<void> {
  try {
    await fetch(`${endpointUrl(endpoint)}/shutdown`, {
      method: "POST",
      headers: { Authorization: `Bearer ${endpoint.token}` },
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
  } catch {
    // A host that already stopped needs no shutdown request.
  }
  const deadline: number = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await healthMatches(endpoint))) return;
    await delay(50);
  }
}

export async function connectEndpoint(dataDir: string = appDataDir()): Promise<Endpoint | undefined> {
  const endpoint: Endpoint | undefined = await readEndpoint(dataDir);
  if (!endpoint || !(await healthMatches(endpoint))) return;
  if (!(await endpointIsCurrent(dataDir))) {
    await retireEndpoint(endpoint);
    return;
  }
  return endpoint;
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

type HostOwnership = { endpoint: Endpoint } | { release(): Promise<void> };

async function acquireHost(dataDir: string): Promise<HostOwnership> {
  if (process.platform === "win32") {
    // Named-pipe ownership is released by Windows even if the sidecar is killed.
    const id: string = createHash("sha256").update(resolve(dataDir).toLowerCase()).digest("hex");
    const pipeName: string = `\\\\.\\pipe\\silver-cli-${id}`;
    const deadline: number = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const endpoint: Endpoint | undefined = await connectEndpoint(dataDir);
      if (endpoint) return { endpoint };
      const mutex: PipeServer = createPipe((socket: Socket): void => { socket.destroy(); });
      try {
        await new Promise<void>((done: (value: void | PromiseLike<void>) => void, reject: (error: Error) => void): void => {
          mutex.once("error", reject);
          mutex.listen(pipeName, (): void => {
            mutex.off("error", reject);
            done();
          });
        });
        return {
          release: (): Promise<void> => new Promise<void>((done: () => void): void => {
            mutex.close((): void => done());
          }),
        };
      } catch (error) {
        if (errorCode(error) !== "EADDRINUSE") throw error;
        await delay(100);
      }
    }
    throw new AppError(ERROR_CODES.HOST_PUBLISH_FAILED);
  }
  const lockPath: string = join(dataDir, LOCK_FILE);
  const deadline: number = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const existing: Endpoint | undefined = await connectEndpoint(dataDir);
    if (existing) return { endpoint: existing };
    try {
      const owner: FileHandle = await open(lockPath, "wx", 0o600);
      try {
        await owner.writeFile(JSON.stringify({ pid: process.pid }), "utf8");
      } finally {
        await owner.close();
      }
      return { release: (): Promise<void> => unlink(lockPath) };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const owner: { pid?: number; } | undefined = await readJson(lockPath).catch((): undefined => undefined) as { pid?: number } | undefined;
    const ownerPid: number | undefined = owner?.pid;
    const havePid: boolean = typeof ownerPid === "number" && Number.isSafeInteger(ownerPid) && ownerPid > 0;
    const expiredUnwritten: boolean = !havePid && await stat(lockPath).then(
      (info: Stats): boolean => Date.now() - info.mtimeMs > 3000, (): boolean => false
    );
    if ((typeof ownerPid === "number" && havePid && !processExists(ownerPid)) || expiredUnwritten) {
      await unlink(lockPath).catch((error: unknown): void => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    } else {
      await delay(100);
    }
  }
  throw new AppError(ERROR_CODES.HOST_PUBLISH_FAILED);
}

function allowedOrigin(origin: string): boolean {
  return origin === "tauri://localhost" || origin === "http://tauri.localhost" ||
    origin === "https://tauri.localhost" || /^http:\/\/(?:localhost|127\.0\.0\.1):[0-9]{1,5}$/u.test(origin);
}

function authenticated(request: IncomingMessage, token: Buffer): boolean {
  const header: string | undefined = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const value: Buffer<ArrayBuffer> = Buffer.from(header.slice(7), "utf8");
  return token.length === value.length && timingSafeEqual(token, value);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const encoded: string = JSON.stringify(value ?? null);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(encoded);
}

class HttpError extends AppError {
  readonly status: number;

  constructor(status: number, code: ErrorCode) {
    super(code);
    this.name = "HttpError";
    this.status = status;
  }
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, ERROR_CODES.HOST_JSON_REQUIRED);
  }
  if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) {
    throw new HttpError(413, ERROR_CODES.HOST_BODY_TOO_LARGE);
  }
  const chunks: Buffer[] = [];
  let size: number = 0;
  for await (const chunk of request) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array | string);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, ERROR_CODES.HOST_BODY_TOO_LARGE);
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, ERROR_CODES.HOST_JSON_INVALID);
  }
}

interface EventClient {
  response: ServerResponse;
  busy: boolean;
  pending?: string;
}

function sendEvent(client: EventClient, frame: string): void {
  if (client.response.destroyed) return;
  if (client.busy) {
    client.pending = frame;
    return;
  }
  if (client.response.write(frame)) return;
  client.busy = true;
  client.response.once("drain", (): void => {
    client.busy = false;
    const pending: string | undefined = client.pending;
    client.pending = undefined;
    if (pending) sendEvent(client, pending);
  });
}

export async function serve(
  options: { runtime: Runtime; dataDir?: string }
): Promise<RunningHost> {
  const { runtime, dataDir = appDataDir() }: { runtime: Runtime; dataDir?: string; } = options;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const ownership: HostOwnership = await acquireHost(dataDir);
  if ("endpoint" in ownership) {
    return {
      endpoint: ownership.endpoint,
      reused: true,
      publish: (): void => undefined,
      close: (): Promise<void> => Promise.resolve(),
    };
  }
  const release = (): Promise<void> => ownership.release();

  const endpointPath: string = join(dataDir, ENDPOINT_FILE);
  const token: string = randomBytes(32).toString("hex");
  const tokenBytes: Buffer<ArrayBuffer> = Buffer.from(token, "utf8");
  const clients: Set<EventClient> = new Set();
  let endpoint: Endpoint;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let finishing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  function publish(state: unknown): void {
    if (!clients.size) return;
    const frame: string = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) sendEvent(client, frame);
  }

  function beginShutdown(): Promise<void> {
    finishing ??= Promise.resolve().then((): void | Promise<void> => runtime.shutdown()).catch((error: unknown): never => {
      finishing = undefined;
      throw error;
    });
    return finishing;
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const origin: string | undefined = request.headers.origin;
    if (request.socket.remoteAddress !== LOOPBACK ||
      request.headers.host !== `${LOOPBACK}:${endpoint.port}` || (origin && !allowedOrigin(origin))) {
      json(response, 403, { error: ERROR_CODES.HOST_LOCAL_ONLY, code: ERROR_CODES.HOST_LOCAL_ONLY });
      return;
    }
    if (origin) {
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Origin", origin);
    }
    if (request.method === "OPTIONS" && origin) {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      }).end();
      return;
    }
    if (!authenticated(request, tokenBytes)) {
      json(response, 401, { error: ERROR_CODES.HOST_UNAUTHORIZED, code: ERROR_CODES.HOST_UNAUTHORIZED });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      json(response, finishing ? 503 : 200, { pid: process.pid });
    } else if (request.method === "GET" && request.url === "/state") {
      json(response, 200, runtime.getState());
    } else if (request.method === "GET" && request.url === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
      });
      const client: EventClient = { response, busy: false };
      clients.add(client);
      response.on("close", (): boolean => clients.delete(client));
      sendEvent(client, `data: ${JSON.stringify(runtime.getState())}\n\n`);
    } else if (request.method === "POST" && request.url === "/shutdown") {
      await beginShutdown();
      response.once("finish", (): void => { void close().catch((): void => { process.exitCode = 1; }); });
      json(response, 200, { ok: true });
    } else if (request.method === "POST" && request.url === "/action") {
      if (finishing) throw new HttpError(503, ERROR_CODES.HOST_EXITING);
      const body: unknown = await jsonBody(request);
      if (typeof body !== "object" || body === null || !("name" in body) || !("args" in body) ||
        typeof body.name !== "string" || !/^[\w.:-]{1,128}$/u.test(body.name) || !Array.isArray(body.args)) {
        throw new HttpError(400, ERROR_CODES.HOST_ACTION_FORMAT_INVALID);
      }
      if (finishing) throw new HttpError(503, ERROR_CODES.HOST_EXITING);
      json(response, 200, await runtime.action(body.name, body.args));
    } else {
      json(response, 404, { error: ERROR_CODES.HOST_ROUTE_NOT_FOUND, code: ERROR_CODES.HOST_ROUTE_NOT_FOUND });
    }
  }

  const server: HttpServer = createServer((request: IncomingMessage, response: ServerResponse<IncomingMessage> & { req: IncomingMessage; }): void => {
    void handle(request, response).catch((error: unknown): void => {
      if (response.headersSent || response.destroyed) {
        response.end();
        return;
      }
      const parsed: ParsedErrorCode = extractErrorCode(error, ERROR_CODES.HOST_EXECUTION_FAILED);
      const status: number = error instanceof HttpError ? error.status : 500;
      if (status >= 500) logError(error, undefined, ERROR_CODES.HOST_EXECUTION_FAILED);
      json(response, status, {
        error: encodeErrorCode(parsed.code, parsed.params),
        code: parsed.code,
        ...(parsed.params ? { params: parsed.params } : {}),
      });
    });
  });

  function close(): Promise<void> {
    closing ??= (async (): Promise<undefined> => {
      try {
        await beginShutdown();
      } finally {
        clearInterval(heartbeat);
        unsubscribe?.();
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        for (const { response } of clients) response.end();
        await new Promise<void>((done: (value: void | PromiseLike<void>) => void): void => {
          server.close((): void => done());
          server.closeAllConnections();
        });
        try {
          rmSync(endpointPath, { force: true });
        } finally {
          await release();
        }
      }
    })();
    return closing;
  }

  function onSignal(): void {
    void close().catch((): void => { process.exitCode = 1; });
  }

  try {
    await new Promise<void>((done: (value: void | PromiseLike<void>) => void, reject: (error: Error) => void): void => {
      server.once("error", reject);
      server.listen(0, LOOPBACK, (): void => {
        server.off("error", reject);
        done();
      });
    });
    const address: string | AddressInfo | null = server.address();
    if (!address || typeof address === "string") throw new AppError(ERROR_CODES.HOST_PORT_UNAVAILABLE);
    endpoint = { port: address.port, token, pid: process.pid };
    writePrivateJson(endpointPath, endpoint);
    unsubscribe = runtime.subscribe?.(publish);
    heartbeat = setInterval((): void => {
      for (const client of clients) if (!client.busy) sendEvent(client, ": silver\n\n");
    }, 15_000);
    heartbeat.unref();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    return { endpoint, reused: false, publish, close };
  } catch (error) {
    await close();
    throw error;
  }
}
