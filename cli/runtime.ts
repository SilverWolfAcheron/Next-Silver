import { initialState, makeThread, reduceSilver, type Action, type SilverState } from "../src/model/silverState";
import { SAMPLE_PCB_THREAD } from "../src/model/samples";
import { importThreads } from "../src/model/localData";
import { getPreset } from "../src/model/presets";
import { applyDiff, decideDiffFile, diffNeedsConfirmation, diffPolicyError, parseDiff } from "../src/model/diff";
import { makeClient, type ProviderConfig } from "../src/provider/presets";
import type { Brief, Thread, WorkspaceSummary } from "../src/model/types";
import { describeProviderError } from "../src/provider/client";
import type { DesktopSnapshot } from "../src/model/desktopClient";
import { createConversation } from "./conversation";
import { createRequestJournal } from "./journal";
import {
  bindWorkspace, exportWorkspaceDocument, listWorkspace, readWorkspaceFile, readWorkspaceFileIfExists,
  requestWorkspaceAccess, searchWorkspaceFiles, writeWorkspaceFile, lookupWorkspace,
} from "./workspace";
import { checkName, runCheck } from "./check";

const text = (value: unknown): string => typeof value === "string" ? value : "";
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error("无效的记录编号。");
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求参数格式不正确。");
  return value as Record<string, unknown>;
}

export function createRuntime(saved: Partial<SilverState> | undefined, onChange: (state: SilverState) => void, dataDir: string) {
  const initial = initialState(saved);
  const latest = { current: initial };
  const listeners = new Set<(snapshot: DesktopSnapshot) => void>();
  const operation = createRequestJournal(dataDir);
  const busyBindings = new Set<string>();
  let revision = Date.now() * 1_000;
  let closing = false;

  function getState(): DesktopSnapshot {
    const state = latest.current;
    return {
      revision, busyThreads: state.threads.filter(({ id }) => conversation.isGenerating(id)).map(({ id }) => id),
      state: {
        ...state,
        providers: state.providers.map((provider) => ({ ...provider, key: "", hasKey: Boolean(provider.key.trim()) })),
        threads: state.threads.map((thread) => ({
          ...thread, runs: thread.runs.map(({ seatPlan: _, ...run }) => ({
            ...run,
            iterations: run.iterations?.map(({ writes: _writes, ...iteration }) => iteration),
          })),
        })),
      },
    };
  }

  function publish() {
    revision++;
    if (!listeners.size) return;
    const value = getState();
    listeners.forEach((listener) => listener(value));
  }

  function commit(action: Action) {
    const next = reduceSilver(latest.current, action);
    if (next === latest.current) return;
    onChange(next);
    latest.current = next;
    publish();
  }

  function newThread(preset: string) {
    const thread = makeThread(preset);
    commit({ type: "NEW_THREAD", thread });
    return thread;
  }

  const conversation = createConversation(latest, commit, newThread, publish, operation);

  function find(threadId: string): Thread {
    const thread = latest.current.threads.find(({ id }) => id === threadId);
    if (!thread) throw new Error("找不到此对话。");
    return thread;
  }

  function edit(threadId: string, update: (thread: Thread) => Thread) {
    commit({ type: "UPDATE_THREAD", threadId, update });
  }

  async function workspace(workspaceId: string): Promise<WorkspaceSummary> {
    return lookupWorkspace(workspaceId, dataDir);
  }

  function withProvider(value: unknown, replacementKey: unknown): ProviderConfig {
    const input = record(value);
    const existing = latest.current.providers.find(({ id }) => input.id === id);
    if (!existing) throw new Error("供应商不存在。");
    const protocol = existing.id === "custom" ? input.protocol : existing.protocol;
    if (protocol !== "openai" && protocol !== "anthropic" && protocol !== "gemini") throw new Error("供应商协议无效。");
    const config: ProviderConfig = {
      id: existing.id,
      protocol,
      label: text(input.label).trim() || existing.label,
      baseUrl: text(input.baseUrl).trim() || undefined,
      model: text(input.model).trim(),
      key: typeof replacementKey === "string" ? replacementKey.trim() : existing.key,
    };
    if (config.baseUrl) makeClient(config);
    return config;
  }

  async function acceptFile(threadId: string, artifactId: string, path: string, confirmed: boolean) {
    const thread = find(threadId);
    const artifact = thread.artifacts.find(({ id }) => id === artifactId);
    const selected = thread.workspace;
    if (!artifact || artifact.kind !== "diff" || !selected || (artifact.workspaceId && artifact.workspaceId !== selected.id)) {
      throw new Error("差异未绑定在当前工作区。");
    }
    if (artifact.fileDecisions?.[path] === "accepted") return;
    if (artifact.fileDecisions?.[path] === "rejected") throw new Error("该文件的差异已拒绝。");
    const change = parseDiff(artifact.body).find((entry) => entry.change?.path === path)?.change;
    if (!change) throw new Error("无法应用这份差异。");
    const restriction = diffPolicyError(change, getPreset(thread.presetId).writePolicy);
    if (restriction) throw new Error(restriction);
    if (diffNeedsConfirmation(change) && !confirmed) throw new Error("此变更需要再次确认。");
    if (busyBindings.has(selected.id)) throw new Error("这个工作区正在应用另一份差异，请稍后重试。");
    busyBindings.add(selected.id);
    try {
      const before = await readWorkspaceFileIfExists(selected, path, { allowMissingParent: change.operation === "create" });
      const after = applyDiff(change, before);
      await writeWorkspaceFile(selected, path, after, before);
      edit(threadId, (current) => ({
        ...current, artifacts: decideDiffFile(current.artifacts, artifact, path, "accepted"),
      }));
    } finally { busyBindings.delete(selected.id); }
  }

  function uiDispatch(value: unknown) {
    const input = record(value);
    switch (input.type) {
      case "SELECT_THREAD": return commit({ type: input.type, id: find(id(input.id)).id });
      case "RENAME_THREAD": return commit({ type: input.type, threadId: id(input.threadId), title: text(input.title) });
      case "TOGGLE_THREAD_PIN": return commit({ type: input.type, threadId: id(input.threadId) });
      case "DELETE_THREAD": {
        const threadId = id(input.threadId);
        conversation.cancelThread(threadId);
        return commit({ type: input.type, threadId });
      }
      case "IMPORT_THREADS": {
        const threads = importThreads(JSON.stringify({ threads: input.threads }));
        threads.forEach(({ id }) => conversation.cancelThread(id));
        return commit({ type: input.type, threads });
      }
      case "SET_INSPECTOR_TAB": {
        if (input.tab !== "brief" && input.tab !== "progress" && input.tab !== "artifact") return;
        return commit({ type: input.type, threadId: id(input.threadId), tab: input.tab });
      }
      case "SET_INSPECTOR_OPEN": return commit({ type: input.type, threadId: id(input.threadId), open: input.open === true });
      case "SET_PROVIDER_PANEL_OPEN": return commit({ type: input.type, open: input.open === true });
      case "SET_APPEARANCE": {
        const { theme } = record(input.appearance);
        if (theme === "dark" || theme === "light" || theme === "system") commit({ type: input.type, appearance: { theme } });
        return;
      }
      case "SET_DEVELOPMENT_CONCURRENCY":
        commit({ type: input.type, value: Number(input.value) });
        conversation.rescheduleSeats();
        return;
      default: throw new Error("未知的桌面状态操作。");
    }
  }

  async function action(name: string, args: unknown[]): Promise<unknown> {
    if (closing) throw new Error("Silver 正在保存状态并退出。");
    const [a, b, c, d] = args;
    switch (name) {
      case "dispatch": return uiDispatch(a);
      case "newThread": return newThread(text(a)).id;
      case "openSample":
        if (latest.current.threads.some(({ id }) => id === SAMPLE_PCB_THREAD.id)) {
          return commit({ type: "SELECT_THREAD", id: SAMPLE_PCB_THREAD.id });
        }
        return commit({ type: "NEW_THREAD", thread: { ...SAMPLE_PCB_THREAD, updatedAt: Date.now() } });
      case "sendMessage": return conversation.sendMessage(a ? id(a) : undefined, text(b), Array.isArray(c) ? c.filter((v): v is string => typeof v === "string").slice(0, 8) : []);
      case "selectModel": return conversation.selectModel(a ? id(a) : undefined, id(b), text(c));
      case "changePreset": return conversation.changePreset(a ? id(a) : undefined, text(b));
      case "retryMessage": return conversation.retryMessage(id(a), id(b));
      case "retryRun": return conversation.retryRun(id(a), id(b));
      case "promoteThread": return conversation.promoteThread(id(a));
      case "updateBrief": return conversation.updateBrief(id(a), b as Brief);
      case "patchFinding": return conversation.patchFinding(id(a), text(b));
      case "resolveConfirmation": return conversation.resolveConfirmation(id(a), id(b), c === true);
      case "stop": return conversation.stop(id(a));
      case "bindWorkspace": {
        const thread = find(id(a));
        if (conversation.isGenerating(thread.id)) throw new Error("请先停止该对话的工作项，再更换工作区。");
        const checked = await workspace(id(b));
        return edit(thread.id, (current) => ({
          ...current, workspace: checked,
          updatedAt: Date.now(),
        }));
      }
      case "acceptFile": return acceptFile(id(a), id(b), text(c), d === true);
      case "decideFile": {
        const thread = find(id(a));
        const artifact = thread.artifacts.find(({ id }) => id === b);
        if (!artifact || d !== "rejected") return;
        return edit(thread.id, (current) => ({
          ...current, artifacts: decideDiffFile(current.artifacts, artifact, text(c), "rejected"),
        }));
      }
      case "saveProvider": {
        const config = withProvider(a, b);
        commit({ type: "SET_PROVIDERS", providers: latest.current.providers.map((provider) => provider.id === config.id ? config : provider) });
        conversation.resumeQueued();
        return;
      }
      case "testProvider": {
        try { return await makeClient(withProvider(a, b)).listModels(AbortSignal.timeout(30_000)); }
        catch (error) { throw new Error(describeProviderError(error)); }
      }
      case "workspace.bind": return bindWorkspace(text(a), dataDir);
      case "workspace.access": return requestWorkspaceAccess(await workspace(id(a)));
      case "workspace.list": return listWorkspace(await workspace(id(a)), text(b));
      case "workspace.read": return readWorkspaceFile(await workspace(id(a)), text(b));
      case "workspace.search": return searchWorkspaceFiles(await workspace(id(a)), text(b), typeof c === "number" ? c : 24);
      case "workspace.export": {
        const binding = await workspace(id(a));
        if (!latest.current.threads.some((thread) => thread.workspace?.id === binding.id && getPreset(thread.presetId).writePolicy !== "none")) {
          throw new Error("当前工作区没有可写文稿的对话。");
        }
        return exportWorkspaceDocument(binding, text(b), text(c));
      }
      case "check": return runCheck(await workspace(id(a)), checkName(b));
      default: throw new Error("未知的 Silver CLI 动作。");
    }
  }

  return {
    getState, action,
    subscribe(listener: (state: DesktopSnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore() { conversation.restore(); },
    async shutdown() {
      closing = true;
      await conversation.shutdown();
      onChange(latest.current);
    },
  };
}
