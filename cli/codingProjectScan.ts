import { constants } from "node:fs";
import type { Dir, Dirent, Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_DIRECTORY_IGNORES, PROJECT_DIRECTORY_PRIORITY, PROJECT_LIMITS } from "../src/constants/codingProject.ts";
import type { CodingProjectTopLevel, CodingProjectWarning, CodingProjectWarningReason } from "../src/types/codingProject.ts";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import { forbidWorkspaceEscape, resolveWorkspaceDirectory, resolveWorkspaceFile, splitWorkspacePath } from "./workspace.ts";
import { compareProjectStrings } from "./codingProjectMetadata.ts";
import { canReadCodingPath } from "./codingRead.ts";

interface ProjectNode extends CodingProjectTopLevel {
  name: string;
  depth: number;
}

export interface ProjectScan {
  files: ProjectNode[];
  topLevel: CodingProjectTopLevel[];
  warnings: CodingProjectWarning[];
  truncated: boolean;
}

export interface ProjectDirectoryOptions {
  directory: string;
  signal?: AbortSignal;
}

interface DirectoryRead {
  children: ProjectNode[];
  visited: number;
  exceeded: boolean;
}

export function projectScope(path: string): string {
  if (path === "" || path === ".") return "";
  if (path.length <= PROJECT_LIMITS.pathLength && canReadCodingPath(path) &&
    splitWorkspacePath(path).every((part: string): boolean => !PROJECT_DIRECTORY_IGNORES.has(part.toLowerCase()))) return path;
  throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
}

function safeNodeName(name: string): boolean {
  try {
    return splitWorkspacePath(name).length === 1 && canReadCodingPath(name);
  } catch {
    return false;
  }
}

function acceptedChild(entry: Dirent<string>, parent: string, depth: number): ProjectNode | undefined {
  const { name }: Dirent<string> = entry;
  const path: string = parent ? `${parent}/${name}` : name;
  if (path.length > PROJECT_LIMITS.pathLength || !safeNodeName(name) || entry.isSymbolicLink()) return undefined;
  if (entry.isDirectory() && !PROJECT_DIRECTORY_IGNORES.has(name.toLowerCase())) {
    return { name, path, kind: "directory", depth };
  }
  if (entry.isFile()) return { name, path, kind: "file", depth };
  return undefined;
}

function compareNodes(a: ProjectNode, b: ProjectNode): number {
  return a.kind === b.kind ? compareProjectStrings(a.name, b.name) : a.kind === "directory" ? -1 : 1;
}

function compareChildFolders(a: ProjectNode, b: ProjectNode): number {
  const aRank: number = PROJECT_DIRECTORY_PRIORITY.has(a.name.toLowerCase()) ? 0 : 1;
  const bRank: number = PROJECT_DIRECTORY_PRIORITY.has(b.name.toLowerCase()) ? 0 : 1;
  return aRank - bRank || compareProjectStrings(a.name, b.name);
}

async function confirmDirectory(path: string, previous?: Stats): Promise<Stats> {
  const info: Stats = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || pathKey(path) !== pathKey(await realpath(path)) ||
    (previous && (previous.dev !== info.dev || previous.ino !== info.ino))) {
    throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
  }
  return info;
}

interface ReadDirectoryOptions {
  node: ProjectNode;
  signal?: AbortSignal;
  budget: number;
}

async function readDirectory(root: string, options: ReadDirectoryOptions): Promise<DirectoryRead> {
  const { node, signal, budget }: ReadDirectoryOptions = options;
  const parts: string[] = node.path ? splitWorkspacePath(node.path) : [];
  const path: string = await resolveWorkspaceDirectory(root, parts);
  const initial: Stats = await confirmDirectory(path);
  const opened: Dir = await opendir(path);
  try {
    // Verify containment again after opening a directory in a potentially changing workspace.
    await confirmDirectory(path, initial);
    const children: ProjectNode[] = [];
    let visited: number = 0;
    while (visited < budget) {
      signal?.throwIfAborted();
      const entry: Dirent<string> | null = await opened.read();
      if (!entry) {
        await confirmDirectory(path, initial);
        return { children: children.sort(compareNodes), visited, exceeded: false };
      }
      visited += 1;
      const child: ProjectNode | undefined = acceptedChild(entry, node.path, node.depth + 1);
      if (!child) continue;
      try {
        forbidWorkspaceEscape(root, join(path, child.name));
        children.push(child);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== ERROR_CODES.WORKSPACE_INVALID_PATH) throw error;
      }
    }
    signal?.throwIfAborted();
    const exceeded: boolean = (await opened.read()) !== null;
    await confirmDirectory(path, initial);
    // Publishing a partial unsorted prefix would make recommendations depend on filesystem order.
    return { children: exceeded ? [] : children.sort(compareNodes), visited, exceeded };
  } finally {
    await opened.close();
  }
}

function warning(result: ProjectScan, path: string, reason: CodingProjectWarningReason): void {
  if (result.warnings.length < PROJECT_LIMITS.warnings) result.warnings.push({ path, reason });
  result.truncated = true;
}

export async function scanProject(root: string, options: ProjectDirectoryOptions): Promise<ProjectScan> {
  const { directory, signal }: ProjectDirectoryOptions = options;
  const result: ProjectScan = { files: [], topLevel: [], warnings: [], truncated: false };
  const queue: ProjectNode[] = [{ name: "", path: directory, depth: 0, kind: "directory" }];
  let visited: number = 0;
  for (let index: number = 0; index < queue.length; index += 1) {
    signal?.throwIfAborted();
    if (index >= PROJECT_LIMITS.directories || visited >= PROJECT_LIMITS.entries) {
      warning(result, directory, "directory-limit");
      break;
    }
    const node: ProjectNode = queue[index];
    let read: DirectoryRead;
    try {
      read = await readDirectory(root, {
        node, budget: Math.min(PROJECT_LIMITS.entriesPerDirectory, PROJECT_LIMITS.entries - visited), signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      // An explicitly selected path should fail rather than masquerade as an empty project.
      if (index === 0) throw error;
      warning(result, node.path, "directory-unavailable");
      continue;
    }
    visited += read.visited;
    if (read.exceeded) {
      warning(result, node.path, "directory-limit");
      continue;
    }
    if (index === 0) {
      result.topLevel = read.children.slice(0, PROJECT_LIMITS.topLevel).map(({ path, kind }: ProjectNode): CodingProjectTopLevel => ({ path, kind }));
      if (read.children.length > PROJECT_LIMITS.topLevel) result.truncated = true;
    }
    result.files.push(...read.children.filter(({ kind }: ProjectNode): boolean => kind === "file"));
    const folders: ProjectNode[] = read.children.filter(({ kind }: ProjectNode): boolean => kind === "directory").sort(compareChildFolders);
    if (node.depth < PROJECT_LIMITS.depth) {
      queue.push(...folders);
    } else if (folders.length) {
      warning(result, node.path, "directory-limit");
    }
  }
  signal?.throwIfAborted();
  return result;
}

interface CodingReadOptions {
  limit: number;
  signal?: AbortSignal;
}

interface CodingText {
  text: string;
  bytes: number;
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function sameFile(before: Stats, after: Stats): boolean {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/** Read only a regular, workspace-contained file and reject a moving read target. */
export async function readCodingWorkspaceText(root: string, path: string, options: CodingReadOptions): Promise<CodingText> {
  const { limit, signal }: CodingReadOptions = options;
  signal?.throwIfAborted();
  if (!canReadCodingPath(path)) throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
  const absolute: string = await resolveWorkspaceFile(root, path);
  const initial: Stats = await lstat(absolute);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_NOT_REGULAR_FILE);
  if (!Number.isSafeInteger(limit) || limit < 0 || initial.size > limit) throw new AppError(ERROR_CODES.WORKSPACE_FILE_TOO_LARGE);
  if (pathKey(absolute) !== pathKey(await realpath(absolute))) throw new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
  // NONBLOCK avoids waiting indefinitely on a FIFO swapped in between lstat and open on Unix.
  const file: FileHandle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    signal?.throwIfAborted();
    const opened: Stats = await file.stat();
    if (!sameFile(initial, opened)) throw new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
    const buffer: Buffer = Buffer.allocUnsafe(opened.size + 1);
    let total: number = 0;
    while (total < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead }: { bytesRead: number; } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    signal?.throwIfAborted();
    if (total !== opened.size || !sameFile(opened, await file.stat()) ||
      pathKey(absolute) !== pathKey(await realpath(absolute)) || !sameFile(opened, await lstat(absolute))) {
      throw new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total));
    } catch {
      throw new AppError(ERROR_CODES.WORKSPACE_NOT_UTF8);
    }
    if (text.includes("\0")) throw new AppError(ERROR_CODES.WORKSPACE_NOT_UTF8);
    return { text, bytes: total };
  } finally {
    await file.close();
  }
}

export async function readProjectManifestText(root: string, path: string, signal?: AbortSignal): Promise<string> {
  const result: CodingText = await readCodingWorkspaceText(root, path, { limit: PROJECT_LIMITS.manifestBytes, signal });
  return result.text;
}
