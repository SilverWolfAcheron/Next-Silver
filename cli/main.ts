import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type { Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AppError, ERROR_CODES, extractErrorCode } from "../src/agent-core/errors";
import type { ProviderConfig } from "../src/agent-core/provider/presets";
import type { DesktopSnapshot, SilverState } from "../src/agent-core/silverState";
import type { ChatMessage, Run, Thread, WorkspaceSummary } from "../src/agent-core/types";
import { getMessages } from "../src/i18n";
import { formatError, formatLocalizedText, logError, resolveSystemLocale } from "../src/i18n/errors";
import type { ParsedErrorCode } from "../src/types/errors";
import type { Messages } from "../src/types/i18n";
import { appDataDir, connectEndpoint, endpointUrl, loadState, saveStateSync, serve } from "./host";
import type { Endpoint, RunningHost } from "./host";
import { runtimeEnvironment } from "./proxy";
import { createRuntime } from "./runtime";
import type { DesktopRuntime } from "./runtime";
import { bindWorkspace } from "./workspace";
import { checkName, runCheck } from "./check";
import type { CheckResult } from "./check";

async function startService(): Promise<void> {
  const directory: string = appDataDir();
  const state: SilverState | undefined = await loadState<SilverState>(directory);
  const runtime: DesktopRuntime = createRuntime(state, (next: SilverState): void => saveStateSync(directory, next), directory);
  const host: RunningHost = await serve({ dataDir: directory, runtime });
  if (!host.reused) runtime.restore();
}

async function findService(): Promise<Endpoint> {
  const existing: Endpoint | undefined = await connectEndpoint();
  if (existing) return existing;
  const child: ChildProcess = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
    detached: true, stdio: "ignore", windowsHide: true, env: runtimeEnvironment(),
  });
  let failure: Error | undefined;
  child.once("error", (error: Error): void => { failure = error; });
  child.unref();
  for (let attempt: number = 0; attempt < 80; attempt++) {
    await delay(100);
    if (failure) throw failure;
    const connected: Endpoint | undefined = await connectEndpoint();
    if (connected) return connected;
  }
  throw new AppError(ERROR_CODES.CLI_START_FAILED);
}

async function remote<T>(host: Endpoint, path: string, body?: unknown): Promise<T> {
  const response: Response = await fetch(endpointUrl(host) + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const parsed: ParsedErrorCode = extractErrorCode(result, ERROR_CODES.CLI_REQUEST_FAILED);
    throw new AppError(parsed.code, { params: parsed.params });
  }
  return result as T;
}

async function runTask(host: Endpoint, directory: string, task: string): Promise<void> {
  if (!task) {
    if (!process.stdin.isTTY) throw new AppError(ERROR_CODES.CLI_TASK_REQUIRED);
    const input: Interface = createInterface({ input: process.stdin, output: process.stdout });
    try { task = (await input.question("任务说明 ")).trim(); } finally { input.close(); }
  }
  if (!task) throw new AppError(ERROR_CODES.CLI_TASK_EMPTY);
  const messages: Messages = getMessages(resolveSystemLocale());
  const call = <T = unknown>(name: string, ...args: unknown[]): Promise<T> => remote<T>(host, "/action", { name, args });
  const snapshot: DesktopSnapshot = await remote<DesktopSnapshot>(host, "/state");
  const provider: ProviderConfig | undefined = snapshot.state.providers.find(
    (entry: ProviderConfig): string | false | undefined => entry.hasKey && entry.model.trim()
  );
  if (!provider) throw new AppError(ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  const workspace: { id: string; } = await call<{ id: string }>("workspace.bind", resolve(directory));
  const threadId: string = await call<string>("newThread", "develop");
  await call("bindWorkspace", threadId, workspace.id);
  await call("selectModel", threadId, provider.id, provider.model);
  await call("sendMessage", threadId, task);
  console.log(threadId);
  let printed: string = "";
  for (;;) {
    await delay(350);
    const current: DesktopSnapshot = await remote<DesktopSnapshot>(host, "/state");
    const thread: Thread | undefined = current.state.threads.find(({ id }: Thread): boolean => id === threadId);
    if (!thread) return;
    const last: ChatMessage | undefined = thread.messages.filter(({ role }: ChatMessage): boolean => role === "assistant").at(-1);
    const status: string = thread.runs
      .map(({ title, status: runStatus, note }: Run): string =>
        `${title} [${runStatus}] ${formatLocalizedText(note, messages)}`
      )
      .join("\n");
    const lastError: string | undefined = last?.error ? formatError(last.error, messages) : undefined;
    const output: string = [last?.text, lastError, last?.confirm?.summary, status].filter(Boolean).join("\n");
    if (output && output !== printed) console.log(printed = output);
    if (!current.busyThreads.includes(threadId) || thread.pendingConfirmation) {
      if (thread.pendingConfirmation) console.log("请在 Silver 窗口确认，或调用 silver action resolveConfirmation。");
      return;
    }
  }
}

async function main(): Promise<void> {
  const [command, ...args]: string[] = process.argv.slice(2);
  if (command === "serve") return startService();
  if (command === "check") {
    const workspace: WorkspaceSummary = await bindWorkspace(resolve(args[1] || process.cwd()));
    const result: CheckResult = await runCheck(workspace, checkName(args[0] || "test"));
    process.stdout.write(result.output);
    process.exitCode = result.exitCode ?? 1;
    return;
  }
  if (command === "sessions" || command === "run" || command === "action" || command === "stop-service") {
    const host: Endpoint = await findService();
    if (command === "stop-service") {
      await remote(host, "/shutdown", {});
      return;
    }
    if (command === "sessions") {
      const { state }: DesktopSnapshot = await remote<DesktopSnapshot>(host, "/state");
      for (const thread of state.threads) console.log(`${thread.id}\t${thread.title}`);
      return;
    }
    if (command === "run" && args[0]) return runTask(host, args[0], args.slice(1).join(" "));
    if (command === "action" && args[0]) {
      const values: unknown[] = args.slice(1).map((arg: string): unknown => {
        try { return JSON.parse(arg) as unknown; } catch { return arg; }
      });
      const result: unknown = await remote(host, "/action", { name: args[0], args: values });
      if (result !== null && result !== undefined) console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
  console.log("Silver CLI\n  silver serve\n  silver run <工作区> [任务]\n  silver check [test|typecheck|build] [工作区]\n  silver sessions\n  silver action <动作> [参数…]\n  silver stop-service");
  if (command && command !== "--help" && command !== "help") process.exitCode = 1;
}

void main().catch((error: unknown): void => {
  logError(error, undefined, ERROR_CODES.CLI_EXECUTION_FAILED);
  process.exitCode = 1;
});
