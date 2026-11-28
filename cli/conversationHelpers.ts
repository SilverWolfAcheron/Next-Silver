import { ProviderError } from "../src/agent-core/provider/client";
import type { ModelClient } from "../src/agent-core/provider/client";
import type { ProviderConfig } from "../src/agent-core/provider/presets";
import type { ModelMessage } from "../src/agent-core/session";
import type { Action, SilverState } from "../src/agent-core/silverState";
import type { AgentOperationKind, ModelActivity, TrackAgentOperation } from "../src/types/modelActivity";
import type {
  Brief,
  ChatMessage,
  PendingConfirmation,
  Thread,
} from "../src/agent-core/types";
import type { RequestJournal } from "./journal";
import type { createIterationEngine } from "./iterations";
import type { createSeatExecution } from "./seatExecution";

export interface ModelRequest {
  model: string;
  signal: AbortSignal;
  track: TrackAgentOperation;
}

type Worker = (client: ModelClient, request: ModelRequest) => Promise<void>;
type Confirmation = NonNullable<ChatMessage["confirm"]>;
type ConfirmationAction = PendingConfirmation extends infer P
  ? P extends PendingConfirmation
    ? Omit<P, "messageId">
    : never
  : never;

export interface ConversationDeps {
  latest: { current: SilverState };
  dispatch: (action: Action) => void;
  newThread: (presetId: string) => Thread;
  refreshJobs: () => void;
  journal: RequestJournal;
}

export interface ConversationService {
  sendMessage: (options: SendMessageOptions) => void;
  selectModel: (threadId: string | undefined, modelId: string, modelName?: string) => void;
  changePreset: (threadId: string | undefined, presetId: string) => void;
  stop: (threadId: string) => boolean;
  isGenerating: (threadId: string) => boolean;
  modelActivity: () => Record<string, ModelActivity>;
  cancelThread: (threadId: string) => void;
  retryMessage: (threadId: string, userMessageId: string) => void;
  retryRun: (threadId: string, runId: string) => void;
  resolveConfirmation: (threadId: string, messageId: string, accepted: boolean) => void;
  updateBrief: (threadId: string, brief: Brief) => void;
  patchFinding: (threadId: string, text: string) => void;
  resumeQueued: (threadId?: string) => void;
  rescheduleSeats: () => void;
  restore: () => void;
  shutdown: () => Promise<void>;
}

export interface StartJobOptions {
  thread: Thread;
  key: string;
  worker: Worker;
  onError: (cause: string) => void;
}

export interface StartChatOptions {
  thread: Thread;
  activity: AgentOperationKind;
  worker: Worker;
  onError: (note: string) => void;
  live?: boolean;
}

export interface ConfirmOptions {
  threadId: string;
  action: ConfirmationAction;
  labels: Confirmation;
  text?: string;
}

export interface SendMessageOptions {
  threadId?: string;
  text: string;
  attachments?: string[];
  clearDraft?: boolean;
}

export interface AskIterationOptions {
  threadId: string;
  runId: string;
  iterationId: string;
  phase: "apply" | "next";
  summary: string;
}

export interface ConversationKernel {
  latest: { current: SilverState };
  dispatch: (action: Action) => void;
  newThread: (presetId: string) => Thread;
  jobs: { current: Map<string, Map<string, AbortController>> };
  seated: ReturnType<typeof createSeatExecution>;
  iterate: ReturnType<typeof createIterationEngine>;
  isShuttingDown: () => boolean;
  find: (threadId: string) => Thread | undefined;
  edit: (threadId: string, update: (thread: Thread) => Thread) => void;
  append: (threadId: string, message: ChatMessage, afterId?: string) => void;
  editMessage: (
    threadId: string,
    messageId: string,
    update: (message: ChatMessage) => ChatMessage
  ) => void;
  providerFor: (thread: Thread) => ProviderConfig | undefined;
  attachedFiles: (
    thread: Thread,
    messageId?: string
  ) => Promise<ModelMessage[]>;
  activeReply: (threadId: string, messageId: string) => { id: string };
  beginRequest: (
    threadId: string,
    request: Omit<NonNullable<Thread["activeRequest"]>, "attempt">
  ) => void;
  start: (options: StartJobOptions) => boolean;
  startChat: (options: StartChatOptions) => boolean;
  cancelJob: (threadId: string, key: string) => void;
  confirm: (options: ConfirmOptions) => void;
  resolveConfirmation: (threadId: string, messageId: string, decision: boolean | "automatic") => void;
  retryOrStart: (threadId: string, runId: string) => void;
  sendMessage: (options: SendMessageOptions) => void;
}

export const SINGLE_STEPS: readonly string[] = ["看相关代码", "修改", "确认没有多余改动"];
export const INTAKE_SCHEMA: string =
  '{"brief":{"intent":"","outcome":"","requirements":[{"id":"R1","text":""}],"constraints":"","autonomy":"ask|decide|act","outOfScope":[],"domainFields":{}},"reply":"","questions":[],"assumptions":[]}';

export function assistant(text: string, fields?: Partial<ChatMessage>): ChatMessage {
  return { id: crypto.randomUUID(), role: "assistant", text, ...fields };
}

export function insertReply(
  messages: ChatMessage[],
  reply: ChatMessage,
  afterId?: string
): ChatMessage[] {
  if (!afterId) return [...messages, reply];
  const index: number = messages.findIndex(({ id }: ChatMessage): boolean => id === afterId);
  const nextUser: number = messages.findIndex(
    ({ role }: ChatMessage, offset: number): boolean => offset > index && role === "user"
  );
  if (index < 0 || nextUser < 0) return [...messages, reply];
  return [...messages.slice(0, nextUser), reply, ...messages.slice(nextUser)];
}

export function isTransientProviderError(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    (error.kind === "stream" ||
      error.kind === "network" ||
      error.status === 429 ||
      (error.status !== undefined && error.status >= 500))
  );
}

export function mergeInspectorBriefEdits(
  brief: Brief,
  current: Thread,
  started: Thread
): void {
  if (!current.brief || current.brief === started.brief) return;
  const baseline: Brief = current.brief;
  for (const key of Object.keys(brief) as (keyof Brief)[]) {
    if (JSON.stringify(baseline[key]) !== JSON.stringify(started.brief?.[key])) {
      Object.assign(brief, { [key]: baseline[key] });
    }
  }
}
