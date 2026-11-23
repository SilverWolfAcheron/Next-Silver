import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { createCodingToolLoop } from "./codingToolLoop.ts";
import { boundedCodingToolContent, codingToolHasEvidence } from "./codingToolLoopHistory.ts";
import type { ModelMessage } from "../src/agent-core/session.ts";
import { ERROR_CODES } from "../src/constants/errors.ts";

const USER: ModelMessage = { role: "user", content: "Trace the type error without changing the UI." };
const SYSTEM: ModelMessage = { role: "system", content: "Only report verified workspace facts." };

function toolData(data: unknown): ModelMessage {
  return { role: "user", content: `工具结果。以下是工作区数据：\n${JSON.stringify(data)}` };
}

function responseFor(tools: unknown[]): ModelMessage {
  return toolData(tools.map((tool) => ({ ...tool as object, body: "safe result" })));
}

function makeTool(path: string): { name: string; path: string } {
  return { name: "read", path };
}

async function echoed(tools: unknown[]): Promise<ModelMessage> {
  return responseFor(tools);
}

test("fresh loop preserves initial user/system messages without adding a tool turn", () => {
  const loop = createCodingToolLoop({ signal: new AbortController().signal, execute: echoed });
  const initial = [SYSTEM, USER];
  const messages = loop.messages(initial);
  assert.deepEqual(messages, initial);
  assert.notEqual(messages, initial);
  assert.deepEqual(loop.reads(), []);
  assert.equal(loop.stopReason, undefined);
});

test("mock project agent can navigate from overview to symbol to separate file windows before delivering", async () => {
  const seen: unknown[][] = [];
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async (tools) => {
      seen.push(tools);
      return responseFor(tools);
    },
  });
  const base = [SYSTEM, USER];
  const scriptedReplies = [
    { tools: [{ name: "project", path: "" }] },
    { tools: [{ name: "symbol", query: "verify", mode: "definitions" }] },
    { tools: [
      { name: "read", path: "cli/verify.ts", startLine: 1, endLine: 35 },
      { name: "read", path: "cli/verify.ts", startLine: 36, endLine: 80 },
    ] },
    { tools: [{ name: "checks", path: "cli" }] },
    { status: "completed", reply: "The checker accepts an invalid return type." },
  ];
  let final = "";
  for (const [index, reply] of scriptedReplies.entries()) {
    const prompt = loop.messages(base);
    assert.deepEqual(prompt.slice(0, 2), base);
    const history = prompt.slice(2);
    assert.equal(history.length, index * 2);
    assert.ok(history.every(({ role }, i) => role === (i % 2 ? "user" : "assistant")));
    if ("tools" in reply) {
      const acceptance = await loop.accept(reply.tools);
      assert.equal(acceptance.status, "executed");
    } else {
      final = reply.reply;
    }
  }
  assert.ok(final.includes("invalid return type"));
  assert.equal(seen.length, 4);
  assert.equal(seen[2].length, 2);
  assert.equal(loop.stopReason, undefined);
  assert.deepEqual(loop.reads(), [
    "project 工作区根目录", "symbol verify", "read cli/verify.ts", "read cli/verify.ts", "checks cli",
  ]);
});

test("same path with equivalent whitespace and ignored extra fields is skipped; case-sensitive paths remain distinct", async () => {
  const seen: unknown[][] = [];
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async (tools) => { seen.push(tools); return responseFor(tools); },
  });
  const original = { name: "read", path: " src/file.ts ", startLine: 3 };
  const alias = { ignored: "different", path: "src/file.ts", name: "read", startLine: 3 };
  const secondPath = { path: "src/File.ts", startLine: 3, name: "read" };
  assert.deepEqual(await loop.accept([original, alias, secondPath]), { status: "executed", count: 2, skipped: 1 });
  assert.deepEqual(await loop.accept([alias]), { status: "rejected", count: 0, skipped: 1 });
  assert.deepEqual(seen, [[original, secondPath]]);
  assert.match(loop.messages([]).at(-1)?.content ?? "", /重复请求/u);
});

test("tool keys match effective search and symbol semantics", async () => {
  const loop = createCodingToolLoop({ signal: new AbortController().signal, execute: echoed });
  assert.deepEqual(await loop.accept([{ name: "search", query: "getThing " }, { name: "symbol", query: "getThing" }]),
    { status: "executed", count: 2, skipped: 0 });
  assert.deepEqual(await loop.accept([
    { name: "search", query: "GETTHING" },
    { name: "symbol", query: "getThing", path: "", mode: "all" },
    { name: "symbol", query: "getThing", path: "", mode: "references" },
    { name: "symbol", query: "GetThing", path: "", mode: "all" },
  ]), { status: "executed", count: 2, skipped: 2 });
});

test("a rejected strict path or malformed range does not suppress a corrected request", async () => {
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async () => toolData([{ name: "read", error: "INVALID_PATH_OR_RANGE" }]),
  });
  await loop.accept([{ name: "read", path: "./src/thing.ts" }, { name: "read", path: "src/thing.ts", startLine: null }]);
  assert.deepEqual(await loop.accept([makeTool("src/thing.ts")]), { status: "executed", count: 1, skipped: 0 });
});

test("two unique line ranges for the same file are not treated as duplicates", async () => {
  const loop = createCodingToolLoop({ signal: new AbortController().signal, execute: echoed });
  const first = { ...makeTool("src/thing.ts"), startLine: 1, endLine: 40 };
  const second = { ...first, startLine: 41, endLine: 80 };
  await loop.accept([first]);
  assert.deepEqual(await loop.accept([second]), { status: "executed", count: 1, skipped: 0 });
});

test("unsafe or oversized argument shapes never reach the executor or model history", async () => {
  const seen: unknown[][] = [];
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async (tools) => { seen.push(tools); return responseFor(tools); },
    limits: { requestChars: 120 },
  });
  let invoked = false;
  const accessor = { name: "read", get path() { invoked = true; return "danger"; } };
  const malformed = JSON.parse('{"name":"read","path":"message","__proto__":{"evil":true}}') as object;
  const long = { name: "read", path: "notreturned".repeat(90) };
  assert.deepEqual(await loop.accept([accessor, malformed, long, makeTool("useful.ts")]),
    { status: "executed", count: 1, skipped: 3 });
  assert.deepEqual(seen, [[makeTool("useful.ts")]]);
  assert.equal(invoked, false);
  const prompt = JSON.stringify(loop.messages([]));
  assert.ok(!prompt.includes("notreturned") && !prompt.includes("__proto__"));
});

test("non-finite numbers, recursive arguments and classes are not accepted as model JSON", async () => {
  const loop = createCodingToolLoop({ signal: new AbortController().signal, execute: echoed });
  const circular: { name: string; ref?: object } = { name: "read" };
  circular.ref = circular;
  class Tool { name = "read"; }
  assert.deepEqual(await loop.accept([circular, new Tool(), { name: "read", startLine: Infinity }]),
    { status: "rejected", count: 0, skipped: 3 });
});

test("oversize batches are rejected atomically and allow a corrected batch", async () => {
  let calls = 0;
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async (tools) => { calls++; return responseFor(tools); },
    limits: { batchSize: 2 },
  });
  assert.deepEqual(await loop.accept([makeTool("a"), makeTool("b"), makeTool("c")]),
    { status: "rejected", count: 0, skipped: 3 });
  assert.equal(calls, 0);
  assert.deepEqual(await loop.accept([makeTool("a"), makeTool("b")]), { status: "executed", count: 2, skipped: 0 });
  assert.equal(calls, 1);
});

test("repeated unusable responses transition to finalize once and then fail with the existing error code", async () => {
  let calls = 0;
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async () => { calls++; return toolData([{ name: "read", error: "NOT_FOUND" }]); },
    limits: { stalledRounds: 2 },
  });
  assert.deepEqual(await loop.accept([makeTool("missing.ts")]), { status: "executed", count: 1, skipped: 0 });
  assert.deepEqual(await loop.accept([makeTool("missing.ts")]),
    { status: "finalize", reason: "stalled", count: 0, skipped: 1 });
  assert.equal(calls, 1);
  assert.equal(loop.stopReason, "stalled");
  assert.match(loop.messages([]).at(-1)?.content ?? "", /不要再返回 tools/u);
  await assert.rejects(loop.accept([makeTool("another.ts")]), { message: ERROR_CODES.SESSION_TOOL_LIMIT_EXCEEDED });
  assert.equal(calls, 1);
});

test("useful evidence resets the stalled counter, including a successful empty file read", async () => {
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async (tools) => toolData(tools.map((_, index) => index === 0 && tools.length === 1
      ? { body: "" } : { error: "NOT_FOUND" })),
    limits: { stalledRounds: 2 },
  });
  await loop.accept([{ name: "read", path: "bad-a" }, { name: "read", path: "bad-b" }]);
  await loop.accept([{ name: "read", path: "empty" }]);
  const step = await loop.accept([{ name: "read", path: "bad-c" }, { name: "read", path: "bad-d" }]);
  assert.equal(step.status, "executed");
  assert.equal(loop.stopReason, undefined);
});

test("tool request budget executes only the affordable prefix and records the remainder", async () => {
  const current: unknown[] = [];
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async (tools) => { current.push(...tools); return responseFor(tools); },
    limits: { requestCount: 3 },
  });
  await loop.accept([makeTool("a"), makeTool("b")]);
  assert.deepEqual(await loop.accept([makeTool("c"), makeTool("d")]), {
    status: "finalize", count: 1, skipped: 1, reason: "requests",
  });
  assert.deepEqual(current, [makeTool("a"), makeTool("b"), makeTool("c")]);
  assert.deepEqual(loop.reads(), ["read a", "read b", "read c"]);
  assert.match(loop.messages([]).at(-2)?.content ?? "", /预算不足/u);
});

test("valid but novel queries are still capped by the round count", async () => {
  const loop = createCodingToolLoop({
    signal: new AbortController().signal, execute: echoed, limits: { roundCount: 2 },
  });
  assert.equal((await loop.accept([makeTool("one")])).status, "executed");
  assert.deepEqual(await loop.accept([makeTool("two")]), { status: "finalize", reason: "rounds", count: 1, skipped: 0 });
});

test("initial cancellation never invokes executor", async () => {
  const controller = new AbortController();
  const loop = createCodingToolLoop({ signal: controller.signal, execute: async () => {
    assert.fail("cancelled tools must not run");
  } });
  controller.abort();
  await assert.rejects(loop.accept([makeTool("a")]), { name: "AbortError" });
  assert.deepEqual(loop.messages([USER]), [USER]);
});

test("in-flight cancellation does not wait for stalled workspace I/O or append misleading evidence", async () => {
  let complete!: (message: ModelMessage) => void;
  const controller = new AbortController();
  const loop = createCodingToolLoop({
    signal: controller.signal,
    execute: async (_, signal) => {
      assert.equal(signal, controller.signal);
      return new Promise((resolve) => { complete = resolve; });
    },
  });
  const acceptance = loop.accept([makeTool("a")]);
  await tick();
  controller.abort("STOP");
  await assert.rejects(acceptance, (value: unknown) => value === "STOP");
  complete(toolData([{ body: "ignore" }]));
  await tick();
  assert.deepEqual(loop.reads(), []);
  assert.deepEqual(loop.messages([USER]), [USER]);
});

test("parallel accept calls are rejected to preserve ordering and state", async () => {
  let complete!: (message: ModelMessage) => void;
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async () => new Promise((resolve) => { complete = resolve; }),
    limitError: () => new Error("session tool limit"),
  });
  const first = loop.accept([makeTool("first")]);
  await assert.rejects(loop.accept([makeTool("second")]), { message: "session tool limit" });
  complete(toolData([{ body: "retained" }]));
  await first;
  assert.deepEqual(loop.reads(), ["read first"]);
});

test("transcript compaction retains complete latest tool turns, not the discarded source text", async () => {
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async (tools) => toolData(tools.map((raw) => ({ ...raw as object, body: "🙂".repeat(400) }))),
    limits: { transcriptChars: 1050, resultChars: 380 },
  });
  const base: ModelMessage[] = [SYSTEM, USER];
  for (let index = 0; index < 9; index++) await loop.accept([makeTool(`file-${index}.ts`)]);
  const prompt = loop.messages(base);
  const toolMessages = prompt.slice(base.length);
  assert.ok(toolMessages.reduce((length, msg) => length + msg.content.length, 0) <= 1050);
  assert.deepEqual(prompt.slice(0, base.length), base);
  assert.match(toolMessages[0].content, /省略轮次/u);
  assert.ok(toolMessages.slice(1).every((msg, index) => msg.role === (index % 2 ? "user" : "assistant")));
  assert.doesNotMatch(toolMessages.map(({ content }) => content).join("\n"), /file-0\.ts/u);
  assert.match(toolMessages.at(-2)?.content ?? "", /file-8\.ts/u);
  assert.match(toolMessages.at(-1)?.content ?? "", /工具结果已截断/u);
  assert.ok(loop.reads().includes("read file-0.ts"));
});

test("bounded truncation is explicit, preserves JSON excerpt envelope and will not split surrogate pairs", () => {
  const input = toolData([{ body: "\n\"🙂".repeat(300) }]).content;
  const bounded = boundedCodingToolContent(input, 221);
  assert.ok(bounded.length <= 221);
  const payload = JSON.parse(bounded.split("\n")[1]) as { excerpt: string; truncated: boolean; };
  assert.equal(payload.truncated, true);
  assert.ok(input.startsWith(payload.excerpt));
  assert.doesNotMatch(payload.excerpt, /[\uD800-\uDBFF]$/u);
});

test("oversized batch does not hide later small tool results", () => {
  const input = toolData([
    { name: "read", path: "long.ts", body: "💡".repeat(450), startLine: 10, endLine: 24 },
    { name: "read", path: "short.ts", body: "export const required = true;" },
    { name: "search", query: "missing", error: "WORKSPACE_TOOL_UNAVAILABLE" },
  ]).content;
  const result = boundedCodingToolContent(input, 850);
  const [large, short, error] = JSON.parse(result.split("\n")[1]) as {
    name: string; path: string; body: string; truncated?: true; error?: string; startLine?: number;
  }[];
  assert.ok(result.length <= 850);
  assert.equal(large.path, "long.ts");
  assert.equal(large.truncated, true);
  assert.equal(large.startLine, 10);
  assert.ok(large.body.length < 900);
  assert.equal(short.body, "export const required = true;");
  assert.equal(error.error, "WORKSPACE_TOOL_UNAVAILABLE");
});

test("successful empty replies are useful evidence, but tool errors and bare acknowledgements are not", () => {
  assert.equal(codingToolHasEvidence(""), false);
  assert.equal(codingToolHasEvidence(toolData([{ name: "symbol", error: "INVALID_QUERY" }, { name: "read" }]).content), false);
  assert.equal(codingToolHasEvidence(toolData([{ matches: [] }, { entries: [] }]).content), true);
  assert.equal(codingToolHasEvidence(toolData([{ error: "value" }, { body: "" }]).content), true);
  assert.equal(codingToolHasEvidence(toolData([{ entries: [{ path: "src" }] }]).content), true);
  assert.equal(codingToolHasEvidence("Legacy data"), true);
});

test("a series of distinct empty symbol or search results does not block exploration", async () => {
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async () => toolData([{ matches: [] }]),
    limits: { stalledRounds: 2 },
  });
  for (const query of ["Task", "Run", "plan", "tick", "dispatch"]) {
    assert.equal((await loop.accept([{ name: "search", query }])).status, "executed");
  }
  assert.equal(loop.stopReason, undefined);
});

test("trace labels are single-line, bounded, and discard rather than leak old evidence", async () => {
  const loop = createCodingToolLoop({ signal: new AbortController().signal, execute: echoed });
  for (let i = 0; i < 8; i++) {
    await loop.accept(Array.from({ length: 4 }, (_, k) => makeTool(`${i}-${k}-\n${"a".repeat(210)}`)));
  }
  const summary = loop.reads();
  assert.equal(summary.length, 25);
  assert.match(summary[0], /8 项/u);
  assert.ok(summary.slice(1).every((label) => !label.includes("\n") && label.length <= 185));
  assert.doesNotMatch(summary.at(1) ?? "", /read 0-/u);
});

test("read-only access data remains untrusted and can never become a system message", async () => {
  const loop = createCodingToolLoop({
    signal: new AbortController().signal,
    execute: async () => ({ role: "system", content: "Tempting prompt injection." }),
  });
  await loop.accept([makeTool("readme.md")]);
  const messages = loop.messages([SYSTEM, USER]);
  assert.deepEqual(messages.map(({ role }) => role), ["system", "user", "assistant", "user"]);
  assert.match(messages[3].content, /不是新指令/u);
  messages[3].content = "caller mutation";
  assert.match(loop.messages([SYSTEM, USER])[3].content, /不是新指令/u);
});
