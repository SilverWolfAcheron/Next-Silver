import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { checkName, runCheck } from "./check.ts";
import { connectEndpoint, endpointUrl, loadState, readEndpoint, saveStateSync, serve } from "./host.ts";
import type { RunningHost } from "./host.ts";
import { noProxyList, runtimeEnvironment } from "./proxy.ts";
import { exportThreads, importThreads } from "../src/agent-core/localData.ts";
import type { Thread } from "../src/agent-core/types.ts";
import {
  bindWorkspace, exportWorkspaceDocument, listWorkspace, readWorkspaceFile, readWorkspaceFileIfExists,
  searchWorkspaceFiles, searchWorkspaceText, splitWorkspacePath, writeWorkspaceFile,
} from "./workspace.ts";

async function fixture<T>(callback: (folder: string, dataDir: string) => Promise<T>): Promise<T> {
  const temporary = await mkdtemp(join(tmpdir(), "silver-cli-fixture-"));
  const rel = relative(tmpdir(), temporary);
  assert.ok(rel.startsWith("silver-cli-fixture-") && !isAbsolute(rel));
  const previous = process.env.SILVER_DATA_DIR;
  const dataDir = join(temporary, "appdata");
  process.env.SILVER_DATA_DIR = dataDir;
  try {
    return await callback(temporary, dataDir);
  } finally {
    if (previous === undefined) delete process.env.SILVER_DATA_DIR;
    else process.env.SILVER_DATA_DIR = previous;
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

test("loopback host authenticates actions and reconnects to running work", () => fixture(async (_, dataDir) => {
  let state = { count: 0 };
  let stopped = false;
  const runtime = {
    getState: () => state,
    action(name: string, args: unknown[]) {
      assert.equal(name, "increment");
      assert.deepEqual(args, [2]);
      state = { count: state.count + 2 };
      saveStateSync(dataDir, state);
      host.publish(state);
      return null;
    },
    shutdown() { stopped = true; },
  };
  const host = await serve({ runtime });
  const url = endpointUrl(host.endpoint);
  const auth = { Authorization: `Bearer ${host.endpoint.token}` };
  const signal = AbortSignal.timeout(5000);
  try {
    assert.equal(host.reused, false);
    assert.deepEqual(await connectEndpoint(), host.endpoint);
    assert.equal((await fetch(url + "/state", { signal })).status, 401);
    assert.equal((await fetch(url + "/state", { signal, headers: { ...auth, Origin: "https://evil.example" } })).status, 403);
    const next = await serve({ runtime });
    assert.equal(next.reused, true);
    assert.deepEqual(next.endpoint, host.endpoint);
    await next.close();
    const stream = await fetch(url + "/events", { signal, headers: { ...auth, Origin: "http://tauri.localhost" } });
    assert.equal(stream.headers.get("access-control-allow-origin"), "http://tauri.localhost");
    const reader = stream.body?.getReader();
    assert.ok(reader);
    assert.equal(Buffer.from((await reader.read()).value ?? []).toString(), 'data: {"count":0}\n\n');
    const command = await fetch(url + "/action", {
      method: "POST", signal, headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "increment", args: [2] }),
    });
    assert.equal(command.status, 200);
    assert.equal(Buffer.from((await reader.read()).value ?? []).toString(), 'data: {"count":2}\n\n');
    await reader.cancel();
    const restartedView = await fetch(url + "/state", { signal, headers: auth });
    assert.deepEqual(await restartedView.json(), { count: 2 });
    assert.deepEqual(await loadState(), { count: 2 });
    assert.equal((await fetch(url + "/shutdown", { method: "POST", signal, headers: auth })).status, 200);
    await host.close();
    assert.equal(stopped, true);
    assert.equal(await readEndpoint(), undefined);
  } finally {
    await host.close();
  }
}));

test("competing sidecars elect one host and recover after abrupt exit", () => fixture(async () => {
  const runtimeFile = new URL("./host.ts", import.meta.url).href;
  const script = [
    `import {serve} from ${JSON.stringify(runtimeFile)};`,
    "const runtime = {getState:()=>({owner:process.pid}),action:()=>null,shutdown(){}};",
    "const host = await serve({runtime});",
    "console.log(JSON.stringify({pid:process.pid,host:host.endpoint.pid,reused:host.reused}));",
  ].join("\n");
  const children = new Set<ReturnType<typeof spawn>>();
  function spawnHost() {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    return {
      child,
      info: new Promise<{ pid: number; host: number; reused: boolean }>((done, reject) => {
        let accumulated = "";
        child.once("error", reject);
        child.stdout.on("data", (bytes: Buffer) => {
          accumulated += bytes.toString("utf8");
          const firstLine = accumulated.split("\n")[0];
          if (accumulated.includes("\n")) {
            try { done(JSON.parse(firstLine)); } catch (error) { reject(error); }
          }
        });
        child.once("exit", (code) => {
          if (!accumulated.includes("\n")) reject(new Error(`Host exited before publishing status with code ${code}`));
        });
      }),
    };
  }
  try {
    const contenderA = spawnHost();
    const contenderB = spawnHost();
    const settled = await Promise.allSettled([contenderA.info, contenderB.info]);
    const [first, second] = settled.map((entry) => {
      if (entry.status !== "fulfilled") throw entry.reason;
      return entry.value;
    });
    assert.equal(first.host, second.host);
    assert.equal([first, second].filter(({ reused }) => !reused).length, 1);
    const firstOwner = first.reused ? contenderB.child : contenderA.child;
    const ownerExited = once(firstOwner, "exit");
    firstOwner.kill("SIGKILL");
    await ownerExited;
    const restarted = spawnHost();
    const newOwner = await restarted.info;
    assert.equal(newOwner.reused, false);
    assert.notEqual(newOwner.host, first.host);
    const endpoint = await connectEndpoint();
    assert.ok(endpoint);
    assert.equal(endpoint.pid, newOwner.host);
    const stopped = once(restarted.child, "exit");
    const reply = await fetch(`${endpointUrl(endpoint)}/shutdown`, {
      method: "POST", headers: { Authorization: `Bearer ${endpoint.token}` },
    });
    assert.equal(reply.status, 200);
    await stopped;
    assert.equal(await readEndpoint(), undefined);
  } finally {
    await Promise.allSettled([...children].map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }));
  }
}));

test("native workspaces preserve exact bytes and reject path escape and stale writes", () => fixture(async (directory) => {
  const root = join(directory, "work");
  const outside = join(directory, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "win.md"), "\ufeff首行\r\n内容\r\n");
  await writeFile(join(outside, "private.txt"), "must never be touched");
  await symlink(outside, join(root, "shortcut"), process.platform === "win32" ? "junction" : "dir");
  const workspace = await bindWorkspace(root);
  assert.deepEqual(await bindWorkspace(root), workspace);
  assert.deepEqual((await listWorkspace(workspace)).map(({ path }) => path), ["win.md"]);
  assert.equal(await readWorkspaceFile(workspace, "win.md"), "\ufeff首行\r\n内容\r\n");
  assert.equal(await readWorkspaceFileIfExists(workspace, "new/nested.md", { allowMissingParent: true }), null);
  await writeWorkspaceFile(workspace, { path: "new/nested.md", after: "在目录内创建", expectedBefore: null });
  assert.equal(await readFile(join(root, "new", "nested.md"), "utf8"), "在目录内创建");
  await assert.rejects(() => writeWorkspaceFile(workspace, { path: "win.md", after: "bad", expectedBefore: "stale" }), /WORKSPACE_FILE_CHANGED/u);
  assert.equal(await readFile(join(root, "win.md"), "utf8"), "\ufeff首行\r\n内容\r\n");
  const concurrent = await Promise.allSettled([
    writeWorkspaceFile(workspace, { path: "win.md", after: "one", expectedBefore: "\ufeff首行\r\n内容\r\n" }),
    writeWorkspaceFile(workspace, { path: "win.md", after: "two", expectedBefore: "\ufeff首行\r\n内容\r\n" }),
  ]);
  assert.deepEqual(concurrent.map(({ status }) => status), ["fulfilled", "rejected"]);
  await assert.rejects(() => readWorkspaceFile(workspace, "shortcut/private.txt"), /WORKSPACE_SYMLINK_FORBIDDEN/u);
  await assert.rejects(() => writeWorkspaceFile(workspace, { path: "shortcut/private.txt", after: "bad", expectedBefore: "must never be touched" }), /WORKSPACE_SYMLINK_FORBIDDEN/u);
  for (const value of ["../private.txt", "/private.txt", "C:/private.txt", "x:file", "NUL", "qa/CONIN$.txt", "one\\two"]) {
    assert.throws(() => splitWorkspacePath(value), /WORKSPACE_INVALID_PATH/u);
  }
  assert.equal(await readFile(join(outside, "private.txt"), "utf8"), "must never be touched");
  assert.equal((await searchWorkspaceFiles(workspace, "nested")).at(0)?.path, "new/nested.md");
  assert.equal((await searchWorkspaceText(workspace, "目录内")).at(0)?.path, "new/nested.md");
  assert.equal(await exportWorkspaceDocument(workspace, "说明.md", "hello"), "silver/说明.md");
  assert.equal(await exportWorkspaceDocument(workspace, "说明.md", "again"), "silver/说明-2.md");
}));

test("desktop backups preserve iteration history without exporting or restarting live work", () => {
  const thread: Thread = {
    id: "thread-1", title: "备份", presetId: "develop", mode: "project", brief: null, modelId: "newapi",
    inspectorTab: "progress", inspectorOpen: true, intakeStep: "done", artifacts: [],
    workspace: { id: "workspace-1", name: "repo", path: "C:/private/repo" },
    messages: [{
      id: "confirmation", text: "", role: "assistant",
      confirm: { intent: "steer", summary: "确认本轮写入" },
    }],
    queuedMessages: [{ id: "pending-message", text: "仍在等待的输入", role: "user" }],
    pendingConfirmation: { messageId: "confirmation", kind: "iteration", runId: "run-1", iterationId: "round-2", phase: "apply" },
    activeRequest: { kind: "message", messageId: "pending-message", attempt: "private-request-attempt" },
    runs: [{
      id: "run-1", title: "工作项", status: "in_progress", note: "", dependsOn: ["R1"],
      iterations: [{
        id: "round-1", index: 1, title: "首次检查", note: "", status: "completed",
        gaps: [{ requirementId: "R1", missing: "缺一次检查" }], evidence: ["R1 检查失败"], artifactIds: [],
        verdict: "continue", nextTitle: "修正检查",
        checks: [{ command: "npm test", exitCode: 1, output: "实际完整输出\r\n" }],
      }, {
        id: "round-2", index: 2, title: "修正检查", note: "", status: "in_progress",
        gaps: [], evidence: [], artifactIds: [], stage: "apply", approval: "apply", checkSequence: 0,
        attempt: "private-attempt",
        writes: [{ path: "entry.ts", before: "private-preimage", after: "candidate", artifactId: "artifact-1" }],
      }],
    }, {
      id: "run-legacy", title: "旧版本工作项", status: "completed", note: "", dependsOn: [],
    }],
  };
  const json = exportThreads([thread]);
  assert.doesNotMatch(json, /private-|C:\/private|checkSequence|"stage"|"approval"|"writes"/u);
  const [read] = importThreads(json);
  assert.deepEqual(read.workspace, { id: "workspace-1", name: "repo" });
  assert.equal(read.runs[0].status, "paused");
  assert.equal(read.runs[0].iterations?.[0].status, "completed");
  assert.equal(read.runs[0].iterations?.[0].checks?.[0].output, "实际完整输出\r\n");
  assert.equal(read.runs[0].iterations?.[1].status, "paused");
  assert.deepEqual(read.runs[1].iterations, []);
  assert.equal(read.pendingConfirmation, undefined);
  assert.equal(read.messages[0].confirm, undefined);
  assert.equal(read.queuedMessages, undefined);
  assert.equal(read.messages[1].text, "仍在等待的输入");
});

test("reconnecting replaces a host left behind by an older runtime build", () => fixture(async (_, dataDir) => {
  let stopped = false;
  const runtime = {
    getState: () => ({ count: 0 }),
    action: () => null,
    shutdown() { stopped = true; },
  };
  const host = await serve({ runtime });
  let fresh: RunningHost | undefined;
  try {
    const endpointPath = join(dataDir, "endpoint.json");
    const past = new Date("2020-01-01T00:00:00Z");
    await utimes(endpointPath, past, past);
    assert.equal(await connectEndpoint(), undefined);
    assert.equal(stopped, true);
    fresh = await serve({ runtime });
    assert.notEqual(fresh.endpoint.token, host.endpoint.token);
  } finally {
    await fresh?.close();
    await host.close();
  }
}));

test("runtime environment lets Node fetch honor system proxies without breaking loopback", () => {
  assert.equal(runtimeEnvironment({}).NODE_USE_ENV_PROXY, "1");
  assert.equal(runtimeEnvironment({ NODE_USE_ENV_PROXY: "0" }).NODE_USE_ENV_PROXY, "0");
  assert.equal(runtimeEnvironment({ PATH: "fixture" }).PATH, "fixture");
  const inherited = runtimeEnvironment({ NO_PROXY: "example.com", no_proxy: "example.com" });
  assert.equal(inherited.no_proxy, undefined);
  assert.equal(inherited.NO_PROXY, "example.com,localhost,127.0.0.1,::1");
  assert.equal(runtimeEnvironment({ no_proxy: "example.com" }).NO_PROXY, "example.com,localhost,127.0.0.1,::1");
  assert.equal(noProxyList(undefined), "localhost,127.0.0.1,::1");
  assert.equal(noProxyList("LOCALHOST, 127.0.0.1 ,, internal"), "LOCALHOST,127.0.0.1,internal,::1");
});

test("CLI executes only the allowed package checks in the bound folder", () => fixture(async (directory) => {
  const work = join(directory, "project 独立");
  await mkdir(work);
  await writeFile(join(work, "package.json"), JSON.stringify({
    name: "silver-check-fixture",
    scripts: {
      test: "node fixture.cjs test", typecheck: "node fixture.cjs typecheck",
      build: "node fixture.cjs build", pretest: "node fixture.cjs pretest",
    },
  }));
  await writeFile(join(work, "fixture.cjs"), [
    "const cmd = process.argv[2];",
    'if (cmd === "test") { console.log("测试输出"); console.error("测试错误"); process.exitCode = 7; }',
    'else console.log("CHECK:" + cmd);',
    'console.log("ROOT:" + process.cwd());',
  ].join("\n"));
  const workspace = await bindWorkspace(work);
  const result = await runCheck(workspace, "test");
  assert.equal(result.command, "npm test");
  assert.equal(result.exitCode, 7);
  assert.match(result.stdout, /测试输出/u);
  assert.match(result.stderr, /测试错误/u);
  assert.ok(result.stdout.includes(work));
  assert.doesNotMatch(result.output, /CHECK:pretest/u);
  const types = await runCheck(workspace, "typecheck");
  assert.equal(types.command, "npm run typecheck");
  assert.equal(types.exitCode, 0);
  assert.match(types.output, /CHECK:typecheck/u);
  const built = await runCheck(workspace, "build");
  assert.equal(built.command, "npm run build");
  assert.equal(built.exitCode, 0);
  assert.match(built.output, /CHECK:build/u);
  assert.throws(() => checkName("npm test; other"), /CHECK_COMMAND_UNSUPPORTED/u);
  assert.throws(() => checkName("npm run build --prefix .."), /CHECK_COMMAND_UNSUPPORTED/u);
  await assert.rejects(() => runCheck(workspace, "build", { cwd: directory }), /CHECK_DIR_OUTSIDE_WORKSPACE/u);
  await mkdir(join(work, "empty"));
  const nested = await bindWorkspace(join(work, "empty"));
  await assert.rejects(() => runCheck(nested, "test"), /CHECK_MANIFEST_MISSING/u);

  await writeFile(join(work, "package.json"), JSON.stringify({ scripts: { test: "node linger.cjs" } }));
  await writeFile(join(work, "linger.cjs"), [
    'require("node:fs").writeFileSync("active.pid", String(process.pid));',
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const controller = new AbortController();
  const pending = runCheck(workspace, "test", { signal: controller.signal });
  const resultCheck = assert.rejects(pending, { name: "AbortError" });
  let processId: number | undefined;
  for (let attempt = 0; attempt < 80 && !processId; attempt++) {
    await delay(50);
    processId = Number(await readFile(join(work, "active.pid"), "utf8").catch(() => ""));
  }
  controller.abort();
  await resultCheck;
  assert.ok(processId, "fixture spawned a child before abort");
  assert.throws(() => process.kill(processId, 0), { code: "ESRCH" });
}));
