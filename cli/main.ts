import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SilverState } from "../src/model/silverState";
import type { DesktopSnapshot } from "../src/model/desktopClient";
import { appDataDir, connectEndpoint, endpointUrl, loadState, saveStateSync, serve, type Endpoint } from "./host";
import { createRuntime } from "./runtime";
import { bindWorkspace } from "./workspace";
import { checkName, runCheck } from "./check";

async function startService() {
  const directory = appDataDir();
  const state = await loadState<SilverState>(directory);
  const runtime = createRuntime(state, (next) => saveStateSync(directory, next), directory);
  const host = await serve({ dataDir: directory, runtime });
  if (!host.reused) runtime.restore();
}

async function findService(): Promise<Endpoint> {
  const existing = await connectEndpoint();
  if (existing) return existing;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
    detached: true, stdio: "ignore", windowsHide: true,
  });
  let failure: Error | undefined;
  child.once("error", (error) => { failure = error; });
  child.unref();
  for (let attempt = 0; attempt < 80; attempt++) {
    await delay(100);
    if (failure) throw failure;
    const connected = await connectEndpoint();
    if (connected) return connected;
  }
  throw new Error("Silver CLI 无法启动。可在终端运行 silver serve 查看错误。");
}

async function remote<T>(host: Endpoint, path: string, body?: unknown): Promise<T> {
  const response = await fetch(endpointUrl(host) + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Silver CLI 请求失败。");
  return result as T;
}

async function runTask(host: Endpoint, directory: string, task: string) {
  if (!task) {
    if (!process.stdin.isTTY) throw new Error("请在工作区路径后提供任务说明。");
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try { task = (await input.question("任务说明 ")).trim(); } finally { input.close(); }
  }
  if (!task) throw new Error("任务说明不能为空。");
  const call = <T = unknown>(name: string, ...args: unknown[]) => remote<T>(host, "/action", { name, args });
  const snapshot = await remote<DesktopSnapshot>(host, "/state");
  const provider = snapshot.state.providers.find((entry) => entry.hasKey && entry.model.trim());
  if (!provider) throw new Error("请先为 Silver 配置一个模型供应商。");
  const workspace = await call<{ id: string }>("workspace.bind", resolve(directory));
  const threadId = await call<string>("newThread", "develop");
  await call("bindWorkspace", threadId, workspace.id);
  await call("selectModel", threadId, provider.id, provider.model);
  await call("sendMessage", threadId, task);
  console.log(threadId);
  let printed = "";
  for (;;) {
    await delay(350);
    const current = await remote<DesktopSnapshot>(host, "/state");
    const thread = current.state.threads.find(({ id }) => id === threadId);
    if (!thread) return;
    const last = thread.messages.filter(({ role }) => role === "assistant").at(-1);
    const status = thread.runs.map(({ title, status, note }) => `${title} [${status}] ${note}`).join("\n");
    const output = [last?.text, last?.error, last?.confirm?.summary, status].filter(Boolean).join("\n");
    if (output && output !== printed) console.log(printed = output);
    if (!current.busyThreads.includes(threadId) || thread.pendingConfirmation) {
      if (thread.pendingConfirmation) console.log("请在 Silver 窗口确认，或调用 silver action resolveConfirmation。");
      return;
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "serve") return startService();
  if (command === "check") {
    const workspace = await bindWorkspace(resolve(args[1] || process.cwd()));
    const result = await runCheck(workspace, checkName(args[0] || "test"));
    process.stdout.write(result.output);
    process.exitCode = result.exitCode ?? 1;
    return;
  }
  if (command === "sessions" || command === "run" || command === "action" || command === "stop-service") {
    const host = await findService();
    if (command === "stop-service") return remote(host, "/shutdown", {});
    if (command === "sessions") {
      const { state } = await remote<DesktopSnapshot>(host, "/state");
      for (const thread of state.threads) console.log(`${thread.id}\t${thread.title}`);
      return;
    }
    if (command === "run" && args[0]) return runTask(host, args[0], args.slice(1).join(" "));
    if (command === "action" && args[0]) {
      const values = args.slice(1).map((arg) => { try { return JSON.parse(arg); } catch { return arg; } });
      const result = await remote(host, "/action", { name: args[0], args: values });
      if (result != null) console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
  console.log("Silver CLI\n  silver serve\n  silver run <工作区> [任务]\n  silver check [test|typecheck|build] [工作区]\n  silver sessions\n  silver action <动作> [参数…]\n  silver stop-service");
  if (command && command !== "--help" && command !== "help") process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Silver CLI 执行失败。");
  process.exitCode = 1;
});
