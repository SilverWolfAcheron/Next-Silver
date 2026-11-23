import { getDomain } from "../src/agent-core/domains/pcb";
import type { DomainPack } from "../src/agent-core/domains/pcb";
import { ERROR_CODES } from "../src/agent-core/errors";
import { intakeQuestions } from "../src/agent-core/intake";
import { blockIteration } from "../src/agent-core/iterate";
import { getPreset } from "../src/agent-core/presets";
import { describeProviderError } from "../src/agent-core/provider/client";
import type { ModelClient } from "../src/agent-core/provider/client";
import { reconcile } from "../src/agent-core/reconcile";
import { pauseSeats } from "../src/agent-core/seats";
import {
  askModel,
  conversationPrompt,
  identifiesRevision,
  modelString,
  modelStrings,
  readBrief,
  readIntent,
  readRuns,
  requirementSequence,
  SessionError,
  streamResult,
} from "../src/agent-core/session";
import type { ModelMessage } from "../src/agent-core/session";
import type {
  AgentSeat,
  Artifact,
  Brief,
  ChatMessage,
  Intent,
  Iteration,
  Run,
  Thread,
} from "../src/agent-core/types";
import {
  assistant,
  INTAKE_SCHEMA,
  isTransientProviderError,
  mergeInspectorBriefEdits,
  SINGLE_STEPS,
} from "./conversationHelpers";
import type {
  AskIterationOptions,
  ConversationKernel,
  ModelRequest,
} from "./conversationHelpers";
import { toolContext } from "./workspaceContext";
import { createCodingToolLoop } from "./codingToolLoop";
import { CODING_TOOL_GUIDE } from "../src/constants/codingTools";
import { produceCodingRound } from "./codingRound";

export interface ConversationFlow {
  proposeBrief: (thread: Thread, brief: Brief, source: string) => void;
  updateBrief: (threadId: string, brief: Brief) => void;
  plan: (threadId: string, messageId: string, revised?: boolean) => void;
  runItem: (threadId: string, runId: string) => void;
  supplement: (thread: Thread, text: string) => boolean;
  branch: (thread: Thread, text: string, attachments?: string[]) => void;
  process: (thread: Thread, message: ChatMessage) => void;
  pump: (threadId: string) => void;
}

export function createConversationFlow(kernel: ConversationKernel): ConversationFlow {
  const {
    dispatch,
    newThread,
    jobs,
    seated,
    iterate,
    isShuttingDown,
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
    retryOrStart,
    sendMessage,
  }: ConversationKernel = kernel;

  function proposeBrief(thread: Thread, brief: Brief, source: string): void {
    const domainId: string | undefined = getPreset(thread.presetId).domainId;
    const paused: Run[] = reconcile({
      before: thread.brief,
      after: brief,
      runs: thread.runs,
      domain: domainId ? getDomain(domainId) : undefined,
    }).filter(
      ({ status }: Run, index: number): boolean =>
        status === "paused" && thread.runs[index].status !== "paused"
    );
    confirm({
      threadId: thread.id,
      action: { kind: "revise", brief, source },
      labels: {
        intent: "revise",
        summary: paused.length
          ? `确认后将暂停：${paused.map(({ title }: Run): string => title).join("、")}。`
          : "确认后更新简报。",
      },
    });
  }

  function updateBrief(threadId: string, brief: Brief): void {
    const thread: Thread | undefined = find(threadId);
    if (!thread || (thread.pendingConfirmation && thread.pendingConfirmation.kind !== "brief")) {
      return;
    }
    const next: Brief = {
      ...brief,
      requirementSequence: Math.max(requirementSequence(thread), requirementSequence(thread, brief)),
    };
    if (thread.runs.length) {
      const source: string = `用户编辑简报：${JSON.stringify(next)}`;
      proposeBrief(thread, next, source);
      return;
    }
    edit(threadId, (current: Thread): Thread => ({ ...current, brief: next, updatedAt: Date.now() }));
  }

  async function intake(
    thread: Thread,
    message: ChatMessage,
    execution: { client: ModelClient; request: ModelRequest }
  ): Promise<void> {
    const { client, request }: { client: ModelClient; request: ModelRequest } = execution;
    const prompt: ModelMessage[] = conversationPrompt(
      thread,
      [
        "从对话提取简报。已给出的信息填入对应字段。保留已有需求编号，遗漏的信息不要伪造。没有额外约束时可把假设「无额外约束」填入。目标、完成标准、约束、自主度是必填项。仅询问会改变计划的空项，最多四条。已回答或明确待定的字段不重复询问。",
        "如果领域字段有关联编号，已有对应需求时保持编号。将默认自主度写入简报，并把真正采用的假设放入 assumptions。",
        `先流式输出给用户的简短正文，随后在独立一行输出 <<<SILVER_RESULT>>>，接一个 JSON 对象：${INTAKE_SCHEMA}。JSON 外不加代码围栏。`,
      ].join("\n"),
      message.id
    );
    const reply: { id: string } = activeReply(thread.id, message.id);
    let first: boolean = true;
    let result: Awaited<ReturnType<typeof streamResult>> | undefined = undefined;
    try {
      const messages: ModelMessage[] = [...prompt, ...(await attachedFiles(thread, message.id))];
      result = await streamResult({
        client,
        request,
        messages,
        structured: true,
        onDelta: (delta: string): void => {
          if (!request.signal.aborted) {
            editMessage(thread.id, reply.id, (entry: ChatMessage): ChatMessage => ({
              ...entry,
              text: (first ? "" : entry.text) + delta,
            }));
          }
          first = false;
        },
      });
      if (!result.brief) throw new SessionError(ERROR_CODES.SESSION_BRIEF_MISSING);
    } catch (error: unknown) {
      if (!request.signal.aborted && isTransientProviderError(error)) throw error;
      if (!request.signal.aborted) {
        editMessage(thread.id, reply.id, (entry: ChatMessage): ChatMessage => ({
          ...entry,
          error: error instanceof SessionError ? error.message : describeProviderError(error),
        }));
      }
      return;
    }
    if (request.signal.aborted) return;
    const current: Thread | undefined = find(thread.id);
    if (!current) return;
    const brief: Brief = readBrief(result.brief, current, message.text);
    mergeInspectorBriefEdits(brief, current, thread);
    const domainId: string | undefined = getPreset(current.presetId).domainId;
    const domain: DomainPack | undefined = domainId ? getDomain(domainId) : undefined;
    const unanswered: string[] = intakeQuestions(brief, domain);
    const questions: string[] = unanswered.length
      ? [...new Set([...unanswered, ...modelStrings(result.questions, 4)])].slice(0, 4)
      : [];
    edit(thread.id, (active: Thread): Thread => ({
      ...active,
      brief,
      inspectorOpen: true,
      inspectorTab: "brief",
      intakeStep: questions.length ? "questioning" : "confirmed",
    }));
    const assumptions: string[] = modelStrings(result.assumptions, 4);
    editMessage(thread.id, reply.id, (entry: ChatMessage): ChatMessage => ({
      ...entry,
      text:
        entry.text.trim() ||
        modelString(result.reply) ||
        (questions.length ? "还有几项需要确认。" : "已整理简报。"),
      assumptions,
      choices: questions.length ? questions : undefined,
    }));
    if (!questions.length) {
      confirm({
        threadId: thread.id,
        action: { kind: "brief" },
        labels: {
          intent: "steer",
          summary:
            current.workspace && getPreset(current.presetId).writePolicy === "code"
              ? "确认后，CLI 会应用本轮普通差异。首次运行此工作项的本地检查前会另行确认。"
              : "确认简报后开始派发工作项。",
          acceptLabel: "确认简报",
          declineLabel: "继续修改",
        },
      });
    }
  }

  function plan(threadId: string, messageId: string, revised: boolean = false): void {
    const thread: Thread | undefined = find(threadId);
    if (!thread) return;
    if (!providerFor(thread)) {
      edit(threadId, (current: Thread): Thread => ({
        ...current,
        pendingPlan: { messageId, revised },
      }));
      return;
    }
    if (thread.activeRequest?.kind !== "plan") {
      beginRequest(threadId, { kind: "plan", messageId, revised });
    }
    const reportError = (error: string): void => append(threadId, assistant("", { error }), messageId);
    const started: boolean = startChat({
      thread,
      onError: reportError,
      worker: async (client: ModelClient, request: ModelRequest): Promise<void> => {
        const existingRuns: { title: string; status: Run["status"]; dependsOn: string[] }[] =
          thread.runs.map(({ title, status, dependsOn }: Run): {
            title: string;
            status: Run["status"];
            dependsOn: string[];
          } => ({ title, status, dependsOn }));
        const prompt: ModelMessage[] = conversationPrompt(
          thread,
          [
            "按已确认简报拆工作项。每个工作项列出它实际依赖的需求编号。并行项用相同 parallelGroup。保留现有编号。若简报没有编号，先返回补全编号后的 brief。",
            thread.presetId === "develop"
              ? "同一目标涉及多个可独立修改的文件时，使用同一个工作项的 seats 分派这些范围。每个开发席位必须有唯一 id、title 和具体相对文件路径 scope。避免重叠的写入范围。确实需要子席位时设置 parentId，子席位范围只能是父范围的子集。聊天或缺少具体路径的工作项留空，不编造路径。审计由客户端自动安排。"
              : "",
            revised
              ? `只补修订后的差额，包括当前仍需接替的已暂停工作项；不重复已完成或仍有效的工作项。已有工作项：${JSON.stringify(existingRuns)}`
              : "",
            thread.workspace
              ? '需要确认实际文件范围时，先单独返回 {"tools":[{"name":"project","path":""}]}。' + "\n" + CODING_TOOL_GUIDE
              : "",
            '只返回 JSON {"reply":"...","brief":{},"runs":[{"title":"...","dependsOn":["R1"],"note":"...","parallelGroup":"g1","seats":[{"id":"a","title":"...","scope":["src/example.ts"]}]}]}。',
          ]
            .filter(Boolean)
            .join("\n")
        );
        prompt.push(...(await attachedFiles(thread, messageId || undefined)));
        const loop: ReturnType<typeof createCodingToolLoop> = createCodingToolLoop({
          signal: request.signal,
          execute: (tools: unknown[], signal: AbortSignal): Promise<ModelMessage> => toolContext(thread, tools, signal),
          limitError: (): SessionError => new SessionError(ERROR_CODES.SESSION_TOOL_LIMIT_EXCEEDED),
        });
        let response: Awaited<ReturnType<typeof askModel>> = await askModel(client, request, loop.messages(prompt));
        while (Array.isArray(response.tools) && response.tools.length) {
          await loop.accept(response.tools);
          response = await askModel(client, request, loop.messages(prompt));
        }
        if (request.signal.aborted) return;
        const current: Thread | undefined = find(threadId);
        if (!current) return;
        const brief: Brief | null =
          current.brief?.requirements.length || !response.brief
            ? current.brief
            : readBrief(response.brief, current, "项目");
        const runs: Run[] = readRuns(response.runs, { ...current, brief }, messageId);
        if (!runs.length && !revised) {
          throw new SessionError(ERROR_CODES.SESSION_RUNS_MISSING);
        }
        edit(threadId, (active: Thread): Thread => ({
          ...active,
          brief,
          intakeStep: "done",
          runs: [...active.runs, ...runs],
          activeRequest: undefined,
          inspectorOpen: true,
          inspectorTab: "progress",
        }));
        const short: boolean = runs.some(({ seats }: Run): boolean => Boolean(seats?.length));
        append(
          threadId,
          assistant(
            (!short && modelString(response.reply)) ||
              (runs.length ? `已派发 ${runs.length} 项工作。` : "修订已应用。")
          )
        );
      },
    });
    if (started && thread.pendingPlan) {
      edit(threadId, (current: Thread): Thread => ({ ...current, pendingPlan: undefined }));
    }
  }

  function askIteration(options: AskIterationOptions): void {
    const { threadId, runId, iterationId, phase, summary }: AskIterationOptions = options;
    const thread: Thread | undefined = find(threadId);
    if (!thread || thread.pendingConfirmation) return;
    const stage: Iteration["stage"] = thread.runs.find((run: Run): boolean => run.id === runId)?.iterations?.at(-1)?.stage;
    confirm({
      threadId,
      action: { kind: "iteration", runId, iterationId, phase },
      labels: {
        intent: "steer",
        summary,
        acceptLabel: phase === "next" ? "继续下一轮" : stage === "checks" ? "允许运行检查" : "确认应用差异",
        declineLabel: "停在这里",
      },
    });
  }

  function runItem(threadId: string, runId: string): void {
    const thread: Thread | undefined = find(threadId);
    const run: Run | undefined = thread?.runs.find(({ id }: Run): boolean => id === runId);
    if (!thread || !run || jobs.current.get(threadId)?.has(runId)) return;
    if (!providerFor(thread)) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return;
    }
    const useSeats: boolean = thread.mode === "project" && Boolean(run.seats?.length);
    if (useSeats && run.seatsWorkspaceId && run.seatsWorkspaceId !== thread.workspace?.id) {
      edit(threadId, (current: Thread): Thread => ({
        ...current,
        runs: current.runs.map((item: Run): Run =>
          item.id === runId
            ? { ...item, status: "blocked", note: "工作区已更换，请为当前文件夹重新派发此项" }
            : item
        ),
      }));
      return;
    }
    edit(threadId, (current: Thread): Thread => ({
      ...current,
      runs: current.runs.map((item: Run): Run =>
        item.id === runId
          ? {
            ...item,
            status: "in_progress",
            note: useSeats ? "正在调度开发与审计席位" : "正在根据简报处理…",
            seatsWorkspaceId: useSeats ? thread.workspace?.id : item.seatsWorkspaceId,
            seatPlan: useSeats ? (item.seatPlan ?? item.seats) : item.seatPlan,
          }
          : item
      ),
    }));
    if (useSeats && !run.iterations?.length) {
      const total: number =
        run.seats?.filter(({ role }: AgentSeat): boolean => role === "develop").length ?? 0;
      append(threadId, assistant(`${run.title.slice(0, 48)}：已安排 ${total} 个开发席位。`));
    }
    start({
      thread,
      key: runId,
      worker: async (client: ModelClient, request: ModelRequest): Promise<void> => {
        const get = (): { thread: Thread; run: Run } => {
          const active: Thread | undefined = find(threadId);
          const item: Run | undefined = active?.runs.find(({ id }: Run): boolean => id === runId);
          if (!active || !item) throw new SessionError(ERROR_CODES.SESSION_RUN_NOT_FOUND);
          return { thread: active, run: item };
        };
        const blocked: string | undefined = await iterate({
          get,
          edit: (update: (thread: Thread) => Thread): void => edit(threadId, update),
          approve: (iterationId: string, phase: "apply" | "next", note: string): void =>
            askIteration({ threadId, runId, iterationId, phase, summary: note }),
          client,
          request,
          produce: async (
            current: Thread,
            item: Run,
            model: ModelClient
          ): Promise<Artifact[] | undefined> => {
            if (item.seats?.length) {
              const result:
                | { status: "completed" | "blocked"; artifacts: Artifact[] }
                | undefined = await seated.executeRun({ thread: current, run: item, client, request });
              return result?.artifacts;
            }
            return produceCodingRound({ current, item, model, request, callbacks: { edit, editMessage, attachedFiles } });
          },
        });
        if (blocked) append(threadId, assistant(blocked));
        if (!request.signal.aborted && thread.mode === "single") {
          edit(threadId, (state: Thread): Thread => {
            if (state.runs.find(({ id }: Run): boolean => id === runId)?.status !== "completed") {
              return state;
            }
            return {
              ...state,
              inspectorTab: "artifact",
              runs: state.runs.map((entry: Run): Run =>
                entry.id === runId ? entry : { ...entry, status: "completed", note: "" }
              ),
            };
          });
        }
      },
      onError: (note: string): void => {
        edit(threadId, (current: Thread): Thread => ({
          ...current,
          runs: current.runs.map((item: Run): Run =>
            item.id === runId ? blockIteration(item, note) : item
          ),
        }));
        append(threadId, assistant(note));
      },
    });
  }

  function supplement(thread: Thread, text: string): boolean {
    const running: Run[] = thread.runs.filter(
      ({ status }: Run): boolean => status === "in_progress"
    );
    const target: Run[] = running.length
      ? running
      : thread.runs.filter(({ status }: Run): boolean => status === "blocked").slice(0, 1);
    if (!target.length) return false;
    const restart: Run[] = target.filter((run: Run): boolean => !run.iterations?.at(-1)?.approval);
    for (const run of restart) cancelJob(thread.id, run.id);
    edit(thread.id, (current: Thread): Thread => ({
      ...current,
      runs: current.runs.map((run: Run): Run =>
        target.some(({ id }: Run): boolean => id === run.id)
          ? {
            ...run,
            supplements: [...(run.supplements ?? []), text],
            seats: pauseSeats(run.seats, "正在加入补充"),
            iterations: run.iterations?.map((round: Iteration): Iteration =>
                round.status === "in_progress" && round.stage === "produce"
                  ? { ...round, attempt: crypto.randomUUID() }
                  : round
            ),
          }
          : run
      ),
    }));
    append(
      thread.id,
      assistant(`已将补充加入${target.map(({ title }: Run): string => `「${title}」`).join("、")}。`)
    );
    for (const run of restart) retryOrStart(thread.id, run.id);
    return true;
  }

  function branch(thread: Thread, text: string, attachments?: string[]): void {
    const patch: Thread = newThread("patch");
    edit(patch.id, (current: Thread): Thread => ({
      ...current,
      modelId: thread.modelId,
      modelName: thread.modelName,
      workspace: thread.workspace,
    }));
    sendMessage({ threadId: patch.id, text, attachments });
  }

  async function classify(
    thread: Thread,
    message: ChatMessage,
    execution: { client: ModelClient; request: ModelRequest }
  ): Promise<void> {
    const { client, request }: { client: ModelClient; request: ModelRequest } = execution;
    const revision: boolean = identifiesRevision(message.text, thread);
    const prompt: ModelMessage[] = conversationPrompt(
      thread,
      [
        revision
          ? "最新用户消息已经在本地判定为 revise。按消息更新完整简报，保留未修改字段和需求编号。"
          : "判断最新用户消息的用途：steer（原范围内补充或讨论）、revise（改变简报）、patch（独立的小改动）。修订需返回修改后的完整简报，保留未修改字段和编号。",
        '只返回 JSON {"intent":"steer|revise|patch","brief":{},"reply":"..."}。reply 是给用户的简短答复。',
      ].join("\n"),
      message.id
    );
    const result: Awaited<ReturnType<typeof askModel>> = await askModel(client, request, [
      ...prompt,
      ...(await attachedFiles(thread, message.id)),
    ]);
    if (request.signal.aborted) return;
    const current: Thread | undefined = find(thread.id);
    if (!current) return;
    if (current.pendingConfirmation) {
      edit(thread.id, (active: Thread): Thread => ({
        ...active,
        messages: active.messages.filter(({ id }: ChatMessage): boolean => id !== message.id),
        queuedMessages: [message, ...(active.queuedMessages ?? [])],
      }));
      return;
    }
    const intent: Intent = revision ? "revise" : readIntent(result.intent);
    if (intent === "revise") {
      const brief: Brief = readBrief(result.brief, current, message.text);
      if (
        !result.brief ||
        JSON.stringify({ ...brief, requirementSequence: undefined }) ===
          JSON.stringify({ ...current.brief, requirementSequence: undefined })
      ) {
        append(
          thread.id,
          assistant(modelString(result.reply) || "请补充需要改成什么内容。"),
          message.id
        );
        return;
      }
      proposeBrief(current, brief, message.text);
    } else if (intent === "patch") {
      append(thread.id, assistant("已打开一条小补丁对话。"), message.id);
      branch(current, message.text, message.attachments);
    } else if (!supplement(current, message.text)) {
      append(thread.id, assistant(modelString(result.reply) || "已记录补充。"), message.id);
    }
  }

  function process(thread: Thread, message: ChatMessage): void {
    if (find(thread.id)?.activeRequest?.kind !== "message") {
      beginRequest(thread.id, { kind: "message", messageId: message.id });
    }
    const reportError = (error: string): void =>
      append(thread.id, assistant("", { error }), message.id);
    if (thread.mode === "project") {
      if (thread.intakeStep !== "done") {
        startChat({
          thread,
          worker: (client: ModelClient, request: ModelRequest): Promise<void> =>
            intake(thread, message, { client, request }),
          onError: reportError,
          live: true,
        });
      } else {
        startChat({
          thread,
          worker: (client: ModelClient, request: ModelRequest): Promise<void> =>
            classify(thread, message, { client, request }),
          onError: reportError,
        });
      }
      return;
    }
    const existing: boolean =
      thread.runs.length === SINGLE_STEPS.length &&
      thread.runs.every(({ messageId }: Run): boolean => messageId === message.id);
    const runs: Run[] = existing
      ? thread.runs
      : SINGLE_STEPS.map((title: string, index: number): Run => ({
        id: crypto.randomUUID(),
        title,
        status: index === 0 ? "completed" : "pending",
        dependsOn: [],
        note: index === 0 ? "已收集输入与附件" : "",
        messageId: message.id,
      }));
    const work: Run = runs[1];
    const needsApproval: boolean = Boolean(
      !existing && thread.workspace && getPreset(thread.presetId).writePolicy === "code"
    );
    edit(thread.id, (current: Thread): Thread => ({
      ...current,
      activeRequest: undefined,
      inspectorOpen: true,
      inspectorTab: "progress",
      runs: runs.map((run: Run): Run =>
        run.id === work.id && !needsApproval ? { ...run, status: "in_progress" } : run
      ),
    }));
    if (needsApproval) {
      confirm({
        threadId: thread.id,
        action: { kind: "run", runId: work.id },
        labels: {
          intent: "steer",
          summary: "确认后，CLI 会在工作区应用普通差异；运行本地检查需单独授权。",
          acceptLabel: "开始工作",
          declineLabel: "暂缓",
        },
      });
    } else {
      retryOrStart(thread.id, work.id);
    }
  }

  function pump(threadId: string): void {
    if (isShuttingDown()) return;
    const thread: Thread | undefined = find(threadId);
    if (
      !thread ||
      thread.pendingConfirmation ||
      jobs.current.get(threadId)?.has("chat") ||
      !providerFor(thread)
    ) {
      return;
    }
    if (thread.pendingPlan) {
      plan(threadId, thread.pendingPlan.messageId, thread.pendingPlan.revised);
      return;
    }
    if (thread.activeRequest) {
      if (thread.activeRequest.kind === "plan") {
        plan(threadId, thread.activeRequest.messageId, thread.activeRequest.revised);
      } else {
        const message: ChatMessage | undefined = thread.messages.find(
          ({ id }: ChatMessage): boolean => id === thread.activeRequest?.messageId
        );
        if (message) process(thread, message);
      }
      return;
    }
    const approval: Run | undefined = thread.runs.find(
      (run: Run): boolean =>
        run.status === "in_progress" && Boolean(run.iterations?.at(-1)?.approval)
    );
    const iteration: Iteration | undefined = approval?.iterations?.at(-1);
    if (approval && iteration?.approval) {
      askIteration({
        threadId,
        runId: approval.id,
        iterationId: iteration.id,
        phase: iteration.approval,
        summary: iteration.note,
      });
      return;
    }
    const unfinished: Run | undefined = thread.runs.find(
      (run: Run): boolean =>
        run.status === "in_progress" && !jobs.current.get(threadId)?.has(run.id)
    );
    if (unfinished) {
      runItem(threadId, unfinished.id);
      return;
    }
    if (
      thread.mode === "single" &&
      thread.runs.some(({ status }: Run): boolean => status === "in_progress")
    ) {
      return;
    }
    const [queued, ...rest]: ChatMessage[] = thread.queuedMessages ?? [];
    if (queued) {
      edit(threadId, (current: Thread): Thread => ({
        ...current,
        queuedMessages: rest,
        messages: [...current.messages, queued],
        updatedAt: Date.now(),
        activeRequest: { kind: "message", messageId: queued.id, attempt: crypto.randomUUID() },
      }));
      const current: Thread | undefined = find(threadId);
      if (current) process(current, queued);
      return;
    }
    if (thread.mode !== "project" || thread.intakeStep !== "done") return;
    const pending: Run | undefined = thread.runs.find(
      ({ status }: Run): boolean => status === "pending"
    );
    if (!pending) return;
    const running: Run | undefined = thread.runs.find(
      ({ status }: Run): boolean => status === "in_progress"
    );
    if (running && (!pending.parallelGroup || pending.parallelGroup !== running.parallelGroup)) {
      return;
    }
    if (thread.brief?.autonomy === "ask") {
      confirm({
        threadId,
        action: { kind: "run", runId: pending.id },
        labels: {
          intent: "steer",
          summary: `开始「${pending.title}」？`,
          acceptLabel: "开始",
          declineLabel: "暂缓",
        },
      });
      return;
    }
    const group: Run[] = pending.parallelGroup
      ? thread.runs.filter(
        (run: Run): boolean =>
          run.status === "pending" && run.parallelGroup === pending.parallelGroup
      )
      : [pending];
    group.forEach(({ id }: Run): void => runItem(threadId, id));
  }

  return {
    proposeBrief,
    updateBrief,
    plan,
    runItem,
    supplement,
    branch,
    process,
    pump,
  };
}
