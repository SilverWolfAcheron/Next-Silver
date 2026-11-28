import { AppError, ERROR_CODES, extractErrorCode } from "../src/agent-core/errors.ts";
import {
  CHECK_LABELS, CHECK_NAMES, CHECK_OUTPUT_DEFAULT_CHARS, CHECK_OUTPUT_MAX_CHARS, CHECK_OUTPUT_MIN_CHARS,
  CHECK_TIMEOUT_DEFAULT_MS, CHECK_TIMEOUT_MAX_MS, CHECK_TIMEOUT_NOTICE,
} from "../src/constants/check.ts";
import type {
  CheckAvailability, CheckCommand, CheckEnvironmentOptions, CheckName, CheckOptions, CheckProcessResult, CheckResult,
} from "../src/types/check.ts";
import { extractCheckDiagnostics } from "./checkDiagnostics.ts";
import { commandFor, findNpm, readPackageChecks, resolveCheckLocation } from "./checkPlan.ts";
import { runCheckProcess } from "./checkProcess.ts";
import type { WorkspaceSummary } from "./workspace.ts";

export type { CheckAvailability, CheckEnvironmentOptions, CheckName, CheckOptions, CheckResult };

export function checkLabel(check: CheckName): string {
  return CHECK_LABELS[check];
}

function isCheckName(value: unknown): value is CheckName {
  return CHECK_NAMES.some((check: CheckName): boolean => check === value);
}

export function checkName(value: unknown): CheckName {
  if (isCheckName(value)) return value;
  if (value === "npm test") return "test";
  if (value === "npm run build") return "build";
  if (value === "npm run typecheck" || value === "npm run type-check") return "typecheck";
  throw new AppError(ERROR_CODES.CHECK_COMMAND_UNSUPPORTED);
}

function boundedInteger(value: number | undefined, fallback: number, limits: { min: number; max: number }): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.trunc(value)));
}

export async function inspectChecks(workspace: WorkspaceSummary, options: CheckEnvironmentOptions = {}): Promise<CheckAvailability[]> {
  const { cwd }: Awaited<ReturnType<typeof resolveCheckLocation>> = await resolveCheckLocation(workspace, options);
  const packageData: Promise<Awaited<ReturnType<typeof readPackageChecks>>> = readPackageChecks(cwd);
  // Convert a malformed or unreadable manifest into unavailable entries without exposing its text.
  const pkg: Awaited<ReturnType<typeof readPackageChecks>> | null = await packageData.catch((): null => null);
  options.signal?.throwIfAborted();
  if (!pkg) {
    return CHECK_NAMES.map((check: CheckName): CheckAvailability => ({
      check, available: false, errorCode: ERROR_CODES.CHECK_EXECUTION_FAILED,
    }));
  }
  const result: CheckAvailability[] = [];
  let npm: Promise<string> | undefined;
  for (const check of CHECK_NAMES) {
    options.signal?.throwIfAborted();
    try {
      const plan: CheckCommand = await commandFor(check, pkg, { cwd, npm: (): Promise<string> => npm ??= findNpm(options.npmCli) });
      result.push({ check, available: true, command: plan.command });
    } catch (error) {
      const { code }: ReturnType<typeof extractErrorCode> = extractErrorCode(error, ERROR_CODES.CHECK_EXECUTION_FAILED);
      result.push({ check, available: false, errorCode: code });
    }
  }
  options.signal?.throwIfAborted();
  return result;
}

export async function runCheck(
  workspace: WorkspaceSummary, requested: CheckName, options: CheckOptions = {}
): Promise<CheckResult> {
  const check: CheckName = checkName(requested);
  const location: Awaited<ReturnType<typeof resolveCheckLocation>> = await resolveCheckLocation(workspace, options);
  const pkg: Awaited<ReturnType<typeof readPackageChecks>> = await readPackageChecks(location.cwd);
  const plan: CheckCommand = await commandFor(check, pkg, { cwd: location.cwd, npm: (): Promise<string> => findNpm(options.npmCli) });
  const timeoutMs: number = boundedInteger(options.timeoutMs, CHECK_TIMEOUT_DEFAULT_MS, { min: 1, max: CHECK_TIMEOUT_MAX_MS });
  const maxOutputChars: number = boundedInteger(options.maxOutputChars, CHECK_OUTPUT_DEFAULT_CHARS, {
    min: CHECK_OUTPUT_MIN_CHARS, max: CHECK_OUTPUT_MAX_CHARS,
  });
  const result: CheckProcessResult = await runCheckProcess(plan, {
    cwd: location.cwd, signal: options.signal, timeoutMs, maxOutputChars,
  });
  const diagnostics: CheckResult["diagnostics"] = extractCheckDiagnostics(result.outputTruncated
    ? result.stdout + "\n" + result.stderr : result.output, location);
  const notice: string = result.timedOut ? "\n" + CHECK_TIMEOUT_NOTICE : "";
  const output: string = result.output.slice(0, maxOutputChars - notice.length) + notice;
  return {
    command: plan.command,
    ...result,
    output,
    outputTruncated: result.outputTruncated || output.length < result.output.length + notice.length,
    diagnostics,
  };
}
