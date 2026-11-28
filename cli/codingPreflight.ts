import { ERROR_CODES, extractErrorCode } from "../src/agent-core/errors.ts";
import type { Artifact, WorkspaceSummary, WritePolicy } from "../src/agent-core/types.ts";
import {
  CODING_PREFLIGHT_BULK_FILE_COUNT,
  CODING_PREFLIGHT_MAX_ARTIFACTS,
  CODING_PREFLIGHT_MAX_FILES,
  CODING_PREFLIGHT_MAX_PATCH_BYTES,
  CODING_PREFLIGHT_MAX_PATCH_LINES,
  CODING_PREFLIGHT_MAX_SNAPSHOT_BYTES,
} from "../src/constants/codingPreflight.ts";
import { FILE_EDIT_MAX_TEXT_BYTES } from "../src/constants/fileEdit.ts";
import type {
  CodingPreflightFile,
  CodingPreflightIssue,
  CodingPreflightOptions,
  CodingPreflightReason,
  CodingPreflightReport,
  CodingPreflightStats,
  CodingPreflightStatus,
  CodingPreflightWrite,
} from "../src/types/codingPreflight.ts";
import type { DiffFile, FileChange } from "../src/types/diff.ts";
import type { ErrorCode } from "../src/types/errors.ts";
import { applyDiff, diffPolicyError, parseDiff } from "../src/utils/diff.ts";
import { codingApplyIssue, locateCodingConflict } from "./codingPreflightConflict.ts";
import {
  codingPathKey,
  codingRiskReasons,
  collidingCodingPaths,
  confirmationCodingIssue,
  errorCodingIssue,
  isProtectedCodingPath,
  safeCodingIssuePath,
} from "./codingPreflightPaths.ts";
import { readWorkspaceFileIfExists } from "./workspace.ts";

export { verifyCodingWriteSnapshot } from "./codingPreflightSnapshot.ts";

interface Candidate {
  change: FileChange;
  metadata: CodingPreflightFile;
  rejected: boolean;
}

interface ReviewState {
  issues: CodingPreflightIssue[];
  files: CodingPreflightFile[];
  stats: CodingPreflightStats;
  writes: CodingPreflightWrite[];
  candidates: Candidate[];
}

interface CandidatePolicy {
  policy: WritePolicy;
  scope?: Set<string>;
  counts: Map<string, number>;
  collisions: Map<string, string>;
}

function initReview(): ReviewState {
  return {
    issues: [],
    files: [],
    stats: {
      artifacts: 0, files: 0, verified: 0, created: 0, updated: 0, deleted: 0,
      additions: 0, deletions: 0, patchBytes: 0, patchLines: 0, snapshotBytes: 0,
    },
    writes: [],
    candidates: [],
  };
}

function summarize(state: ReviewState): CodingPreflightReport {
  const { issues, files, stats }: ReviewState = state;
  const status: CodingPreflightStatus = issues.some(({ severity }: CodingPreflightIssue): boolean => severity === "error")
    ? "invalid" : issues.length ? "needs_confirmation" : "ready";
  return { status, issues, files, stats, writes: status === "invalid" ? [] : state.writes };
}

// Bound line-object allocations before splitting model-controlled text in the diff parser.
function countPatchLines(body: string, remaining: number): number {
  if (!body.length) return 0;
  let count: number = body.endsWith("\n") ? 0 : 1;
  for (let index: number = body.indexOf("\n"); index !== -1 && count <= remaining; index = body.indexOf("\n", index + 1)) {
    count++;
  }
  return count;
}

function countArtifact(artifact: Artifact, state: ReviewState): boolean {
  const { stats, issues }: ReviewState = state;
  if (stats.artifacts >= CODING_PREFLIGHT_MAX_ARTIFACTS) {
    issues.push(errorCodingIssue(ERROR_CODES.DIFF_APPLY_FAILED, "artifact_limit", {
      limit: CODING_PREFLIGHT_MAX_ARTIFACTS,
    }));
    return false;
  }
  stats.artifacts++;
  stats.patchBytes += Buffer.byteLength(artifact.body);
  if (stats.patchBytes > CODING_PREFLIGHT_MAX_PATCH_BYTES) {
    issues.push(errorCodingIssue(ERROR_CODES.DIFF_APPLY_FAILED, "patch_limit", {
      artifactId: artifact.id, limit: CODING_PREFLIGHT_MAX_PATCH_BYTES,
    }));
    return false;
  }
  stats.patchLines += countPatchLines(artifact.body, CODING_PREFLIGHT_MAX_PATCH_LINES - stats.patchLines);
  if (stats.patchLines > CODING_PREFLIGHT_MAX_PATCH_LINES) {
    issues.push(errorCodingIssue(ERROR_CODES.DIFF_APPLY_FAILED, "patch_line_limit", {
      artifactId: artifact.id, limit: CODING_PREFLIGHT_MAX_PATCH_LINES,
    }));
    return false;
  }
  return true;
}

function collectCandidate(artifact: Artifact, item: DiffFile, state: ReviewState): void {
  const { stats, issues, files, candidates }: ReviewState = state;
  const { change, additions, deletions }: DiffFile = item;
  const { id: artifactId }: Artifact = artifact;
  const path: string | undefined = safeCodingIssuePath(item.path);
  if (!change || !path) {
    const { code }: { code: ErrorCode } = extractErrorCode(item.error, ERROR_CODES.WORKSPACE_INVALID_PATH);
    const reason: CodingPreflightReason = code === ERROR_CODES.DIFF_DUPLICATE_FILE ? "duplicate_path" : "malformed";
    issues.push(errorCodingIssue(code, reason, { artifactId, path }));
    return;
  }
  const metadata: CodingPreflightFile = {
    artifactId, path, operation: change.operation, status: "invalid", additions, deletions, hunks: change.hunks.length,
  };
  files.push(metadata);
  candidates.push({ change, metadata, rejected: artifact.fileDecisions?.[path] === "rejected" });
  stats.additions += additions;
  stats.deletions += deletions;
  switch (change.operation) {
    case "create":
      stats.created++;
      break;
    case "update":
      stats.updated++;
      break;
    case "delete":
      stats.deleted++;
      break;
  }
}

function collectArtifacts(
  workspace: WorkspaceSummary,
  artifacts: readonly Artifact[],
  options: CodingPreflightOptions
): ReviewState {
  const state: ReviewState = initReview();
  const { stats, issues }: ReviewState = state;
  for (const artifact of artifacts) {
    options.signal?.throwIfAborted();
    if (artifact.kind !== "diff") continue;
    if (!countArtifact(artifact, state)) return state;
    if (artifact.workspaceId !== workspace.id) {
      issues.push(errorCodingIssue(ERROR_CODES.DIFF_WORKSPACE_UNBOUND, "artifact_workspace", {
        artifactId: artifact.id,
      }));
      continue;
    }
    const entries: DiffFile[] = parseDiff(artifact.body);
    if (stats.files + entries.length > CODING_PREFLIGHT_MAX_FILES) {
      issues.push(errorCodingIssue(ERROR_CODES.DIFF_APPLY_FAILED, "file_limit", {
        artifactId: artifact.id, limit: CODING_PREFLIGHT_MAX_FILES,
      }));
      return state;
    }
    stats.files += entries.length;
    for (const entry of entries) collectCandidate(artifact, entry, state);
  }
  return state;
}

function buildPolicy(candidates: readonly Candidate[], options: CodingPreflightOptions): CandidatePolicy {
  const counts: Map<string, number> = new Map();
  const paths: Set<string> = new Set();
  for (const { change: { path } } of candidates) {
    const key: string = codingPathKey(path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    paths.add(path);
  }
  return {
    counts, collisions: collidingCodingPaths(paths), policy: options.policy ?? "code",
    scope: options.scope ? new Set(options.scope) : undefined,
  };
}

function findCandidateIssue(candidate: Candidate, rules: CandidatePolicy): CodingPreflightIssue | undefined {
  const { change, metadata: { artifactId, path }, rejected }: Candidate = candidate;
  const fields: { artifactId: string; path: string; } = { artifactId, path };
  const key: string = codingPathKey(path);
  if ((rules.counts.get(key) ?? 0) > 1) {
    return errorCodingIssue(ERROR_CODES.ITERATION_CONFLICTING_DIFF, "duplicate_path", fields);
  }
  if (rules.collisions.has(key)) {
    return errorCodingIssue(ERROR_CODES.ITERATION_CONFLICTING_DIFF, "path_collision", fields);
  }
  if (isProtectedCodingPath(path)) {
    return errorCodingIssue(ERROR_CODES.WORKSPACE_INVALID_PATH, "protected_path", fields);
  }
  if (rules.scope && !rules.scope.has(path)) {
    return errorCodingIssue(ERROR_CODES.SEAT_SCOPE_EXCEEDED, "scope", fields);
  }
  const restriction: ErrorCode | undefined = diffPolicyError(change, rules.policy);
  if (restriction) return errorCodingIssue(restriction, "policy", fields);
  if (rejected) return errorCodingIssue(ERROR_CODES.DIFF_FILE_REJECTED, "rejected", fields);
}

function canVerifyAtAll(issues: readonly CodingPreflightIssue[]): boolean {
  return !issues.some(({ reason }: CodingPreflightIssue): boolean =>
    reason === "artifact_limit" || reason === "file_limit" || reason === "patch_limit" || reason === "patch_line_limit");
}

async function verifyCandidate(
  workspace: WorkspaceSummary,
  candidate: Candidate,
  signal?: AbortSignal
): Promise<CodingPreflightIssue | CodingPreflightWrite> {
  const { change, metadata }: Candidate = candidate;
  const { artifactId, path }: CodingPreflightFile = metadata;
  const fields: { artifactId: string; path: string; } = { artifactId, path };
  let before: string | null;
  try {
    // A missing parent represents an absent target here. This check never creates it.
    before = await readWorkspaceFileIfExists(workspace, path, { allowMissingParent: true });
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    const { code }: { code: ErrorCode } = extractErrorCode(error, ERROR_CODES.WORKSPACE_ACCESS_FAILED);
    return errorCodingIssue(code, "read", fields);
  }
  let after: string | null;
  try {
    after = applyDiff(change, before);
  } catch (error) {
    const { code }: { code: ErrorCode } = extractErrorCode(error, ERROR_CODES.DIFF_APPLY_FAILED);
    const issue: CodingPreflightIssue = codingApplyIssue(code, artifactId, change);
    return code === ERROR_CODES.DIFF_CONFLICT
      ? errorCodingIssue(issue.code, issue.reason, { ...fields, ...locateCodingConflict(change, before) })
      : issue;
  }
  if (after !== null && Buffer.byteLength(after) > FILE_EDIT_MAX_TEXT_BYTES) {
    return errorCodingIssue(ERROR_CODES.WORKSPACE_WRITE_INVALID, "result_limit", { ...fields, limit: FILE_EDIT_MAX_TEXT_BYTES });
  }
  return { artifactId, path, before, after };
}

function retainVerifiedWrite(state: ReviewState, candidate: Candidate, write: CodingPreflightWrite): boolean {
  const { metadata, change }: Candidate = candidate;
  const beforeBytes: number = Buffer.byteLength(write.before ?? "");
  const afterBytes: number = Buffer.byteLength(write.after ?? "");
  if (state.stats.snapshotBytes + beforeBytes + afterBytes > CODING_PREFLIGHT_MAX_SNAPSHOT_BYTES) {
    state.issues.push(errorCodingIssue(ERROR_CODES.WORKSPACE_WRITE_INVALID, "snapshot_limit", {
      artifactId: write.artifactId, path: write.path, limit: CODING_PREFLIGHT_MAX_SNAPSHOT_BYTES,
    }));
    return false;
  }
  metadata.status = "verified";
  metadata.beforeBytes = beforeBytes;
  metadata.afterBytes = afterBytes;
  state.stats.snapshotBytes += beforeBytes + afterBytes;
  state.stats.verified++;
  for (const reason of codingRiskReasons(change)) {
    state.issues.push(confirmationCodingIssue(reason, { artifactId: write.artifactId, path: write.path }));
  }
  // An identical replacement is not a mutation. Existing artifact acceptance still records the result.
  state.writes.push(write);
  return true;
}

/**
 * Read-only review of one batch of model artifacts. Every write remains optimistic:
 * apply paths must still use expectedBefore and check current user decisions.
 */
export async function preflightCodingChanges(
  workspace: WorkspaceSummary,
  artifacts: readonly Artifact[],
  options: CodingPreflightOptions = {}
): Promise<CodingPreflightReport> {
  options.signal?.throwIfAborted();
  const state: ReviewState = collectArtifacts(workspace, artifacts, options);
  if (!canVerifyAtAll(state.issues)) return summarize(state);
  const rules: CandidatePolicy = buildPolicy(state.candidates, options);
  for (const candidate of state.candidates) {
    options.signal?.throwIfAborted();
    const invalid: CodingPreflightIssue | undefined = findCandidateIssue(candidate, rules);
    if (invalid) {
      state.issues.push(invalid);
      continue;
    }
    const result: CodingPreflightIssue | CodingPreflightWrite = await verifyCandidate(workspace, candidate, options.signal);
    if ("severity" in result) {
      state.issues.push(result);
      continue;
    }
    if (!retainVerifiedWrite(state, candidate, result)) break;
  }
  if (state.writes.length > CODING_PREFLIGHT_BULK_FILE_COUNT) {
    state.issues.push(confirmationCodingIssue("bulk_change", { limit: CODING_PREFLIGHT_BULK_FILE_COUNT }));
  }
  options.signal?.throwIfAborted();
  return summarize(state);
}
