import { initialState, makeThread, reduceSilver } from "../src/agent-core/silverState";
import type { Action, DesktopSnapshot, SilverState } from "../src/agent-core/silverState";
import { AppError, ERROR_CODES } from "../src/agent-core/errors";
import type { ErrorCode } from "../src/types/errors";
import { importThreads } from "../src/agent-core/localData";
import { getPreset } from "../src/agent-core/presets";
import { applyDiff, decideDiffFile, diffNeedsConfirmation, diffPolicyError, isDiffPath, parseDiff } from "../src/utils/diff";
import type { DiffFile, FileChange } from "../src/types/diff";
import { makeClient } from "../src/agent-core/provider/presets";
import type { ProviderConfig } from "../src/agent-core/provider/presets";
import type { Artifact, Brief, ChatDraft, Iteration, Run, Thread, WorkspaceSummary } from "../src/agent-core/types";
import { describeProviderError } from "../src/agent-core/provider/client";
import { createConversation } from "./conversation";
import type { ConversationService } from "./conversationHelpers";
import { createRequestJournal } from "./journal";
import type { RequestJournal } from "./journal";
import {
  bindWorkspace, exportWorkspaceDocument, listWorkspace, readWorkspaceFile, readWorkspaceFileIfExists,
  requestWorkspaceAccess, searchWorkspaceFiles, searchWorkspaceText, subscribeWorkspaceChanges,
  writeWorkspaceFile, lookupWorkspace,
} from "./workspace";
import { isProtectedCodingPath } from "./codingPreflightPaths";
import { checkName, runCheck } from "./check";
import { readWorkspaceGitDiff } from "./gitDiff";
import {
  appendWorkspaceFile,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceDirectory,
  deleteWorkspaceFile,
  deleteWorkspaceFileLines,
  renameWorkspaceDirectory,
  renameWorkspaceFile,
  replaceWorkspaceFileContent,
  replaceWorkspaceFileLines,
} from "./workspaceFileOps";

export interface DesktopRuntime {
  getState(): DesktopSnapshot;
  action(name: string, args: unknown[]): Promise<unknown>;
  subscribe(listener: (state: DesktopSnapshot) => void): () => void;
  restore(): void;
  shutdown(): Promise<void>;
}

const text = (value: unknown): string => typeof value === "string" ? value : "";
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new AppError(ERROR_CODES.CLI_INVALID_ID);
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(ERROR_CODES.CLI_INVALID_PARAMS);
  return value as Record<string, unknown>;
}

function readDraft(value: unknown, thread: Thread | undefined): ChatDraft {
  const draft: Record<string, unknown> = record(value);
  const workspaceId: string | undefined = thread?.workspace?.id;
  if ((draft.workspaceId ?? undefined) !== workspaceId) throw new AppError(ERROR_CODES.WORKSPACE_DRAFT_MISMATCH);
  const attachments: string[] = workspaceId && Array.isArray(draft.attachments)
    ? [...new Set(draft.attachments.filter((path: unknown): path is string => typeof path === "string" && isDiffPath(path)))].slice(0, 8)
    : [];
  const input: string = text(draft.text);
  if (input.length > 100_000) throw new AppError(ERROR_CODES.WORKSPACE_DRAFT_TOO_LONG);
  return { text: input, attachments, workspaceId };
}

export function createRuntime(
  saved: Partial<SilverState> | undefined,
  onChange: (state: SilverState) => void,
  dataDir: string
): DesktopRuntime {
  const initial: SilverState = initialState(saved);
  const latest: { current: SilverState; } = { current: initial };
  const listeners: Set<(snapshot: DesktopSnapshot) => void> = new Set();
  const operation: RequestJournal = createRequestJournal(dataDir);
  const busyBindings: Set<string> = new Set();
  const watchedWorkspaces: Map<string, () => void> = new Map();
  const workspaceVersions: Map<string, number> = new Map();
  let workspacePublish: ReturnType<typeof setTimeout> | undefined;
  let revision: number = Date.now() * 1_000;
  let stateRevision: number = revision;
  let closing: boolean = false;

  function getState(): DesktopSnapshot {
    const state: SilverState = latest.current;
    return {
      revision, stateRevision, workspaceVersions: Object.fromEntries(workspaceVersions),
      busyThreads: state.threads.filter(({ id }: Thread): boolean => conversation.isGenerating(id)).map(({ id }: Thread): string => id),
      modelActivity: conversation.modelActivity(),
      state: {
        ...state,
        providers: state.providers.map((provider: ProviderConfig): ProviderConfig => ({ ...provider, key: "", hasKey: Boolean(provider.key.trim()) })),
        threads: state.threads.map((thread: Thread): Thread => ({
          ...thread, runs: thread.runs.map(({ seatPlan: _, ...run }: Run): Run => ({
            ...run,
            iterations: run.iterations?.map(({ writes: _writes, ...iteration }: Iteration): Iteration => iteration),
          })),
        })),
      },
    };
  }

  function publish(): void {
    revision++;
    if (!listeners.size) return;
    const value: DesktopSnapshot = getState();
    listeners.forEach((listener: (snapshot: DesktopSnapshot) => void): void => listener(value));
  }

  function commit(action: Action): void {
    const next: SilverState = reduceSilver(latest.current, action);
    if (next === latest.current) return;
    onChange(next);
    latest.current = next;
    stateRevision = revision + 1;
    watchWorkspaces();
    publish();
  }

  function watchWorkspaces(): void {
    const active: Set<string> = new Set(latest.current.threads.flatMap(({ workspace }: Thread): string[] => workspace ? [workspace.id] : []));
    for (const [key, dispose] of watchedWorkspaces) {
      if (active.has(key)) continue;
      dispose();
      watchedWorkspaces.delete(key);
      workspaceVersions.delete(key);
    }
    for (const { workspace } of latest.current.threads) {
      if (!workspace || watchedWorkspaces.has(workspace.id)) continue;
      const unsubscribe: () => void = subscribeWorkspaceChanges(workspace, (): void => {
        workspaceVersions.set(workspace.id, (workspaceVersions.get(workspace.id) ?? 0) + 1);
        workspacePublish ??= setTimeout((): void => {
          workspacePublish = undefined;
          publish();
        }, 100);
      });
      watchedWorkspaces.set(workspace.id, unsubscribe);
    }
  }
  watchWorkspaces();

  function newThread(preset: string): Thread {
    const thread: Thread = makeThread(preset);
    commit({ type: "NEW_THREAD", thread });
    return thread;
  }

  const conversation: ConversationService = createConversation({
    latest,
    dispatch: commit,
    newThread,
    refreshJobs: publish,
    journal: operation,
  });

  function find(threadId: string): Thread {
    const thread: Thread | undefined = latest.current.threads.find(({ id }: Thread): boolean => id === threadId);
    if (!thread) throw new AppError(ERROR_CODES.SESSION_THREAD_NOT_FOUND);
    return thread;
  }

  function edit(threadId: string, update: (thread: Thread) => Thread): void {
    commit({ type: "UPDATE_THREAD", threadId, update });
  }

  async function workspace(workspaceId: string): Promise<WorkspaceSummary> {
    return lookupWorkspace(workspaceId, dataDir);
  }

  function withProvider(value: unknown, replacementKey: unknown): ProviderConfig {
    const input: Record<string, unknown> = record(value);
    const existing: ProviderConfig | undefined = latest.current.providers.find(({ id }: ProviderConfig): boolean => input.id === id);
    if (!existing) throw new AppError(ERROR_CODES.PROVIDER_NOT_FOUND);
    const protocol: unknown = existing.id === "custom" ? input.protocol : existing.protocol;
    if (protocol !== "openai" && protocol !== "anthropic" && protocol !== "gemini") {
      throw new AppError(ERROR_CODES.PROVIDER_PROTOCOL_INVALID);
    }
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

  async function acceptFile(options: {
    threadId: string;
    artifactId: string;
    path: string;
    confirmed: boolean;
  }): Promise<void> {
    const { threadId, artifactId, path, confirmed }: { threadId: string; artifactId: string; path: string; confirmed: boolean; } = options;
    const thread: Thread = find(threadId);
    const artifact: Artifact | undefined = thread.artifacts.find(({ id }: Artifact): boolean => id === artifactId);
    const selected: WorkspaceSummary | undefined = thread.workspace;
    if (artifact?.kind !== "diff" || !selected || (artifact.workspaceId && artifact.workspaceId !== selected.id)) {
      throw new AppError(ERROR_CODES.DIFF_WORKSPACE_UNBOUND);
    }
    if (artifact.fileDecisions?.[path] === "accepted") return;
    if (artifact.fileDecisions?.[path] === "rejected") throw new AppError(ERROR_CODES.DIFF_FILE_REJECTED);
    const change: FileChange | undefined = parseDiff(artifact.body).find((entry: DiffFile): boolean => entry.change?.path === path)?.change;
    if (!change) throw new AppError(ERROR_CODES.DIFF_APPLY_FAILED);
    if (isProtectedCodingPath(change.path)) throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
    const restriction: ErrorCode | undefined = diffPolicyError(change, getPreset(thread.presetId).writePolicy);
    if (restriction) throw new AppError(restriction);
    if (diffNeedsConfirmation(change) && !confirmed) throw new AppError(ERROR_CODES.DIFF_CONFIRMATION_REQUIRED);
    if (busyBindings.has(selected.id)) throw new AppError(ERROR_CODES.DIFF_WORKSPACE_BUSY);
    busyBindings.add(selected.id);
    try {
      const before: string | null = await readWorkspaceFileIfExists(selected, path, { allowMissingParent: change.operation === "create" });
      const after: string | null = applyDiff(change, before);
      await writeWorkspaceFile(selected, { path, after, expectedBefore: before });
      edit(threadId, (current: Thread): Thread => ({
        ...current,
        artifacts: decideDiffFile(current.artifacts, { snapshot: artifact, path, decision: "accepted" }),
      }));
    } finally { busyBindings.delete(selected.id); }
  }

  function uiDispatch(value: unknown): void {
    const input: Record<string, unknown> = record(value);
    switch (input.type) {
      case "SELECT_THREAD": return commit({ type: input.type, id: find(id(input.id)).id });
      case "RENAME_THREAD": return commit({ type: input.type, threadId: id(input.threadId), title: text(input.title) });
      case "TOGGLE_THREAD_PIN": return commit({ type: input.type, threadId: id(input.threadId) });
      case "DELETE_THREAD": {
        const threadId: string = id(input.threadId);
        conversation.cancelThread(threadId);
        return commit({ type: input.type, threadId });
      }
      case "IMPORT_THREADS": {
        const threads: Thread[] = importThreads(JSON.stringify({ threads: input.threads }));
        threads.forEach(({ id }: Thread): void => conversation.cancelThread(id));
        return commit({ type: input.type, threads });
      }
      case "SET_INSPECTOR_TAB": {
        if (input.tab !== "brief" && input.tab !== "progress" && input.tab !== "artifact") return;
        return commit({ type: input.type, threadId: id(input.threadId), tab: input.tab });
      }
      case "SET_INSPECTOR_OPEN": return commit({ type: input.type, threadId: id(input.threadId), open: input.open === true });
      case "SET_PROVIDER_PANEL_OPEN": return commit({ type: input.type, open: input.open === true });
      case "SET_APPEARANCE": {
        const { theme }: Record<string, unknown> = record(input.appearance);
        if (theme === "dark" || theme === "light" || theme === "system") commit({ type: input.type, appearance: { theme } });
        return;
      }
      case "SET_DEVELOPMENT_CONCURRENCY":
        commit({ type: input.type, value: Number(input.value) });
        conversation.rescheduleSeats();
        return;
      default: throw new AppError(ERROR_CODES.CLI_UNKNOWN_STATE_ACTION);
    }
  }

  async function action(name: string, args: unknown[]): Promise<unknown> {
    if (closing) throw new AppError(ERROR_CODES.CLI_SHUTTING_DOWN);
    const [a, b, c, d]: unknown[] = args;
    switch (name) {
      case "dispatch": return uiDispatch(a);
      case "newThread": return newThread(text(a)).id;
      case "sendMessage": return conversation.sendMessage({
        threadId: a ? id(a) : undefined,
        text: text(b),
        attachments: Array.isArray(c) ? c.filter((v: unknown): v is string => typeof v === "string").slice(0, 8) : [],
      });
      case "saveDraft": {
        const thread: Thread | undefined = latest.current.threads.find(({ id: key }: Thread): boolean => key === id(a));
        if (!thread) return;
        const draft: ChatDraft = readDraft(b, thread);
        const next: ChatDraft | undefined = draft.text || draft.attachments.length ? draft : undefined;
        if (JSON.stringify(thread.draft) === JSON.stringify(next)) return;
        return edit(thread.id, (current: Thread): Thread => ({ ...current, draft: next }));
      }
      case "submitComposer": {
        const thread: Thread | undefined = a ? find(id(a)) : undefined;
        const draft: ChatDraft = readDraft(b, thread);
        if (!draft.text.trim()) return;
        return conversation.sendMessage({
          threadId: thread?.id,
          text: draft.text,
          attachments: draft.attachments,
          clearDraft: true,
        });
      }
      case "selectModel": return conversation.selectModel(a ? id(a) : undefined, id(b), text(c));
      case "changePreset": return conversation.changePreset(a ? id(a) : undefined, text(b));
      case "retryMessage": return conversation.retryMessage(id(a), id(b));
      case "retryRun": return conversation.retryRun(id(a), id(b));
      case "updateBrief": return conversation.updateBrief(id(a), b as Brief);
      case "patchFinding": return conversation.patchFinding(id(a), text(b));
      case "resolveConfirmation": return conversation.resolveConfirmation(id(a), id(b), c === true);
      case "setAutoApproval": {
        const thread: Thread = find(id(a));
        const enabled: boolean = b === true;
        if (enabled && (c ?? undefined) !== thread.workspace?.id) throw new AppError(ERROR_CODES.WORKSPACE_APPROVAL_MISMATCH);
        edit(thread.id, (current: Thread): Thread => ({
          ...current, autoApproval: enabled ? { workspaceId: current.workspace?.id } : undefined,
        }));
        if (enabled) conversation.resumeQueued(thread.id);
        return;
      }
      case "stop": return conversation.stop(id(a));
      case "bindWorkspace": {
        const thread: Thread = find(id(a));
        if (conversation.isGenerating(thread.id)) throw new AppError(ERROR_CODES.WORKSPACE_SWITCH_WHILE_RUNNING);
        const checked: WorkspaceSummary = await workspace(id(b));
        if (conversation.isGenerating(thread.id)) throw new AppError(ERROR_CODES.WORKSPACE_SWITCH_WHILE_RUNNING);
        return edit(thread.id, (current: Thread): Thread => ({
          ...current, workspace: checked, draft: current.workspace?.id === checked.id ? current.draft : undefined,
          autoApproval: current.workspace?.id === checked.id ? current.autoApproval : undefined,
          updatedAt: Date.now(),
        }));
      }
      case "acceptFile": return acceptFile({ threadId: id(a), artifactId: id(b), path: text(c), confirmed: d === true });
      case "decideFile": {
        const thread: Thread = find(id(a));
        const artifact: Artifact | undefined = thread.artifacts.find(({ id }: Artifact): boolean => id === b);
        if (!artifact || d !== "rejected") return;
        return edit(thread.id, (current: Thread): Thread => ({
          ...current,
          artifacts: decideDiffFile(current.artifacts, { snapshot: artifact, path: text(c), decision: "rejected" }),
        }));
      }
      case "saveProvider": {
        const config: ProviderConfig = withProvider(a, b);
        commit({ type: "SET_PROVIDERS", providers: latest.current.providers.map((provider: ProviderConfig): ProviderConfig => provider.id === config.id ? config : provider) });
        conversation.resumeQueued();
        return;
      }
      case "testProvider": {
        try { return await makeClient(withProvider(a, b)).listModels(AbortSignal.timeout(30_000)); } catch (error) { throw new AppError(describeProviderError(error), { cause: error }); }
      }
      case "workspace.bind": return bindWorkspace(text(a), dataDir);
      case "workspace.access": return requestWorkspaceAccess(await workspace(id(a)));
      case "workspace.list": return listWorkspace(await workspace(id(a)), text(b));
      case "workspace.read": return readWorkspaceFile(await workspace(id(a)), text(b));
      case "workspace.search": return searchWorkspaceFiles(await workspace(id(a)), text(b), { limit: typeof c === "number" ? c : 24 });
      case "workspace.searchText": return searchWorkspaceText(await workspace(id(a)), text(b), { limit: typeof c === "number" ? c : 40 });
      case "workspace.gitDiff": return readWorkspaceGitDiff(await workspace(id(a)), dataDir);
      case "workspace.deleteFile": {
        const payload: Record<string, unknown> = record(b);
        return deleteWorkspaceFile(
          await workspace(id(a)),
          {
            path: text(payload.path),
            ...(typeof payload.expectedBefore === "string"
              ? { expectedBefore: payload.expectedBefore }
              : {}),
          },
          dataDir
        );
      }
      case "workspace.deleteDirectory": {
        const payload: Record<string, unknown> = record(b);
        return deleteWorkspaceDirectory(
          await workspace(id(a)),
          {
            path: text(payload.path),
            recursive: payload.recursive !== false,
          },
          dataDir
        );
      }
      case "workspace.createFile": {
        const payload: Record<string, unknown> = record(b);
        return createWorkspaceFile(
          await workspace(id(a)),
          {
            path: text(payload.path),
            content: typeof payload.content === "string" ? payload.content : "",
            overwrite: payload.overwrite === true,
            createParents: payload.createParents !== false,
          },
          dataDir
        );
      }
      case "workspace.createDirectory": {
        const payload: Record<string, unknown> = record(b);
        return createWorkspaceDirectory(
          await workspace(id(a)),
          {
            path: text(payload.path),
            recursive: payload.recursive !== false,
          },
          dataDir
        );
      }
      case "workspace.renameFile": {
        const payload: Record<string, unknown> = record(b);
        return renameWorkspaceFile(
          await workspace(id(a)),
          {
            fromPath: text(payload.fromPath),
            toPath: text(payload.toPath),
            overwrite: payload.overwrite === true,
          },
          dataDir
        );
      }
      case "workspace.renameDirectory": {
        const payload: Record<string, unknown> = record(b);
        return renameWorkspaceDirectory(
          await workspace(id(a)),
          {
            fromPath: text(payload.fromPath),
            toPath: text(payload.toPath),
            overwrite: payload.overwrite === true,
          },
          dataDir
        );
      }
      case "workspace.replaceLines": {
        const payload: Record<string, unknown> = record(b);
        return replaceWorkspaceFileLines(
          await workspace(id(a)),
          {
            path: text(payload.path),
            startLine: typeof payload.startLine === "number" ? payload.startLine : -1,
            endLine: typeof payload.endLine === "number" ? payload.endLine : -1,
            replacement: text(payload.replacement),
            ...(typeof payload.expectedBefore === "string"
              ? { expectedBefore: payload.expectedBefore }
              : {}),
          },
          dataDir
        );
      }
      case "workspace.appendFile": {
        const payload: Record<string, unknown> = record(b);
        return appendWorkspaceFile(
          await workspace(id(a)),
          {
            path: text(payload.path),
            content: text(payload.content),
            ensureNewline: payload.ensureNewline !== false,
            createIfMissing: payload.createIfMissing === true,
          },
          dataDir
        );
      }
      case "workspace.deleteLines": {
        const payload: Record<string, unknown> = record(b);
        return deleteWorkspaceFileLines(
          await workspace(id(a)),
          {
            path: text(payload.path),
            startLine: typeof payload.startLine === "number" ? payload.startLine : -1,
            endLine: typeof payload.endLine === "number" ? payload.endLine : -1,
            ...(typeof payload.expectedBefore === "string"
              ? { expectedBefore: payload.expectedBefore }
              : {}),
          },
          dataDir
        );
      }
      case "workspace.replaceContent": {
        const payload: Record<string, unknown> = record(b);
        return replaceWorkspaceFileContent(
          await workspace(id(a)),
          {
            path: text(payload.path),
            content: text(payload.content),
            ...(payload.expectedBefore === null || typeof payload.expectedBefore === "string"
              ? { expectedBefore: payload.expectedBefore }
              : {}),
            createIfMissing: payload.createIfMissing === true,
          },
          dataDir
        );
      }
      case "workspace.export": {
        const binding: WorkspaceSummary = await workspace(id(a));
        if (!latest.current.threads.some((thread: Thread): boolean => thread.workspace?.id === binding.id && getPreset(thread.presetId).writePolicy !== "none")) {
          throw new AppError(ERROR_CODES.WORKSPACE_NO_WRITABLE_THREAD);
        }
        return exportWorkspaceDocument(binding, text(b), text(c));
      }
      case "check": return runCheck(await workspace(id(a)), checkName(b));
      default: throw new AppError(ERROR_CODES.CLI_UNKNOWN_ACTION);
    }
  }

  return {
    getState, action,
    subscribe(listener: (state: DesktopSnapshot) => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    restore(): void { conversation.restore(); },
    async shutdown(): Promise<void> {
      closing = true;
      await conversation.shutdown();
      clearTimeout(workspacePublish);
      watchedWorkspaces.forEach((dispose: () => void): void => dispose());
      onChange(latest.current);
    },
  };
}
