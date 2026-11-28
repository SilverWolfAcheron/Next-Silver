import {
  CODING_PREFLIGHT_ENV_TEMPLATE,
  CODING_PREFLIGHT_EXECUTION_FILE,
  CODING_PREFLIGHT_EXECUTION_PATH,
  CODING_PREFLIGHT_EXTRA_LOCKFILE,
  CODING_PREFLIGHT_MAX_PATH_CHARS,
  CODING_PREFLIGHT_PROTECTED_SEGMENTS,
  CODING_PREFLIGHT_SECRET_FILE,
} from "../src/constants/codingPreflight.ts";
import { ERROR_CODES } from "../src/agent-core/errors.ts";
import type { CodingPreflightIssue, CodingPreflightReason } from "../src/types/codingPreflight.ts";
import type { FileChange } from "../src/types/diff.ts";
import type { ErrorCode, ErrorParams } from "../src/types/errors.ts";
import { diffNeedsConfirmation } from "../src/utils/diff.ts";
import { splitWorkspacePath } from "./workspace.ts";

export function codingPathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function isCodingReviewPath(path: string): boolean {
  if (path.length > CODING_PREFLIGHT_MAX_PATH_CHARS) return false;
  try {
    return splitWorkspacePath(path).length > 0;
  } catch {
    return false;
  }
}

export function safeCodingIssuePath(path?: string): string | undefined {
  return path && isCodingReviewPath(path) ? path : undefined;
}

export function isProtectedCodingPath(path: string): boolean {
  const parts: string[] = codingPathKey(path).split("/");
  return parts.some((part: string): boolean =>
    CODING_PREFLIGHT_PROTECTED_SEGMENTS.has(part) ||
    (CODING_PREFLIGHT_SECRET_FILE.test(part) && !CODING_PREFLIGHT_ENV_TEMPLATE.test(part)));
}

type IssueFields = Omit<CodingPreflightIssue, "severity" | "code" | "reason" | "params">;

function issueParams(fields: IssueFields): ErrorParams | undefined {
  const { path, limit, expectedLine, nearbyLine }: IssueFields = fields;
  const params: ErrorParams = {};
  if (path !== undefined) params.path = path;
  if (limit !== undefined) params.limit = limit;
  if (expectedLine !== undefined) params.expectedLine = expectedLine;
  if (nearbyLine !== undefined) params.nearbyLine = nearbyLine;
  return Object.keys(params).length ? params : undefined;
}

export function errorCodingIssue(
  code: ErrorCode,
  reason: CodingPreflightReason,
  fields: IssueFields = {}
): CodingPreflightIssue {
  return { severity: "error", code, reason, params: issueParams(fields), ...fields };
}

export function confirmationCodingIssue(
  reason: CodingPreflightReason,
  fields: IssueFields = {}
): CodingPreflightIssue {
  return { severity: "confirmation", code: ERROR_CODES.DIFF_CONFIRMATION_REQUIRED, reason, params: issueParams(fields), ...fields };
}

export function codingRiskReasons(change: FileChange): CodingPreflightReason[] {
  const result: CodingPreflightReason[] = [];
  const name: string = change.path.split("/").at(-1) ?? "";
  if (change.operation === "delete") result.push("delete");
  // Test lockfile policy independently of the operation so a removed lockfile reports both risks.
  if (diffNeedsConfirmation({ ...change, operation: "update" }) || CODING_PREFLIGHT_EXTRA_LOCKFILE.test(name)) {
    result.push("lockfile");
  }
  if (CODING_PREFLIGHT_EXECUTION_FILE.test(name) || CODING_PREFLIGHT_EXECUTION_PATH.test(change.path)) {
    result.push("execution_config");
  }
  return result;
}

/** Canonical collisions including a file proposed as the parent of another proposed file. */
export function collidingCodingPaths(paths: Iterable<string>): Map<string, string> {
  const byKey: Map<string, string> = new Map();
  for (const path of paths) byKey.set(codingPathKey(path), path);
  const collisions: Map<string, string> = new Map();
  for (const [key, path] of byKey) {
    for (let separator: number = key.indexOf("/"); separator !== -1; separator = key.indexOf("/", separator + 1)) {
      const prefix: string = key.slice(0, separator);
      const parent: string | undefined = byKey.get(prefix);
      if (parent === undefined) continue;
      collisions.set(key, parent);
      if (!collisions.has(prefix)) collisions.set(prefix, path);
    }
  }
  return collisions;
}
