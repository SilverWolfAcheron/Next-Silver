import {
  MAX_AUDIT_CONCURRENCY, isValidAudit, normalizeDevelopConcurrency, pauseSeats, retainedFindings,
  retrySeats, scheduleSeats, settleSeats, syncAuditSeats, validateDeveloperPlan,
} from "./seats.ts";
import type { AgentSeat, Run } from "./types";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, body: () => void) {
  try {
    body();
    console.log(`PASS ${name}`);
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

function rejects(run: () => void, match: RegExp) {
  try {
    run();
  } catch (error) {
    expect(error instanceof Error && match.test(error.message), "unexpected validation error");
    return;
  }
  throw new Error("invalid input was accepted");
}

function developer(id: string, fields?: Partial<AgentSeat>): AgentSeat {
  return {
    id, title: id, role: "develop", status: "pending", scope: [`src/${id}.ts`],
    summary: "", findings: [], refutations: [], note: "", ...fields,
  };
}

function work(seats: AgentSeat[], id = "work"): Run {
  return { id, title: id, dependsOn: ["R1"], status: "in_progress", note: "", seats };
}

function activeDevelopers(count: number) {
  return Array.from({ length: count }, (_, index) => developer(`active-${index}`, { status: "in_progress" }));
}

test("§6.2 starts an audit while nine developers are still active", () => {
  const running = activeDevelopers(9);
  const finished = developer("source", { status: "completed", findings: ["默认值未校验"] });
  const seats = syncAuditSeats([...running, finished]);
  const audit = seats.find((seat) => seat.role === "audit");
  expect(audit, "completed source with a finding has an audit");
  expect(audit.auditFor === finished.id, "audit must link its developer");
  const result = scheduleSeats([work(seats)], 9);
  expect(result.starts.length === 1 && result.starts[0].seatId === audit.id, "audit uses independent cap");
  expect(running.every((seat) => seat.status === "in_progress"), "scheduling the audit leaves all nine running");
});

test("§6.3 leaves the overlapping tenth developer pending on a portable path collision", () => {
  const running = activeDevelopers(9);
  running[0].scope = ["src/café.ts"];
  const overlap = developer("waiting", { scope: ["SRC/CAFE\u0301.ts"] });
  const result = scheduleSeats([work(running), work([overlap], "other")], 16);
  expect(!result.starts.length, "overlap must not start even with spare slots");
  expect(result.blockedByScope[0]?.seatId === overlap.id, "overlap gets an explanation");
  expect(overlap.status === "pending", "waiting seat remains pending");
  running[0].status = "completed";
  expect(scheduleSeats([work(running), work([overlap], "other")], 16).starts[0]?.seatId === overlap.id,
    "overlap can start after the writer finishes");
});

test("§6.4 creates audits immediately for completed and blocked developers with findings", () => {
  const running = activeDevelopers(2);
  const seats = syncAuditSeats([
    ...running,
    developer("done", { status: "completed", findings: ["第一条"] }),
    developer("stopped", { status: "blocked", findings: ["第二条"] }),
    developer("empty", { status: "completed" }),
  ]);
  const audits = seats.filter((seat) => seat.role === "audit");
  expect(audits.map((seat) => seat.auditFor).join(",") === "done,stopped", "every terminal source with findings gets an audit");
  expect(syncAuditSeats(seats) === seats, "the audit discovery step is idempotent");
  expect(scheduleSeats([work(seats)], 16).starts.length === 2, "both auditors can start while development continues");
});

test("§6.5 refuses parent completion for absent, partial, or repeated audit reasoning", () => {
  const source = developer("checks", { status: "completed", findings: ["配置未定义。", "边界没有测试。"] });
  const seats = syncAuditSeats([source]);
  const audit = seats[1];
  expect(settleSeats([source]) === "in_progress", "no audit cannot complete the work");
  expect(settleSeats([source, { ...audit, status: "blocked" }]) === "in_progress", "failed audit leaves findings unresolved");
  const partial: AgentSeat = { ...audit, status: "completed", verdicts: ["retained", "retained"], refutations: ["配置实际未赋值"] };
  expect(settleSeats([source, partial]) === "in_progress", "every finding requires its own evidence");
  const echo: AgentSeat = { ...partial, refutations: ["依据：结论保留，配置未定义", "边界没有测试！"] };
  expect(!isValidAudit(echo, source), "punctuation and boilerplate do not make an echo independent");
  const repeated: AgentSeat = { ...partial, refutations: ["检查了文件初始值", "检查了文件初始值。"] };
  expect(!isValidAudit(repeated, source), "duplicated evidence cannot stand in for separate reviews");
});

test("§6.6 excludes refuted findings from the final document", () => {
  const source = developer("report", { status: "completed", findings: ["错误已确认", "缺少异常检查"] });
  const audit: AgentSeat = {
    ...syncAuditSeats([source])[1], status: "completed", verdicts: ["refuted", "retained"],
    refutations: ["在入口看到了早期返回，无法复现所述路径", "读取处理函数仅发现成功分支，并且抛出异常时直接退出"],
  };
  expect(settleSeats([source, audit]) === "completed", "independent complete review settles the parent");
  const report = retainedFindings([source, audit]).join("\n");
  expect(report === "缺少异常检查" && !report.includes("错误已确认"), "only retained findings reach the final document");
});

test("§6.7 enforces two levels and confines children to their parent's file set", () => {
  const parent = developer("parent", { scope: ["src/a.ts", "src/b.ts"] });
  const child = developer("child", { parentId: parent.id, scope: ["src/a.ts"] });
  validateDeveloperPlan([parent, child]);
  const order = scheduleSeats([work([parent, child])], 16).starts.map((seat) => seat.seatId);
  expect(order.join(",") === child.id, "parent waits for its child's summary without locking its path");
  rejects(() => validateDeveloperPlan([parent, child, developer("third", {
    parentId: child.id, scope: ["src/a.ts"],
  })]), /最多两层/u);
  rejects(() => validateDeveloperPlan([parent, { ...child, scope: ["src/other.ts"] }]), /超出父席位/u);
  rejects(() => validateDeveloperPlan([parent, { ...child, scope: ["src/A.ts"] }]), /超出父席位/u);
  rejects(() => validateDeveloperPlan([{ ...parent, scope: ["../outside.ts"] }]), /相对文件路径/u);
});

test("§6.8 normalizes invalid concurrency to 16 and can concurrently admit nine", () => {
  const pending = Array.from({ length: 20 }, (_, index) => developer(`pending-${index}`));
  expect(normalizeDevelopConcurrency(8) === 16, "saving a low value uses the standard default");
  expect(normalizeDevelopConcurrency(undefined) === 16, "missing setting uses the standard default");
  expect(normalizeDevelopConcurrency(9) === 9, "nine is a valid setting");
  expect(scheduleSeats([work(pending)], 8).starts.length === 16, "fallback actually admits sixteen");
  expect(scheduleSeats([work(pending)], 9).starts.length === 9, "setting actually admits nine");
});

test("independent audit cap and pause/retry preserve the parent boundaries", () => {
  const busy = activeDevelopers(16);
  const sources = Array.from({ length: 7 }, (_, index) =>
    developer(`audited-${index}`, { status: "completed", findings: [`待审发现 ${index}`] }),
  );
  const seats = syncAuditSeats([...busy, ...sources]);
  const ref = scheduleSeats([work(seats)], 16);
  expect(ref.starts.length === MAX_AUDIT_CONCURRENCY, "audit admissions respect their own four slots");
  const active = seats.map((seat) => ref.starts.some(({ seatId }) => seatId === seat.id)
    ? { ...seat, status: "in_progress" as const } : seat);
  expect(!scheduleSeats([work(active)], 16).starts.length, "a full audit lane cannot start another audit");
  const paused = pauseSeats(active, "已停止");
  expect(!paused.some((seat) => seat.status === "in_progress"), "a stop pauses both roles");
  const scheduled = scheduleSeats([{ ...work(paused), status: "blocked" }], 16);
  expect(!scheduled.starts.length, "an inactive parent cannot dispatch queued seats");
  const retried = retrySeats(paused);
  expect(retried.find((seat) => seat.role === "audit")?.status === "pending", "audit retries are independently schedulable");
});
