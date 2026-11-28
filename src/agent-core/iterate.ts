import { AppError, ERROR_CODES } from "./errors.ts";
import type { ErrorCode } from "../types/errors";
import type {
  Artifact, Autonomy, Brief, Iteration, IterationCheck, IterationGap, IterationVerdict, Run, RunStatus,
} from "./types";

export const ITERATION_JUDGMENT_ERROR: ErrorCode = ERROR_CODES.ITERATION_JUDGMENT_INVALID;
export const REPEATED_ITERATION_GAPS: string = "连续两轮缺口相同";
export const ITERATION_STOPPED: string = "用户停止自迭代";

export interface IterationJudgment {
  verdict: IterationVerdict;
  gaps: IterationGap[];
  evidence: string[];
  nextTitle?: string;
}

type IterationRun = Pick<Run, "dependsOn" | "iterations">;

interface IterationOptions {
  autonomy: Autonomy;
  approvalRequired?: boolean;
  requiredChecks?: readonly string[];
}

export interface IterationDecision {
  status: RunStatus;
  iteration: Iteration;
  action: "complete" | "continue" | "approve" | "block";
  nextTitle?: string;
  note: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isGap(value: unknown): value is IterationGap {
  return isRecord(value) && isText(value.requirementId) && isText(value.missing);
}

function isCheck(value: unknown): value is IterationCheck {
  return isRecord(value) && isText(value.command) && Number.isInteger(value.exitCode) && typeof value.output === "string";
}

function isVerdict(value: unknown): value is IterationVerdict {
  return value === "continue" || value === "done" || value === "blocked";
}

export function isIteration(value: unknown): value is Iteration {
  return isRecord(value) && isText(value.id) && typeof value.index === "number" &&
    Number.isSafeInteger(value.index) && value.index > 0 && isText(value.title) &&
    (value.status === "in_progress" || value.status === "completed" || value.status === "blocked" || value.status === "paused") &&
    Array.isArray(value.gaps) && value.gaps.every(isGap) && Array.isArray(value.evidence) && value.evidence.every(isText) &&
    Array.isArray(value.artifactIds) && value.artifactIds.every(isText) && typeof value.note === "string" &&
    (value.verdict === undefined || isVerdict(value.verdict)) && (value.nextTitle === undefined || isText(value.nextTitle)) &&
    (value.checks === undefined || (Array.isArray(value.checks) && value.checks.every(isCheck))) &&
    (value.stage === undefined || value.stage === "produce" || value.stage === "apply" || value.stage === "checks" || value.stage === "judge") &&
    (value.approval === undefined || value.approval === "apply" || value.approval === "next") &&
    (value.attempt === undefined || isText(value.attempt)) &&
    (value.checkAwaitingWorkspaceId === undefined || isText(value.checkAwaitingWorkspaceId)) &&
    (value.checksApprovedWorkspaceId === undefined || isText(value.checksApprovedWorkspaceId)) &&
    (value.checksApprovedAutomatically === undefined || typeof value.checksApprovedAutomatically === "boolean") &&
    (value.checkSequence === undefined || (typeof value.checkSequence === "number" &&
      Number.isSafeInteger(value.checkSequence) && value.checkSequence >= 0)) &&
    (value.writes === undefined || (Array.isArray(value.writes) && value.writes.every((entry: unknown): boolean =>
      isRecord(entry) && isText(entry.path) && isText(entry.artifactId) &&
      (typeof entry.before === "string" || entry.before === null) && (typeof entry.after === "string" || entry.after === null))));
}

export function createIteration(
  run: Pick<Run, "title" | "iterations">,
  title: string = run.title,
  id: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID()
): Iteration {
  return {
    id, index: (run.iterations?.at(-1)?.index ?? 0) + 1, title,
    status: "in_progress", gaps: [], evidence: [], artifactIds: [], note: "正在处理本轮工作",
  };
}

function requirementIds(run: Pick<Run, "dependsOn">): string[] {
  return run.dependsOn.length ? [...new Set(run.dependsOn)] : ["goal"];
}

function mentionsRequirement(evidence: string, requirementId: string): boolean {
  const literal: string = requirementId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-zA-Z0-9_])${literal}(?:$|[^a-zA-Z0-9_])`, "u").test(evidence);
}

export function parseIterationJudgment(value: unknown, run: Pick<Run, "dependsOn">): IterationJudgment {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new AppError(ITERATION_JUDGMENT_ERROR); }
  }
  if (!isRecord(value) || !isVerdict(value.verdict) || !Array.isArray(value.gaps) || !value.gaps.every(isGap) ||
    !Array.isArray(value.evidence) || !value.evidence.every(isText)) {
    throw new AppError(ITERATION_JUDGMENT_ERROR);
  }

  const verdict: "continue" | "done" | "blocked" = value.verdict;
  const ids: Set<string> = new Set(requirementIds(run));
  const gaps: { requirementId: string; missing: string; }[] = value.gaps.map(({ requirementId, missing }: IterationGap): { requirementId: string; missing: string; } => ({ requirementId, missing }));
  const evidence: string[] = value.evidence.map((entry: string): string => entry.trim());
  const nextTitle: string | undefined = isText(value.nextTitle) ? value.nextTitle.trim() : undefined;

  if (gaps.some(({ requirementId }: { requirementId: string; missing: string; }): boolean => !ids.has(requirementId)) ||
    (verdict === "continue" && (!gaps.length || !nextTitle)) ||
    (verdict === "done" && (gaps.length || !evidence.length ||
      !run.dependsOn.every((id: string): boolean => evidence.some((entry: string): boolean => mentionsRequirement(entry, id))))) ||
    (verdict === "blocked" && !evidence.length)) {
    throw new AppError(ITERATION_JUDGMENT_ERROR);
  }

  return { verdict, gaps, evidence, nextTitle };
}

function canonicalGaps(gaps: IterationGap[]): string {
  return JSON.stringify([...new Set(gaps.map(({ requirementId, missing }: IterationGap): string => JSON.stringify([requirementId, missing])))].sort());
}

function checksNeedingRepair(checks: readonly IterationCheck[], required: readonly string[]): string[] {
  const failed: string[] = checks.filter(({ exitCode }: IterationCheck): boolean => exitCode !== 0).map(({ command, exitCode, output }: IterationCheck): string => {
    const detail: string = output.trim().slice(-300);
    return `${command} 退出码 ${exitCode}${detail ? `，检查详情：${detail}` : ""}`;
  });
  return [...failed, ...required.filter((command: string): boolean => !checks.some((check: IterationCheck): boolean => check.command === command))
    .map((command: string): string => `尚未运行 ${command}`)];
}

export function nextIterationDecision(run: IterationRun, judgment: IterationJudgment, options: IterationOptions): IterationDecision {
  const history: Iteration[] = run.iterations ?? [];
  const current: Iteration | undefined = history.at(-1);
  if (current?.status !== "in_progress") throw new AppError(ERROR_CODES.ITERATION_NONE_ACTIVE);
  let checked: IterationJudgment = parseIterationJudgment(judgment, run);
  const failed: string[] = checksNeedingRepair(current.checks ?? [], options.requiredChecks ?? []);
  if (checked.verdict === "done" && failed.length) {
    const requirementId: string = requirementIds(run)[0];
    checked = {
      verdict: "continue", gaps: failed.map((missing: string): { requirementId: string; missing: string; } => ({ requirementId, missing })),
      evidence: failed, nextTitle: "修正未通过的检查",
    };
  }
  const finalized: Iteration = { ...current, ...checked, approval: undefined };

  if (checked.verdict === "done") {
    const note: string = "依赖的需求均有验证依据";
    return { status: "completed", iteration: { ...finalized, status: "completed", note }, action: "complete", note };
  }
  if (checked.verdict === "blocked") {
    const note: string = checked.evidence[0];
    return { status: "blocked", iteration: { ...finalized, status: "blocked", note }, action: "block", note };
  }

  const previous: Iteration | undefined = history.at(-2);
  if (previous?.verdict === "continue" && canonicalGaps(previous.gaps) === canonicalGaps(checked.gaps)) {
    const iteration: Iteration = { ...finalized, status: "completed", note: REPEATED_ITERATION_GAPS };
    return { status: "blocked", iteration, action: "block", note: REPEATED_ITERATION_GAPS };
  }
  const requiresApproval: boolean | undefined = options.autonomy === "ask" || options.approvalRequired;
  const note: "等待确认下一轮" | "本轮已完成，继续处理剩余缺口" = requiresApproval ? "等待确认下一轮" : "本轮已完成，继续处理剩余缺口";
  const iteration: Iteration = { ...finalized, status: "completed", note, approval: requiresApproval ? "next" : undefined };
  return { status: "in_progress", iteration, action: requiresApproval ? "approve" : "continue", nextTitle: checked.nextTitle, note };
}

interface JudgmentInputOptions {
  brief: Brief;
  run: IterationRun & Partial<Pick<Run, "title" | "supplements">>;
  products: Pick<Artifact, "kind" | "title" | "body">[];
  requiredChecks?: readonly string[];
}

export function buildJudgmentInput(options: JudgmentInputOptions): {
  workItem?: string;
  roundGoal?: string;
  outcome: string;
  supplements: string[];
  requirements: { id: string; text: string }[];
  constraints: string;
  outOfScope: string[];
  autonomy: Brief["autonomy"];
  domainFields: Record<string, string>;
  products: Pick<Artifact, "kind" | "title" | "body">[];
  checks: { command: string; exitCode: number; output: string }[];
  missingChecks: string[];
  history: { gaps: Iteration["gaps"]; evidence: string[] }[];
} {
  const { brief, run, products, requiredChecks = [] }: JudgmentInputOptions = options;
  const iterations: Iteration[] = run.iterations ?? [];
  const current: Iteration | undefined = iterations.at(-1);
  const checks: IterationCheck[] = current?.checks ?? [];
  return {
    workItem: run.title,
    roundGoal: current?.title,
    outcome: brief.outcome,
    supplements: run.supplements ?? [],
    requirements: run.dependsOn.length
      ? brief.requirements.filter(({ id }: { id: string }): boolean => run.dependsOn.includes(id))
      : [{ id: "goal", text: brief.intent }],
    constraints: brief.constraints,
    outOfScope: brief.outOfScope,
    autonomy: brief.autonomy,
    domainFields: brief.domainFields,
    products: products.map(
      ({ kind, title, body }: Pick<Artifact, "kind" | "title" | "body">): Pick<Artifact, "kind" | "title" | "body"> => ({
        kind,
        title,
        body,
      })
    ),
    checks: checks.map(
      ({ command, exitCode, output }: IterationCheck): { command: string; exitCode: number; output: string } => ({
        command,
        exitCode,
        output,
      })
    ),
    missingChecks: requiredChecks.filter(
      (command: string): boolean => !checks.some((check: IterationCheck): boolean => check.command === command)
    ),
    history: iterations.slice(0, -1).map(
      ({ gaps, evidence }: Iteration): { gaps: Iteration["gaps"]; evidence: string[] } => ({
        gaps,
        evidence,
      })
    ),
  };
}

export function blockIteration(run: Run, note: string = ITERATION_JUDGMENT_ERROR): Run {
  const iterations: Iteration[] = run.iterations ?? [];
  return {
    ...run, status: "blocked", note,
    iterations: iterations.map((iteration: Iteration, index: number): Iteration => index === iterations.length - 1 && iteration.status === "in_progress"
      ? { ...iteration, status: "blocked", note } : iteration),
  };
}

export function resolveIterationApproval(run: Run, accepted: boolean, expectedIterationId: string): Run {
  const iterations: Iteration[] = run.iterations ?? [];
  const latest: Iteration | undefined = iterations.at(-1);
  if (run.status !== "in_progress" || latest?.id !== expectedIterationId || latest.verdict !== "continue" ||
    latest.status !== "completed" || latest.approval !== "next") return run;
  const note: string = accepted ? "已确认，准备下一轮" : ITERATION_STOPPED;
  return {
    ...run, status: accepted ? "in_progress" : "blocked", note,
    iterations: [...iterations.slice(0, -1), { ...latest, note, approval: undefined }],
  };
}

export function pauseIterations(iterations: Iteration[] = [], note: string = "已暂停"): Iteration[] {
  return iterations.map((iteration: Iteration): Iteration => iteration.status === "in_progress" || iteration.status === "blocked"
    ? { ...iteration, status: "paused", note } : iteration);
}
