import { execFile } from "node:child_process";
import type { ExecException } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { isDiffPath } from "../src/utils/diff.ts";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import {
  GIT_DIFF_MAX_BUFFER_BYTES,
  GIT_DIFF_MAX_LINES_PER_FILE,
  GIT_UNTRACKED_MAX_BYTES,
  GIT_UNTRACKED_MAX_FILES,
} from "../src/constants/git.ts";
import type {
  GitDiffFile,
  GitDiffLine,
  GitFileStatus,
  WorkspaceGitDiff,
} from "../src/types/git.ts";
import { appDataDir } from "./host.ts";
import { workspaceRoot } from "./workspace.ts";

interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const HUNK_HEADER_RE: RegExp = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;
const DIFF_GIT_HEADER_RE: RegExp = /^diff --git ("?(?:a\/|[^"\s]+).*"?) ("?(?:b\/|[^"\s]+).*"?)$/u;

function runGit(cwd: string, args: string[]): Promise<GitExecResult> {
  return new Promise<GitExecResult>(
    (resolve: (value: GitExecResult) => void, reject: (reason: unknown) => void): void => {
      execFile(
        "git",
        ["-c", "core.quotepath=false", ...args],
        {
          cwd,
          windowsHide: true,
          maxBuffer: GIT_DIFF_MAX_BUFFER_BYTES,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            LC_ALL: "C",
          },
        },
        (error: ExecException | null, stdout: string, stderr: string): void => {
          if (!error) {
            resolve({ stdout, stderr, exitCode: 0 });
            return;
          }
          const code: string | number | undefined = error.code;
          if (code === "ENOENT") {
            reject(new AppError(ERROR_CODES.WORKSPACE_GIT_UNAVAILABLE, { cause: error }));
            return;
          }
          if (typeof code === "number") {
            resolve({ stdout, stderr, exitCode: code });
            return;
          }
          reject(new AppError(ERROR_CODES.WORKSPACE_GIT_DIFF_FAILED, { cause: error }));
        }
      );
    }
  );
}

function unquoteGitPath(raw: string): string {
  const trimmed: string = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner: string = trimmed.slice(1, -1);
    return inner.replace(/\\(["\\tnr])/gu, (_match: string, ch: string): string => {
      if (ch === "t") return "\t";
      if (ch === "n") return "\n";
      if (ch === "r") return "\r";
      return ch;
    });
  }
  return trimmed;
}

function stripDiffPrefix(raw: string, prefix: "a/" | "b/"): string {
  const unquoted: string = unquoteGitPath(raw);
  if (unquoted === "/dev/null") return "";
  return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match: RegExpExecArray | null = HUNK_HEADER_RE.exec(line);
  if (!match) return null;
  return {
    oldStart: Number.parseInt(match[1], 10),
    newStart: Number.parseInt(match[2], 10),
  };
}

function splitDiffSections(raw: string): string[][] {
  if (!raw) return [];
  const allLines: string[] = raw.replace(/\r\n/gu, "\n").split("\n");
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
    allLines.pop();
  }
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of allLines) {
    if (line.startsWith("diff --git ")) {
      if (current) sections.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function parseDiffSection(section: string[]): GitDiffFile | null {
  if (section.length === 0) return null;
  const headerMatch: RegExpExecArray | null = DIFF_GIT_HEADER_RE.exec(section[0]);
  let oldPath: string = headerMatch ? stripDiffPrefix(headerMatch[1], "a/") : "";
  let newPath: string = headerMatch ? stripDiffPrefix(headerMatch[2], "b/") : "";
  let status: GitFileStatus = "modified";
  let binary: boolean = false;
  let truncated: boolean = false;
  let additions: number = 0;
  let deletions: number = 0;
  const lines: GitDiffLine[] = [];

  let inHunk: boolean = false;
  let oldCursor: number = 0;
  let newCursor: number = 0;

  for (let i: number = 1; i < section.length; i += 1) {
    const line: string = section[i];

    if (!inHunk) {
      if (line.startsWith("new file mode ")) {
        status = "added";
        continue;
      }
      if (line.startsWith("deleted file mode ")) {
        status = "deleted";
        continue;
      }
      if (line.startsWith("rename from ")) {
        status = "renamed";
        oldPath = unquoteGitPath(line.slice("rename from ".length));
        continue;
      }
      if (line.startsWith("rename to ")) {
        status = "renamed";
        newPath = unquoteGitPath(line.slice("rename to ".length));
        continue;
      }
      if (line.startsWith("Binary files ") || line === "GIT binary patch") {
        binary = true;
        continue;
      }
      if (line.startsWith("--- ")) {
        const parsedOld: string = stripDiffPrefix(line.slice(4), "a/");
        if (parsedOld) oldPath = parsedOld;
        continue;
      }
      if (line.startsWith("+++ ")) {
        const parsedNew: string = stripDiffPrefix(line.slice(4), "b/");
        if (parsedNew) newPath = parsedNew;
        continue;
      }
    }

    if (line.startsWith("@@ ")) {
      const hunk: { oldStart: number; newStart: number } | null = parseHunkHeader(line);
      if (hunk) {
        inHunk = true;
        oldCursor = hunk.oldStart;
        newCursor = hunk.newStart;
        if (lines.length < GIT_DIFF_MAX_LINES_PER_FILE) {
          lines.push({ kind: "meta", text: line, oldLine: null, newLine: null });
        } else {
          truncated = true;
        }
      }
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("+")) {
      additions += 1;
      const lineNum: number = newCursor;
      newCursor += 1;
      if (lines.length < GIT_DIFF_MAX_LINES_PER_FILE) {
        lines.push({ kind: "added", text: line, oldLine: null, newLine: lineNum });
      } else {
        truncated = true;
      }
    } else if (line.startsWith("-")) {
      deletions += 1;
      const lineNum: number = oldCursor;
      oldCursor += 1;
      if (lines.length < GIT_DIFF_MAX_LINES_PER_FILE) {
        lines.push({ kind: "removed", text: line, oldLine: lineNum, newLine: null });
      } else {
        truncated = true;
      }
    } else if (line.startsWith("\\")) {
      if (lines.length < GIT_DIFF_MAX_LINES_PER_FILE) {
        lines.push({ kind: "meta", text: line, oldLine: null, newLine: null });
      } else {
        truncated = true;
      }
    } else {
      const prevOld: number = oldCursor;
      const prevNew: number = newCursor;
      oldCursor += 1;
      newCursor += 1;
      if (lines.length < GIT_DIFF_MAX_LINES_PER_FILE) {
        lines.push({ kind: "context", text: line, oldLine: prevOld, newLine: prevNew });
      } else {
        truncated = true;
      }
    }
  }

  const resolvedPath: string = status === "deleted" ? (oldPath || newPath) : (newPath || oldPath);
  if (!resolvedPath) return null;

  return {
    path: resolvedPath,
    ...(status === "renamed" && oldPath && oldPath !== resolvedPath ? { oldPath } : {}),
    status,
    additions,
    deletions,
    binary,
    truncated,
    lines,
  };
}

export function parseGitDiffOutput(raw: string): GitDiffFile[] {
  const sections: string[][] = splitDiffSections(raw);
  const files: GitDiffFile[] = [];
  for (const section of sections) {
    const parsed: GitDiffFile | null = parseDiffSection(section);
    if (parsed) files.push(parsed);
  }
  return files;
}

async function readUntrackedFile(root: string, relPath: string): Promise<GitDiffFile | null> {
  if (!isDiffPath(relPath)) return null;
  const fullPath: string = join(root, ...relPath.split("/"));
  let stats: Stats;
  try {
    stats = await lstat(fullPath);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) return null;

  if (stats.size > GIT_UNTRACKED_MAX_BYTES) {
    return {
      path: relPath,
      status: "untracked",
      additions: 0,
      deletions: 0,
      binary: false,
      truncated: true,
      lines: [],
    };
  }

  let rawBytes: Buffer;
  try {
    rawBytes = await readFile(fullPath);
  } catch {
    return null;
  }

  if (rawBytes.includes(0)) {
    return {
      path: relPath,
      status: "untracked",
      additions: 0,
      deletions: 0,
      binary: true,
      truncated: false,
      lines: [],
    };
  }

  const content: string = rawBytes.toString("utf8");
  if (!content) {
    return {
      path: relPath,
      status: "untracked",
      additions: 0,
      deletions: 0,
      binary: false,
      truncated: false,
      lines: [],
    };
  }

  const normalized: string = content.replace(/\r\n/gu, "\n");
  const splitLines: string[] = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    splitLines.pop();
  }

  const additions: number = splitLines.length;
  const lines: GitDiffLine[] = [
    { kind: "meta", text: `@@ -0,0 +1,${additions} @@`, oldLine: null, newLine: null },
  ];
  let truncated: boolean = false;
  for (let index: number = 0; index < splitLines.length; index += 1) {
    if (lines.length < GIT_DIFF_MAX_LINES_PER_FILE) {
      lines.push({
        kind: "added",
        text: `+${splitLines[index]}`,
        oldLine: null,
        newLine: index + 1,
      });
    } else {
      truncated = true;
      break;
    }
  }

  return {
    path: relPath,
    status: "untracked",
    additions,
    deletions: 0,
    binary: false,
    truncated,
    lines,
  };
}

async function resolveGitBranch(root: string): Promise<string> {
  const symbolic: GitExecResult = await runGit(root, ["symbolic-ref", "--short", "HEAD"]);
  if (symbolic.exitCode === 0 && symbolic.stdout.trim()) {
    return symbolic.stdout.trim();
  }
  const detached: GitExecResult = await runGit(root, ["rev-parse", "--short", "HEAD"]);
  if (detached.exitCode === 0 && detached.stdout.trim()) {
    return detached.stdout.trim();
  }
  return "";
}

export async function readWorkspaceGitDiff(
  workspace: WorkspaceSummary,
  dataDir: string = appDataDir()
): Promise<WorkspaceGitDiff> {
  const root: string = await workspaceRoot(workspace, dataDir);
  const probe: GitExecResult = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (probe.exitCode !== 0 || probe.stdout.trim() !== "true") {
    return {
      isRepo: false,
      branch: "",
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      truncated: false,
    };
  }

  const branch: string = await resolveGitBranch(root);
  const headCheck: GitExecResult = await runGit(root, ["rev-parse", "--verify", "HEAD"]);
  const untrackedQuery: GitExecResult = await runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
  ]);

  const diffArgs: string[] = headCheck.exitCode === 0
    ? ["diff", "HEAD", "--no-color", "--no-ext-diff", "--unified=3", "--relative", "-M", "--", "."]
    : ["diff", "--cached", "--no-color", "--no-ext-diff", "--unified=3", "--relative", "-M", "--", "."];
  const diffResult: GitExecResult = await runGit(root, diffArgs);
  if (diffResult.exitCode !== 0 && diffResult.exitCode !== 1) {
    throw new AppError(ERROR_CODES.WORKSPACE_GIT_DIFF_FAILED);
  }

  const files: GitDiffFile[] = parseGitDiffOutput(diffResult.stdout);
  const existingPaths: Set<string> = new Set(files.map((file: GitDiffFile): string => file.path));

  let workspaceTruncated: boolean = false;
  if (untrackedQuery.exitCode === 0 && untrackedQuery.stdout) {
    const rawPaths: string[] = untrackedQuery.stdout
      .split("\0")
      .filter((entry: string): boolean => Boolean(entry) && !existingPaths.has(entry));
    const limitedPaths: string[] = rawPaths.slice(0, GIT_UNTRACKED_MAX_FILES);
    if (rawPaths.length > GIT_UNTRACKED_MAX_FILES) {
      workspaceTruncated = true;
    }
    const batchSize: number = 16;
    for (let offset: number = 0; offset < limitedPaths.length; offset += batchSize) {
      const slice: string[] = limitedPaths.slice(offset, offset + batchSize);
      const settled: PromiseSettledResult<GitDiffFile | null>[] = await Promise.allSettled(
        slice.map((relPath: string): Promise<GitDiffFile | null> => readUntrackedFile(root, relPath))
      );
      for (const item of settled) {
        if (item.status === "fulfilled" && item.value) {
          files.push(item.value);
        }
      }
    }
  }

  files.sort((left: GitDiffFile, right: GitDiffFile): number =>
    left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" })
  );

  let totalAdditions: number = 0;
  let totalDeletions: number = 0;
  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }

  return {
    isRepo: true,
    branch,
    files,
    totalAdditions,
    totalDeletions,
    truncated: workspaceTruncated,
  };
}
