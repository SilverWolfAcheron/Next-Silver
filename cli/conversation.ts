import { setTimeout as delay } from "node:timers/promises";
import { canAutoApprove } from "../src/agent-core/autoApproval";
import { getDomain } from "../src/agent-core/domains/pcb";
import { AppError, ERROR_CODES } from "../src/agent-core/errors";
import { pauseIterations, resolveIterationApproval } from "../src/agent-core/iterate";
import { getPreset } from "../src/agent-core/presets";
import type { Preset } from "../src/agent-core/presets";
import { describeProviderError } from "../src/agent-core/provider/client";
import type { ModelClient } from "../src/agent-core/provider/client";
import { isConfiguredProvider, makeClient } from "../src/agent-core/provider/presets";
import type { ProviderConfig } from "../src/agent-core/provider/presets";
import { reconcile } from "../src/agent-core/reconcile";
import { pauseSeats, retrySeats } from "../src/agent-core/seats";
import { SessionError } from "../src/agent-core/session";
import type { ModelMessage } from "../src/agent-core/session";
import type { ModelActivity } from "../src/types/modelActivity";
import type {
  AgentSeat,
  ChatMessage,
  Iteration,
  PendingConfirmation,
  Run,
  Thread,
} from "../src/agent-core/types";
import { createConversationFlow } from "./conversationFlow";
import type { ConversationFlow } from "./conversationFlow";
import {
  assistant,
  insertReply,
  isTransientProviderError,
} from "./conversationHelpers";
import type {
  ConfirmOptions,
  ConversationDeps,
  ConversationService,
  ModelRequest,
  SendMessageOptions,
  StartChatOptions,
  StartJobOptions,
} from "./conversationHelpers";
import { createIterationEngine } from "./iterations";
import { createModelActivity } from "./modelActivity";
import { createSeatExecution } from "./seatExecution";
import { attachmentContext } from "./workspaceContext";

export function createConversation(deps: ConversationDeps): ConversationService {
  const { latest, dispatch, newThread, refreshJobs, journal }: ConversationDeps = deps;
  const jobs: { current: Map<string, Map<string, AbortController>> } = { current: new Map() };
  const activeJobs: Set<Promise<void>> = new Set();
  const modelActivity: ReturnType<typeof createModelActivity> = createModelActivity(refreshJobs);
  let shuttingDown: boolean = false;

  function find(threadId: string): Thread | undefined {
    return latest.current.threads.find(({ id }: Thread): boolean => id === threadId);
  }

  function edit(threadId: string, update: (thread: Thread) => Thread): void {
    dispatch({ type: "UPDATE_THREAD", threadId, update });
  }

  const seated: ReturnType<typeof createSeatExecution> = createSeatExecution(latest, edit, journal);
  const iterate: ReturnType<typeof createIterationEngine> = createIterationEngine(journal);

  function append(threadId: string, message: ChatMessage, afterId?: string): void {
    edit(threadId, (thread: Thread): Thread => ({
      ...thread,
      messages: insertReply(thread.messages, message, afterId),
      updatedAt: Date.now(),
    }));
  }

  function editMessage(
    threadId: string,
    messageId: string,
    update: (message: ChatMessage) => ChatMessage
  ): void {
    edit(threadId, (thread: Thread): Thread => ({
      ...thread,
      messages: thread.messages.map((message: ChatMessage): ChatMessage =>
        message.id === messageId ? update(message) : message
      ),
    }));
  }

  function providerFor(thread: Thread): ProviderConfig | undefined {
    const provider: ProviderConfig | undefined = latest.current.providers.find(
      ({ id }: ProviderConfig): boolean => id === thread.modelId
    );
    if (!provider) return;
    const config: ProviderConfig = { ...provider, model: thread.modelName || provider.model };
    if (isConfiguredProvider(config)) return config;
  }

  async function attachedFiles(
    thread: Thread,
    messageId?: string
  ): Promise<ModelMessage[]> {
    try {
      return await attachmentContext(thread, messageId);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw new SessionError(error.code, { params: error.params, cause: error });
      }
      throw new SessionError(ERROR_CODES.WORKSPACE_ATTACHMENTS_READ_FAILED, { cause: error });
    }
  }

  function isGenerating(threadId: string): boolean {
    const thread: Thread | undefined = find(threadId);
    return Boolean(
      jobs.current.get(threadId)?.size ||
        thread?.runs.some(({ status }: Run): boolean => status === "in_progress")
    );
  }

  function activeReply(threadId: string, messageId: string): { id: string } {
    const thread: Thread | undefined = find(threadId);
    const prior: string | undefined = thread?.activeRequest?.replyId;
    if (prior && thread?.messages.some(({ id }: ChatMessage): boolean => id === prior)) {
      return { id: prior };
    }
    const reply: ChatMessage = assistant("");
    edit(threadId, (current: Thread): Thread => ({
      ...current,
      activeRequest: current.activeRequest
        ? { ...current.activeRequest, replyId: reply.id }
        : undefined,
      messages: insertReply(current.messages, reply, messageId),
    }));
    return reply;
  }

  function beginRequest(
    threadId: string,
    request: Omit<NonNullable<Thread["activeRequest"]>, "attempt">
  ): void {
    edit(threadId, (current: Thread): Thread => ({
      ...current,
      activeRequest: { ...request, attempt: crypto.randomUUID() },
    }));
  }

  function cancelJob(threadId: string, key: string): void {
    const active: Map<string, AbortController> | undefined = jobs.current.get(threadId);
    const controller: AbortController | undefined = active?.get(key);
    if (!controller) return;
    active?.delete(key);
    if (!active?.size) jobs.current.delete(threadId);
    controller.abort();
    refreshJobs();
  }

  function cancelThread(threadId: string): void {
    const active: Map<string, AbortController> | undefined = jobs.current.get(threadId);
    if (!active) return;
    jobs.current.delete(threadId);
    active.forEach((controller: AbortController): void => controller.abort());
    refreshJobs();
  }

  function confirm(options: ConfirmOptions): void {
    const { threadId, action, labels, text = "" }: ConfirmOptions = options;
    const message: ChatMessage = assistant(text, { confirm: labels });
    const pendingConfirmation: PendingConfirmation = { ...action, messageId: message.id };
    edit(threadId, (thread: Thread): Thread => ({
      ...thread,
      pendingConfirmation,
      messages: [...thread.messages, message],
    }));
    const thread: Thread | undefined = find(threadId);
    if (thread && canAutoApprove(thread, pendingConfirmation)) queueMicrotask((): void => flow.pump(threadId));
  }

  function start(options: StartJobOptions): boolean {
    const { thread, key, worker, onError }: StartJobOptions = options;
    if (shuttingDown) return false;
    const provider: ProviderConfig | undefined = providerFor(thread);
    if (!provider) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return false;
    }
    let active: Map<string, AbortController> | undefined = jobs.current.get(thread.id);
    if (active?.has(key)) return false;
    if (!active) {
      active = new Map();
      jobs.current.set(thread.id, active);
    }
    const controller: AbortController = new AbortController();
    active.set(key, controller);
    refreshJobs();
    const task: Promise<void> = (async (): Promise<void> => {
      try {
        await worker(modelActivity.observe(thread.id, makeClient(provider)), {
          model: provider.model, signal: controller.signal, track: modelActivity.track(thread.id, controller.signal),
        });
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          onError(error instanceof SessionError ? error.message : describeProviderError(error));
        }
      } finally {
        if (jobs.current.get(thread.id)?.get(key) === controller) {
          jobs.current.get(thread.id)?.delete(key);
          if (!jobs.current.get(thread.id)?.size) jobs.current.delete(thread.id);
          refreshJobs();
          flow.pump(thread.id);
        }
      }
    })();
    activeJobs.add(task);
    void task
      .finally((): boolean => activeJobs.delete(task))
      .catch((): undefined => undefined);
    return true;
  }

  function startChat(options: StartChatOptions): boolean {
    const { thread, worker, activity, onError, live = false }: StartChatOptions = options;
    const claimed: Thread["activeRequest"] = find(thread.id)?.activeRequest;
    if (!claimed) return false;
    const operation: string = `${thread.id}:chat:${claimed.attempt}`;
    return start({
      thread,
      key: "chat",
      onError,
      worker: async (client: ModelClient, request: ModelRequest): Promise<void> => {
        for (let retry: number = 0; ; retry++) {
          try {
            await request.track({ kind: activity }, (): Promise<void> => worker(journal.model(operation, client, live), request));
            break;
          } catch (error: unknown) {
            request.signal.throwIfAborted();
            if (!isTransientProviderError(error)) {
              edit(thread.id, (current: Thread): Thread => ({ ...current, activeRequest: undefined }));
              journal.clear(operation);
              throw error;
            }
            await delay(Math.min(30_000, 2_000 * (retry + 1)), undefined, {
              signal: request.signal,
            });
          }
        }
        request.signal.throwIfAborted();
        edit(thread.id, (current: Thread): Thread =>
          current.activeRequest?.attempt === claimed.attempt
            ? { ...current, activeRequest: undefined }
            : current
        );
        journal.clear(operation);
      },
    });
  }

  function retryOrStart(threadId: string, runId: string): void {
    const current: Thread | undefined = find(threadId);
    if (!current) return;
    if (providerFor(current)) {
      edit(threadId, (thread: Thread): Thread => ({
        ...thread,
        runs: thread.runs.map((run: Run): Run =>
          run.id === runId
            ? {
              ...run,
              seats: retrySeats(run.seats).map((seat: AgentSeat): AgentSeat =>
                  seat.status === "pending" ? { ...seat, attempt: crypto.randomUUID() } : seat
              ),
              iterations: run.iterations?.map(
                (iteration: Iteration, index: number, all: Iteration[]): Iteration => {
                  if (
                    index !== all.length - 1 ||
                      (iteration.status !== "blocked" && iteration.status !== "paused")
                  ) {
                    return iteration;
                  }
                  if (iteration.approval === "apply") {
                    return { ...iteration, status: "in_progress" };
                  }
                  return {
                    ...iteration,
                    status: "in_progress",
                    note: "正在从保存的阶段重试",
                    attempt: crypto.randomUUID(),
                  };
                }
              ),
            }
            : run
        ),
      }));
    }
    flow.runItem(threadId, runId);
    flow.pump(threadId);
  }

  function sendMessage(options: SendMessageOptions): void {
    const { threadId, text, attachments = [], clearDraft = false }: SendMessageOptions = options;
    const content: string = text.trim();
    if (!content) return;
    const thread: Thread | undefined = threadId ? find(threadId) : newThread("develop");
    if (!thread) return;
    modelActivity.clearOutcome(thread.id);
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: content,
      attachments: attachments.length ? attachments : undefined,
      workspaceId: attachments.length ? thread.workspace?.id : undefined,
    };
    edit(thread.id, (current: Thread): Thread => ({
      ...current,
      draft: clearDraft ? undefined : current.draft,
      title:
        !current.titleEdited &&
        !current.messages.some(({ role }: ChatMessage): boolean => role === "user") &&
        !current.queuedMessages?.length
          ? Array.from(content.replace(/\s+/g, " ")).slice(0, 20).join("")
          : current.title,
      queuedMessages: [...(current.queuedMessages ?? []), message],
      messages: current.messages.some(({ choices }: ChatMessage): boolean => Boolean(choices?.length))
        ? current.messages.map((entry: ChatMessage): ChatMessage =>
            entry.choices ? { ...entry, choices: undefined } : entry
        )
        : current.messages,
      updatedAt: Date.now(),
    }));
    if (!providerFor(thread) && !thread.pendingConfirmation) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
    }
    flow.pump(thread.id);
  }

  const flow: ConversationFlow = createConversationFlow({
    latest,
    dispatch,
    newThread,
    jobs,
    seated,
    iterate,
    isShuttingDown: (): boolean => shuttingDown,
    find,
    edit,
    append,
    editMessage,
    providerFor,
    attachedFiles,
    activeReply,
    beginRequest,
    start,
    startChat,
    cancelJob,
    confirm,
    resolveConfirmation,
    retryOrStart,
    sendMessage,
  });

  function stop(threadId: string): boolean {
    if (!isGenerating(threadId)) return false;
    cancelThread(threadId);
    edit(threadId, (thread: Thread): Thread => ({
      ...thread,
      activeRequest: undefined,
      pendingConfirmation:
        thread.pendingConfirmation?.kind === "iteration" ? undefined : thread.pendingConfirmation,
      messages: thread.messages.map((entry: ChatMessage): ChatMessage =>
        thread.pendingConfirmation?.kind === "iteration" &&
        entry.id === thread.pendingConfirmation.messageId
          ? { ...entry, confirm: undefined }
          : entry
      ),
      runs: thread.runs.map((run: Run): Run =>
        run.status === "in_progress"
          ? {
            ...run,
            status: "paused",
            note: "已停止，可以重试",
            seats: pauseSeats(run.seats, "已停止"),
            iterations: pauseIterations(run.iterations, "已停止"),
          }
          : run
      ),
    }));
    append(threadId, assistant("已停止，可以重试。"));
    return true;
  }

  function selectModel(threadId: string | undefined, modelId: string, modelName?: string): void {
    const thread: Thread | undefined = threadId ? find(threadId) : newThread("develop");
    if (!thread) return;
    const selectedName: string | undefined =
      modelName ||
      latest.current.providers.find(({ id }: ProviderConfig): boolean => id === modelId)?.model;
    edit(thread.id, (current: Thread): Thread => ({ ...current, modelId, modelName: selectedName }));
    if (providerFor({ ...thread, modelId, modelName: selectedName })) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    }
    flow.pump(thread.id);
  }

  function applyPreset(thread: Thread, presetId: string): void {
    const preset: Preset = getPreset(presetId);
    if (thread.mode !== preset.mode) cancelThread(thread.id);
    edit(thread.id, (current: Thread): Thread => ({
      ...current,
      presetId: preset.id,
      mode: preset.mode,
      inspectorTab: preset.defaultTab,
      title:
        current.messages.length || current.titleEdited || current.queuedMessages?.length
          ? current.title
          : preset.label,
      runs:
        current.mode !== preset.mode
          ? current.runs.map((run: Run): Run =>
              run.status === "completed"
                ? run
                : {
                  ...run,
                  status: "paused",
                  note: "预设已切换",
                  seats: pauseSeats(run.seats, "预设已切换", true),
                  iterations: pauseIterations(run.iterations, "预设已切换"),
                }
          )
          : current.runs,
      activeRequest: current.mode === preset.mode ? current.activeRequest : undefined,
      pendingPlan: current.mode === preset.mode ? current.pendingPlan : undefined,
      intakeStep:
        current.mode === "single" && preset.mode === "project" ? "questioning" : current.intakeStep,
    }));
    dispatch({ type: "REMEMBER_PRESET", presetId: preset.id });
  }

  function changePreset(threadId: string | undefined, presetId: string): void {
    const thread: Thread | null = threadId ? (find(threadId) ?? null) : null;
    if (!thread) {
      newThread(presetId);
      return;
    }
    if (thread.presetId === presetId || thread.pendingConfirmation) return;
    if (
      thread.mode === "project" &&
      getPreset(presetId).mode === "single" &&
      thread.runs.length > 1
    ) {
      confirm({
        threadId: thread.id,
        action: { kind: "preset", presetId },
        labels: {
          intent: "revise",
          summary: "把当前目标收成一次 Single 请求，并暂停其余未完成项？",
          acceptLabel: "切换预设",
          declineLabel: "保留项目",
        },
      });
    } else {
      applyPreset(thread, presetId);
    }
  }

  function promoteThread(threadId: string): void {
    const thread: Thread | undefined = find(threadId);
    if (thread?.mode !== "single" || thread.pendingConfirmation) return;
    confirm({
      threadId,
      action: { kind: "promote" },
      labels: {
        intent: "steer",
        summary: "根据当前对话建立简报，已有产物会保留。",
        acceptLabel: "升成项目",
        declineLabel: "取消",
      },
    });
  }

  function retryRun(threadId: string, runId: string): void {
    const thread: Thread | undefined = find(threadId);
    const run: Run | undefined = thread?.runs.find(({ id }: Run): boolean => id === runId);
    if (!thread || !run) return;
    if (
      run.status === "in_progress" &&
      run.seats?.some((seat: AgentSeat): boolean => seat.role === "audit" && seat.status === "blocked")
    ) {
      edit(threadId, (current: Thread): Thread => ({
        ...current,
        runs: current.runs.map((item: Run): Run =>
          item.id === runId
            ? {
              ...item,
              seats: item.seats?.map((seat: AgentSeat): AgentSeat =>
                  seat.role === "audit" && seat.status === "blocked"
                    ? {
                      ...seat,
                      status: "pending",
                      note: "",
                      summary: "",
                      refutations: [],
                      verdicts: undefined,
                      attempt: crypto.randomUUID(),
                    }
                    : seat
              ),
            }
            : item
        ),
      }));
      seated.requestPulse();
      return;
    }
    if (run.status !== "paused" && run.status !== "blocked") return;
    if (thread.mode === "single" && run.messageId && !run.iterations?.length) {
      retryMessage(threadId, run.messageId);
      return;
    }
    retryOrStart(threadId, runId);
  }

  function resolveConfirmation(threadId: string, messageId: string, decision: boolean | "automatic"): void {
    const accepted: boolean = decision !== false;
    const automated: boolean = decision === "automatic";
    const thread: Thread | undefined = find(threadId);
    const action: PendingConfirmation | undefined = thread?.pendingConfirmation;
    if (!thread || action?.messageId !== messageId) return;
    if (accepted && (action.kind === "promote" || action.kind === "run") && !providerFor(thread)) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return;
    }
    edit(threadId, (current: Thread): Thread => ({ ...current, pendingConfirmation: undefined }));
    editMessage(threadId, messageId, (message: ChatMessage): ChatMessage => ({
      ...message,
      confirm: undefined,
      text: automated
        ? `已自动审批：${message.confirm?.acceptLabel ?? "继续"}。`
        : message.text || (accepted ? "已确认。" : "已取消。"),
    }));
    const recent: ChatMessage | undefined = thread.messages
      .filter(({ role }: ChatMessage): boolean => role === "user")
      .at(-1);
    switch (action.kind) {
      case "brief":
        if (accepted && thread.brief?.intent && thread.brief.outcome && thread.brief.constraints) {
          flow.plan(threadId, recent?.id ?? "");
        } else if (accepted) {
          append(threadId, assistant("请在简报中补全目标、完成标准和约束，或在对话里继续补充。"));
          edit(threadId, (current: Thread): Thread => ({ ...current, intakeStep: "questioning" }));
        } else {
          edit(threadId, (current: Thread): Thread => ({ ...current, intakeStep: "questioning" }));
        }
        break;
      case "revise":
        if (accepted) {
          const domainId: string | undefined = getPreset(thread.presetId).domainId;
          const runs: Run[] = reconcile({
            before: thread.brief,
            after: action.brief,
            runs: thread.runs,
            domain: domainId ? getDomain(domainId) : undefined,
          });
          runs.forEach((run: Run, index: number): void => {
            if (run.status === "paused" && thread.runs[index].status === "in_progress") {
              cancelJob(threadId, run.id);
            }
          });
          edit(threadId, (current: Thread): Thread => ({
            ...current,
            brief: action.brief,
            runs,
            updatedAt: Date.now(),
          }));
          flow.plan(threadId, recent?.id ?? "", true);
        } else {
          flow.supplement(thread, action.source);
        }
        break;
      case "preset":
        if (accepted) {
          cancelThread(threadId);
          applyPreset(thread, action.presetId);
        }
        break;
      case "run":
        if (accepted) {
          flow.runItem(threadId, action.runId);
        } else {
          edit(threadId, (current: Thread): Thread => ({
            ...current,
            runs: current.runs.map((run: Run): Run =>
              run.id === action.runId ? { ...run, status: "paused", note: "用户暂缓，可重试" } : run
            ),
          }));
        }
        break;
      case "promote":
        if (accepted) {
          applyPreset(thread, "develop");
          const current: Thread | undefined = find(threadId);
          if (current && recent) flow.process(current, recent);
        }
        break;
      case "iteration": {
        const run: Run | undefined = thread.runs.find(({ id }: Run): boolean => id === action.runId);
        const iteration: Iteration | undefined = run?.iterations?.at(-1);
        if (
          !run ||
          !iteration ||
          run.status !== "in_progress" ||
          iteration.id !== action.iterationId ||
          iteration.approval !== action.phase
        ) {
          break;
        }
        const checkApproval: boolean = action.phase === "apply" && iteration.stage === "checks";
        const approvalWorkspace: string | undefined = checkApproval && accepted &&
          thread.workspace?.id === iteration.checkAwaitingWorkspaceId ? iteration.checkAwaitingWorkspaceId : undefined;
        const approvalNote: string = checkApproval
          ? approvalWorkspace ? "已授权运行当前工作区的检查" : "未授权运行项目代码，检查未执行"
          : accepted ? "已确认，准备应用差异" : "用户停止自迭代";
        const next: Run =
          action.phase === "next"
            ? resolveIterationApproval(run, accepted, iteration.id)
            : {
              ...run,
              status: accepted ? ("in_progress" as const) : ("blocked" as const),
              note: approvalNote,
              iterations: [
                ...(run.iterations ?? []).slice(0, -1),
                {
                  ...iteration,
                  approval: undefined,
                  status: accepted ? ("in_progress" as const) : ("blocked" as const),
                  writes: accepted ? iteration.writes : undefined,
                  stage: accepted || checkApproval ? iteration.stage : ("produce" as const),
                  checksApprovedWorkspaceId: approvalWorkspace ?? iteration.checksApprovedWorkspaceId,
                  checksApprovedAutomatically: approvalWorkspace ? automated : iteration.checksApprovedAutomatically,
                  checkAwaitingWorkspaceId: undefined,
                  note: approvalNote,
                },
              ],
            };
        edit(threadId, (current: Thread): Thread => ({
          ...current,
          runs: current.runs.map((item: Run): Run => (item.id === run.id ? next : item)),
        }));
        if (accepted) flow.runItem(threadId, run.id);
        break;
      }
    }
    flow.pump(threadId);
  }

  function retryMessage(threadId: string, userMessageId: string): void {
    const thread: Thread | undefined = find(threadId);
    const index: number =
      thread?.messages.findIndex(
        ({ id, role }: ChatMessage): boolean => id === userMessageId && role === "user"
      ) ?? -1;
    if (!thread || index < 0 || jobs.current.get(threadId)?.has("chat")) return;
    if (!providerFor(thread)) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return;
    }
    const nextUser: number = thread.messages.findIndex(
      ({ role }: ChatMessage, offset: number): boolean => offset > index && role === "user"
    );
    const end: number = nextUser === -1 ? thread.messages.length : nextUser;
    const removed: ChatMessage[] = thread.messages.slice(index + 1, end);
    const pendingRemoved: boolean = removed.some(
      ({ id }: ChatMessage): boolean => id === thread.pendingConfirmation?.messageId
    );
    if (thread.pendingConfirmation && !pendingRemoved) return;
    const affected: Run[] = thread.runs.filter(
      (run: Run): boolean => run.messageId === userMessageId && run.status !== "completed"
    );
    affected.forEach(({ id }: Run): void => cancelJob(threadId, id));
    edit(threadId, (current: Thread): Thread => ({
      ...current,
      messages: [...thread.messages.slice(0, index + 1), ...thread.messages.slice(end)],
      runs: current.runs.map((run: Run): Run =>
        affected.some(({ id }: Run): boolean => id === run.id)
          ? {
            ...run,
            status: "paused",
            note: "等待重新生成回复",
            seats: pauseSeats(run.seats, "等待重新生成回复", true),
          }
          : run
      ),
      pendingConfirmation: pendingRemoved ? undefined : current.pendingConfirmation,
    }));
    const current: Thread | undefined = find(threadId);
    if (!current) return;
    if (
      current.mode === "project" &&
      (affected.length || (current.intakeStep === "confirmed" && !pendingRemoved))
    ) {
      flow.plan(threadId, userMessageId, current.runs.length > 0);
      return;
    }
    flow.process(current, thread.messages[index]);
  }

  function patchFinding(threadId: string, text: string): void {
    const thread: Thread | undefined = find(threadId);
    if (thread) flow.branch(thread, text);
  }

  function restore(): void {
    for (const thread of latest.current.threads) {
      if (thread.mode === "project" || thread.mode === "single") {
        edit(thread.id, (current: Thread): Thread => ({
          ...current,
          runs: current.runs.map((run: Run): Run =>
            run.status === "in_progress"
              ? {
                ...run,
                seats: run.seats?.map((seat: AgentSeat): AgentSeat =>
                    seat.status === "in_progress"
                      ? { ...seat, status: "pending", note: "从已保存的请求继续" }
                      : seat
                ),
              }
              : run
          ),
        }));
        for (const run of thread.runs) {
          if (run.status === "in_progress" && !run.iterations?.at(-1)?.approval) {
            flow.runItem(thread.id, run.id);
          }
        }
      }
      flow.pump(thread.id);
    }
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    for (const threadId of jobs.current.keys()) cancelThread(threadId);
    await Promise.allSettled([...activeJobs]);
  }

  return {
    sendMessage,
    selectModel,
    changePreset,
    stop,
    isGenerating,
    modelActivity: (): Record<string, ModelActivity> => modelActivity.snapshot(latest.current.threads.map(({ id }: Thread): string => id)),
    cancelThread,
    retryMessage,
    retryRun,
    resolveConfirmation,
    updateBrief: flow.updateBrief,
    promoteThread,
    patchFinding,
    resumeQueued(threadId?: string): void {
      if (threadId) flow.pump(threadId);
      else latest.current.threads.forEach(({ id }: Thread): void => flow.pump(id));
    },
    rescheduleSeats: (): void => seated.requestPulse(),
    restore,
    shutdown,
  };
}
