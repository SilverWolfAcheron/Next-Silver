import type { WritePolicy } from "../agent-core/types";
import type { FileChange } from "./diff";
import type { ErrorCode, ErrorParams } from "./errors";

export type CodingPreflightReason =
  | "artifact_workspace"
  | "artifact_limit"
  | "patch_limit"
  | "patch_line_limit"
  | "file_limit"
  | "malformed"
  | "duplicate_path"
  | "path_collision"
  | "protected_path"
  | "scope"
  | "policy"
  | "read"
  | "source_missing"
  | "target_exists"
  | "stale_hunk"
  | "result_limit"
  | "snapshot_limit"
  | "rejected"
  | "snapshot_changed"
  | "delete"
  | "lockfile"
  | "execution_config"
  | "bulk_change";

export type CodingPreflightStatus = "ready" | "needs_confirmation" | "invalid";

export interface CodingPreflightIssue {
  severity: "error" | "confirmation";
  code: ErrorCode;
  reason: CodingPreflightReason;
  params?: ErrorParams;
  artifactId?: string;
  /** Safe workspace-relative path, never a host path or source line. */
  path?: string;
  /** Old-side line named in the patch, if the conflict can be narrowed to a hunk. */
  expectedLine?: number;
  /** One exact local context match nearby, for re-reading only, not automatic relocation. */
  nearbyLine?: number;
  /** For budget findings only. */
  limit?: number;
}

export interface CodingPreflightFile {
  artifactId: string;
  path: string;
  operation: FileChange["operation"];
  status: "verified" | "invalid";
  additions: number;
  deletions: number;
  hunks: number;
  beforeBytes?: number;
  afterBytes?: number;
}

export interface CodingPreflightStats {
  artifacts: number;
  files: number;
  verified: number;
  created: number;
  updated: number;
  deleted: number;
  additions: number;
  deletions: number;
  patchBytes: number;
  patchLines: number;
  snapshotBytes: number;
}

export interface CodingPreflightWrite {
  artifactId: string;
  path: string;
  before: string | null;
  after: string | null;
}

export interface CodingPreflightReport {
  status: CodingPreflightStatus;
  stats: CodingPreflightStats;
  files: CodingPreflightFile[];
  issues: CodingPreflightIssue[];
  /** CLI-only data for guarded writes. Never send this field to a model. */
  writes: CodingPreflightWrite[];
}

export interface CodingPreflightOptions {
  policy?: WritePolicy;
  signal?: AbortSignal;
  /** Exact paths. An empty scope permits no writes; omission means no seat restriction. */
  scope?: readonly string[];
}

export interface CodingSnapshotOptions {
  signal?: AbortSignal;
  /** Recovery may encounter a write already completed before the last persisted checkpoint. */
  allowAlreadyApplied?: boolean;
}

export interface CodingSnapshotResult {
  issues: CodingPreflightIssue[];
  alreadyApplied: string[];
}
