import { ERROR_CODES } from "../src/agent-core/errors";
import { getPreset } from "../src/agent-core/presets";
import {
  conversationPrompt, modelString, readArtifacts, resultInstruction, SessionError, streamResult,
} from "../src/agent-core/session";
import type { ModelMessage } from "../src/agent-core/session";
import type { ModelClient } from "../src/agent-core/provider/client";
import type { Artifact, ChatMessage, Iteration, Run, Thread } from "../src/agent-core/types";
import type { CodingPreflightReport } from "../src/types/codingPreflight";
import { assistant, insertReply } from "./conversationHelpers";
import type { ConversationKernel, ModelRequest } from "./conversationHelpers";
import { iterationContext } from "./iterations";
import { createWorkspaceToolLoop } from "./workspaceContext";
import { codingDraftRepairMessage } from "./codingDraftRepair";
import { preflightCodingChanges } from "./codingPreflight";

interface CodingRoundOptions {
  current: Thread;
  item: Run;
  model: ModelClient;
  request: ModelRequest;
  callbacks: Pick<ConversationKernel, "edit" | "editMessage" | "attachedFiles">;
}

export async function produceCodingRound(options: CodingRoundOptions): Promise<Artifact[]> {
  const { current, item, model, request, callbacks }: CodingRoundOptions = options;
  const { edit, editMessage, attachedFiles }: CodingRoundOptions["callbacks"] = callbacks;
  const prompt: ModelMessage[] = [
    ...conversationPrompt(
      current,
      `${resultInstruction(current, item, true)}\n当前轮次：${item.iterations?.at(-1)?.index}。轮次目标：${item.iterations?.at(-1)?.title}`,
      item.messageId
    ),
    ...iterationContext(current, item),
    ...(await attachedFiles(current, item.messageId || undefined)),
  ];
  const round: Iteration | undefined = item.iterations?.at(-1);
  let replyId: string | undefined = round?.replyId;
  if (current.mode === "single" && round?.index === 1 && !replyId) {
    const reply: ChatMessage = assistant("");
    replyId = reply.id;
    edit(current.id, (state: Thread): Thread => ({
      ...state,
      messages: insertReply(state.messages, reply, item.messageId),
      runs: state.runs.map((entry: Run): Run =>
        entry.id === item.id
          ? {
            ...entry,
            iterations: entry.iterations?.map((iteration: Iteration): Iteration =>
                iteration.id === round.id ? { ...iteration, replyId: reply.id } : iteration
            ),
          }
          : entry
      ),
    }));
  }
  const loop: ReturnType<typeof createWorkspaceToolLoop> = createWorkspaceToolLoop(current, {
    signal: request.signal,
    track: request.track,
    limitError: (): SessionError => new SessionError(ERROR_CODES.SESSION_TOOL_LIMIT_EXCEEDED),
  });
  let repair: ModelMessage | undefined;
  for (;;) {
    let firstDelta: boolean = true;
    request.signal.throwIfAborted();
    const reply: Awaited<ReturnType<typeof streamResult>> = await streamResult({
      client: model,
      request,
      messages: loop.messages(repair ? [...prompt, repair] : prompt),
      structured: true,
      onDelta: (delta: string): void => {
        if (!replyId || request.signal.aborted) return;
        editMessage(current.id, replyId, (entry: ChatMessage): ChatMessage => ({
          ...entry,
          text: (firstDelta ? "" : entry.text) + delta,
        }));
        firstDelta = false;
      },
    });
    if (!Array.isArray(reply.tools) || !reply.tools.length) {
      const artifacts: Artifact[] = readArtifacts(reply.artifacts, current, item.id);
      if (!repair && reply.status !== "blocked" && current.workspace &&
          getPreset(current.presetId).writePolicy === "code" &&
          artifacts.some(({ kind }: Artifact): boolean => kind === "diff")) {
        const workspace: NonNullable<Thread["workspace"]> = current.workspace;
        const review: CodingPreflightReport = await request.track({ kind: "preflight" },
          (): Promise<CodingPreflightReport> => preflightCodingChanges(workspace, artifacts, { policy: "code", signal: request.signal }));
        repair = codingDraftRepairMessage(review, artifacts);
        if (repair) continue;
      }
      const note: string = modelString(reply.note);
      if (note && !artifacts.length) {
        artifacts.push({
          id: crypto.randomUUID(),
          kind: "doc",
          title: "本轮说明",
          body: note,
          runId: item.id,
        });
      }
      return artifacts;
    }
    await loop.accept(reply.tools);
  }
}
