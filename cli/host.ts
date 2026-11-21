import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createPipe } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOOPBACK = "127.0.0.1";
const ENDPOINT_FILE = "endpoint.json";
const STATE_FILE = "sessions.json";
const LOCK_FILE = "host.lock";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface Endpoint {
  port: number;
  token: string;
  pid: number;
}

interface Runtime {
  getState(): unknown;
  action(name: string, args: unknown[]): unknown | Promise<unknown>;
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
  const override = process.env.SILVER_DATA_DIR;
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

export function writePrivateJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const fd = openSync(temporary, "wx", 0o600);
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

export async function loadState<T = unknown>(dataDir = appDataDir()): Promise<T | undefined> {
  return await readJson(join(dataDir, STATE_FILE)) as T | undefined;
}

export function saveStateSync(dataDir: string, value: unknown): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writePrivateJson(join(dataDir, STATE_FILE), value);
}

export async function saveState(dataDir: string, value: unknown): Promise<void> {
  saveStateSync(dataDir, value);
}

export async function readEndpoint(dataDir = appDataDir()): Promise<Endpoint | undefined> {
  const value = await readJson(join(dataDir, ENDPOINT_FILE)).catch(() => undefined);
  if (typeof value !== "object" || value === null) return;
  const { port, token, pid } = value as Partial<Endpoint>;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535 ||
    typeof token !== "string" || !/^[0-9a-f]{64}$/u.test(token) ||
    typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return;
  return { port, token, pid };
}

export function endpointUrl(endpoint: Endpoint): string {
  return `http://${LOOPBACK}:${endpoint.port}`;
}

export async function connectEndpoint(dataDir = appDataDir()): Promise<Endpoint | undefined> {
  const endpoint = await readEndpoint(dataDir);
  if (!endpoint) return;
  try {
    const response = await fetch(`${endpointUrl(endpoint)}/health`, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
      signal: AbortSignal.timeout(600),
      redirect: "error",
    });
    const health = response.ok ? await response.json() as { pid?: number } : undefined;
    if (health?.pid === endpoint.pid) return endpoint;
  } catch {
    // A closed or incomplete host descriptor can be replaced by the next owner.
  }
}

function processExists(processId: number) {
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
    const id = createHash("sha256").update(resolve(dataDir).toLowerCase()).digest("hex");
    const pipeName = `\\\\.\\pipe\\silver-cli-${id}`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const endpoint = await connectEndpoint(dataDir);
      if (endpoint) return { endpoint };
      const mutex = createPipe((socket) => { socket.destroy(); });
      try {
        await new Promise<void>((done, reject) => {
          mutex.once("error", reject);
          mutex.listen(pipeName, () => {
            mutex.off("error", reject);
            done();
          });
        });
        return { release: () => new Promise<void>((done) => mutex.close(() => done())) };
      } catch (error) {
        if (errorCode(error) !== "EADDRINUSE") throw error;
        await delay(100);
      }
    }
    throw new Error("Silver CLI 未能发布本机连接。请退出已有实例后重试。");
  }
  const lockPath = join(dataDir, LOCK_FILE);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const existing = await connectEndpoint(dataDir);
    if (existing) return { endpoint: existing };
    try {
      const owner = await open(lockPath, "wx", 0o600);
      try {
        await owner.writeFile(JSON.stringify({ pid: process.pid }), "utf8");
      } finally {
        await owner.close();
      }
      return { release: () => unlink(lockPath) };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const owner = await readJson(lockPath).catch(() => undefined) as { pid?: number } | undefined;
    const ownerPid = owner?.pid;
    const havePid = typeof ownerPid === "number" && Number.isSafeInteger(ownerPid) && ownerPid > 0;
    const expiredUnwritten = !havePid && await stat(lockPath).then(
      (info) => Date.now() - info.mtimeMs > 3000, () => false,
    );
    if ((havePid && !processExists(ownerPid)) || expiredUnwritten) {
      await unlink(lockPath).catch((error: unknown) => {
        if (errorCode(error) !== "ENOENT") throw error;
      });
    } else {
      await delay(100);
    }
  }
  throw new Error("Silver CLI 未能发布本机连接。请退出已有实例后重试。");
}

function allowedOrigin(origin: string) {
  return origin === "tauri://localhost" || origin === "http://tauri.localhost" ||
    origin === "https://tauri.localhost" || /^http:\/\/(?:localhost|127\.0\.0\.1):[0-9]{1,5}$/u.test(origin);
}

function authenticated(request: IncomingMessage, token: Buffer) {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const value = Buffer.from(header.slice(7), "utf8");
  return token.length === value.length && timingSafeEqual(token, value);
}

function json(response: ServerResponse, status: number, value: unknown) {
  const encoded = JSON.stringify(value ?? null);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(encoded);
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "请求正文必须为 JSON。");
  }
  if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) throw new HttpError(413, "请求正文过大。");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "请求正文过大。");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "请求 JSON 无法读取。");
  }
}

interface EventClient {
  response: ServerResponse;
  busy: boolean;
  pending?: string;
}

function sendEvent(client: EventClient, frame: string) {
  if (client.response.destroyed) return;
  if (client.busy) {
    client.pending = frame;
    return;
  }
  if (client.response.write(frame)) return;
  client.busy = true;
  client.response.once("drain", () => {
    client.busy = false;
    const pending = client.pending;
    client.pending = undefined;
    if (pending) sendEvent(client, pending);
  });
}

export async function serve(
  options: { runtime: Runtime; dataDir?: string },
): Promise<RunningHost> {
  const { runtime, dataDir = appDataDir() } = options;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const ownership = await acquireHost(dataDir);
  if ("endpoint" in ownership) return { endpoint: ownership.endpoint, reused: true, publish() {}, async close() {} };
  const { release } = ownership;

  const endpointPath = join(dataDir, ENDPOINT_FILE);
  const token = randomBytes(32).toString("hex");
  const tokenBytes = Buffer.from(token, "utf8");
  const clients = new Set<EventClient>();
  let endpoint: Endpoint;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let finishing: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  function publish(state: unknown) {
    if (!clients.size) return;
    const frame = `data: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) sendEvent(client, frame);
  }

  function beginShutdown() {
    finishing ??= Promise.resolve().then(() => runtime.shutdown()).catch((error: unknown) => {
      finishing = undefined;
      throw error;
    });
    return finishing;
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const origin = request.headers.origin;
    if (request.socket.remoteAddress !== LOOPBACK ||
      request.headers.host !== `${LOOPBACK}:${endpoint.port}` || (origin && !allowedOrigin(origin))) {
      json(response, 403, { error: "只接受 Silver 桌面窗口的本机连接。" });
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
      json(response, 401, { error: "Silver CLI 鉴权失败。" });
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
      response.on("close", () => clients.delete(client));
      sendEvent(client, `data: ${JSON.stringify(runtime.getState())}\n\n`);
    } else if (request.method === "POST" && request.url === "/shutdown") {
      await beginShutdown();
      response.once("finish", () => { void close().catch(() => { process.exitCode = 1; }); });
      json(response, 200, { ok: true });
    } else if (request.method === "POST" && request.url === "/action") {
      if (finishing) throw new HttpError(503, "Silver CLI 正在退出。");
      const body = await jsonBody(request);
      if (typeof body !== "object" || body === null || !("name" in body) || !("args" in body) ||
        typeof body.name !== "string" || !/^[\w.:-]{1,128}$/u.test(body.name) || !Array.isArray(body.args)) {
        throw new HttpError(400, "CLI 动作格式无效。");
      }
      if (finishing) throw new HttpError(503, "Silver CLI 正在退出。");
      json(response, 200, await runtime.action(body.name, body.args));
    } else {
      json(response, 404, { error: "CLI 路径不存在。" });
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent || response.destroyed) {
        response.end();
        return;
      }
      json(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof Error ? error.message : "本机 CLI 执行失败。",
      });
    });
  });

  function close(): Promise<void> {
    closing ??= (async () => {
      try {
        await beginShutdown();
      } finally {
        clearInterval(heartbeat);
        unsubscribe?.();
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        for (const { response } of clients) response.end();
        await new Promise<void>((done) => {
          server.close(() => done());
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

  function onSignal() {
    void close().catch(() => { process.exitCode = 1; });
  }

  try {
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK, () => {
        server.off("error", reject);
        done();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无法获取 Silver CLI 端口。");
    endpoint = { port: address.port, token, pid: process.pid };
    writePrivateJson(endpointPath, endpoint);
    unsubscribe = runtime.subscribe?.(publish);
    heartbeat = setInterval(() => {
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
