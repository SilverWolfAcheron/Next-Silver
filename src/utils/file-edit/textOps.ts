import { AppError, ERROR_CODES } from "../../agent-core/errors.ts";
import { FILE_EDIT_DEFAULT_LINE_ENDING } from "../../constants/fileEdit.ts";
import type {
  LineEnding,
  TextAppendParams,
  TextAppendResult,
  TextLineDeleteParams,
  TextLineDeleteResult,
  TextLineReplaceParams,
  TextLineReplaceResult,
} from "../../types/fileEdit";

interface ParsedLines {
  lines: string[];
  ending: LineEnding;
  hasTrailingNewline: boolean;
}

export function detectLineEnding(content: string): LineEnding {
  return content.includes("\r\n") ? "\r\n" : FILE_EDIT_DEFAULT_LINE_ENDING;
}

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/gu, "\n");
}

export function restoreLineEndings(content: string, ending: LineEnding): string {
  const normalized: string = normalizeLineEndings(content);
  return ending === "\r\n" ? normalized.replace(/\n/gu, "\r\n") : normalized;
}

function parseLines(content: string): ParsedLines {
  const ending: LineEnding = detectLineEnding(content);
  if (!content) {
    return { lines: [], ending, hasTrailingNewline: false };
  }
  const normalized: string = normalizeLineEndings(content);
  const hasTrailingNewline: boolean = normalized.endsWith("\n");
  const trimmed: string = hasTrailingNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: trimmed.split("\n"),
    ending,
    hasTrailingNewline,
  };
}

function joinLines(lines: string[], ending: LineEnding, hasTrailingNewline: boolean): string {
  if (lines.length === 0) return "";
  const joined: string = lines.join(ending);
  return hasTrailingNewline ? `${joined}${ending}` : joined;
}

function assertLineRange(startLine: number, endLine: number, lineCount: number): void {
  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine > lineCount
  ) {
    throw new AppError(ERROR_CODES.FILE_EDIT_LINE_RANGE_INVALID);
  }
}

export function countTextLines(content: string): number {
  return parseLines(content).lines.length;
}

export function replaceLinesInText(params: TextLineReplaceParams): TextLineReplaceResult {
  const { content, startLine, endLine, replacement }: TextLineReplaceParams = params;
  const parsed: ParsedLines = parseLines(content);
  assertLineRange(startLine, endLine, parsed.lines.length);

  const normalizedReplacement: string = normalizeLineEndings(replacement);
  const replacementLines: string[] = normalizedReplacement.split("\n");
  const nextLines: string[] = [
    ...parsed.lines.slice(0, startLine - 1),
    ...replacementLines,
    ...parsed.lines.slice(endLine),
  ];

  return {
    content: joinLines(nextLines, parsed.ending, parsed.hasTrailingNewline),
    lineCount: nextLines.length,
    replacedCount: endLine - startLine + 1,
  };
}

export function appendTextToContent(params: TextAppendParams): TextAppendResult {
  const { content, addition, ensureNewline = true }: TextAppendParams = params;
  if (!addition) {
    return {
      content,
      lineCount: countTextLines(content),
    };
  }

  const ending: LineEnding = content ? detectLineEnding(content) : detectLineEnding(addition);
  const alignedAddition: string = restoreLineEndings(addition, ending);
  const needsSeparator: boolean =
    content.length > 0 && ensureNewline && !content.endsWith("\n") && !alignedAddition.startsWith("\n");
  const nextContent: string = needsSeparator
    ? `${content}${ending}${alignedAddition}`
    : `${content}${alignedAddition}`;

  return {
    content: nextContent,
    lineCount: countTextLines(nextContent),
  };
}

export function deleteLinesInText(params: TextLineDeleteParams): TextLineDeleteResult {
  const { content, startLine, endLine }: TextLineDeleteParams = params;
  const parsed: ParsedLines = parseLines(content);
  assertLineRange(startLine, endLine, parsed.lines.length);

  const nextLines: string[] = [
    ...parsed.lines.slice(0, startLine - 1),
    ...parsed.lines.slice(endLine),
  ];

  return {
    content: joinLines(nextLines, parsed.ending, parsed.hasTrailingNewline),
    lineCount: nextLines.length,
    deletedCount: endLine - startLine + 1,
  };
}
