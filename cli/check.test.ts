import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { CHECK_MANIFEST_MAX_BYTES, CHECK_MAX_DIAGNOSTICS, CHECK_OUTPUT_OMISSION } from "../src/constants/check.ts";
import { inspectChecks, runCheck } from "./check.ts";
import { extractCheckDiagnostics } from "./checkDiagnostics.ts";
import { createCheckOutput } from "./checkOutput.ts";
import { bindWorkspace } from "./workspace.ts";
import type { WorkspaceSummary } from "./workspace.ts";

interface Fixture {
  workspace: WorkspaceSummary;
  root: string;
  fixture: string;
}

async function project(action: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await mkdtemp(join(tmpdir(), "silver-check-test-"));
  const root = join(fixture, "workspace project 中文");
  await mkdir(root);
  const previous = process.env.SILVER_DATA_DIR;
  process.env.SILVER_DATA_DIR = join(fixture, "appdata");
  try {
    await action({ workspace: await bindWorkspace(root), root, fixture });
  } finally {
    if (previous === undefined) delete process.env.SILVER_DATA_DIR;
    else process.env.SILVER_DATA_DIR = previous;
    await rm(fixture, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function manifest(directory: string, scripts: Record<string, unknown>): Promise<void> {
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "check-test-project", scripts }));
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

async function pollPid(path: string): Promise<number> {
  for (let i = 0; i < 80; i += 1) {
    const pid = Number(await readFile(path, "utf8").catch(() => ""));
    if (pid > 0) return pid;
    await delay(25);
  }
  throw new Error("fixture process did not start");
}

function scriptWithMarker(): string {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'fs.writeFileSync(path.join(process.cwd(), "ran"), "explicit check");',
    'process.stdout.write("ready\\n");',
  ].join("\n");
}

test("inspectChecks does not execute scripts or claim unavailable tasks are installed", () => project(async ({ root, workspace }) => {
  await manifest(root, { test: "node fixture.cjs", "check:types": "node fixture.cjs", build: "" });
  await writeFile(join(root, "fixture.cjs"), scriptWithMarker());
  assert.deepEqual(await inspectChecks(workspace), [
    { check: "test", available: true, command: "npm test" },
    { check: "typecheck", available: true, command: "npm run check:types" },
    { check: "build", available: false, errorCode: "CHECK_COMMAND_UNSUPPORTED" },
  ]);
  assert.equal(await exists(join(root, "ran")), false);
  await assert.rejects(() => runCheck(workspace, "build"), /CHECK_COMMAND_UNSUPPORTED/u);
  await runCheck(workspace, "test");
  assert.equal(await exists(join(root, "ran")), true);
}));

test("missing npm does not falsely hide a bundled TypeScript fallback", () => project(async ({ root, workspace, fixture }) => {
  await manifest(root, { build: "node fixture.cjs" });
  await writeFile(join(root, "tsconfig.json"), "{}");
  const tscDir = join(root, "node_modules", "typescript", "bin");
  await mkdir(tscDir, { recursive: true });
  await writeFile(join(tscDir, "tsc"), 'console.log("arguments", process.argv.slice(2).join(","));');
  const options = { npmCli: join(fixture, "npm-does-not-exist") };
  assert.deepEqual(await inspectChecks(workspace, options), [
    { check: "test", available: false, errorCode: "CHECK_COMMAND_UNSUPPORTED" },
    { check: "typecheck", available: true, command: "tsc --noEmit" },
    { check: "build", available: false, errorCode: "CHECK_NPM_NOT_FOUND" },
  ]);
  const result = await runCheck(workspace, "typecheck", options);
  assert.equal(result.command, "tsc --noEmit");
  assert.match(result.stdout, /arguments --noEmit/u);
}));

test("local typecheck fallback does not follow a dependency directory outside the package", { skip: process.platform === "win32" }, () => project(async ({ root, workspace, fixture }) => {
  const external = join(fixture, "dependencies");
  const externalTsc = join(external, "typescript", "bin");
  await mkdir(externalTsc, { recursive: true });
  await writeFile(join(externalTsc, "tsc"), scriptWithMarker());
  await symlink(external, join(root, "node_modules"), "dir");
  await writeFile(join(root, "tsconfig.json"), "{}");
  await assert.rejects(() => runCheck(workspace, "typecheck"), /CHECK_TYPECHECK_UNAVAILABLE/u);
  assert.equal(await exists(join(root, "ran")), false);
}));

test("nested package is explicit and sibling or linked directories are not followed", () => project(async ({ root, workspace, fixture }) => {
  const nested = join(root, "packages", "second");
  await mkdir(nested, { recursive: true });
  await manifest(root, { build: "node fixture.cjs" });
  await manifest(nested, { build: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), scriptWithMarker());
  await writeFile(join(nested, "fixture.cjs"), scriptWithMarker());

  assert.equal((await runCheck(workspace, "build", { cwd: "packages/second" })).exitCode, 0);
  assert.equal(await exists(join(nested, "ran")), true);
  assert.equal(await exists(join(root, "ran")), false);
  await assert.rejects(() => runCheck(workspace, "build", { cwd: fixture }), /CHECK_DIR_OUTSIDE_WORKSPACE/u);
  await assert.rejects(() => runCheck(workspace, "build", { cwd: "../" }), /CHECK_DIR_OUTSIDE_WORKSPACE/u);

  if (process.platform !== "win32") {
    await symlink(nested, join(root, "linked"), "dir");
    await assert.rejects(() => runCheck(workspace, "build", { cwd: "linked" }), /WORKSPACE_SYMLINK_FORBIDDEN/u);
  }
}));

test("npm checks only the selected package even if project configuration requests workspace traversal", () => project(async ({ root, workspace }) => {
  const nested = join(root, "packages", "second");
  await mkdir(nested, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "shared-root", workspaces: ["packages/*"], scripts: { test: "node fixture.cjs" },
  }));
  await writeFile(join(root, ".npmrc"), "workspaces=true\ninclude-workspace-root=true\n");
  await manifest(nested, { test: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), scriptWithMarker());
  await writeFile(join(nested, "fixture.cjs"), scriptWithMarker());
  assert.equal((await runCheck(workspace, "test")).exitCode, 0);
  assert.equal(await exists(join(root, "ran")), true);
  assert.equal(await exists(join(nested, "ran")), false);
}));

test("default npm test and pre/post hooks do not start unrequested files", () => project(async ({ root, workspace }) => {
  await manifest(root, { pretest: "node fixture.cjs", posttest: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), scriptWithMarker());
  await writeFile(join(root, "server.js"), scriptWithMarker());
  await assert.rejects(() => runCheck(workspace, "test"), /CHECK_COMMAND_UNSUPPORTED/u);
  assert.equal(await exists(join(root, "ran")), false);
}));

test("malformed or oversized manifests produce local diagnostics without exposing content", () => project(async ({ root, workspace }) => {
  const path = join(root, "package.json");
  for (const body of ["{ this-should-not-leak", "[]", " ".repeat(CHECK_MANIFEST_MAX_BYTES + 1)]) {
    await writeFile(path, body);
    const result = await inspectChecks(workspace);
    assert.equal(result.length, 3);
    assert.ok(result.every((item) => !item.available && item.errorCode === "CHECK_EXECUTION_FAILED"));
    assert.doesNotMatch(JSON.stringify(result), /this-should-not-leak/u);
    await assert.rejects(() => runCheck(workspace, "test"), /CHECK_EXECUTION_FAILED/u);
  }
}));

test("accepts Unicode package JSON with BOM and ignores non-string script entries", () => project(async ({ root, workspace }) => {
  await writeFile(join(root, "package.json"), "\uFEFF" + JSON.stringify({
    name: "utf8-test",
    scripts: { test: "node fixture.cjs", build: { not: "a valid script" } },
  }));
  await writeFile(join(root, "fixture.cjs"), scriptWithMarker());
  assert.equal((await runCheck(workspace, "test")).exitCode, 0);
  await assert.rejects(() => runCheck(workspace, "build"), /CHECK_COMMAND_UNSUPPORTED/u);
}));

test("limits combined and separate streams while preserving both ends", () => project(async ({ root, workspace }) => {
  await manifest(root, { build: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), [
    'process.stdout.write("first line\\n" + "中".repeat(220_000) + "\\nfinal stdout\\n");',
    'process.stderr.write("first stderr\\n" + "🐺".repeat(220_000) + "\\nfinal error\\n");',
    "process.exitCode = 27;",
  ].join("\n"));
  const budget = 512;
  const result = await runCheck(workspace, "build", { maxOutputChars: budget });
  assert.equal(result.exitCode, 27);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputTruncated, true);
  assert.ok(result.durationMs > 0);
  for (const text of [result.stdout, result.stderr, result.output]) {
    assert.ok(text.length <= budget);
    assert.ok(text.includes(CHECK_OUTPUT_OMISSION));
    assert.doesNotMatch(text, /[\uD800-\uDFFF]/u);
  }
  assert.match(result.stdout, /first line/u);
  assert.match(result.stdout, /final stdout/u);
  assert.match(result.stderr, /first stderr/u);
  assert.match(result.stderr, /final error/u);
}));

test("stream decoder handles split UTF-8 bytes and preserves short output exactly", () => {
  const collector = createCheckOutput(128);
  const payload = Buffer.from("中🐺\r\n", "utf8");
  collector.append("stdout", payload.subarray(0, 2));
  collector.append("stderr", Buffer.from("err\n"));
  collector.append("stdout", payload.subarray(2, 5));
  collector.append("stdout", payload.subarray(5));
  assert.deepEqual(collector.finish(), {
    stdout: "中🐺\r\n", stderr: "err\n", output: "err\n中🐺\r\n", outputTruncated: false,
  });
});

test("stream bounds hold at exact capacity, after 1 more byte, and on many small writes", () => {
  const exact = createCheckOutput(128);
  exact.append("stdout", Buffer.from("a".repeat(128)));
  assert.equal(exact.finish().outputTruncated, false);
  const collector = createCheckOutput(128);
  for (let i = 0; i < 15_000; i += 1) {
    collector.append(i % 11 === 0 ? "stderr" : "stdout", Buffer.from(i === 14_999 ? "END" : "猫"));
  }
  const captured = collector.finish();
  assert.equal(captured.output.length, 128);
  assert.match(captured.output, /^猫+\n/u);
  assert.match(captured.output, /END$/u);
  assert.equal(captured.outputTruncated, true);
});

test("reports timeout without claiming success and preserves check output before killing", { timeout: 8000 }, () => project(async ({ root, workspace }) => {
  await manifest(root, { test: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), 'process.stdout.write("starting check\\n"); setInterval(() => {}, 1000);');
  const result = await runCheck(workspace, "test", { timeoutMs: 1500 });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.match(result.output, /检查超时/u);
  assert.match(result.stdout, /starting check/u);
  assert.ok(result.durationMs < 6000);
}));

test("abort preserves the supplied reason and terminates the owned check process", { timeout: 8000 }, () => project(async ({ root, workspace }) => {
  await manifest(root, { test: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), [
    'require("node:fs").writeFileSync("test.pid", String(process.pid));',
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const controller = new AbortController();
  const reason = new Error("user paused inspection");
  const pending = runCheck(workspace, "test", { signal: controller.signal, timeoutMs: 5000 });
  const assertion = assert.rejects(pending, (error) => error === reason);
  const pid = await pollPid(join(root, "test.pid"));
  controller.abort(reason);
  await assertion;
  if (process.platform === "linux" || process.platform === "win32") assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}));

test("pre-aborted calls neither inspect nor launch checks", () => project(async ({ root, workspace }) => {
  await manifest(root, { test: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), scriptWithMarker());
  const reason = new Error("cancelled before starting");
  const signal = AbortSignal.abort(reason);
  await assert.rejects(() => inspectChecks(workspace, { signal }), (error) => error === reason);
  await assert.rejects(() => runCheck(workspace, "test", { signal }), (error) => error === reason);
  assert.equal(await exists(join(root, "ran")), false);
}));

test("check environment excludes unrelated inherited variables", () => project(async ({ root, workspace }) => {
  await manifest(root, { test: "node fixture.cjs" });
  await writeFile(join(root, "fixture.cjs"), [
    'console.log("value", process.env.SILVER_TEST_SENTINEL ?? "unset");',
    'console.log("path", process.env.Path || process.env.PATH ? "present" : "absent");',
  ].join("\n"));
  const prior = process.env.SILVER_TEST_SENTINEL;
  try {
    process.env.SILVER_TEST_SENTINEL = "not-workspace-data";
    const result = await runCheck(workspace, "test");
    assert.match(result.output, /value unset/u);
    assert.match(result.output, /path present/u);
    assert.doesNotMatch(result.output, /not-workspace-data/u);
  } finally {
    if (prior === undefined) delete process.env.SILVER_TEST_SENTINEL;
    else process.env.SILVER_TEST_SENTINEL = prior;
  }
}));

test("structured compiler hints are repo-relative, deduplicated, capped, and read-only", () => project(async ({ root, fixture }) => {
  const cwd = join(root, "packages", "nested");
  const payload = [
    "src/main.ts(12,4): error TS2322: bad assignment",
    "src/main.ts(12,4): error TS2322: bad assignment",
    "types.d.ts(1,2): warning TS6444: declaration warning",
    "error[E0308]: mismatched types",
    "  --> src/lib.rs:31:5",
    "service/main.go:8:17: cannot use value",
    "service/other.go:8: missing package",
    "../../../outside.go:1: must not include",
    `${join(fixture, "other.ts")}(1,2): error TS0001: absolute outside`,
    `${join(root, "file.ts")}(7,8): error TS5000: absolute inside`,
    "wrong.ts(0,3): error TS1000: invalid zero line",
    "wrong.ts(12345678901234567890,3): error TS1000: invalid long line number",
    "wrong.ts(99,3): error TS1000: " + "\0",
    "\x1b[31mmain.ts(4,5): error TS2551: escaped message\x1b[0m",
  ].join("\r\n");
  const results = extractCheckDiagnostics(payload, { root, cwd });
  assert.deepEqual(results.map(({ path, line, column, severity, code }) => ({ path, line, column, severity, code })), [
    { path: "packages/nested/src/main.ts", line: 12, column: 4, severity: "error", code: "TS2322" },
    { path: "packages/nested/types.d.ts", line: 1, column: 2, severity: "warning", code: "TS6444" },
    { path: "packages/nested/src/lib.rs", line: 31, column: 5, severity: "error", code: "E0308" },
    { path: "packages/nested/service/main.go", line: 8, column: 17, severity: "error", code: undefined },
    { path: "packages/nested/service/other.go", line: 8, column: undefined, severity: "error", code: undefined },
    { path: "file.ts", line: 7, column: 8, severity: "error", code: "TS5000" },
    { path: "packages/nested/main.ts", line: 4, column: 5, severity: "error", code: "TS2551" },
  ]);
  const many = Array.from({ length: CHECK_MAX_DIAGNOSTICS * 4 }, (_, i) => `file-${i}.go:2:2: failed`).join("\n");
  assert.equal(extractCheckDiagnostics(many, { root, cwd }).length, CHECK_MAX_DIAGNOSTICS);
}));
