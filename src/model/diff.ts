import type { Artifact, WritePolicy } from "./types";

export type FileDecision = "accepted" | "rejected";
export type DiffLineKind = "added" | "removed" | "context" | "meta";

interface DiffRow {
  marker: " " | "+" | "-";
  text: string;
  noNewline?: boolean;
}

interface Range {
  start: number;
  count: number;
}

interface Hunk {
  before: Range;
  after: Range;
  rows: DiffRow[];
}

export interface FileChange {
  path: string;
  operation: "create" | "update" | "delete";
  hunks: Hunk[];
}

interface DiffFile {
  path?: string;
  change?: FileChange;
  error?: string;
  lines: { text: string; kind: DiffLineKind }[];
  additions: number;
  deletions: number;
}

const NO_NEWLINE = "\\ No newline at end of file";
const lineKinds = { " ": "context", "+": "added", "-": "removed" } as const;

export function isDiffPath(path: string): boolean {
  return path.split("/").every((part) => (
    part.trim() && part.trim() !== "." && part.trim() !== ".." &&
    !/[<>:"\\|?*\p{Cc}\p{Cs}\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(part) &&
    !/[ .]$/u.test(part) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?: *\.|$)/iu.test(part)
  ));
}

function pathKey(path: string) {
  return path.normalize("NFC").toLowerCase();
}

function hunkHeader(line: string): Omit<Hunk, "rows"> | undefined {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:\s.*)?$/u.exec(line);
  if (!match) return;
  const [, oldStart, oldCount = "1", newStart, newCount = "1"] = match;
  const before = { start: Number(oldStart), count: Number(oldCount) };
  const after = { start: Number(newStart), count: Number(newCount) };
  if (
    ![before.start, before.count, after.start, after.count].every(Number.isSafeInteger) ||
    (before.count && !before.start) || (after.count && !after.start) ||
    (!before.count && !after.count)
  ) return;
  return { before, after };
}

function isFileHeader(lines: string[], index: number) {
  return lines[index].startsWith("--- ") && lines[index + 1]?.startsWith("+++ ");
}

function splitDiff(body: string) {
  const normalized = body.replace(/\r\n/gu, "\n");
  const fenced = /^\s*```(?:diff|patch)?[^\S\n]*\n([\s\S]*?)\n```\s*$/u.exec(normalized);
  const lines = (fenced?.[1] ?? normalized).replace(/^\n+|\n+$/gu, "").split("\n");
  const sections: string[][] = [[]];
  let hasHeaders = false;
  let before = 0;
  let after = 0;
  for (const [index, line] of lines.entries()) {
    const inside = before !== 0 || after !== 0;
    const header = !inside && isFileHeader(lines, index);
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
      const range = hunkHeader(line);
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
  if (!token.endsWith('"')) throw new Error("差异中的带引号路径不完整。");
  const quoted = token.slice(1, -1);
  if (/\\(?![0-3][0-7]{2}|["\\])/u.test(quoted)) {
    throw new Error("差异中的路径转义格式不受支持。");
  }
  return quoted.replace(/(?:\\[0-3][0-7]{2})+|\\["\\]/gu, (sequence) => {
    if (sequence.length === 2) return sequence[1];
    try {
      const bytes = sequence.slice(1).split("\\").map((value) => Number.parseInt(value, 8));
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes));
    } catch {
      throw new Error("差异中的路径编码无法读取。");
    }
  });
}

function checkedPath(line: string) {
  const token = pathToken(line.slice(4).split("\t", 1)[0]);
  return token === "/dev/null" ? null : token;
}

function gitPathsMatch(header: string, path: string) {
  const tokens = header.slice("diff --git ".length);
  for (let separator = tokens.indexOf(" "); separator >= 0; separator = tokens.indexOf(" ", separator + 1)) {
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
    lines: lines.map((text) => ({ text, kind: "meta" })),
    additions: 0,
    deletions: 0,
  };
  try {
    const header = lines.findIndex((_, index) => isFileHeader(lines, index));
    if (header === -1) throw new Error("缺少可应用的文件头，仅显示差异。");
    const git = lines[0]?.startsWith("diff --git ");
    let before = checkedPath(lines[header]);
    let after = checkedPath(lines[header + 1]);
    const gitPrefixes = before?.startsWith("a/") && after?.startsWith("b/")
      && before.slice(2) === after.slice(2);
    if (git || gitPrefixes) {
      if ((before !== null && !before.startsWith("a/")) ||
        (after !== null && !after.startsWith("b/"))) {
        throw new Error("Git 差异的文件路径前缀不完整。");
      }
      before = before?.slice(2) ?? null;
      after = after?.slice(2) ?? null;
    }
    file.path = after ?? before ?? undefined;
    const operation = before === null ? "create" : after === null ? "delete" : "update";
    const metadata = lines.slice(git ? 1 : 0, header);
    if (metadata.some((line) => (
      !/^index [\da-f]+\.\.[\da-f]+(?: 100(?:644|755))?$/iu.test(line) &&
      !(operation === "create" && line === "new file mode 100644") &&
      !(operation === "delete" && /^(?:deleted file mode 100(?:644|755))$/u.test(line))
    ))) throw new Error("这份差异包含不支持的文件模式或元数据。");
    const path = file.path;
    if (!path || !isDiffPath(path)) throw new Error("已拒绝。路径必须指向工作区内的文件。");
    if (before !== null && after !== null && before !== after) {
      throw new Error("这份差异更改了文件路径，仅提供预览。");
    }
    if (git && !gitPathsMatch(lines[0], path)) throw new Error("Git 差异中的文件路径不一致。");

    const hunks: Hunk[] = [];
    let index = header + 2;
    while (index < lines.length) {
      const range = hunkHeader(lines[index++]);
      if (!range) throw new Error("差异块的行号格式有误。");
      const rows: DiffRow[] = [];
      let oldCount = 0;
      let newCount = 0;
      while (index < lines.length) {
        const line = lines[index];
        if (line === NO_NEWLINE) {
          const row = rows.at(-1);
          if (!row || row.noNewline) throw new Error("差异中的文件结尾标记有误。");
          row.noNewline = true;
          index++;
          continue;
        }
        if (oldCount === range.before.count && newCount === range.after.count) break;
        const marker = line[0];
        if (marker !== " " && marker !== "+" && marker !== "-") {
          throw new Error("差异块的内容不完整。");
        }
        if (/[\u0000\r\p{Cs}]/u.test(line)) {
          throw new Error("差异块含无法写入的文本编码。");
        }
        rows.push({ marker, text: line.slice(1) });
        file.lines[index].kind = lineKinds[marker];
        index++;
        if (marker !== "+") oldCount++;
        if (marker !== "-") newCount++;
        if (marker === "+") file.additions++;
        if (marker === "-") file.deletions++;
        if (oldCount > range.before.count || newCount > range.after.count) {
          throw new Error("差异块的实际行数与文件头不符。");
        }
      }
      if (oldCount !== range.before.count || newCount !== range.after.count) {
        throw new Error("差异块的实际行数与文件头不符。");
      }
      hunks.push({ ...range, rows });
    }
    if (!hunks.length || (!file.additions && !file.deletions)) {
      throw new Error("这份差异没有可应用的内容。");
    }
    file.change = { path, operation, hunks };
  } catch (error) {
    file.error = error instanceof Error ? error.message : "无法读取差异。";
  }
  return file;
}

export function parseDiff(body: string): DiffFile[] {
  const files = splitDiff(body).map(readFile);
  const counts = new Map<string, number>();
  for (const { change } of files) {
    if (!change) continue;
    const key = pathKey(change.path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return files.map((file) => file.change && (counts.get(pathKey(file.change.path)) ?? 0) > 1
    ? { ...file, change: undefined, error: "同一文件在差异中出现多次，请重新生成。" }
    : file);
}

interface TextLine {
  text: string;
  ending: "\n" | "\r\n" | "";
}

function textLines(text: string): TextLine[] {
  const pieces = text.split("\n");
  return pieces.flatMap<TextLine>((part, index) => {
    if (index === pieces.length - 1) return part ? [{ text: part, ending: "" }] : [];
    if (part.endsWith("\r")) return [{ text: part.slice(0, -1), ending: "\r\n" }];
    return [{ text: part, ending: "\n" }];
  });
}

function rangeOffset({ start, count }: Range) {
  return count ? start - 1 : start;
}

function patchConflict(): never {
  throw new Error("当前文件与差异中的行号或原文不匹配，请重新生成差异。");
}

export function applyDiff(change: FileChange, original: string | null): string | null {
  if (change.operation === "create" ? original !== null : original === null) {
    throw new Error(change.operation === "create" ? "目标文件已存在，请重新生成差异。" : "原文件已移除，请重新生成差异。");
  }
  const source = textLines(original ?? "");
  if (source.some(({ text }) => text.includes("\r"))) throw new Error("当前文件的换行格式不受支持。");
  const ending = source.find((line) => line.ending)?.ending || "\n";
  const result: TextLine[] = [];
  let cursor = 0;
  let previousInsertion = -1;
  for (const hunk of change.hunks) {
    const offset = rangeOffset(hunk.before);
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
      const current = source[cursor++];
      if (!current || current.text !== row.text || (current.ending === "") !== Boolean(row.noNewline)) patchConflict();
      if (row.marker === " ") result.push(current);
    }
  }
  for (; cursor < source.length; cursor++) result.push(source[cursor]);
  if (result.slice(0, -1).some((line) => !line.ending) ||
    (change.operation === "delete" && result.length > 0)) patchConflict();
  if (change.operation === "delete") return null;
  return result.map(({ text, ending: separator }) => text + separator).join("");
}

export function diffPolicyError(change: FileChange, policy: WritePolicy): string | undefined {
  if (policy === "none") return "当前预设只读。";
  if (policy === "docs" && (!/\.md$/iu.test(change.path) || change.operation === "delete")) {
    return "当前预设只允许新建或覆盖 Markdown 文件。";
  }
}

export function diffNeedsConfirmation(change: FileChange) {
  return change.operation === "delete" ||
    /(?:\.lockb?|(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|packages\.lock\.json|go\.sum))$/iu.test(change.path);
}

function fileText(file: DiffFile) {
  return file.lines.map(({ text }) => text).join("\n");
}

function withFiles(artifact: Artifact, files: DiffFile[]): Artifact {
  const retainedPaths = new Set(files.map(({ path }) => path));
  const fileDecisions = Object.fromEntries(Object.entries(artifact.fileDecisions ?? {})
    .filter(([path]) => retainedPaths.has(path)));
  return { ...artifact, body: files.map(fileText).join("\n"), fileDecisions };
}

export function mergeDiffArtifacts(existing: Artifact[], additions: Artifact[]): Artifact[] {
  let merged = existing;
  for (const addition of additions) {
    if (addition.kind !== "diff") {
      merged = [...merged, addition];
      continue;
    }
    const incoming = new Set(parseDiff(addition.body).flatMap(({ change }) => change ? [pathKey(change.path)] : []));
    let previousAccepted = false;
    merged = merged.flatMap((artifact) => {
      if (artifact.kind !== "diff" || artifact.workspaceId !== addition.workspaceId) return [artifact];
      const files = parseDiff(artifact.body);
      const retained = files.filter(({ path }) => {
        if (!path || !incoming.has(pathKey(path))) return true;
        if (artifact.fileDecisions?.[path] !== "accepted") return false;
        previousAccepted = true;
        return true;
      });
      if (files.length === retained.length) return [artifact];
      return retained.length ? [withFiles(artifact, retained)] : [];
    });
    merged.push(previousAccepted
      ? { ...addition, title: `${addition.title} · ${new Date().toLocaleString("zh-CN")}` }
      : addition);
  }
  return merged;
}

export function decideDiffFile(artifacts: Artifact[], snapshot: Artifact, path: string, decision: FileDecision): Artifact[] {
  const proposed = parseDiff(snapshot.body).find(({ change }) => change?.path === path);
  if (!proposed) return artifacts;
  const same = artifacts.find((artifact) => artifact.id === snapshot.id && (
    artifact.body === snapshot.body || parseDiff(artifact.body).some(
      (file) => file.change?.path === path && fileText(file) === fileText(proposed),
    )
  ));
  if (same?.fileDecisions?.[path] === "accepted") return artifacts;
  if (same) return artifacts.map((artifact) => artifact === same
    ? { ...artifact, fileDecisions: { ...artifact.fileDecisions, [path]: decision } }
    : artifact);
  if (decision === "rejected") return artifacts;
  return [...artifacts, {
    ...withFiles(snapshot, [proposed]),
    id: crypto.randomUUID(),
    fileDecisions: { [path]: decision },
  }];
}
