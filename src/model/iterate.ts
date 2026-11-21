import type {
  Artifact, Autonomy, Brief, Iteration, IterationCheck, IterationGap, IterationVerdict, Run, RunStatus,
} from "./types";

export const ITERATION_JUDGMENT_ERROR = "判断结果无法读取，可以重试";
export const REPEATED_ITERATION_GAPS = "连续两轮缺口相同";
export const ITERATION_STOPPED = "用户停止自迭代";

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
    (value.checkSequence === undefined || (typeof value.checkSequence === "number" &&
      Number.isSafeInteger(value.checkSequence) && value.checkSequence >= 0)) &&
    (value.writes === undefined || (Array.isArray(value.writes) && value.writes.every((entry: unknown) =>
      isRecord(entry) && isText(entry.path) && isText(entry.artifactId) &&
      (typeof entry.before === "string" || entry.before === null) && (typeof entry.after === "string" || entry.after === null))));
}

export function createIteration(
  run: Pick<Run, "title" | "iterations">,
  title = run.title,
  id = crypto.randomUUID(),
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
  const literal = requirementId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-zA-Z0-9_])${literal}(?:$|[^a-zA-Z0-9_])`, "u").test(evidence);
}

export function parseIterationJudgment(value: unknown, run: Pick<Run, "dependsOn">): IterationJudgment {
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { throw new Error(ITERATION_JUDGMENT_ERROR); }
  }
  if (!isRecord(value) || !isVerdict(value.verdict) || !Array.isArray(value.gaps) || !value.gaps.every(isGap) ||
    !Array.isArray(value.evidence) || !value.evidence.every(isText)) {
    throw new Error(ITERATION_JUDGMENT_ERROR);
  }

  const { verdict } = value;
  const ids = new Set(requirementIds(run));
  const gaps = value.gaps.map(({ requirementId, missing }) => ({ requirementId, missing }));
  const evidence = value.evidence.map((entry) => entry.trim());
  const nextTitle = isText(value.nextTitle) ? value.nextTitle.trim() : undefined;

  if (gaps.some(({ requirementId }) => !ids.has(requirementId)) ||
    (verdict === "continue" && (!gaps.length || !nextTitle)) ||
    (verdict === "done" && (gaps.length || !evidence.length ||
      !run.dependsOn.every((id) => evidence.some((entry) => mentionsRequirement(entry, id))))) ||
    (verdict === "blocked" && !evidence.length)) {
    throw new Error(ITERATION_JUDGMENT_ERROR);
  }

  return { verdict, gaps, evidence, nextTitle };
}

function canonicalGaps(gaps: IterationGap[]): string {
  return JSON.stringify([...new Set(gaps.map(({ requirementId, missing }) => JSON.stringify([requirementId, missing])))].sort());
}

function checksNeedingRepair(checks: readonly IterationCheck[], required: readonly string[]): string[] {
  const failed = checks.filter(({ exitCode }) => exitCode !== 0).map(({ command, exitCode, output }) => {
    const detail = output.trim().slice(-300);
    return `${command} 退出码 ${exitCode}${detail ? `，检查详情：${detail}` : ""}`;
  });
  return [...failed, ...required.filter((command) => !checks.some((check) => check.command === command))
    .map((command) => `尚未运行 ${command}`)];
}

export function nextIterationDecision(run: IterationRun, judgment: IterationJudgment, options: IterationOptions): IterationDecision {
  const history = run.iterations ?? [];
  const current = history.at(-1);
  if (!current || current.status !== "in_progress") throw new Error("当前没有进行中的轮次");
  let checked = parseIterationJudgment(judgment, run);
  const failed = checksNeedingRepair(current.checks ?? [], options.requiredChecks ?? []);
  if (checked.verdict === "done" && failed.length) {
    const requirementId = requirementIds(run)[0];
    checked = {
      verdict: "continue", gaps: failed.map((missing) => ({ requirementId, missing })),
      evidence: failed, nextTitle: "修正未通过的检查",
    };
  }
  const finalized = { ...current, ...checked, approval: undefined };

  if (checked.verdict === "done") {
    const note = "依赖的需求均有验证依据";
    return { status: "completed", iteration: { ...finalized, status: "completed", note }, action: "complete", note };
  }
  if (checked.verdict === "blocked") {
    const note = checked.evidence[0];
    return { status: "blocked", iteration: { ...finalized, status: "blocked", note }, action: "block", note };
  }

  const previous = history.at(-2);
  if (previous?.verdict === "continue" && canonicalGaps(previous.gaps) === canonicalGaps(checked.gaps)) {
    const iteration = { ...finalized, status: "completed" as const, note: REPEATED_ITERATION_GAPS };
    return { status: "blocked", iteration, action: "block", note: REPEATED_ITERATION_GAPS };
  }
  const requiresApproval = options.autonomy === "ask" || options.approvalRequired;
  const note = requiresApproval ? "等待确认下一轮" : "本轮已完成，继续处理剩余缺口";
  const iteration: Iteration = { ...finalized, status: "completed", note, approval: requiresApproval ? "next" : undefined };
  return { status: "in_progress", iteration, action: requiresApproval ? "approve" : "continue", nextTitle: checked.nextTitle, note };
}

export function buildJudgmentInput(
  brief: Brief,
  run: IterationRun,
  products: Pick<Artifact, "kind" | "title" | "body">[],
  requiredChecks: readonly string[] = [],
) {
  const iterations = run.iterations ?? [];
  const checks = iterations.at(-1)?.checks ?? [];
  return {
    requirements: run.dependsOn.length
      ? brief.requirements.filter(({ id }) => run.dependsOn.includes(id)) : [{ id: "goal", text: brief.intent }],
    constraints: brief.constraints,
    outOfScope: brief.outOfScope,
    autonomy: brief.autonomy,
    domainFields: brief.domainFields,
    products: products.map(({ kind, title, body }) => ({ kind, title, body })),
    checks: checks.map(({ command, exitCode, output }) => ({ command, exitCode, output })),
    missingChecks: requiredChecks.filter((command) => !checks.some((check) => check.command === command)),
    history: iterations.slice(0, -1).map(({ gaps, evidence }) => ({ gaps, evidence })),
  };
}

export function blockIteration(run: Run, note = ITERATION_JUDGMENT_ERROR): Run {
  const iterations = run.iterations ?? [];
  return {
    ...run, status: "blocked", note,
    iterations: iterations.map((iteration, index) => index === iterations.length - 1 && iteration.status === "in_progress"
      ? { ...iteration, status: "blocked", note } : iteration),
  };
}

export function resolveIterationApproval(run: Run, accepted: boolean, expectedIterationId: string): Run {
  const iterations = run.iterations ?? [];
  const latest = iterations.at(-1);
  if (run.status !== "in_progress" || latest?.id !== expectedIterationId || latest.verdict !== "continue" ||
    latest.status !== "completed" || latest.approval !== "next") return run;
  const note = accepted ? "已确认，准备下一轮" : ITERATION_STOPPED;
  return {
    ...run, status: accepted ? "in_progress" : "blocked", note,
    iterations: [...iterations.slice(0, -1), { ...latest, note, approval: undefined }],
  };
}

export function pauseIterations(iterations: Iteration[] = [], note = "已暂停"): Iteration[] {
  return iterations.map((iteration) => iteration.status === "in_progress" || iteration.status === "blocked"
    ? { ...iteration, status: "paused", note } : iteration);
}
