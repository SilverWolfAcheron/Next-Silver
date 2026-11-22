import { AppError, ERROR_CODES, serializeErrorCode } from "../agent-core/errors.ts";
import type { Artifact, WritePolicy } from "../agent-core/types";
import type {
  DecideDiffFileOptions,
  DiffFile,
  DiffHunk,
  DiffLineKind,
  DiffRange,
  DiffRow,
  FileChange,
  FileDecision,
} from "../types/diff";
import type { ErrorCode } from "../types/errors";
import type { GitDiffFile, GitTreeNode } from "../types/git";

export type {
  DecideDiffFileOptions,
  DiffFile,
  DiffLineKind,
  FileChange,
  FileDecision,
};

const NO_NEWLINE: string = "\\ No newline at end of file";
const lineKinds: { readonly " ": "context"; readonly "+": "added"; readonly "-": "removed" } = {
  " ": "context",
  "+": "added",
  "-": "removed",
} as const;

export function isDiffPath(path: string): boolean {
  return path.split("/").every((part: string): boolean | "" => (
    part.trim() && part.trim() !== "." && part.trim() !== ".." &&
    !/[<>:"\\|?*\p{Cc}\p{Cs}\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(part) &&
    !/[ .]$/u.test(part) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?: *\.|$)/iu.test(part)
  ));
}

function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function hunkHeader(line: string): Omit<DiffHunk, "rows"> | undefined {
  const match: RegExpExecArray | null = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:\s.*)?$/u.exec(line);
  if (!match) return;
  const [, oldStart, oldCount = "1", newStart, newCount = "1"]: RegExpExecArray = match;
  const before: DiffRange = { start: Number(oldStart), count: Number(oldCount) };
  const after: DiffRange = { start: Number(newStart), count: Number(newCount) };
  if (
    ![before.start, before.count, after.start, after.count].every(Number.isSafeInteger) ||
    (before.count && !before.start) || (after.count && !after.start) ||
    (!before.count && !after.count)
  ) return;
  return { before, after };
}

function isFileHeader(lines: string[], index: number): boolean {
  return lines[index].startsWith("--- ") && lines[index + 1]?.startsWith("+++ ");
}

function splitDiff(body: string): string[][] {
  const normalized: string = body.replace(/\r\n/gu, "\n");
  const fenced: RegExpExecArray | null = /^\s*```(?:diff|patch)?[^\S\n]*\n([\s\S]*?)\n```\s*$/u.exec(normalized);
  const lines: string[] = (fenced?.[1] ?? normalized).replace(/^\n+|\n+$/gu, "").split("\n");
  const sections: string[][] = [[]];
  let hasHeaders: boolean = false;
  let before: number = 0;
  let after: number = 0;
  for (const [index, line] of lines.entries()) {
    const inside: boolean = before !== 0 || after !== 0;
    const header: boolean = !inside && isFileHeader(lines, index);
    if (line.startsWith("diff --git ") || (header && hasHeaders)) {
      if (sections.at(-1)!.length) sections.push([]);
      hasHeaders = false;
      before = after = 0;
    }
    sections.at(-1)!.push(line);
    if (header) hasHeaders = true;
    if (inside && !line.startsWith("diff --git ")) {
      if (line.startsWith(" ") || line.startsWith("-")) before--;
      if (line.startsWith(" ") || line.startsWith("+")) after--;
    } else {
      const range: Omit<DiffHunk, "rows"> | undefined = hunkHeader(line);
      if (range) {
        before = range.before.count;
        after = range.after.count;
      }
    }
  }
  return sections;
}

function pathToken(token: string): string {
  if (!token.startsWith('"')) return token;
  if (!token.endsWith('"')) throw new AppError(ERROR_CODES.DIFF_QUOTED_PATH_INCOMPLETE);
  const quoted: string = token.slice(1, -1);
  if (/\\(?![0-3][0-7]{2}|["\\])/u.test(quoted)) {
    throw new AppError(ERROR_CODES.DIFF_PATH_ESCAPE_UNSUPPORTED);
  }
  return quoted.replace(/(?:\\[0-3][0-7]{2})+|\\["\\]/gu, (sequence: string): string => {
    if (sequence.length === 2) return sequence[1];
    try {
      const bytes: number[] = sequence.slice(1).split("\\").map((value: string): number => Number.parseInt(value, 8));
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes));
    } catch {
      throw new AppError(ERROR_CODES.DIFF_PATH_ENCODING_INVALID);
    }
  });
}

function checkedPath(line: string): string | null {
  const token: string = pathToken(line.slice(4).split("\t", 1)[0]);
  return token === "/dev/null" ? null : token;
}

function gitPathsMatch(header: string, path: string): boolean {
  const tokens: string = header.slice("diff --git ".length);
  for (let separator: number = tokens.indexOf(" "); separator >= 0; separator = tokens.indexOf(" ", separator + 1)) {
    try {
      if (pathToken(tokens.slice(0, separator)) === `a/${path}` &&
        pathToken(tokens.slice(separator + 1)) === `b/${path}`) return true;
    } catch {
      // A space inside a quoted path can be skipped.
    }
  }
  return false;
}

function readFile(lines: string[]): DiffFile {
  const file: DiffFile = {
    lines: lines.map((text: string): { text: string; kind: "meta" } => ({ text, kind: "meta" })),
    additions: 0,
    deletions: 0,
  };
  try {
    const header: number = lines.findIndex((_: string, index: number): boolean => isFileHeader(lines, index));
    if (header === -1) throw new AppError(ERROR_CODES.DIFF_HEADER_MISSING);
    const git: boolean = lines[0]?.startsWith("diff --git ");
    let before: string | null = checkedPath(lines[header]);
    let after: string | null = checkedPath(lines[header + 1]);
    const gitPrefixes: boolean | undefined = before?.startsWith("a/") && after?.startsWith("b/") &&
      before.slice(2) === after.slice(2);
    if (git || gitPrefixes) {
      if ((before !== null && !before.startsWith("a/")) ||
        (after !== null && !after.startsWith("b/"))) {
        throw new AppError(ERROR_CODES.DIFF_GIT_PREFIX_INCOMPLETE);
      }
      before = before?.slice(2) ?? null;
      after = after?.slice(2) ?? null;
    }
    file.path = after ?? before ?? undefined;
    const operation: "create" | "delete" | "update" = before === null ? "create" : after === null ? "delete" : "update";
    const metadata: string[] = lines.slice(git ? 1 : 0, header);
    if (metadata.some((line: string): boolean => (
      !/^index [\da-f]+\.\.[\da-f]+(?: 100(?:644|755))?$/iu.test(line) &&
      !(operation === "create" && line === "new file mode 100644") &&
      !(operation === "delete" && /^(?:deleted file mode 100(?:644|755))$/u.test(line))
    ))) throw new AppError(ERROR_CODES.DIFF_METADATA_UNSUPPORTED);
    const path: string | undefined = file.path;
    if (!path || !isDiffPath(path)) throw new AppError(ERROR_CODES.DIFF_PATH_OUTSIDE_WORKSPACE);
    if (before !== null && after !== null && before !== after) {
      throw new AppError(ERROR_CODES.DIFF_RENAME_PREVIEW_ONLY);
    }
    if (git && !gitPathsMatch(lines[0], path)) throw new AppError(ERROR_CODES.DIFF_GIT_PATH_MISMATCH);

    const hunks: DiffHunk[] = [];
    let index: number = header + 2;
    while (index < lines.length) {
      const range: Omit<DiffHunk, "rows"> | undefined = hunkHeader(lines[index++]);
      if (!range) throw new AppError(ERROR_CODES.DIFF_HUNK_RANGE_INVALID);
      const rows: DiffRow[] = [];
      let oldCount: number = 0;
      let newCount: number = 0;
      while (index < lines.length) {
        const line: string = lines[index];
        if (line === NO_NEWLINE) {
          const row: DiffRow | undefined = rows.at(-1);
          if (!row || row.noNewline) throw new AppError(ERROR_CODES.DIFF_NO_NEWLINE_INVALID);
          row.noNewline = true;
          index++;
          continue;
        }
        if (oldCount === range.before.count && newCount === range.after.count) break;
        const marker: string = line[0];
        if (marker !== " " && marker !== "+" && marker !== "-") {
          throw new AppError(ERROR_CODES.DIFF_HUNK_INCOMPLETE);
        }
        if (line.includes("\0") || /[\r\p{Cs}]/u.test(line)) {
          throw new AppError(ERROR_CODES.DIFF_TEXT_ENCODING_INVALID);
        }
        rows.push({ marker, text: line.slice(1) });
        file.lines[index].kind = lineKinds[marker];
        index++;
        if (marker !== "+") oldCount++;
        if (marker !== "-") newCount++;
        if (marker === "+") file.additions++;
        if (marker === "-") file.deletions++;
        if (oldCount > range.before.count || newCount > range.after.count) {
          throw new AppError(ERROR_CODES.DIFF_HUNK_LINE_COUNT_MISMATCH);
        }
      }
      if (oldCount !== range.before.count || newCount !== range.after.count) {
        throw new AppError(ERROR_CODES.DIFF_HUNK_LINE_COUNT_MISMATCH);
      }
      hunks.push({ ...range, rows });
    }
    if (!hunks.length || (!file.additions && !file.deletions)) {
      throw new AppError(ERROR_CODES.DIFF_EMPTY);
    }
    file.change = { path, operation, hunks };
  } catch (error) {
    file.error = serializeErrorCode(error, ERROR_CODES.DIFF_APPLY_FAILED);
  }
  return file;
}

export function parseDiff(body: string): DiffFile[] {
  const files: DiffFile[] = splitDiff(body).map(readFile);
  const counts: Map<string, number> = new Map();
  for (const { change } of files) {
    if (!change) continue;
    const key: string = pathKey(change.path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return files.map((file: DiffFile): DiffFile => file.change && (counts.get(pathKey(file.change.path)) ?? 0) > 1
    ? { ...file, change: undefined, error: ERROR_CODES.DIFF_DUPLICATE_FILE }
    : file);
}

interface TextLine {
  text: string;
  ending: "\n" | "\r\n" | "";
}

function textLines(text: string): TextLine[] {
  const pieces: string[] = text.split("\n");
  return pieces.flatMap<TextLine>(
    (part: string, index: number): { text: string; ending: "" }[] | { text: string; ending: "\r\n" }[] | { text: string; ending: "\n" }[] => {
      if (index === pieces.length - 1) return part ? [{ text: part, ending: "" }] : [];
      if (part.endsWith("\r")) return [{ text: part.slice(0, -1), ending: "\r\n" }];
      return [{ text: part, ending: "\n" }];
    }
  );
}

function rangeOffset({ start, count }: DiffRange): number {
  return count ? start - 1 : start;
}

function patchConflict(): never {
  throw new AppError(ERROR_CODES.DIFF_CONFLICT);
}

export function applyDiff(change: FileChange, original: string | null): string | null {
  if (change.operation === "create" ? original !== null : original === null) {
    throw new AppError(
      change.operation === "create" ? ERROR_CODES.DIFF_TARGET_EXISTS : ERROR_CODES.DIFF_SOURCE_MISSING
    );
  }
  const source: TextLine[] = textLines(original ?? "");
  if (source.some(({ text }: TextLine): boolean => text.includes("\r"))) {
    throw new AppError(ERROR_CODES.DIFF_LINE_ENDING_UNSUPPORTED);
  }
  const ending: "\n" | "\r\n" = source.find((line: TextLine): "" | "\n" | "\r\n" => line.ending)?.ending || "\n";
  const result: TextLine[] = [];
  let cursor: number = 0;
  let previousInsertion: number = -1;
  for (const hunk of change.hunks) {
    const offset: number = rangeOffset(hunk.before);
    if (offset < cursor || offset + hunk.before.count > source.length ||
      (!hunk.before.count && (source.length > 0 || offset === previousInsertion))) patchConflict();
    if (!hunk.before.count) previousInsertion = offset;
    for (; cursor < offset; cursor++) result.push(source[cursor]);
    if (rangeOffset(hunk.after) !== result.length) patchConflict();
    for (const row of hunk.rows) {
      if (row.marker === "+") {
        result.push({ text: row.text, ending: row.noNewline ? "" : ending });
        continue;
      }
      const current: TextLine | undefined = source[cursor++];
      if (current?.text !== row.text || (current?.ending === "") !== Boolean(row.noNewline)) patchConflict();
      if (row.marker === " " && current) result.push(current);
    }
  }
  for (; cursor < source.length; cursor++) result.push(source[cursor]);
  if (result.slice(0, -1).some((line: TextLine): boolean => !line.ending) ||
    (change.operation === "delete" && result.length > 0)) patchConflict();
  if (change.operation === "delete") return null;
  return result.map(({ text, ending: separator }: TextLine): string => text + separator).join("");
}

export function diffPolicyError(change: FileChange, policy: WritePolicy): ErrorCode | undefined {
  if (policy === "none") return ERROR_CODES.DIFF_POLICY_READONLY;
  if (policy === "docs" && (!/\.md$/iu.test(change.path) || change.operation === "delete")) {
    return ERROR_CODES.DIFF_POLICY_DOCS_ONLY;
  }
}

export function diffNeedsConfirmation(change: FileChange): boolean {
  return change.operation === "delete" ||
    /(?:\.lockb?|(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|packages\.lock\.json|go\.sum))$/iu.test(change.path);
}

function fileText(file: DiffFile): string {
  return file.lines.map(({ text }: { text: string; kind: DiffLineKind }): string => text).join("\n");
}

function withFiles(artifact: Artifact, files: DiffFile[]): Artifact {
  const retainedPaths: Set<string | undefined> = new Set(files.map(({ path }: DiffFile): string | undefined => path));
  const fileDecisions: Record<string, FileDecision> = Object.fromEntries(
    Object.entries(artifact.fileDecisions ?? {}).filter(
      ([path]: [string, FileDecision]): boolean => retainedPaths.has(path)
    )
  );
  return { ...artifact, body: files.map(fileText).join("\n"), fileDecisions };
}

export function mergeDiffArtifacts(existing: Artifact[], additions: Artifact[]): Artifact[] {
  let merged: Artifact[] = existing;
  for (const addition of additions) {
    if (addition.kind !== "diff") {
      merged = [...merged, addition];
      continue;
    }
    const incoming: Set<string> = new Set(
      parseDiff(addition.body).flatMap(({ change }: DiffFile): string[] => change ? [pathKey(change.path)] : [])
    );
    let previousAccepted: boolean = false;
    merged = merged.flatMap((artifact: Artifact): Artifact[] => {
      if (artifact.kind !== "diff" || artifact.workspaceId !== addition.workspaceId) return [artifact];
      const files: DiffFile[] = parseDiff(artifact.body);
      const retained: DiffFile[] = files.filter(({ path }: DiffFile): boolean => {
        if (!path || !incoming.has(pathKey(path))) return true;
        if (artifact.fileDecisions?.[path] !== "accepted") return false;
        previousAccepted = true;
        return true;
      });
      if (files.length === retained.length) return [artifact];
      return retained.length ? [withFiles(artifact, retained)] : [];
    });
    merged.push(
      previousAccepted
        ? { ...addition, title: `${addition.title} · ${new Date().toLocaleString("zh-CN")}` }
        : addition
    );
  }
  return merged;
}

export function decideDiffFile(
  artifacts: Artifact[],
  options: DecideDiffFileOptions<Artifact>
): Artifact[] {
  const { snapshot, path, decision }: DecideDiffFileOptions<Artifact> = options;
  const proposed: DiffFile | undefined = parseDiff(snapshot.body).find(
    ({ change }: DiffFile): boolean => change?.path === path
  );
  if (!proposed) return artifacts;
  const same: Artifact | undefined = artifacts.find(
    (artifact: Artifact): boolean =>
      artifact.id === snapshot.id &&
      (artifact.body === snapshot.body ||
        parseDiff(artifact.body).some(
          (file: DiffFile): boolean =>
            file.change?.path === path && fileText(file) === fileText(proposed)
        ))
  );
  if (same?.fileDecisions?.[path] === "accepted") return artifacts;
  if (same) {
    return artifacts.map((artifact: Artifact): Artifact =>
      artifact === same
        ? { ...artifact, fileDecisions: { ...artifact.fileDecisions, [path]: decision } }
        : artifact
    );
  }
  if (decision === "rejected") return artifacts;
  return [
    ...artifacts,
    {
      ...withFiles(snapshot, [proposed]),
      id: crypto.randomUUID(),
      fileDecisions: { [path]: decision },
    },
  ];
}

interface MutableDirectory {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory>;
  files: GitTreeNode[];
  additions: number;
  deletions: number;
}

function finalizeDirectory(directory: MutableDirectory): GitTreeNode[] {
  const dirNodes: GitTreeNode[] = Array.from(directory.directories.values())
    .sort((left: MutableDirectory, right: MutableDirectory): number =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    )
    .map((child: MutableDirectory): GitTreeNode => ({
      name: child.name,
      path: child.path,
      kind: "directory",
      children: finalizeDirectory(child),
      additions: child.additions,
      deletions: child.deletions,
    }));

  const fileNodes: GitTreeNode[] = [...directory.files].sort(
    (left: GitTreeNode, right: GitTreeNode): number =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
  );

  return [...dirNodes, ...fileNodes];
}

export function buildGitChangesTree(files: GitDiffFile[]): GitTreeNode[] {
  const root: MutableDirectory = {
    name: "",
    path: "",
    directories: new Map(),
    files: [],
    additions: 0,
    deletions: 0,
  };

  for (const file of files) {
    const parts: string[] = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current: MutableDirectory = root;
    current.additions += file.additions;
    current.deletions += file.deletions;

    for (let index: number = 0; index < parts.length - 1; index += 1) {
      const segment: string = parts[index];
      const nextPath: string = current.path ? `${current.path}/${segment}` : segment;
      let child: MutableDirectory | undefined = current.directories.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: nextPath,
          directories: new Map(),
          files: [],
          additions: 0,
          deletions: 0,
        };
        current.directories.set(segment, child);
      }
      child.additions += file.additions;
      child.deletions += file.deletions;
      current = child;
    }

    const fileName: string = parts[parts.length - 1];
    current.files.push({
      name: fileName,
      path: file.path,
      kind: "file",
      file,
      additions: file.additions,
      deletions: file.deletions,
    });
  }

  return finalizeDirectory(root);
}
