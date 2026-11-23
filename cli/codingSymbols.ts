import type { Dir, Dirent } from "node:fs";
import { opendir } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  CODING_SYMBOL_IDENTIFIER, CODING_SYMBOL_IGNORED_DIRS, CODING_SYMBOL_LANGUAGES,
  CODING_SYMBOL_LIMITS, CODING_SYMBOL_MODES,
} from "../src/constants/codingSymbols.ts";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import type {
  CodingSymbolLanguage, CodingSymbolMatch, CodingSymbolMode, CodingSymbolOptions, CodingSymbolResult,
} from "../src/types/codingSymbols";
import type { WorkspaceSummary } from "./workspace.ts";
import {
  forbidWorkspaceEscape, resolveWorkspaceDirectory, splitWorkspacePath, workspaceRoot,
} from "./workspace.ts";
import { matchCodingSource } from "./codingSymbolsMatch.ts";
import { projectScope, readCodingWorkspaceText } from "./codingProjectScan.ts";

interface PendingDirectory {
  path: string;
  parts: string[];
  depth: number;
}

interface ScanState {
  root: string;
  query: string;
  mode: CodingSymbolMode;
  signal?: AbortSignal;
  definitions: CodingSymbolMatch[];
  references: CodingSymbolMatch[];
  entries: number;
  files: number;
  scannedFiles: number;
  bytes: number;
  truncated: boolean;
}

interface SourceEntry {
  path: string;
  language: CodingSymbolLanguage;
}

interface ReadSource {
  text: string;
  bytes: number;
}

function isVisibleDirectory(part: string): boolean {
  return !part.startsWith(".") && !CODING_SYMBOL_IGNORED_DIRS.has(part.toLowerCase());
}

function makeScope(directory: string): PendingDirectory {
  const path: string = projectScope(directory);
  const parts: string[] = path ? splitWorkspacePath(path) : [];
  if (!parts.every(isVisibleDirectory)) throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
  return { path, parts, depth: 0 };
}

function compareNames(a: Dirent, b: Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function isSafeEntry(entry: Dirent, options: { folder: string; root: string }): boolean {
  if (entry.name.startsWith(".") || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
    return false;
  }
  try {
    forbidWorkspaceEscape(options.root, join(options.folder, entry.name));
    return projectScope(entry.name) === entry.name;
  } catch {
    return false;
  }
}

async function directoryEntries(state: ScanState, scope: PendingDirectory): Promise<Dirent[]> {
  const folder: string = await resolveWorkspaceDirectory(state.root, scope.parts);
  const entries: Dirent[] = [];
  const opened: Dir = await opendir(folder);
  try {
    await resolveWorkspaceDirectory(state.root, scope.parts);
    let visited: number = 0;
    while (visited < CODING_SYMBOL_LIMITS.entriesPerDirectory) {
      state.signal?.throwIfAborted();
      const entry: Dirent | null = await opened.read();
      if (!entry) return entries.sort(compareNames);
      if (++state.entries > CODING_SYMBOL_LIMITS.entries) {
        state.truncated = true;
        return [];
      }
      visited++;
      if (isSafeEntry(entry, { folder, root: state.root })) entries.push(entry);
    }
    state.signal?.throwIfAborted();
    if (await opened.read() === null) return entries.sort(compareNames);
    state.truncated = true;
    // Don't return a filesystem-order-dependent partial list for a huge folder.
    return [];
  } finally {
    await opened.close();
  }
}

async function readBounded(state: ScanState, path: string): Promise<ReadSource> {
  const limit: number = Math.min(CODING_SYMBOL_LIMITS.fileBytes, CODING_SYMBOL_LIMITS.searchBytes - state.bytes);
  return readCodingWorkspaceText(state.root, path, { limit, signal: state.signal });
}

function appendMatches(state: ScanState, matches: CodingSymbolMatch[], kind: "definitions" | "references"): void {
  const slots: number = CODING_SYMBOL_LIMITS.matches - state[kind].length;
  if (matches.length > slots) state.truncated = true;
  state[kind].push(...matches.slice(0, slots));
}

async function scanSource(state: ScanState, { path, language }: SourceEntry): Promise<void> {
  state.signal?.throwIfAborted();
  const source: ReadSource | undefined = await readBounded(state, path).catch((): undefined => undefined);
  state.signal?.throwIfAborted();
  if (!source) {
    state.truncated = true;
    return;
  }
  state.bytes += source.bytes;
  state.scannedFiles++;
  const matches: ReturnType<typeof matchCodingSource> = matchCodingSource({ path, language, text: source.text }, {
    name: state.query, mode: state.mode, signal: state.signal,
  });
  appendMatches(state, matches.definitions, "definitions");
  appendMatches(state, matches.references, "references");
  state.truncated ||= matches.truncated;
}

function eligibleLanguage(name: string): CodingSymbolLanguage | undefined {
  const lower: string = name.toLowerCase();
  if (/(?:\.min|\.bundle|\.generated)\.[cm]?[jt]sx?$/u.test(lower)) return undefined;
  return CODING_SYMBOL_LANGUAGES.get(extname(lower));
}

function enqueueDirectory(
  pending: PendingDirectory[], current: PendingDirectory, entry: Dirent
): boolean {
  if (!isVisibleDirectory(entry.name)) return true;
  if (pending.length >= CODING_SYMBOL_LIMITS.directories || current.depth >= CODING_SYMBOL_LIMITS.depth) return false;
  const path: string = current.path ? current.path + "/" + entry.name : entry.name;
  pending.push({ path, parts: [...current.parts, entry.name], depth: current.depth + 1 });
  return true;
}

async function scan(state: ScanState, scope: PendingDirectory): Promise<void> {
  const pending: PendingDirectory[] = [scope];
  for (const directory of pending) {
    state.signal?.throwIfAborted();
    const entries: Dirent[] = await directoryEntries(state, directory).catch((error: Error): Dirent[] => {
      state.signal?.throwIfAborted();
      if (directory === scope) throw error;
      state.truncated = true;
      return [];
    });
    if (state.entries > CODING_SYMBOL_LIMITS.entries) return;
    for (const entry of entries) {
      state.signal?.throwIfAborted();
      if (entry.isDirectory()) {
        // Enqueue even when earlier directories were already omitted.
        if (!enqueueDirectory(pending, directory, entry)) state.truncated = true;
        continue;
      }
      const language: CodingSymbolLanguage | undefined = eligibleLanguage(entry.name);
      if (!language) continue;
      if (state.files >= CODING_SYMBOL_LIMITS.files || state.bytes >= CODING_SYMBOL_LIMITS.searchBytes) {
        state.truncated = true;
        return;
      }
      state.files++;
      const path: string = directory.path ? directory.path + "/" + entry.name : entry.name;
      await scanSource(state, { path, language });
    }
  }
}

/**
 * Navigate existing source without invoking project scripts or writing workspace files.
 * Results are lexical candidates (definitions are inferred), not compiler binding analysis.
 */
export async function findCodingSymbols(
  workspace: WorkspaceSummary, query: string, options: CodingSymbolOptions = {}
): Promise<CodingSymbolResult> {
  const { directory = "", mode = "all", signal }: CodingSymbolOptions = options;
  signal?.throwIfAborted();
  const name: string = query.trim();
  if (!name) throw new AppError(ERROR_CODES.WORKSPACE_SEARCH_QUERY_EMPTY);
  if (name.length > CODING_SYMBOL_LIMITS.queryLength || !CODING_SYMBOL_IDENTIFIER.test(name) || !CODING_SYMBOL_MODES.has(mode)) {
    throw new AppError(ERROR_CODES.WORKSPACE_TOOL_UNAVAILABLE);
  }
  const scope: PendingDirectory = makeScope(directory);
  const state: ScanState = {
    root: await workspaceRoot(workspace), query: name, mode, signal,
    definitions: [], references: [], entries: 0, files: 0, scannedFiles: 0, bytes: 0, truncated: false,
  };
  await scan(state, scope);
  signal?.throwIfAborted();
  const matches: CodingSymbolMatch[] = [...state.definitions, ...state.references];
  return {
    query: name, directory: scope.path, mode,
    matches: matches.slice(0, CODING_SYMBOL_LIMITS.matches),
    scannedFiles: state.scannedFiles,
    truncated: state.truncated || matches.length > CODING_SYMBOL_LIMITS.matches,
  };
}
