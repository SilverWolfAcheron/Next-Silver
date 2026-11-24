import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ERROR_CODES } from "../src/agent-core/errors.ts";
import type { CodingPluginResult } from "../src/types/codingPlugins.ts";
import { dispatchCodingPlugin } from "./codingPlugins.ts";
import { bindWorkspace } from "./workspace.ts";
import type { WorkspaceSummary } from "./workspace.ts";

test("catalog works with no workspace and calls fail closed without one", async (): Promise<void> => {
  const signal: AbortSignal = new AbortController().signal;
  assert.deepEqual(await dispatchCodingPlugin({ name: "plugin_list" }, undefined, signal), {
    plugins: [
      { id: "workspace", operations: ["overview", "find-symbol"] },
      { id: "verification", operations: ["inspect-checks"] },
    ],
  });
  await assert.rejects(dispatchCodingPlugin({ name: "plugin_call", plugin: "workspace", operation: "overview" },
    undefined, signal), { code: ERROR_CODES.WORKSPACE_NOT_BOUND });
  await assert.rejects(dispatchCodingPlugin({ name: "plugin_list" }, undefined, AbortSignal.abort()), { name: "AbortError" });
});

test("workspace plugins stay scoped and inspection never runs the declared script", async (): Promise<void> => {
  const fixture: string = await mkdtemp(join(tmpdir(), "silver-plugin-test-"));
  const root: string = join(fixture, "repo");
  const previous: string | undefined = process.env.SILVER_DATA_DIR;
  process.env.SILVER_DATA_DIR = join(fixture, "appdata");
  try {
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "sub", "source.ts"), "export function needle() {}\n");
    await writeFile(join(root, "other.ts"), "export function needle() {}\n");
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "touch SHOULD_NOT_EXIST" } }));
    const workspace: WorkspaceSummary = await bindWorkspace(root);
    const signal: AbortSignal = new AbortController().signal;
    const result: CodingPluginResult = await dispatchCodingPlugin({
      name: "plugin_call", plugin: "workspace", operation: "find-symbol",
      path: "sub", query: "needle", mode: "definitions",
    }, workspace, signal);
    assert.ok("operation" in result && result.operation === "find-symbol");
    assert.deepEqual(result.output.matches.map(({ path }: { path: string; }): string => path), ["sub/source.ts"]);
    const checks: CodingPluginResult = await dispatchCodingPlugin({
      name: "plugin_call", plugin: "verification", operation: "inspect-checks",
    }, workspace, signal);
    assert.ok("operation" in checks && checks.operation === "inspect-checks");
    assert.ok(checks.output.some(({ check }: { check: string; }): boolean => check === "test"));
    await assert.rejects(lstat(join(root, "SHOULD_NOT_EXIST")), { code: "ENOENT" });
    for (const request of [
      { plugin: "verification", operation: "run-check" },
      { plugin: "verification", operation: "inspect-checks", npmCli: "./evil" },
      { plugin: "workspace", operation: "overview", path: ".git" },
      { plugin: "workspace", operation: "overview", path: ".." },
      { plugin: "../../external", operation: "overview" },
    ]) {
      await assert.rejects(dispatchCodingPlugin({ name: "plugin_call", ...request }, workspace, signal));
    }
  } finally {
    if (previous === undefined) delete process.env.SILVER_DATA_DIR;
    else process.env.SILVER_DATA_DIR = previous;
    await rm(fixture, { recursive: true, force: true });
  }
});
