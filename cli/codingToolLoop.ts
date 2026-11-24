import {
  CODING_TOOL_CONTINUE, CODING_TOOL_LIMITS, CODING_TOOL_MAX_TRACE, CODING_TOOL_STOP_TEXT,
} from "../src/constants/codingToolLoop.ts";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import type { ModelMessage } from "../src/agent-core/session.ts";
import type {
  CodingToolBatch, CodingToolLimits, CodingToolLoop, CodingToolLoopOptions, CodingToolRequest,
  CodingToolStep, CodingToolStop, CodingToolTurn,
} from "../src/types/codingToolLoop.ts";
import { codingToolKey, codingToolLabel, readCodingToolBatch } from "./codingToolLoopInput.ts";
import { codingToolHasEvidence, codingToolMessages, makeCodingToolTurn } from "./codingToolLoopHistory.ts";

interface Round {
  tools: CodingToolRequest[];
  keys: string[];
  invalid: number;
  duplicates: number;
  limited: number;
}

interface LoopState {
  rounds: number;
  requests: number;
  stalled: number;
  stop?: CodingToolStop;
  busy: boolean;
}

const TRANSCRIPT_RESERVE: number = 192;
const MIN_RESULT_CHARS: number = 192;

function limit(raw: number | undefined, fallback: number, floor: number = 1): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return Math.max(floor, Math.min(fallback, Math.floor(raw)));
}

function codeToolLimits(options?: Partial<CodingToolLimits>): CodingToolLimits {
  const defaults: CodingToolLimits = CODING_TOOL_LIMITS;
  return {
    batchSize: limit(options?.batchSize, defaults.batchSize),
    roundCount: limit(options?.roundCount, defaults.roundCount),
    requestCount: limit(options?.requestCount, defaults.requestCount),
    stalledRounds: limit(options?.stalledRounds, defaults.stalledRounds),
    requestChars: limit(options?.requestChars, defaults.requestChars, 64),
    resultChars: limit(options?.resultChars, defaults.resultChars, MIN_RESULT_CHARS),
    transcriptChars: limit(options?.transcriptChars, defaults.transcriptChars, 1_024),
  };
}

function roundTools(
  batch: CodingToolBatch, seen: ReadonlySet<string>, options: { allowance: number; refreshKey?: CodingToolLoopOptions["refreshKey"] }
): Round {
  const round: Round = { tools: [], keys: [], invalid: batch.invalid, duplicates: 0, limited: 0 };
  const batchKeys: Set<string> = new Set();
  for (const tool of batch.tools) {
    const base: string = codingToolKey(tool);
    const refresh: string | undefined = options.refreshKey?.(tool);
    const key: string = refresh === undefined ? base : `${base}#${refresh}`;
    if (seen.has(key) || batchKeys.has(key)) {
      round.duplicates++;
      continue;
    }
    batchKeys.add(key);
    if (round.tools.length >= options.allowance) {
      round.limited++;
      continue;
    }
    round.tools.push(tool);
    round.keys.push(key);
  }
  return round;
}

function rejectionNote(round: Round, limits: CodingToolLimits): string {
  const strings: string[] = [];
  if (round.invalid) {
    strings.push(`无效或超限请求：${round.invalid}。每批最多 ${limits.batchSize} 项，每项应为带 name 的精简 JSON 对象。`);
  }
  if (round.duplicates) {
    strings.push(`已跳过 ${round.duplicates} 项重复请求。请使用已有结果，或换一个尚未读取的目标。`);
  }
  if (round.limited) strings.push(`剩余工具预算不足，未执行 ${round.limited} 项。`);
  return strings.join("\n");
}

function stopFor(state: LoopState, limits: CodingToolLimits): CodingToolStop | undefined {
  if (state.rounds >= limits.roundCount) return "rounds";
  if (state.requests >= limits.requestCount) return "requests";
  if (state.stalled >= limits.stalledRounds) return "stalled";
  return undefined;
}

function stopDirective(reason?: CodingToolStop): string | undefined {
  if (!reason) return;
  return `${CODING_TOOL_STOP_TEXT[reason]}。${CODING_TOOL_CONTINUE}`;
}

async function executeWithCancellation(
  execute: CodingToolLoopOptions["execute"], tools: CodingToolRequest[], signal: AbortSignal
): Promise<ModelMessage> {
  signal.throwIfAborted();
  let listener: (() => void) | undefined;
  const cancelled: Promise<undefined> = new Promise<undefined>((resolve: (value: undefined) => void): void => {
    listener = (): void => { resolve(undefined); };
    signal.addEventListener("abort", listener, { once: true });
  });
  // Defer invocation so synchronous exceptions and late rejections participate in
  // the race and cannot become unhandled after the caller cancels.
  const execution: Promise<ModelMessage> = Promise.resolve().then((): Promise<ModelMessage> => {
    signal.throwIfAborted();
    return execute(tools, signal);
  });
  try {
    const result: ModelMessage | undefined = await Promise.race([execution, cancelled]);
    if (!result) {
      signal.throwIfAborted();
      throw new AppError(ERROR_CODES.REQUEST_ABORTED);
    }
    signal.throwIfAborted();
    return result;
  } finally {
    if (listener) signal.removeEventListener("abort", listener);
  }
}

export function createCodingToolLoop(options: CodingToolLoopOptions): CodingToolLoop {
  const { execute, signal }: CodingToolLoopOptions = options;
  const limits: CodingToolLimits = codeToolLimits(options.limits);
  const effective: CodingToolLimits = {
    ...limits,
    requestChars: Math.min(limits.requestChars, Math.floor(
      (limits.transcriptChars - TRANSCRIPT_RESERVE - MIN_RESULT_CHARS) / limits.batchSize
    )),
  };
  const state: LoopState = { rounds: 0, requests: 0, stalled: 0, busy: false };
  const seen: Set<string> = new Set();
  const history: CodingToolTurn[] = [];
  const trace: string[] = [];

  async function accept(value: unknown): Promise<CodingToolStep> {
    signal.throwIfAborted();
    if (state.stop || state.busy) {
      throw options.limitError?.() ?? new AppError(ERROR_CODES.SESSION_TOOL_LIMIT_EXCEEDED);
    }
    state.busy = true;
    try {
      const batch: CodingToolBatch = readCodingToolBatch(value, effective);
      const round: Round = roundTools(batch, seen, {
        allowance: effective.requestCount - state.requests, refreshKey: options.refreshKey,
      });
      const count: number = round.tools.length;
      const skipped: number = round.invalid + round.duplicates + round.limited;
      const result: ModelMessage | undefined = count ? await executeWithCancellation(execute, round.tools, signal) : undefined;
      signal.throwIfAborted();
      const requestContent: string = JSON.stringify({ tools: round.tools });
      const note: string = rejectionNote(round, effective);
      const resultContent: string = [note, result?.content].filter(Boolean).join("\n");
      const responseLimit: number = Math.min(
        effective.resultChars, effective.transcriptChars - TRANSCRIPT_RESERVE - requestContent.length
      );
      history.push(makeCodingToolTurn(requestContent, resultContent, responseLimit));
      for (const key of round.keys) seen.add(key);
      trace.push(...round.tools.map(codingToolLabel));
      state.rounds++;
      state.requests += count;
      state.stalled = result && codingToolHasEvidence(result.content) ? 0 : state.stalled + 1;
      state.stop = stopFor(state, effective);
      if (state.stop) return { status: "finalize", count, skipped, reason: state.stop };
      if (count) return { status: "executed", count, skipped };
      return { status: "rejected", count: 0, skipped };
    } finally {
      state.busy = false;
    }
  }

  function messages(base: readonly ModelMessage[]): ModelMessage[] {
    return codingToolMessages({
      base, history, transcriptChars: effective.transcriptChars, directive: stopDirective(state.stop),
    });
  }

  function reads(): string[] {
    if (trace.length <= CODING_TOOL_MAX_TRACE) return [...trace];
    const remaining: number = trace.length - CODING_TOOL_MAX_TRACE;
    return [`已省略较早的 ${remaining} 项工作区读取请求`, ...trace.slice(-CODING_TOOL_MAX_TRACE)];
  }

  return {
    accept, messages, reads,
    get stopReason(): CodingToolStop | undefined { return state.stop; },
  };
}
