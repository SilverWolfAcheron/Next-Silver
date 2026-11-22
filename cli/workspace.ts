import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { constants, readFileSync } from "node:fs";
import type { BigIntStats, Dirent, Stats } from "node:fs";
import {
  access, copyFile, link, lstat, mkdir, open, readdir, realpath, rename, unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDiffPath } from "../src/agent-core/diff.ts";
import { AppError, ERROR_CODES, serializeErrorCode } from "../src/agent-core/errors.ts";
import type { AppErrorOptions, ErrorCode } from "../src/types/errors.ts";
import type { WorkspaceEntry, WorkspaceSummary, WorkspaceTextMatch } from "../src/agent-core/types.ts";
import { appDataDir, writePrivateJson } from "./host.ts";

export type { WorkspaceEntry, WorkspaceSummary, WorkspaceTextMatch };

const MAX_TEXT_BYTES: number = 1024 * 1024;
const SEARCH_FILE_BYTES: number = 256 * 1024;
const WORKSPACES_FILE: string = "workspaces.json";
const dataChanges: EventEmitter = new EventEmitter();
const writes: Map<string, Promise<unknown>> = new Map();

interface Binding extends WorkspaceSummary {
  root: string;
  device: string;
  inode: string;
}

export class WorkspaceAccessError extends AppError {
  readonly reason: "permission" | "unavailable";

  constructor(reason: "permission" | "unavailable", code: ErrorCode, options?: AppErrorOptions) {
    super(code, options);
    this.name = "WorkspaceAccessError";
    this.reason = reason;
  }
}

class MissingParent extends AppError {
  constructor() {
    super(ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
    this.name = "MissingParent";
  }
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
}

function within(root: string, path: string): boolean {
  const remaining: string = relative(pathKey(root), pathKey(path));
  return remaining === "" || (remaining !== ".." && !remaining.startsWith(`..${sep}`) && !isAbsolute(remaining));
}

export function splitWorkspacePath(path: string): string[] {
  if (typeof path !== "string" || !isDiffPath(path) ||
    path.split("/").some((piece: string): boolean => /^(?:CONIN|CONOUT)\$(?:\.|$)/iu.test(piece))) {
    throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
  }
  return path.split("/");
}

function safePart(part: string): boolean {
  try {
    return splitWorkspacePath(part).length === 1;
  } catch {
    return false;
  }
}

function readRegistry(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
}

function isBinding(value: unknown): value is Binding {
  if (typeof value !== "object" || value === null) return false;
  const item: Partial<Binding> = value;
  return typeof item.id === "string" && typeof item.name === "string" &&
    typeof item.root === "string" && isAbsolute(item.root) &&
    typeof item.device === "string" && typeof item.inode === "string";
}

function loadBindings(dataDir: string): Binding[] {
  const stored: unknown = readRegistry(join(dataDir, WORKSPACES_FILE));
  return Array.isArray(stored) ? stored.filter(isBinding) : [];
}

function findBinding(id: string, dataDir: string): Binding | undefined {
  if (/^[a-f0-9]{64}$/u.test(id)) {
    const item: unknown = readRegistry(join(dataDir, "workspaces", id + ".json"));
    if (isBinding(item) && item.id === id) return item;
  }
  return loadBindings(dataDir).find((entry: Binding): boolean => entry.id === id);
}

export async function bindWorkspace(path: string, dataDir: string = appDataDir()): Promise<WorkspaceSummary> {
  if (typeof path !== "string" || !isAbsolute(path)) throw new AppError(ERROR_CODES.WORKSPACE_ABSOLUTE_PATH_REQUIRED);
  const root: string = await realpath(path);
  if (within(resolve(dataDir), root)) throw new AppError(ERROR_CODES.WORKSPACE_DATA_DIR_FORBIDDEN);
  const info: BigIntStats = await lstat(root, { bigint: true });
  if (!info.isDirectory()) throw new AppError(ERROR_CODES.WORKSPACE_NOT_DIRECTORY);
  const device: string = String(info.dev);
  const inode: string = String(info.ino);
  const bindings: Binding[] = loadBindings(dataDir);
  const existing: Binding | undefined = bindings.find((item: Binding): boolean =>
    pathKey(item.root) === pathKey(root) && item.device === device && item.inode === inode);
  if (existing) return { id: existing.id, name: existing.name, path: root };
  const id: string = createHash("sha256").update(JSON.stringify([pathKey(root), device, inode])).digest("hex");
  const name: string = basename(root) || root;
  // Bindings are independent files so standalone checks and an active host cannot overwrite one another.
  writePrivateJson(join(dataDir, "workspaces", id + ".json"), { id, name, root, device, inode });
  return { id, name, path: root };
}

async function verifyBinding(binding: Binding): Promise<string> {
  try {
    const resolved: string = await realpath(binding.root);
    const info: BigIntStats = await lstat(resolved, { bigint: true });
    if (pathKey(resolved) !== pathKey(binding.root) || !info.isDirectory() ||
      String(info.dev) !== binding.device || String(info.ino) !== binding.inode) {
      throw new AppError(ERROR_CODES.WORKSPACE_UNAVAILABLE);
    }
    return resolved;
  } catch (error) {
    if (errno(error) === "EACCES" || errno(error) === "EPERM") {
      throw new WorkspaceAccessError("permission", ERROR_CODES.WORKSPACE_PERMISSION_DENIED, { cause: error });
    }
    throw new WorkspaceAccessError("unavailable", ERROR_CODES.WORKSPACE_UNAVAILABLE, { cause: error });
  }
}

export async function lookupWorkspace(id: string, dataDir: string = appDataDir()): Promise<WorkspaceSummary & { path: string }> {
  const binding: Binding | undefined = findBinding(id, dataDir);
  if (!binding) throw new WorkspaceAccessError("unavailable", ERROR_CODES.WORKSPACE_NOT_FOUND);
  return { id: binding.id, name: binding.name, path: await verifyBinding(binding) };
}

export async function workspaceRoot(workspace: WorkspaceSummary, dataDir: string = appDataDir()): Promise<string> {
  const binding: WorkspaceSummary & { path: string; } = await lookupWorkspace(workspace?.id, dataDir);
  if (binding.name !== workspace?.name) throw new WorkspaceAccessError("unavailable", ERROR_CODES.WORKSPACE_NOT_FOUND);
  return binding.path;
}

export async function requestWorkspaceAccess(workspace: WorkspaceSummary): Promise<void> {
  await access(await workspaceRoot(workspace), constants.R_OK);
}

export async function requestWorkspaceWriteAccess(workspace: WorkspaceSummary): Promise<void> {
  await access(await workspaceRoot(workspace), constants.R_OK | constants.W_OK);
}

export function subscribeWorkspaceChanges(workspace: WorkspaceSummary, listener: () => void): () => void {
  dataChanges.on(workspace.id, listener);
  return (): void => {
    dataChanges.off(workspace.id, listener);
  };
}

function forbidEscape(root: string, path: string): void {
  if (!within(root, path) || within(resolve(appDataDir()), path)) {
    throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
  }
}

async function resolveDirectory(root: string, parts: string[], create: boolean = false): Promise<string> {
  let current: string = root;
  for (const part of parts) {
    const next: string = join(current, part);
    forbidEscape(root, next);
    const inspected: Stats | undefined = await lstat(next).catch((error: unknown): undefined => {
      if (errno(error) === "ENOENT") return undefined;
      throw error;
    });
    if (!inspected) {
      if (!create) throw new MissingParent();
      await mkdir(next).catch((error: unknown): void => {
        if (errno(error) !== "EEXIST") throw error;
      });
    }
    const info: Stats = inspected ?? await lstat(next);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
    const resolved: string = await realpath(next);
    forbidEscape(root, resolved);
    if (pathKey(resolved) !== pathKey(next)) throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
    current = resolved;
  }
  return current;
}

async function readTarget(path: string, limit: number = MAX_TEXT_BYTES): Promise<string | null> {
  const initial: Stats | undefined = await lstat(path).catch((error: unknown): undefined => {
    if (errno(error) === "ENOENT") return undefined;
    throw error;
  });
  if (!initial) return null;
  if (!initial.isFile() || initial.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_NOT_REGULAR_FILE);
  if (pathKey(await realpath(path)) !== pathKey(path)) throw new AppError(ERROR_CODES.WORKSPACE_CASE_MISMATCH);
  const handle: FileHandle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info: Stats = await handle.stat();
    if (!info.isFile() || info.ino !== initial.ino || info.dev !== initial.dev) throw changedFile();
    if (info.size > limit) throw new AppError(ERROR_CODES.WORKSPACE_FILE_TOO_LARGE);
    const bytes: Buffer = await handle.readFile();
    if (bytes.byteLength > limit) throw new AppError(ERROR_CODES.WORKSPACE_FILE_TOO_LARGE);
    try {
      const text: string = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes("\0")) throw new AppError(ERROR_CODES.WORKSPACE_NOT_UTF8);
      return text;
    } catch {
      throw new AppError(ERROR_CODES.WORKSPACE_NOT_UTF8);
    }
  } finally {
    await handle.close();
  }
}

async function containedFile(root: string, path: string, createParents: boolean = false): Promise<string> {
  const parts: string[] = splitWorkspacePath(path);
  const file: string = join(await resolveDirectory(root, parts.slice(0, -1), createParents), parts[parts.length - 1]);
  forbidEscape(root, file);
  return file;
}

export async function listWorkspace(workspace: WorkspaceSummary, path: string = ""): Promise<WorkspaceEntry[]> {
  const root: string = await workspaceRoot(workspace);
  const full: string = await resolveDirectory(root, path ? splitWorkspacePath(path) : []);
  return (await readdir(full, { withFileTypes: true })).flatMap((entry: Dirent<string>): WorkspaceEntry[] => {
    if ((!entry.isDirectory() && !entry.isFile()) || entry.isSymbolicLink() || !safePart(entry.name)) return [];
    if (within(resolve(appDataDir()), join(full, entry.name))) return [];
    return [{ path: path ? `${path}/${entry.name}` : entry.name, name: entry.name, kind: entry.isDirectory() ? "directory" : "file" }];
  }).sort((a: WorkspaceEntry, b: WorkspaceEntry): number => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
}

export async function readWorkspaceFileIfExists(
  workspace: WorkspaceSummary, path: string, options?: { allowMissingParent?: boolean }
): Promise<string | null> {
  const root: string = await workspaceRoot(workspace);
  try {
    return await readTarget(await containedFile(root, path));
  } catch (error) {
    if (options?.allowMissingParent && error instanceof MissingParent) return null;
    throw error;
  }
}

export async function readWorkspaceFile(workspace: WorkspaceSummary, path: string): Promise<string> {
  const content: string | null = await readWorkspaceFileIfExists(workspace, path);
  if (content === null) throw new WorkspaceAccessError("unavailable", ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
  return content;
}

function changedFile(): AppError {
  return new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
}

async function serializeWrite<T>(root: string, write: () => Promise<T>): Promise<T> {
  const key: string = pathKey(root);
  const previous: Promise<unknown> | undefined = writes.get(key);
  const pending: Promise<T> = Promise.resolve(previous).catch((): undefined => undefined).then(write);
  writes.set(key, pending);
  try {
    return await pending;
  } finally {
    if (writes.get(key) === pending) writes.delete(key);
  }
}

interface ReplaceFileOptions {
  root: string;
  path: string;
  after: string | null;
  expectedBefore: string | null;
}

export interface WriteWorkspaceFileOptions {
  path: string;
  after: string | null;
  expectedBefore: string | null;
}

export interface SearchWorkspaceOptions {
  limit?: number;
  signal?: AbortSignal;
}

async function replaceFile(options: ReplaceFileOptions): Promise<void> {
  const { root, path, after, expectedBefore }: ReplaceFileOptions = options;
  const target: string = await containedFile(root, path, after !== null && expectedBefore === null);
  const current: string | null = await readTarget(target);
  if (current !== expectedBefore) throw changedFile();
  if (current === after) return;
  if (after === null) {
    if (await containedFile(root, path) !== target || await readTarget(target) !== expectedBefore) throw changedFile();
    await unlink(target);
    return;
  }
  if (after.includes("\0") || Buffer.byteLength(after) > MAX_TEXT_BYTES) {
    throw new AppError(ERROR_CODES.WORKSPACE_WRITE_INVALID);
  }
  const mode: number = current === null ? 0o666 : (await lstat(target)).mode & 0o777;
  const temp: string = join(dirname(target), `.silver-${randomUUID()}.tmp`);
  try {
    const handle: FileHandle = await open(temp, "wx", mode);
    try {
      await handle.writeFile(after, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (await containedFile(root, path) !== target || await readTarget(target) !== expectedBefore) throw changedFile();
    if (current === null) {
      try {
        await link(temp, target);
      } catch (error) {
        if (errno(error) === "EEXIST") throw changedFile();
        if (!["EPERM", "ENOTSUP", "EXDEV", "ENOSYS"].includes(errno(error) ?? "")) throw error;
        await copyFile(temp, target, constants.COPYFILE_EXCL);
      }
    } else {
      await rename(temp, target);
    }
  } finally {
    await unlink(temp).catch((): undefined => undefined);
  }
}

export async function writeWorkspaceFile(
  workspace: WorkspaceSummary,
  options: WriteWorkspaceFileOptions
): Promise<void> {
  const { path, after, expectedBefore }: WriteWorkspaceFileOptions = options;
  if ((after !== null && typeof after !== "string") || (expectedBefore !== null && typeof expectedBefore !== "string")) {
    throw new AppError(ERROR_CODES.WORKSPACE_TEXT_CONTENT_REQUIRED);
  }
  const root: string = await workspaceRoot(workspace);
  await serializeWrite(root, (): Promise<void> => replaceFile({ root, path, after, expectedBefore }));
  dataChanges.emit(workspace.id);
}

export async function exportWorkspaceDocument(workspace: WorkspaceSummary, filename: string, body: string): Promise<string> {
  if (!safePart(filename) || !filename.toLowerCase().endsWith(".md")) {
    throw new AppError(ERROR_CODES.WORKSPACE_MARKDOWN_FILENAME_REQUIRED);
  }
  const root: string = await workspaceRoot(workspace);
  const path: string = await serializeWrite(root, async (): Promise<string> => {
    const folder: string = await resolveDirectory(root, ["silver"], true);
    const entries: Set<string> = new Set((await readdir(folder)).map(pathKey));
    let name: string = filename;
    let index: number = 2;
    while (entries.has(pathKey(name))) name = `${filename.slice(0, -3)}-${index++}.md`;
    const entry: string = `silver/${name}`;
    await replaceFile({ root, path: entry, after: body, expectedBefore: null });
    return entry;
  });
  dataChanges.emit(workspace.id);
  return path;
}

async function* walkFiles(root: string, signal?: AbortSignal): AsyncGenerator<WorkspaceEntry> {
  const pending: string[] = [""];
  const skipped: Set<string> = new Set([".git", "node_modules"]);
  for (const path of pending) {
    signal?.throwIfAborted();
    const directory: string = await resolveDirectory(root, path ? splitWorkspacePath(path) : []);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const next: string = path ? `${path}/${entry.name}` : entry.name;
      if (!safePart(entry.name) || entry.isSymbolicLink() || within(resolve(appDataDir()), join(directory, entry.name))) continue;
      if (entry.isDirectory() && !skipped.has(entry.name)) pending.push(next);
      if (entry.isFile()) yield { path: next, name: entry.name, kind: "file" as const };
    }
  }
}

function safeLimit(limit: number, maximum: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.min(maximum, Math.floor(limit))) : maximum;
}

export async function searchWorkspaceFiles(
  workspace: WorkspaceSummary,
  query: string,
  options?: SearchWorkspaceOptions
): Promise<WorkspaceEntry[]> {
  const limit: number = options?.limit ?? 48;
  const signal: AbortSignal | undefined = options?.signal;
  const maximum: number = safeLimit(limit, 200);
  if (!maximum) return [];
  const root: string = await workspaceRoot(workspace);
  const matches: WorkspaceEntry[] = [];
  const needle: string = query.trim().toLocaleLowerCase();
  for await (const entry of walkFiles(root, signal)) {
    if (entry.path.toLocaleLowerCase().includes(needle)) matches.push(entry);
    if (matches.length >= maximum) break;
  }
  return matches;
}

export async function searchWorkspaceText(
  workspace: WorkspaceSummary,
  query: string,
  options?: SearchWorkspaceOptions
): Promise<WorkspaceTextMatch[]> {
  const limit: number = options?.limit ?? 30;
  const signal: AbortSignal | undefined = options?.signal;
  const matches: WorkspaceTextMatch[] = [];
  const needle: string = query.trim().toLocaleLowerCase();
  const maximum: number = safeLimit(limit, 200);
  if (!needle || !maximum) return matches;
  const root: string = await workspaceRoot(workspace);
  for await (const entry of walkFiles(root, signal)) {
    const text: string | null = await containedFile(root, entry.path)
      .then((path: string): Promise<string | null> => readTarget(path, SEARCH_FILE_BYTES))
      .catch((): null => null);
    if (text === null) continue;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const offset: number = line.toLocaleLowerCase().indexOf(needle);
      if (offset >= 0) {
        const start: number = Math.max(0, offset - 100);
        matches.push({ path: entry.path, line: index + 1, text: line.slice(start, start + 300) });
      }
      if (matches.length >= maximum) return matches;
    }
  }
  return matches;
}

export function workspaceErrorText(error: unknown): string {
  switch (errno(error)) {
    case "ENOENT": return ERROR_CODES.WORKSPACE_FILE_NOT_FOUND;
    case "EACCES":
    case "EPERM": return ERROR_CODES.WORKSPACE_PERMISSION_DENIED;
    case "ENOTDIR":
    case "EISDIR": return ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN;
    default:
      return serializeErrorCode(error, ERROR_CODES.WORKSPACE_ACCESS_FAILED);
  }
}
