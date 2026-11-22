import {
  blockIteration, buildJudgmentInput, createIteration, isIteration, ITERATION_JUDGMENT_ERROR,
  ITERATION_STOPPED, nextIterationDecision, parseIterationJudgment, pauseIterations,
  REPEATED_ITERATION_GAPS, resolveIterationApproval,
} from "./iterate.ts";
import type { IterationDecision, IterationJudgment } from "./iterate.ts";
import type { Brief, IterationCheck, Run } from "./types";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, body: () => void) {
  try {
    body();
    console.log(`PASS ${name}`);
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

function expectJudgmentError(fn: () => void) {
  try {
    fn();
  } catch (error) {
    expect(error instanceof Error && error.message === ITERATION_JUDGMENT_ERROR, "expected retryable judgment error");
    return;
  }
  throw new Error("invalid judgment was accepted");
}

function newRun(dependsOn = ["R1"]): Run {
  return { id: "work", title: "修正结账流程", status: "pending", dependsOn, note: "" };
}

function begin(run: Run, title?: string, checks?: IterationCheck[]): Run {
  const iteration = createIteration(run, title);
  return { ...run, status: "in_progress", iterations: [...(run.iterations ?? []), { ...iteration, checks }] };
}

function store(run: Run, decision: IterationDecision): Run {
  return { ...run, status: decision.status, note: decision.note, iterations: [
    ...(run.iterations ?? []).slice(0, -1), decision.iteration,
  ] };
}

function gaps(missing: string, requirementId = "R1"): IterationJudgment {
  return { verdict: "continue", gaps: [{ requirementId, missing }], evidence: [], nextTitle: missing };
}

function done(...evidence: string[]): IterationJudgment {
  return { verdict: "done", gaps: [], evidence };
}

test("§7.1 an artifact and a partial or substring requirement match cannot complete a work item", () => {
  const run = begin(newRun(["R1", "R10"]));
  run.iterations![0].artifactIds.push("draft-1");
  expectJudgmentError(() => parseIterationJudgment(done("已实现R10对应的范围"), run));
  const blocked = blockIteration(run);
  expect(blocked.status === "blocked" && blocked.iterations?.[0].artifactIds[0] === "draft-1", "invalid review preserves work");
  expect(parseIterationJudgment(done("已实现R1对应的范围", "R10 已通过测试"), run).verdict === "done", "exact requirements validate");
});

test("§7.2 a later done verdict completes the same parent with all history", () => {
  const first = begin(newRun());
  const review = nextIterationDecision(first, gaps("配送仍然使用额外页面"), { autonomy: "decide" });
  expect(review.action === "continue" && review.iteration.status === "completed", "first round is settled but parent continues");
  const second = begin(store(first, review), review.nextTitle);
  const finalized = nextIterationDecision(second, done("R1 已改为一次提交并通过测试"), { autonomy: "decide" });
  const updated = store(second, finalized);
  expect(updated.id === first.id && updated.iterations?.length === 2 && updated.status === "completed", "only the round count changes");
});

test("§7.3 identical requirement and missing text sets block after two rounds", () => {
  const first = begin(newRun(["R1", "R2"]));
  const initial = gaps("配送仍分步");
  initial.gaps.push({ requirementId: "R2", missing: "按钮仍未生效" });
  const saved = store(first, nextIterationDecision(first, initial, { autonomy: "act" }));
  const second = begin(saved);
  const repeated = nextIterationDecision(second, { ...initial, gaps: [...initial.gaps].reverse(), nextTitle: "换个标题" }, { autonomy: "act" });
  expect(repeated.action === "block" && repeated.note === REPEATED_ITERATION_GAPS, "order and title don't change the gap pairs");
  expect(store(second, repeated).iterations?.length === 2, "the blocked result cannot open a third round");
});

test("§7.4 later rounds keep running without a round cap", () => {
  let run = newRun();
  for (let index = 1; index <= 12; index++) {
    run = begin(run);
    const review = nextIterationDecision(run, gaps(`余下路径 ${index}`), { autonomy: "decide" });
    expect(review.action === "continue" && review.status === "in_progress", "a distinct gap remains actionable");
    run = store(run, review);
    expect(run.iterations?.length === index && review.iteration.index === index, "rounds retain exact numbering");
  }
});

test("§7.5 ask waits for approval and decline never creates a new round", () => {
  const first = begin(newRun());
  const decision = nextIterationDecision(first, gaps("补充支付边界"), { autonomy: "ask" });
  const awaiting = store(first, decision);
  expect(decision.action === "approve" && decision.iteration.approval === "next" && awaiting.iterations?.length === 1, "no work before approval");
  expect(resolveIterationApproval(awaiting, true, "wrong-round") === awaiting, "stale approval is ignored");
  const declined = resolveIterationApproval(awaiting, false, decision.iteration.id);
  expect(declined.status === "blocked" && declined.note === ITERATION_STOPPED && declined.iterations?.length === 1, "decline leaves history unchanged");
  const approved = resolveIterationApproval(awaiting, true, decision.iteration.id);
  expect(!approved.iterations?.[0].approval, "record approval before creating work");
  const next = begin(approved, decision.nextTitle);
  expect(next.iterations?.at(-1)?.index === 2 && next.iterations?.at(-1)?.title === "补充支付边界", "approval can start the next round");
});

test("§7.6 decide continues and explicit destructive work still needs approval", () => {
  const run = begin(newRun());
  expect(nextIterationDecision(run, gaps("修补路由"), { autonomy: "decide" }).action === "continue", "safe changes advance automatically");
  expect(nextIterationDecision(run, gaps("差异覆盖了 21 个文件"), { autonomy: "decide", approvalRequired: true }).action === "approve", "large difference requires approval");
  expect(nextIterationDecision(run, gaps("删除旧文件"), { autonomy: "act", approvalRequired: true }).action === "approve", "direct autonomy does not bypass approval");
});

test("§7.7 malformed decisions block and unsupported requirements cannot become gaps", () => {
  const run = begin(newRun());
  expectJudgmentError(() => parseIterationJudgment("{broken JSON", run));
  expectJudgmentError(() => parseIterationJudgment(gaps("不在范围", "R2"), run));
  expectJudgmentError(() => parseIterationJudgment({ verdict: "blocked", gaps: [], evidence: [] }, run));
  const blocked = blockIteration(run);
  expect(blocked.note === ITERATION_JUDGMENT_ERROR && blocked.iterations?.at(-1)?.status === "blocked", "show retryable block in both rows");
});

test("§7.8 and §7.9 revision pauses unfinished rounds and old data starts with a first round", () => {
  const legacy = newRun([]);
  expect(pauseIterations(legacy.iterations).length === 0, "legacy conversation has no rounds");
  const first = begin(legacy);
  expect(first.iterations?.[0].index === 1 && isIteration(first.iterations[0]), "a new first round has a valid snapshot");
  const continueGoal = nextIterationDecision(first, gaps("颜色仍需调整", "goal"), { autonomy: "decide" });
  const second = begin(store(first, continueGoal));
  const paused = pauseIterations(second.iterations, "需求修订");
  expect(paused[0].status === "completed" && paused[1].status === "paused" && paused[1].note === "需求修订", "revision preserves completed work");
});

test("failed and missing checks prevent completion and keep exact output in the judgment input", () => {
  const requiredChecks = ["npm test", "npm run typecheck", "npm run build"];
  const failedCheck = { command: "npm test", exitCode: 1, output: "开始测试\r\n失败：89 != 90\r\n" };
  const run = begin(newRun(), undefined, [failedCheck, { command: "npm run typecheck", exitCode: 0, output: "" }]);
  const brief: Brief = {
    intent: "结账", outcome: "完成", requirements: [{ id: "R1", text: "只有一个表单" }, { id: "R2", text: "不应传入" }],
    constraints: "固定工具", autonomy: "decide", outOfScope: ["删除文件"], domainFields: {},
  };
  const input = buildJudgmentInput({
    brief,
    run,
    products: [{ kind: "diff", title: "差异", body: "+代码" }],
    requiredChecks,
  });
  expect(input.checks[0].output === failedCheck.output && input.missingChecks[0] === "npm run build", "input preserves raw output and declared absent checks");
  expect(input.requirements.length === 1 && input.requirements[0].id === "R1", "input only includes scoped requirements");
  const review = nextIterationDecision(run, done("R1 已完成"), { autonomy: "decide", requiredChecks });
  expect(review.action === "continue" && review.iteration.gaps.length === 2, "failing and missing checks still require repair");
  expect(review.iteration.gaps[0].missing.includes("89 != 90"), "repair gap identifies the failure");
  const clean = begin(newRun(), undefined, requiredChecks.map((command) => ({ command, exitCode: 0, output: "通过" })));
  expect(nextIterationDecision(clean, done("R1 已完成"), { autonomy: "decide", requiredChecks }).action === "complete", "all successful checks permit well-supported completion");
});
