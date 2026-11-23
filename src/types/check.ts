import type { ErrorCode } from "./errors.ts";

export type CheckName = "test" | "typecheck" | "build";

export interface CheckEnvironmentOptions {
  signal?: AbortSignal;
  /** Host-provided npm program path, never a model or workspace input. */
  npmCli?: string;
  cwd?: string;
}

export interface CheckOptions extends CheckEnvironmentOptions {
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface CheckDiagnostic {
  path: string;
  line: number;
  column?: number;
  severity: "error" | "warning";
  code?: string;
  message: string;
}

export interface CheckResult {
  command: string;
  exitCode: number | null;
  signal?: string;
  output: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  outputTruncated: boolean;
  diagnostics: CheckDiagnostic[];
}

export type CheckAvailability =
  | { check: CheckName; available: true; command: string }
  | { check: CheckName; available: false; errorCode: ErrorCode };

export interface CheckCommand {
  command: string;
  argv: string[];
}

export interface CheckProcessOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputChars: number;
}

export interface CheckCapture {
  stdout: string;
  stderr: string;
  output: string;
  outputTruncated: boolean;
}

export interface CheckProcessResult extends CheckCapture {
  exitCode: number | null;
  signal?: string;
  durationMs: number;
  timedOut: boolean;
}
