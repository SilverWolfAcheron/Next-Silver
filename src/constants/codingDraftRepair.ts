import type { CodingPreflightReason } from "../types/codingPreflight.ts";

export const CODING_REPAIR_SOURCE_CHARS: number = 14_000;
export const CODING_REPAIR_ISSUES: number = 12;
export const CODING_REPAIR_REASONS: ReadonlySet<CodingPreflightReason> = new Set([
  "malformed", "duplicate_path", "stale_hunk", "source_missing", "target_exists",
]);
