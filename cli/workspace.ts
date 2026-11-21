import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { constants, readFileSync } from "node:fs";
import {
  access, copyFile, link, lstat, mkdir, open, readdir, realpath, rename, unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDiffPath } from "../src/model/diff.ts";
import type { WorkspaceEntry, WorkspaceSummary, WorkspaceTextMatch } from "../src/model/workspace.ts";
import { appDataDir, writePrivateJson } from "./host.ts";

export type { WorkspaceEntry, WorkspaceSummary, WorkspaceTextMatch };

const MAX_TEXT_BYTES = 1024 * 1024;
const SEARCH_FILE_BYTES = 256 * 1024;
const WORKSPACES_FILE = "workspaces.json";
const dataChanges = new EventEmitter();
const writes = new Map<string, Promise<unknown>>();

interface Binding extends WorkspaceSummary {
  root: string;
  device: string;
  inode: string;
}

export class WorkspaceAccessError extends Error {
  readonly reason: "permission" | "unavailable";

  constructor(reason: "permission" | "unavailable", message: string) {
    super(message);
    this.reason = reason;
  }
}

class MissingParent extends Error {
  constructor() {
    super("工作区缺少父目录。");
  }
}

function errno(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
}

function within(root: string, path: string) {
  const remaining = relative(pathKey(root), pathKey(path));
  return remaining === "" || (remaining !== ".." && !remaining.startsWith(`..${sep}`) && !isAbsolute(remaining));
}

export function splitWorkspacePath(path: string): string[] {
  if (typeof path !== "string" || !isDiffPath(path) ||
    path.split("/").some((piece) => /^(?:CONIN|CONOUT)\$(?:\.|$)/iu.test(piece))) {
    throw new Error("路径必须指向工作区中的文件或目录。");
  }
  return path.split("/");
}

function safePart(part: string) {
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
  const item = value as Partial<Binding>;
  return typeof item.id === "string" && typeof item.name === "string" &&
    typeof item.root === "string" && isAbsolute(item.root) &&
    typeof item.device === "string" && typeof item.inode === "string";
}

function loadBindings(dataDir: string): Binding[] {
  const stored = readRegistry(join(dataDir, WORKSPACES_FILE));
  return Array.isArray(stored) ? stored.filter(isBinding) : [];
}

function findBinding(id: string, dataDir: string): Binding | undefined {
  if (/^[a-f0-9]{64}$/u.test(id)) {
    const item = readRegistry(join(dataDir, "workspaces", id + ".json"));
    if (isBinding(item) && item.id === id) return item;
  }
  return loadBindings(dataDir).find((entry) => entry.id === id);
}

export async function bindWorkspace(path: string, dataDir = appDataDir()): Promise<WorkspaceSummary> {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("请提供本机文件夹的绝对路径。");
  const root = await realpath(path);
  if (within(resolve(dataDir), root)) throw new Error("Silver 的本机数据目录不能作为工作区。");
  const info = await lstat(root, { bigint: true });
  if (!info.isDirectory()) throw new Error("所选路径不是文件夹。");
  const device = String(info.dev);
  const inode = String(info.ino);
  const bindings = loadBindings(dataDir);
  const existing = bindings.find((item) =>
    pathKey(item.root) === pathKey(root) && item.device === device && item.inode === inode);
  if (existing) return { id: existing.id, name: existing.name, path: root };
  const id = createHash("sha256").update(JSON.stringify([pathKey(root), device, inode])).digest("hex");
  const name = basename(root) || root;
  // Bindings are independent files so standalone checks and an active host cannot overwrite one another.
  writePrivateJson(join(dataDir, "workspaces", id + ".json"), { id, name, root, device, inode });
  return { id, name, path: root };
}

async function verifyBinding(binding: Binding): Promise<string> {
  try {
    const resolved = await realpath(binding.root);
    const info = await lstat(resolved, { bigint: true });
    if (pathKey(resolved) !== pathKey(binding.root) || !info.isDirectory() ||
      String(info.dev) !== binding.device || String(info.ino) !== binding.inode) {
      throw new Error("The bound directory changed.");
    }
    return resolved;
  } catch (error) {
    if (errno(error) === "EACCES" || errno(error) === "EPERM") {
      throw new WorkspaceAccessError("permission", "没有权限打开工作区文件夹。");
    }
    throw new WorkspaceAccessError("unavailable", "工作区文件夹已移动、替换或删除，请重新打开。");
  }
}

export async function lookupWorkspace(id: string, dataDir = appDataDir()): Promise<WorkspaceSummary & { path: string }> {
  const binding = findBinding(id, dataDir);
  if (!binding) throw new WorkspaceAccessError("unavailable", "找不到保存的文件夹，请重新打开。");
  return { id: binding.id, name: binding.name, path: await verifyBinding(binding) };
}

export async function workspaceRoot(workspace: WorkspaceSummary, dataDir = appDataDir()): Promise<string> {
  const binding = await lookupWorkspace(workspace?.id, dataDir);
  if (binding.name !== workspace?.name) throw new WorkspaceAccessError("unavailable", "找不到保存的文件夹，请重新打开。");
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
  return () => dataChanges.off(workspace.id, listener);
}

function forbidEscape(root: string, path: string) {
  if (!within(root, path) || within(resolve(appDataDir()), path)) {
    throw new Error("路径必须指向工作区中的文件或目录。");
  }
}

async function resolveDirectory(root: string, parts: string[], create = false): Promise<string> {
  let current = root;
  for (const part of parts) {
    const next = join(current, part);
    forbidEscape(root, next);
    const inspected = await lstat(next).catch((error: unknown) => {
      if (errno(error) === "ENOENT") return undefined;
      throw error;
    });
    if (!inspected) {
      if (!create) throw new MissingParent();
      await mkdir(next).catch((error: unknown) => {
        if (errno(error) !== "EEXIST") throw error;
      });
    }
    const info = inspected ?? await lstat(next);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("工作区路径包含目录链接或同名文件。");
    const resolved = await realpath(next);
    forbidEscape(root, resolved);
    if (pathKey(resolved) !== pathKey(next)) throw new Error("工作区路径包含目录链接。");
    current = resolved;
  }
  return current;
}

async function readTarget(path: string, limit = MAX_TEXT_BYTES): Promise<string | null> {
  const initial = await lstat(path).catch((error: unknown) => {
    if (errno(error) === "ENOENT") return undefined;
    throw error;
  });
  if (!initial) return null;
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error("该路径不是工作区中的普通文件。");
  if (pathKey(await realpath(path)) !== pathKey(path)) throw new Error("请使用工作区中的实际文件名。");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== initial.ino || info.dev !== initial.dev) throw changedFile();
    if (info.size > limit) throw new Error("文件过大，无法读取为工作区文本。");
    const bytes = await handle.readFile();
    if (bytes.byteLength > limit) throw new Error("文件过大，无法读取为工作区文本。");
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (text.includes("\0")) throw new Error("Binary text");
      return text;
    } catch {
      throw new Error("该文件无法读取为 UTF-8 文本。");
    }
  } finally {
    await handle.close();
  }
}

async function containedFile(root: string, path: string, createParents = false) {
  const parts = splitWorkspacePath(path);
  const file = join(await resolveDirectory(root, parts.slice(0, -1), createParents), parts[parts.length - 1]);
  forbidEscape(root, file);
  return file;
}

export async function listWorkspace(workspace: WorkspaceSummary, path = ""): Promise<WorkspaceEntry[]> {
  const root = await workspaceRoot(workspace);
  const full = await resolveDirectory(root, path ? splitWorkspacePath(path) : []);
  return (await readdir(full, { withFileTypes: true })).flatMap((entry): WorkspaceEntry[] => {
    if ((!entry.isDirectory() && !entry.isFile()) || entry.isSymbolicLink() || !safePart(entry.name)) return [];
    if (within(resolve(appDataDir()), join(full, entry.name))) return [];
    return [{ path: path ? `${path}/${entry.name}` : entry.name, name: entry.name, kind: entry.isDirectory() ? "directory" : "file" }];
  }).sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
}

export async function readWorkspaceFileIfExists(
  workspace: WorkspaceSummary, path: string, options?: { allowMissingParent?: boolean },
): Promise<string | null> {
  const root = await workspaceRoot(workspace);
  try {
    return await readTarget(await containedFile(root, path));
  } catch (error) {
    if (options?.allowMissingParent && error instanceof MissingParent) return null;
    throw error;
  }
}

export async function readWorkspaceFile(workspace: WorkspaceSummary, path: string): Promise<string> {
  const content = await readWorkspaceFileIfExists(workspace, path);
  if (content === null) throw new WorkspaceAccessError("unavailable", "工作区文件不存在。");
  return content;
}

function changedFile() {
  return new Error("工作区文件已变化，请重新生成差异。");
}

async function serializeWrite<T>(root: string, write: () => Promise<T>): Promise<T> {
  const key = pathKey(root);
  const previous = writes.get(key);
  const pending = Promise.resolve(previous).catch(() => undefined).then(write);
  writes.set(key, pending);
  try {
    return await pending;
  } finally {
    if (writes.get(key) === pending) writes.delete(key);
  }
}

async function replaceFile(root: string, path: string, after: string | null, expectedBefore: string | null) {
  const target = await containedFile(root, path, after !== null && expectedBefore === null);
  const current = await readTarget(target);
  if (current !== expectedBefore) throw changedFile();
  if (current === after) return;
  if (after === null) {
    if (await containedFile(root, path) !== target || await readTarget(target) !== expectedBefore) throw changedFile();
    await unlink(target);
    return;
  }
  if (after.includes("\0") || Buffer.byteLength(after) > MAX_TEXT_BYTES) {
    throw new Error("差异结果无法写入为 UTF-8 文本，或文件超过 1 MB。");
  }
  const mode = current === null ? 0o666 : (await lstat(target)).mode & 0o777;
  const temp = join(dirname(target), `.silver-${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, "wx", mode);
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
    await unlink(temp).catch(() => undefined);
  }
}

export async function writeWorkspaceFile(
  workspace: WorkspaceSummary, path: string, after: string | null, expectedBefore: string | null,
): Promise<void> {
  if ((after !== null && typeof after !== "string") || (expectedBefore !== null && typeof expectedBefore !== "string")) {
    throw new Error("文件变更必须使用文本内容。");
  }
  const root = await workspaceRoot(workspace);
  await serializeWrite(root, () => replaceFile(root, path, after, expectedBefore));
  dataChanges.emit(workspace.id);
}

export async function exportWorkspaceDocument(workspace: WorkspaceSummary, filename: string, body: string): Promise<string> {
  if (!safePart(filename) || !filename.toLowerCase().endsWith(".md")) throw new Error("文稿需要使用 Markdown 文件名。");
  const root = await workspaceRoot(workspace);
  const path = await serializeWrite(root, async () => {
    const folder = await resolveDirectory(root, ["silver"], true);
    const entries = new Set((await readdir(folder)).map(pathKey));
    let name = filename;
    let index = 2;
    while (entries.has(pathKey(name))) name = `${filename.slice(0, -3)}-${index++}.md`;
    const entry = `silver/${name}`;
    await replaceFile(root, entry, body, null);
    return entry;
  });
  dataChanges.emit(workspace.id);
  return path;
}

async function* walkFiles(root: string, signal?: AbortSignal) {
  const pending = [""];
  const skipped = new Set([".git", "node_modules"]);
  for (let index = 0; index < pending.length; index++) {
    signal?.throwIfAborted();
    const path = pending[index];
    const directory = await resolveDirectory(root, path ? splitWorkspacePath(path) : []);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const next = path ? `${path}/${entry.name}` : entry.name;
      if (!safePart(entry.name) || entry.isSymbolicLink() || within(resolve(appDataDir()), join(directory, entry.name))) continue;
      if (entry.isDirectory() && !skipped.has(entry.name)) pending.push(next);
      if (entry.isFile()) yield { path: next, name: entry.name, kind: "file" as const };
    }
  }
}

function safeLimit(limit: number, maximum: number) {
  return Number.isFinite(limit) ? Math.max(0, Math.min(maximum, Math.floor(limit))) : maximum;
}

export async function searchWorkspaceFiles(
  workspace: WorkspaceSummary, query: string, limit = 48, signal?: AbortSignal,
): Promise<WorkspaceEntry[]> {
  const maximum = safeLimit(limit, 200);
  if (!maximum) return [];
  const root = await workspaceRoot(workspace);
  const matches: WorkspaceEntry[] = [];
  const needle = query.trim().toLocaleLowerCase();
  for await (const entry of walkFiles(root, signal)) {
    if (entry.path.toLocaleLowerCase().includes(needle)) matches.push(entry);
    if (matches.length >= maximum) break;
  }
  return matches;
}

export async function searchWorkspaceText(
  workspace: WorkspaceSummary, query: string, limit = 30, signal?: AbortSignal,
): Promise<WorkspaceTextMatch[]> {
  const matches: WorkspaceTextMatch[] = [];
  const needle = query.trim().toLocaleLowerCase();
  const maximum = safeLimit(limit, 200);
  if (!needle || !maximum) return matches;
  const root = await workspaceRoot(workspace);
  for await (const entry of walkFiles(root, signal)) {
    const text = await containedFile(root, entry.path)
      .then((path) => readTarget(path, SEARCH_FILE_BYTES))
      .catch(() => null);
    if (text === null) continue;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      const offset = line.toLocaleLowerCase().indexOf(needle);
      if (offset >= 0) {
        const start = Math.max(0, offset - 100);
        matches.push({ path: entry.path, line: index + 1, text: line.slice(start, start + 300) });
      }
      if (matches.length >= maximum) return matches;
    }
  }
  return matches;
}

export function workspaceErrorText(error: unknown): string {
  switch (errno(error)) {
    case "ENOENT": return "文件或文件夹已移动或不存在。";
    case "EACCES":
    case "EPERM": return "系统未授予访问权限。";
    case "ENOTDIR":
    case "EISDIR": return "同名文件或目录的类型不符。";
    default:
      return error instanceof Error ? error.message : "无法访问工作区。";
  }
}
