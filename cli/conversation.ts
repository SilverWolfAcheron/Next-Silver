import { getPreset } from "../src/model/presets";
import { getDomain } from "../src/model/domains/pcb";
import { intakeQuestions } from "../src/model/intake";
import { reconcile } from "../src/model/reconcile";
import { pauseSeats, retrySeats } from "../src/model/seats";
import { createSeatExecution } from "./seatExecution";
import { createIterationEngine, iterationContext } from "./iterations";
import { blockIteration, pauseIterations, resolveIterationApproval } from "../src/model/iterate";
import type { RequestJournal } from "./journal";
import {
  askModel, conversationPrompt, identifiesRevision, modelString, modelStrings, readArtifacts,
  readBrief, readIntent, readRuns, requirementSequence, resultInstruction, SessionError, streamResult,
} from "../src/model/session";
import type { Brief, ChatMessage, PendingConfirmation, Run, Thread } from "../src/model/types";
import { attachmentContext, toolContext } from "./workspaceContext";
import { describeProviderError, ProviderError, type ModelClient } from "../src/provider/client";
import { setTimeout as delay } from "node:timers/promises";
import { isConfiguredProvider, makeClient } from "../src/provider/presets";
import type { Action, SilverState } from "../src/model/silverState";

type Request = { model: string; signal: AbortSignal };
type Worker = (client: ModelClient, request: Request) => Promise<void>;
type Confirmation = NonNullable<ChatMessage["confirm"]>;
type ConfirmationAction = PendingConfirmation extends infer P
  ? P extends PendingConfirmation ? Omit<P, "messageId"> : never : never;

const SINGLE_STEPS = ["看相关代码", "修改", "确认没有多余改动"];
const INTAKE_SCHEMA = '{"brief":{"intent":"","outcome":"","requirements":[{"id":"R1","text":""}],"constraints":"","autonomy":"ask|decide|act","outOfScope":[],"domainFields":{}},"reply":"","questions":[],"assumptions":[]}';

function assistant(text: string, fields?: Partial<ChatMessage>): ChatMessage {
  return { id: crypto.randomUUID(), role: "assistant", text, ...fields };
}

function insertReply(messages: ChatMessage[], reply: ChatMessage, afterId?: string) {
  if (!afterId) return [...messages, reply];
  const index = messages.findIndex(({ id }) => id === afterId);
  const nextUser = messages.findIndex(({ role }, offset) => offset > index && role === "user");
  if (index < 0 || nextUser < 0) return [...messages, reply];
  return [...messages.slice(0, nextUser), reply, ...messages.slice(nextUser)];
}

export function createConversation(
  latest: { current: SilverState },
  dispatch: (action: Action) => void,
  newThread: (presetId: string) => Thread,
  refreshJobs: () => void,
  journal: RequestJournal,
) {
  const jobs = { current: new Map<string, Map<string, AbortController>>() };
  const activeJobs = new Set<Promise<void>>();
  let shuttingDown = false;
  const seated = createSeatExecution(latest, edit, journal);
  const iterate = createIterationEngine(journal);

  function find(threadId: string) {
    return latest.current.threads.find(({ id }) => id === threadId);
  }

  function edit(threadId: string, update: (thread: Thread) => Thread) {
    dispatch({ type: "UPDATE_THREAD", threadId, update });
  }

  function append(threadId: string, message: ChatMessage, afterId?: string) {
    edit(threadId, (thread) => ({
      ...thread, messages: insertReply(thread.messages, message, afterId), updatedAt: Date.now(),
    }));
  }

  function editMessage(threadId: string, messageId: string, update: (message: ChatMessage) => ChatMessage) {
    edit(threadId, (thread) => ({
      ...thread, messages: thread.messages.map((message) => message.id === messageId ? update(message) : message),
    }));
  }

  function providerFor(thread: Thread) {
    const provider = latest.current.providers.find(({ id }) => id === thread.modelId);
    if (!provider) return;
    const config = { ...provider, model: thread.modelName || provider.model };
    if (isConfiguredProvider(config)) return config;
  }

  async function attachedFiles(thread: Thread, messageId?: string) {
    try {
      return await attachmentContext(thread, messageId);
    } catch (error) {
      throw new SessionError(error instanceof Error ? error.message : "无法读取附加文件。");
    }
  }

  function isGenerating(threadId: string) {
    const thread = find(threadId);
    return Boolean(jobs.current.get(threadId)?.size || thread?.runs.some(({ status }) => status === "in_progress"));
  }

  function transient(error: unknown) {
    return error instanceof ProviderError && (error.kind === "stream" || error.kind === "network" || error.status === 429 ||
      (error.status !== undefined && error.status >= 500));
  }

  function activeReply(threadId: string, messageId: string) {
    const thread = find(threadId);
    const prior = thread?.activeRequest?.replyId;
    if (prior && thread?.messages.some(({ id }) => id === prior)) return { id: prior };
    const reply = assistant("");
    edit(threadId, (current) => ({
      ...current,
      activeRequest: current.activeRequest ? { ...current.activeRequest, replyId: reply.id } : undefined,
      messages: insertReply(current.messages, reply, messageId),
    }));
    return reply;
  }

  function beginRequest(threadId: string, request: Omit<NonNullable<Thread["activeRequest"]>, "attempt">) {
    edit(threadId, (current) => ({
      ...current, activeRequest: { ...request, attempt: crypto.randomUUID() },
    }));
  }

  function startChat(thread: Thread, worker: Worker, onError: (note: string) => void, live = false) {
    const claimed = find(thread.id)?.activeRequest;
    if (!claimed) return false;
    const operation = `${thread.id}:chat:${claimed.attempt}`;
    return start(thread, "chat", async (client, request) => {
      for (let retry = 0; ; retry++) {
        try {
          await worker(journal.model(operation, client, live), request);
          break;
        } catch (error) {
          request.signal.throwIfAborted();
          if (!transient(error)) {
            edit(thread.id, (current) => ({ ...current, activeRequest: undefined }));
            journal.clear(operation);
            throw error;
          }
          await delay(Math.min(30_000, 2_000 * (retry + 1)), undefined, { signal: request.signal });
        }
      }
      request.signal.throwIfAborted();
      edit(thread.id, (current) => current.activeRequest?.attempt === claimed.attempt
        ? { ...current, activeRequest: undefined } : current);
      journal.clear(operation);
    }, onError);
  }

  function cancelJob(threadId: string, key: string) {
    const active = jobs.current.get(threadId);
    const controller = active?.get(key);
    if (!controller) return;
    active?.delete(key);
    if (!active?.size) jobs.current.delete(threadId);
    controller.abort();
    refreshJobs();
  }

  function cancelThread(threadId: string) {
    const active = jobs.current.get(threadId);
    if (!active) return;
    jobs.current.delete(threadId);
    active.forEach((controller) => controller.abort());
    refreshJobs();
  }

  function stop(threadId: string) {
    if (!isGenerating(threadId)) return false;
    cancelThread(threadId);
    edit(threadId, (thread) => ({
      ...thread, activeRequest: undefined,
      pendingConfirmation: thread.pendingConfirmation?.kind === "iteration" ? undefined : thread.pendingConfirmation,
      messages: thread.messages.map((entry) => thread.pendingConfirmation?.kind === "iteration" &&
        entry.id === thread.pendingConfirmation.messageId ? { ...entry, confirm: undefined } : entry),
      runs: thread.runs.map((run) => run.status === "in_progress"
        ? { ...run, status: "paused", note: "已停止，可以重试", seats: pauseSeats(run.seats, "已停止"),
          iterations: pauseIterations(run.iterations, "已停止") } : run),
    }));
    append(threadId, assistant("已停止，可以重试。"));
    return true;
  }

  function start(thread: Thread, key: string, worker: Worker, onError: (cause: string) => void) {
    if (shuttingDown) return false;
    const provider = providerFor(thread);
    if (!provider) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return false;
    }
    let active = jobs.current.get(thread.id);
    if (active?.has(key)) return false;
    if (!active) {
      active = new Map();
      jobs.current.set(thread.id, active);
    }
    const controller = new AbortController();
    active.set(key, controller);
    refreshJobs();
    const task = (async () => {
      try {
        await worker(makeClient(provider), { model: provider.model, signal: controller.signal });
      } catch (error) {
        if (!controller.signal.aborted) {
          onError(error instanceof SessionError ? error.message : describeProviderError(error));
        }
      } finally {
        if (jobs.current.get(thread.id)?.get(key) === controller) {
          jobs.current.get(thread.id)?.delete(key);
          if (!jobs.current.get(thread.id)?.size) jobs.current.delete(thread.id);
          refreshJobs();
          pump(thread.id);
        }
      }
    })();
    activeJobs.add(task);
    void task.finally(() => activeJobs.delete(task)).catch(() => undefined);
    return true;
  }

  function confirm(threadId: string, action: ConfirmationAction, labels: Confirmation, text = "") {
    const message = assistant(text, { confirm: labels });
    edit(threadId, (thread) => ({
      ...thread,
      pendingConfirmation: { ...action, messageId: message.id },
      messages: [...thread.messages, message],
    }));
  }

  function proposeBrief(thread: Thread, brief: Brief, source: string) {
    const domainId = getPreset(thread.presetId).domainId;
    const paused = reconcile(thread.brief, brief, thread.runs, domainId ? getDomain(domainId) : undefined)
      .filter(({ status }, index) => status === "paused" && thread.runs[index].status !== "paused");
    confirm(thread.id, { kind: "revise", brief, source }, {
      intent: "revise",
      summary: paused.length ? `确认后将暂停：${paused.map(({ title }) => title).join("、")}。` : "确认后更新简报。",
    });
  }

  function updateBrief(threadId: string, brief: Brief) {
    const thread = find(threadId);
    if (!thread || (thread.pendingConfirmation && thread.pendingConfirmation.kind !== "brief")) return;
    const next = { ...brief, requirementSequence: Math.max(requirementSequence(thread), requirementSequence(thread, brief)) };
    if (thread.runs.length) {
      const source = `用户编辑简报：${JSON.stringify(next)}`;
      proposeBrief(thread, next, source);
      return;
    }
    edit(threadId, (current) => ({ ...current, brief: next, updatedAt: Date.now() }));
  }

  async function intake(thread: Thread, message: ChatMessage, client: ModelClient, request: Request) {
    const prompt = conversationPrompt(thread, [
      "从对话提取简报。已给出的信息填入对应字段。保留已有需求编号，遗漏的信息不要伪造。没有额外约束时可把假设「无额外约束」填入。目标、完成标准、约束、自主度是必填项。仅询问会改变计划的空项，最多四条。已回答或明确待定的字段不重复询问。",
      "如果领域字段有关联编号，已有对应需求时保持编号。将默认自主度写入简报，并把真正采用的假设放入 assumptions。",
      `先流式输出给用户的简短正文，随后在独立一行输出 <<<SILVER_RESULT>>>，接一个 JSON 对象：${INTAKE_SCHEMA}。JSON 外不加代码围栏。`,
    ].join("\n"), message.id);
    const reply = activeReply(thread.id, message.id);
    let first = true;
    let result;
    try {
      const messages = [...prompt, ...await attachedFiles(thread, message.id)];
      result = await streamResult(client, request, messages, (delta) => {
        if (!request.signal.aborted) editMessage(thread.id, reply.id, (entry) => ({ ...entry, text: (first ? "" : entry.text) + delta }));
        first = false;
      }, true);
      if (!result.brief) throw new SessionError("模型回复缺少简报数据，可以重试。");
    } catch (error) {
      if (!request.signal.aborted && transient(error)) throw error;
      if (!request.signal.aborted) {
        editMessage(thread.id, reply.id, (entry) => ({
          ...entry, error: error instanceof SessionError ? error.message : describeProviderError(error),
        }));
      }
      return;
    }
    if (request.signal.aborted) return;
    const current = find(thread.id);
    if (!current) return;
    const baseline = current.brief ?? readBrief({}, current, message.text);
    const brief = readBrief(result.brief, current, message.text);
    if (current.brief && current.brief !== thread.brief) {
      // Fields saved in the inspector after this request started take precedence.
      for (const key of Object.keys(brief) as (keyof Brief)[]) {
        if (JSON.stringify(baseline[key]) !== JSON.stringify(thread.brief?.[key])) Object.assign(brief, { [key]: baseline[key] });
      }
    }
    const domainId = getPreset(current.presetId).domainId;
    const domain = domainId ? getDomain(domainId) : undefined;
    const unanswered = intakeQuestions(brief, domain);
    const questions = unanswered.length
      ? [...new Set([...unanswered, ...modelStrings(result.questions, 4)])].slice(0, 4)
      : [];
    edit(thread.id, (active) => ({
      ...active, brief, inspectorOpen: true, inspectorTab: "brief",
      intakeStep: questions.length ? "questioning" : "confirmed",
    }));
    const assumptions = modelStrings(result.assumptions, 4);
    editMessage(thread.id, reply.id, (entry) => ({
      ...entry, text: entry.text.trim() || modelString(result.reply) || (questions.length ? "还有几项需要确认。" : "已整理简报。"),
      assumptions, choices: questions.length ? questions : undefined,
    }));
    if (!questions.length) {
      confirm(thread.id, { kind: "brief" }, {
        intent: "steer",
        summary: current.workspace && getPreset(current.presetId).writePolicy === "code"
          ? "确认后，CLI 会在工作区应用本轮普通差异并运行项目的测试、类型检查和构建脚本。"
          : "确认简报后开始派发工作项。",
        acceptLabel: "确认简报", declineLabel: "继续修改",
      });
    }
  }

  function plan(threadId: string, messageId: string, revised = false) {
    const thread = find(threadId);
    if (!thread) return;
    if (!providerFor(thread)) {
      edit(threadId, (current) => ({ ...current, pendingPlan: { messageId, revised } }));
      return;
    }
    if (thread.activeRequest?.kind !== "plan") beginRequest(threadId, { kind: "plan", messageId, revised });
    const reportError = (error: string) => append(threadId, assistant("", { error }), messageId);
    const started = startChat(thread, async (client, request) => {
      const existingRuns = thread.runs.map(({ title, status, dependsOn }) => ({ title, status, dependsOn }));
      const prompt = conversationPrompt(thread, [
        "按已确认简报拆工作项。每个工作项列出它实际依赖的需求编号。并行项用相同 parallelGroup。保留现有编号。若简报没有编号，先返回补全编号后的 brief。",
        thread.presetId === "develop"
          ? "同一目标涉及多个可独立修改的文件时，使用同一个工作项的 seats 分派这些范围。每个开发席位必须有唯一 id、title 和具体相对文件路径 scope。避免重叠的写入范围。确实需要子席位时设置 parentId，子席位范围只能是父范围的子集。聊天或缺少具体路径的工作项留空，不编造路径。审计由客户端自动安排。"
          : "",
        revised ? `只补修订后的差额，包括当前仍需接替的已暂停工作项；不重复已完成或仍有效的工作项。已有工作项：${JSON.stringify(existingRuns)}` : "",
        thread.workspace && '需要确认实际文件范围时，先单独返回 {"tools":[{"name":"list","path":""},{"name":"search","query":"关键词"}]}，也可使用 read。',
        '只返回 JSON {"reply":"...","brief":{},"runs":[{"title":"...","dependsOn":["R1"],"note":"...","parallelGroup":"g1","seats":[{"id":"a","title":"...","scope":["src/example.ts"]}]}]}。',
      ].filter(Boolean).join("\n"));
      prompt.push(...await attachedFiles(thread, messageId || undefined));
      let response = await askModel(client, request, prompt);
      while (Array.isArray(response.tools) && response.tools.length) {
        request.signal.throwIfAborted();
        prompt.push(await toolContext(thread, response.tools, request.signal));
        response = await askModel(client, request, prompt);
      }
      if (request.signal.aborted) return;
      const current = find(threadId);
      if (!current) return;
      const brief = current.brief?.requirements.length || !response.brief
        ? current.brief : readBrief(response.brief, current, "项目");
      const runs = readRuns(response.runs, { ...current, brief }, messageId);
      if (!runs.length && !revised) throw new SessionError("模型没有返回可派发的工作项，可以重试。");
      edit(threadId, (active) => ({
        ...active, brief, intakeStep: "done", runs: [...active.runs, ...runs], activeRequest: undefined,
        inspectorOpen: true, inspectorTab: "progress",
      }));
      const short = runs.some(({ seats }) => seats?.length);
      append(threadId, assistant((!short && modelString(response.reply)) || (runs.length ? `已派发 ${runs.length} 项工作。` : "修订已应用。")));
    }, reportError);
    if (started && thread.pendingPlan) edit(threadId, (current) => ({ ...current, pendingPlan: undefined }));
  }

  function runItem(threadId: string, runId: string) {
    const thread = find(threadId);
    const run = thread?.runs.find(({ id }) => id === runId);
    if (!thread || !run || jobs.current.get(threadId)?.has(runId)) return;
    if (!providerFor(thread)) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return;
    }
    const useSeats = thread.mode === "project" && Boolean(run.seats?.length);
    if (useSeats && run.seatsWorkspaceId && run.seatsWorkspaceId !== thread.workspace?.id) {
      edit(threadId, (current) => ({
        ...current, runs: current.runs.map((item) => item.id === runId
          ? { ...item, status: "blocked", note: "工作区已更换，请为当前文件夹重新派发此项" } : item),
      }));
      return;
    }
    edit(threadId, (current) => ({
      ...current, runs: current.runs.map((item) => item.id === runId
        ? {
          ...item, status: "in_progress", note: useSeats ? "正在调度开发与审计席位" : "正在根据简报处理…",
          seatsWorkspaceId: useSeats ? thread.workspace?.id : item.seatsWorkspaceId,
          seatPlan: useSeats ? item.seatPlan ?? item.seats : item.seatPlan,
        } : item),
    }));
    if (useSeats && !run.iterations?.length) {
      const total = run.seats?.filter(({ role }) => role === "develop").length ?? 0;
      append(threadId, assistant(`${run.title.slice(0, 48)}：已安排 ${total} 个开发席位。`));
    }
    start(thread, runId, async (client, request) => {
      const get = () => {
        const active = find(threadId);
        const item = active?.runs.find(({ id }) => id === runId);
        if (!active || !item) throw new SessionError("找不到工作项。");
        return { thread: active, run: item };
      };
      const blocked = await iterate(get, (update) => edit(threadId, update),
        (iterationId, phase, note) => askIteration(threadId, runId, iterationId, phase, note),
        client, request, async (current, item, model) => {
          if (item.seats?.length) {
            const result = await seated.executeRun(current, item, client, request);
            return result?.artifacts;
          }
          const prompt = [
            ...conversationPrompt(current, `${resultInstruction(current, item, true)}\n当前轮次：${item.iterations?.at(-1)?.index}。轮次目标：${item.iterations?.at(-1)?.title}`, item.messageId),
            ...iterationContext(current, item),
            ...await attachedFiles(current, item.messageId || undefined),
          ];
          const round = item.iterations?.at(-1);
          let replyId = round?.replyId;
          if (current.mode === "single" && round?.index === 1 && !replyId) {
            const reply = assistant("");
            replyId = reply.id;
            edit(threadId, (state) => ({
              ...state, messages: insertReply(state.messages, reply, item.messageId),
              runs: state.runs.map((entry) => entry.id === item.id ? {
                ...entry, iterations: entry.iterations?.map((iteration) => iteration.id === round.id
                  ? { ...iteration, replyId: reply.id } : iteration),
              } : entry),
            }));
          }
          let firstDelta = true;
          for (;;) {
            request.signal.throwIfAborted();
            const reply = await streamResult(model, request, prompt, (delta) => {
              if (!replyId || request.signal.aborted) return;
              editMessage(threadId, replyId, (entry) => ({
                ...entry, text: (firstDelta ? "" : entry.text) + delta,
              }));
              firstDelta = false;
            }, true);
            if (!Array.isArray(reply.tools) || !reply.tools.length) {
              const artifacts = readArtifacts(reply.artifacts, current, item.id);
              const note = modelString(reply.note);
              if (note && !artifacts.length) artifacts.push({
                id: crypto.randomUUID(), kind: "doc", title: "本轮说明", body: note, runId: item.id,
              });
              return artifacts;
            }
            prompt.push(await toolContext(current, reply.tools, request.signal));
          }
        });
      if (blocked) append(threadId, assistant(blocked));
      if (!request.signal.aborted && thread.mode === "single") {
        edit(threadId, (state) => {
          if (state.runs.find(({ id }) => id === runId)?.status !== "completed") return state;
          return {
            ...state, inspectorTab: "artifact",
            runs: state.runs.map((entry) => entry.id === runId ? entry : { ...entry, status: "completed", note: "" }),
          };
        });
      }
    }, (note) => {
      edit(threadId, (current) => ({
        ...current, runs: current.runs.map((item) => item.id === runId ? blockIteration(item, note) : item),
      }));
      append(threadId, assistant(note));
    });
  }

  function askIteration(threadId: string, runId: string, iterationId: string, phase: "apply" | "next", summary: string) {
    if (find(threadId)?.pendingConfirmation) return;
    confirm(threadId, { kind: "iteration", runId, iterationId, phase }, {
      intent: "steer", summary,
      acceptLabel: phase === "apply" ? "确认应用差异" : "继续下一轮",
      declineLabel: "停在这里",
    });
  }

  function supplement(thread: Thread, text: string) {
    const running = thread.runs.filter(({ status }) => status === "in_progress");
    const target = running.length ? running : thread.runs.filter(({ status }) => status === "blocked").slice(0, 1);
    if (!target.length) return false;
    const restart = target.filter((run) => !run.iterations?.at(-1)?.approval);
    for (const run of restart) cancelJob(thread.id, run.id);
    edit(thread.id, (current) => ({
      ...current, runs: current.runs.map((run) => target.some(({ id }) => id === run.id)
        ? { ...run, supplements: [...(run.supplements ?? []), text],
          seats: pauseSeats(run.seats, "正在加入补充"),
          iterations: run.iterations?.map((round) => round.status === "in_progress" && round.stage === "produce"
            ? { ...round, attempt: crypto.randomUUID() } : round) } : run),
    }));
    append(thread.id, assistant(`已将补充加入${target.map(({ title }) => `「${title}」`).join("、")}。`));
    for (const run of restart) retryOrStart(thread.id, run.id);
    return true;
  }

  function branch(thread: Thread, text: string, attachments?: string[]) {
    const patch = newThread("patch");
    edit(patch.id, (current) => ({ ...current, modelId: thread.modelId, modelName: thread.modelName, workspace: thread.workspace }));
    sendMessage(patch.id, text, attachments);
  }

  async function classify(thread: Thread, message: ChatMessage, client: ModelClient, request: Request) {
    const revision = identifiesRevision(message.text, thread);
    const prompt = conversationPrompt(thread, [
      revision ? "最新用户消息已经在本地判定为 revise。按消息更新完整简报，保留未修改字段和需求编号。"
        : "判断最新用户消息的用途：steer（原范围内补充或讨论）、revise（改变简报）、patch（独立的小改动）。修订需返回修改后的完整简报，保留未修改字段和编号。",
      '只返回 JSON {"intent":"steer|revise|patch","brief":{},"reply":"..."}。reply 是给用户的简短答复。',
    ].join("\n"), message.id);
    const result = await askModel(client, request, [...prompt, ...await attachedFiles(thread, message.id)]);
    if (request.signal.aborted) return;
    const current = find(thread.id);
    if (!current) return;
    if (current.pendingConfirmation) {
      edit(thread.id, (active) => ({
        ...active,
        messages: active.messages.filter(({ id }) => id !== message.id),
        queuedMessages: [message, ...(active.queuedMessages ?? [])],
      }));
      return;
    }
    const intent = revision ? "revise" : readIntent(result.intent);
    if (intent === "revise") {
      const brief = readBrief(result.brief, current, message.text);
      if (!result.brief || JSON.stringify({ ...brief, requirementSequence: undefined })
        === JSON.stringify({ ...current.brief, requirementSequence: undefined })) {
        append(thread.id, assistant(modelString(result.reply) || "请补充需要改成什么内容。"), message.id);
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

  function process(thread: Thread, message: ChatMessage) {
    if (find(thread.id)?.activeRequest?.kind !== "message") beginRequest(thread.id, { kind: "message", messageId: message.id });
    const reportError = (error: string) => append(thread.id, assistant("", { error }), message.id);
    if (thread.mode === "project") {
      if (thread.intakeStep !== "done") {
        startChat(thread, (client, request) => intake(thread, message, client, request), reportError, true);
      } else {
        startChat(thread, (client, request) => classify(thread, message, client, request), reportError);
      }
      return;
    }
    const existing = thread.runs.length === SINGLE_STEPS.length && thread.runs.every(({ messageId }) => messageId === message.id);
    const runs = existing ? thread.runs : SINGLE_STEPS.map((title, index): Run => ({
      id: crypto.randomUUID(), title, status: index === 0 ? "completed" : "pending",
      dependsOn: [], note: index === 0 ? "已收集输入与附件" : "", messageId: message.id,
    }));
    const work = runs[1];
    const needsApproval = !existing && thread.workspace && getPreset(thread.presetId).writePolicy === "code";
    edit(thread.id, (current) => ({
      ...current, activeRequest: undefined, inspectorOpen: true, inspectorTab: "progress",
      runs: runs.map((run) => run.id === work.id && !needsApproval ? { ...run, status: "in_progress" } : run),
    }));
    if (needsApproval) {
      confirm(thread.id, { kind: "run", runId: work.id }, {
        intent: "steer", summary: "确认后，CLI 会在工作区应用普通差异并运行项目检查。",
        acceptLabel: "开始工作", declineLabel: "暂缓",
      });
    } else retryOrStart(thread.id, work.id);
  }

  function pump(threadId: string) {
    if (shuttingDown) return;
    const thread = find(threadId);
    if (!thread || thread.pendingConfirmation || jobs.current.get(threadId)?.has("chat") || !providerFor(thread)) return;
    if (thread.pendingPlan) {
      plan(threadId, thread.pendingPlan.messageId, thread.pendingPlan.revised);
      return;
    }
    if (thread.activeRequest) {
      if (thread.activeRequest.kind === "plan") {
        plan(threadId, thread.activeRequest.messageId, thread.activeRequest.revised);
      } else {
        const message = thread.messages.find(({ id }) => id === thread.activeRequest?.messageId);
        if (message) process(thread, message);
      }
      return;
    }
    const approval = thread.runs.find((run) => run.status === "in_progress" && run.iterations?.at(-1)?.approval);
    const iteration = approval?.iterations?.at(-1);
    if (approval && iteration?.approval) {
      askIteration(threadId, approval.id, iteration.id, iteration.approval, iteration.note);
      return;
    }
    const unfinished = thread.runs.find((run) => run.status === "in_progress" &&
      run.iterations?.length && !jobs.current.get(threadId)?.has(run.id));
    if (unfinished) {
      runItem(threadId, unfinished.id);
      return;
    }
    if (thread.mode === "single" && thread.runs.some(({ status }) => status === "in_progress")) return;
    const [queued, ...rest] = thread.queuedMessages ?? [];
    if (queued) {
      edit(threadId, (current) => ({
        ...current, queuedMessages: rest, messages: [...current.messages, queued], updatedAt: Date.now(),
        activeRequest: { kind: "message", messageId: queued.id, attempt: crypto.randomUUID() },
      }));
      const current = find(threadId);
      if (current) process(current, queued);
      return;
    }
    if (thread.mode !== "project" || thread.intakeStep !== "done") return;
    const pending = thread.runs.find(({ status }) => status === "pending");
    if (!pending) return;
    const running = thread.runs.find(({ status }) => status === "in_progress");
    if (running && (!pending.parallelGroup || pending.parallelGroup !== running.parallelGroup)) return;
    if (thread.brief?.autonomy === "ask") {
      confirm(threadId, { kind: "run", runId: pending.id }, {
        intent: "steer", summary: `开始「${pending.title}」？`, acceptLabel: "开始", declineLabel: "暂缓",
      });
      return;
    }
    const group = pending.parallelGroup
      ? thread.runs.filter((run) => run.status === "pending" && run.parallelGroup === pending.parallelGroup)
      : [pending];
    group.forEach(({ id }) => runItem(threadId, id));
  }

  function sendMessage(threadId: string | undefined, text: string, attachments: string[] = []) {
    const content = text.trim();
    if (!content) return;
    const thread = threadId ? find(threadId) : newThread("develop");
    if (!thread) return;
    const message: ChatMessage = {
      id: crypto.randomUUID(), role: "user", text: content,
      attachments: attachments.length ? attachments : undefined,
      workspaceId: attachments.length ? thread.workspace?.id : undefined,
    };
    edit(thread.id, (current) => ({
      ...current,
      title: !current.titleEdited && !current.messages.some(({ role }) => role === "user") && !current.queuedMessages?.length
        ? Array.from(content.replace(/\s+/g, " ")).slice(0, 20).join("") : current.title,
      queuedMessages: [...(current.queuedMessages ?? []), message],
      messages: current.messages.some(({ choices }) => choices?.length)
        ? current.messages.map((entry) => entry.choices ? { ...entry, choices: undefined } : entry) : current.messages,
      updatedAt: Date.now(),
    }));
    if (!providerFor(thread) && !thread.pendingConfirmation) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
    pump(thread.id);
  }

  function selectModel(threadId: string | undefined, modelId: string, modelName?: string) {
    const thread = threadId ? find(threadId) : newThread("develop");
    if (!thread) return;
    const selectedName = modelName || latest.current.providers.find(({ id }) => id === modelId)?.model;
    edit(thread.id, (current) => ({ ...current, modelId, modelName: selectedName }));
    if (providerFor({ ...thread, modelId, modelName: selectedName })) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    pump(thread.id);
  }

  function applyPreset(thread: Thread, presetId: string) {
    const preset = getPreset(presetId);
    if (thread.mode !== preset.mode) cancelThread(thread.id);
    edit(thread.id, (current) => ({
      ...current, presetId: preset.id, mode: preset.mode, inspectorTab: preset.defaultTab,
      title: current.messages.length || current.titleEdited || current.queuedMessages?.length ? current.title : preset.label,
      runs: current.mode !== preset.mode ? current.runs.map((run) =>
        run.status === "completed" ? run : {
          ...run, status: "paused", note: "预设已切换", seats: pauseSeats(run.seats, "预设已切换", true),
          iterations: pauseIterations(run.iterations, "预设已切换"),
        }) : current.runs,
      activeRequest: current.mode === preset.mode ? current.activeRequest : undefined,
      pendingPlan: current.mode === preset.mode ? current.pendingPlan : undefined,
      intakeStep: current.mode === "single" && preset.mode === "project" ? "questioning" : current.intakeStep,
    }));
    dispatch({ type: "REMEMBER_PRESET", presetId: preset.id });
  }

  function changePreset(threadId: string | undefined, presetId: string) {
    const thread = threadId ? find(threadId) : null;
    if (!thread) {
      newThread(presetId);
      return;
    }
    if (thread.presetId === presetId || thread.pendingConfirmation) return;
    if (thread.mode === "project" && getPreset(presetId).mode === "single" && thread.runs.length > 1) {
      confirm(thread.id, { kind: "preset", presetId }, {
        intent: "revise", summary: "把当前目标收成一次 Single 请求，并暂停其余未完成项？",
        acceptLabel: "切换预设", declineLabel: "保留项目",
      });
    } else {
      applyPreset(thread, presetId);
    }
  }

  function promoteThread(threadId: string) {
    const thread = find(threadId);
    if (!thread || thread.mode !== "single" || thread.pendingConfirmation) return;
    confirm(threadId, { kind: "promote" }, {
      intent: "steer", summary: "根据当前对话建立简报，已有产物会保留。", acceptLabel: "升成项目", declineLabel: "取消",
    });
  }

  function retryRun(threadId: string, runId: string) {
    const thread = find(threadId);
    const run = thread?.runs.find(({ id }) => id === runId);
    if (!thread || !run) return;
    if (run.status === "in_progress" && run.seats?.some((seat) => seat.role === "audit" && seat.status === "blocked")) {
      edit(threadId, (current) => ({
        ...current, runs: current.runs.map((item) => item.id === runId ? {
          ...item, seats: item.seats?.map((seat) => seat.role === "audit" && seat.status === "blocked"
            ? { ...seat, status: "pending", note: "", summary: "", refutations: [], verdicts: undefined, attempt: crypto.randomUUID() } : seat),
        } : item),
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

  function retryOrStart(threadId: string, runId: string) {
    const current = find(threadId);
    if (!current) return;
    if (providerFor(current)) edit(threadId, (thread) => ({
      ...thread, runs: thread.runs.map((run) => run.id === runId ? {
        ...run, seats: retrySeats(run.seats).map((seat) => seat.status === "pending"
          ? { ...seat, attempt: crypto.randomUUID() } : seat),
        iterations: run.iterations?.map((iteration, index, all) => index === all.length - 1 &&
          (iteration.status === "blocked" || iteration.status === "paused")
          ? { ...iteration, status: "in_progress", note: "正在从保存的阶段重试",
            attempt: crypto.randomUUID() } : iteration),
      } : run),
    }));
    runItem(threadId, runId);
  }

  function resolveConfirmation(threadId: string, messageId: string, accepted: boolean) {
    const thread = find(threadId);
    const action = thread?.pendingConfirmation;
    if (!thread || !action || action.messageId !== messageId) return;
    if (accepted && (action.kind === "promote" || action.kind === "run") && !providerFor(thread)) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return;
    }
    edit(threadId, (current) => ({ ...current, pendingConfirmation: undefined }));
    editMessage(threadId, messageId, (message) => ({
      ...message, confirm: undefined, text: message.text || (accepted ? "已确认。" : "已取消。"),
    }));
    const recent = thread.messages.filter(({ role }) => role === "user").at(-1);
    switch (action.kind) {
      case "brief":
        if (accepted && thread.brief?.intent && thread.brief.outcome && thread.brief.constraints) plan(threadId, recent?.id ?? "");
        else if (accepted) {
          append(threadId, assistant("请在简报中补全目标、完成标准和约束，或在对话里继续补充。"));
          edit(threadId, (current) => ({ ...current, intakeStep: "questioning" }));
        }
        else edit(threadId, (current) => ({ ...current, intakeStep: "questioning" }));
        break;
      case "revise":
        if (accepted) {
          const domainId = getPreset(thread.presetId).domainId;
          const runs = reconcile(thread.brief, action.brief, thread.runs, domainId ? getDomain(domainId) : undefined);
          runs.forEach((run, index) => {
            if (run.status === "paused" && thread.runs[index].status === "in_progress") cancelJob(threadId, run.id);
          });
          edit(threadId, (current) => ({ ...current, brief: action.brief, runs, updatedAt: Date.now() }));
          plan(threadId, recent?.id ?? "", true);
        } else {
          supplement(thread, action.source);
        }
        break;
      case "preset":
        if (accepted) {
          cancelThread(threadId);
          applyPreset(thread, action.presetId);
        }
        break;
      case "run":
        if (accepted) runItem(threadId, action.runId);
        else edit(threadId, (current) => ({
          ...current, runs: current.runs.map((run) => run.id === action.runId
            ? { ...run, status: "paused", note: "用户暂缓，可重试" } : run),
        }));
        break;
      case "promote":
        if (accepted) {
          applyPreset(thread, "develop");
          const current = find(threadId);
          if (current && recent) process(current, recent);
        }
        break;
      case "iteration": {
        const run = thread.runs.find(({ id }) => id === action.runId);
        const iteration = run?.iterations?.at(-1);
        if (!run || !iteration || run.status !== "in_progress" ||
          iteration.id !== action.iterationId || iteration.approval !== action.phase) break;
        const next = action.phase === "next" ? resolveIterationApproval(run, accepted, iteration.id) : {
          ...run,
          status: accepted ? "in_progress" as const : "blocked" as const,
          note: accepted ? "已确认，准备应用差异" : "用户停止自迭代",
          iterations: [...run.iterations!.slice(0, -1), {
            ...iteration, approval: undefined,
            status: accepted ? "in_progress" as const : "blocked" as const,
            writes: accepted ? iteration.writes : undefined,
            stage: accepted ? iteration.stage : "produce" as const,
            note: accepted ? "已确认，准备应用差异" : "用户停止自迭代",
          }],
        };
        edit(threadId, (current) => ({
          ...current, runs: current.runs.map((item) => item.id === run.id ? next : item),
        }));
        if (accepted) runItem(threadId, run.id);
        break;
      }
    }
    pump(threadId);
  }

  function retryMessage(threadId: string, userMessageId: string) {
    const thread = find(threadId);
    const index = thread?.messages.findIndex(({ id, role }) => id === userMessageId && role === "user") ?? -1;
    if (!thread || index < 0 || jobs.current.get(threadId)?.has("chat")) return;
    if (!providerFor(thread)) {
      dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
      return;
    }
    const nextUser = thread.messages.findIndex(({ role }, offset) => offset > index && role === "user");
    const end = nextUser === -1 ? thread.messages.length : nextUser;
    const removed = thread.messages.slice(index + 1, end);
    const pendingRemoved = removed.some(({ id }) => id === thread.pendingConfirmation?.messageId);
    if (thread.pendingConfirmation && !pendingRemoved) return;
    const affected = thread.runs.filter((run) => run.messageId === userMessageId && run.status !== "completed");
    affected.forEach(({ id }) => cancelJob(threadId, id));
    edit(threadId, (current) => ({
      ...current, messages: [...thread.messages.slice(0, index + 1), ...thread.messages.slice(end)],
      runs: current.runs.map((run) => affected.some(({ id }) => id === run.id)
        ? { ...run, status: "paused", note: "等待重新生成回复", seats: pauseSeats(run.seats, "等待重新生成回复", true) } : run),
      pendingConfirmation: pendingRemoved ? undefined : current.pendingConfirmation,
    }));
    const current = find(threadId);
    if (!current) return;
    if (current.mode === "project" && (affected.length || (current.intakeStep === "confirmed" && !pendingRemoved))) {
      plan(threadId, userMessageId, current.runs.length > 0);
      return;
    }
    process(current, thread.messages[index]);
  }

  function patchFinding(threadId: string, text: string) {
    const thread = find(threadId);
    if (thread) branch(thread, text);
  }

  function restore() {
    for (const thread of latest.current.threads) {
      if (thread.mode === "project" || thread.mode === "single") {
        edit(thread.id, (current) => ({
          ...current,
          runs: current.runs.map((run) => run.status === "in_progress" ? {
            ...run, seats: run.seats?.map((seat) => seat.status === "in_progress"
              ? { ...seat, status: "pending", note: "从已保存的请求继续" } : seat),
          } : run),
        }));
        for (const run of thread.runs) {
          if (run.status === "in_progress" && !run.iterations?.at(-1)?.approval) runItem(thread.id, run.id);
        }
      }
      pump(thread.id);
    }
  }

  async function shutdown() {
    shuttingDown = true;
    for (const threadId of jobs.current.keys()) cancelThread(threadId);
    await Promise.allSettled([...activeJobs]);
  }

  return {
    sendMessage, selectModel, changePreset, stop, isGenerating, cancelThread, retryMessage,
    retryRun, resolveConfirmation, updateBrief, promoteThread, patchFinding,
    resumeQueued: () => latest.current.threads.forEach(({ id }) => pump(id)),
    rescheduleSeats: seated.requestPulse,
    restore, shutdown,
  };
}
