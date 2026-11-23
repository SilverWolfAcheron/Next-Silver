import { ERROR_CODES } from "../src/agent-core/errors.ts";
import {
  CODING_PREFLIGHT_HUNK_MAX_ANCHORS,
  CODING_PREFLIGHT_HUNK_SEARCH_RADIUS,
} from "../src/constants/codingPreflight.ts";
import type { CodingPreflightIssue } from "../src/types/codingPreflight.ts";
import type { DiffHunk, DiffRow, FileChange } from "../src/types/diff.ts";
import type { ErrorCode } from "../src/types/errors.ts";
import { errorCodingIssue } from "./codingPreflightPaths.ts";

type ConflictLines = Pick<CodingPreflightIssue, "expectedLine" | "nearbyLine">;

function originalRows(hunk: DiffHunk): DiffRow[] {
  return hunk.rows.filter(({ marker }: DiffRow): boolean => marker !== "+");
}

function matchRows(source: readonly string[], rows: readonly DiffRow[], offset: number): boolean {
  if (offset < 0 || offset + rows.length > source.length) return false;
  for (let index: number = 0; index < rows.length; index++) {
    if (source[offset + index] !== rows[index].text) return false;
  }
  return true;
}

function uniqueNearbyMatch(source: readonly string[], rows: readonly DiffRow[], offset: number): number | undefined {
  if (rows.length < 2 || rows.length > CODING_PREFLIGHT_HUNK_MAX_ANCHORS ||
    rows.every(({ text }: DiffRow): boolean => text.trim() === "")) return;
  const start: number = Math.max(0, offset - CODING_PREFLIGHT_HUNK_SEARCH_RADIUS);
  const end: number = Math.min(source.length - rows.length, offset + CODING_PREFLIGHT_HUNK_SEARCH_RADIUS);
  let match: number | undefined;
  for (let candidate: number = start; candidate <= end; candidate++) {
    if (!matchRows(source, rows, candidate)) continue;
    if (match !== undefined) return;
    match = candidate + 1;
  }
  return match;
}

/** Return coordinates only. Matching is advisory and must never change hunk placement. */
export function locateCodingConflict(change: FileChange, before: string | null): ConflictLines {
  if (before === null) return {};
  const source: string[] = before.split(/\r?\n/u);
  if (before.endsWith("\n") || before.length === 0) source.pop();
  for (const hunk of change.hunks) {
    const rows: DiffRow[] = originalRows(hunk);
    const offset: number = hunk.before.count ? hunk.before.start - 1 : hunk.before.start;
    if (!rows.length) return { expectedLine: offset + 1 };
    if (matchRows(source, rows, offset)) continue;
    return { expectedLine: offset + 1, nearbyLine: uniqueNearbyMatch(source, rows, offset) };
  }
  return {};
}

export function codingApplyIssue(code: ErrorCode, artifactId: string, change: FileChange): CodingPreflightIssue {
  const fields: { artifactId: string; path: string; } = { artifactId, path: change.path };
  switch (code) {
    case ERROR_CODES.DIFF_CONFLICT:
      return errorCodingIssue(code, "stale_hunk", fields);
    case ERROR_CODES.DIFF_TARGET_EXISTS:
      return errorCodingIssue(code, "target_exists", fields);
    case ERROR_CODES.DIFF_SOURCE_MISSING:
      return errorCodingIssue(code, "source_missing", fields);
    default:
      return errorCodingIssue(code, "malformed", fields);
  }
}
