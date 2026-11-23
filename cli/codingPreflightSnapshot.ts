import { ERROR_CODES, extractErrorCode } from "../src/agent-core/errors.ts";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import { CODING_PREFLIGHT_MAX_FILES } from "../src/constants/codingPreflight.ts";
import type {
  CodingPreflightIssue,
  CodingPreflightWrite,
  CodingSnapshotOptions,
  CodingSnapshotResult,
} from "../src/types/codingPreflight.ts";
import type { ErrorCode } from "../src/types/errors.ts";
import {
  codingPathKey,
  collidingCodingPaths,
  errorCodingIssue,
  isProtectedCodingPath,
  safeCodingIssuePath,
} from "./codingPreflightPaths.ts";
import { readWorkspaceFileIfExists } from "./workspace.ts";

/**
 * Compare a saved write batch with disk again before the first mutation.
 * This detects drift after review/approval, but is not a transaction: callers must
 * retain their per-write expectedBefore guards against concurrent external edits.
 */
export async function verifyCodingWriteSnapshot(
  workspace: WorkspaceSummary,
  writes: readonly CodingPreflightWrite[],
  options: CodingSnapshotOptions = {}
): Promise<CodingSnapshotResult> {
  const issues: CodingPreflightIssue[] = [];
  const alreadyApplied: string[] = [];
  options.signal?.throwIfAborted();
  if (writes.length > CODING_PREFLIGHT_MAX_FILES) {
    return {
      issues: [errorCodingIssue(ERROR_CODES.DIFF_APPLY_FAILED, "file_limit", { limit: CODING_PREFLIGHT_MAX_FILES })],
      alreadyApplied,
    };
  }
  const collisions: Map<string, string> = collidingCodingPaths(writes.map(({ path }: CodingPreflightWrite): string => path));
  const seen: Set<string> = new Set();
  for (const write of writes) {
    const path: string | undefined = safeCodingIssuePath(write.path);
    const fields: { artifactId: string; path?: string; } = { artifactId: write.artifactId, path };
    options.signal?.throwIfAborted();
    if (!path || isProtectedCodingPath(path)) {
      issues.push(errorCodingIssue(ERROR_CODES.WORKSPACE_INVALID_PATH, "protected_path", fields));
      continue;
    }
    const key: string = codingPathKey(path);
    if (seen.has(key) || collisions.has(key)) {
      issues.push(errorCodingIssue(ERROR_CODES.ITERATION_CONFLICTING_DIFF,
        seen.has(key) ? "duplicate_path" : "path_collision", fields));
      continue;
    }
    seen.add(key);
    let current: string | null;
    try {
      current = await readWorkspaceFileIfExists(workspace, path, { allowMissingParent: true });
      options.signal?.throwIfAborted();
    } catch (error) {
      options.signal?.throwIfAborted();
      const { code }: { code: ErrorCode } = extractErrorCode(error, ERROR_CODES.WORKSPACE_ACCESS_FAILED);
      issues.push(errorCodingIssue(code, "read", fields));
      continue;
    }
    if (current === write.before) continue;
    if (options.allowAlreadyApplied && current === write.after) {
      alreadyApplied.push(path);
    } else {
      issues.push(errorCodingIssue(ERROR_CODES.ITERATION_FILE_MODIFIED, "snapshot_changed", fields));
    }
  }
  options.signal?.throwIfAborted();
  return { issues, alreadyApplied };
}
