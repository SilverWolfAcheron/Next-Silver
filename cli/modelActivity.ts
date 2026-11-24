import type { ChatInput, ModelClient } from "../src/agent-core/provider/client";
import { ACTIVITY_TARGET_CHARS, BYTES_PER_ESTIMATED_TOKEN, MODEL_RATE_INTERVAL_MS, RECENT_AGENT_OPERATIONS } from "../src/constants/modelActivity";
import type {
  AgentOperation, AgentOperationInput, AgentOperationStatus, ModelActivity, ModelStreamOutcome, ModelStreamPhase, TrackAgentOperation,
} from "../src/types/modelActivity";

interface ThreadActivity {
  counts: ModelActivity;
  sampleBytes: number;
  sampledAt: number;
  timer?: ReturnType<typeof setInterval>;
  active: Map<number, AgentOperation>;
  recent: AgentOperation[];
}

export function createModelActivity(publish: () => void): {
  snapshot: (threadIds: readonly string[]) => Record<string, ModelActivity>;
  observe: (threadId: string, client: ModelClient) => ModelClient;
  track: (threadId: string, signal: AbortSignal) => TrackAgentOperation;
  clearOutcome: (threadId: string) => void;
} {
  const threads: Map<string, ThreadActivity> = new Map();
  let nextId: number = 0;

  function activityFor(threadId: string): ThreadActivity {
    const existing: ThreadActivity | undefined = threads.get(threadId);
    if (existing) return existing;
    const created: ThreadActivity = {
      counts: { requesting: 0, accepted: 0, streaming: 0 }, sampleBytes: 0, sampledAt: 0,
      active: new Map(), recent: [],
    };
    threads.set(threadId, created);
    return created;
  }

  function track(threadId: string, signal: AbortSignal): TrackAgentOperation {
    const pending: Map<number, () => void> = new Map();
    const abort = (): void => {
      pending.forEach((cancel: () => void): void => cancel());
      publish();
    };

    return async <T>(input: AgentOperationInput, run: () => Promise<T>): Promise<T> => {
      signal.throwIfAborted();
      const group: ThreadActivity = activityFor(threadId);
      const operation: AgentOperation = {
        ...input, id: ++nextId, status: "running",
        target: input.target?.replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ").slice(0, ACTIVITY_TARGET_CHARS),
      };
      function finish(status: AgentOperationStatus): boolean {
        if (!pending.delete(operation.id)) return false;
        if (!pending.size) signal.removeEventListener("abort", abort);
        group.active.delete(operation.id);
        group.recent = [{ ...operation, status }, ...group.recent].slice(0, RECENT_AGENT_OPERATIONS);
        return true;
      }

      if (!pending.size) signal.addEventListener("abort", abort, { once: true });
      pending.set(operation.id, (): void => { finish("cancelled"); });
      group.active.set(operation.id, operation);
      let outcome: AgentOperationStatus = "failed";
      try {
        publish();
        const result: T = await run();
        outcome = "finished";
        return result;
      } finally {
        if (finish(outcome)) publish();
      }
    };
  }

  function sample(group: ThreadActivity): void {
    const now: number = performance.now();
    const seconds: number = (now - group.sampledAt) / 1_000;
    const rate: number | undefined = group.sampleBytes
      ? Math.ceil(group.sampleBytes / BYTES_PER_ESTIMATED_TOKEN / seconds)
      : undefined;
    group.sampledAt = now;
    group.sampleBytes = 0;
    if (rate === group.counts.estimatedTokensPerSecond) return;
    group.counts.estimatedTokensPerSecond = rate;
    publish();
  }

  function observe(threadId: string, client: ModelClient): ModelClient {
    return {
      listModels: (signal?: AbortSignal): Promise<string[]> => client.listModels(signal),
      async *streamChat(input: ChatInput): AsyncIterable<string> {
        input.signal?.throwIfAborted();
        const group: ThreadActivity = activityFor(threadId);
        let phase: ModelStreamPhase | undefined = "requesting";
        group.counts.requesting++;
        delete group.counts.outcome;

        function advance(next: ModelStreamPhase): void {
          if (!phase || phase === next) return;
          group.counts[phase]--;
          group.counts[next]++;
          phase = next;
          publish();
        }

        function finish(outcome: ModelStreamOutcome): void {
          if (!phase) return;
          group.counts[phase]--;
          phase = undefined;
          if (!group.counts.streaming) {
            clearInterval(group.timer);
            group.timer = undefined;
            group.sampleBytes = 0;
            group.counts.estimatedTokensPerSecond = undefined;
          }
          if (!group.counts.requesting && !group.counts.accepted && !group.counts.streaming) {
            group.counts.outcome = outcome;
          }
          publish();
        }

        const stop = (): void => finish("stopped");
        let outcome: ModelStreamOutcome = "interrupted";
        input.signal?.addEventListener("abort", stop, { once: true });
        try {
          publish();
          for await (const chunk of client.streamChat({ ...input, onAccepted: (): void => {
            advance("accepted");
            input.onAccepted?.();
          } })) {
            if (phase && chunk) {
              if (!group.timer) {
                group.sampledAt = performance.now();
                group.timer = setInterval((): void => sample(group), MODEL_RATE_INTERVAL_MS);
                group.timer.unref();
              }
              group.sampleBytes += Buffer.byteLength(chunk, "utf8");
              advance("streaming");
            }
            yield chunk;
          }
          outcome = "ended";
        } finally {
          input.signal?.removeEventListener("abort", stop);
          finish(outcome);
        }
      },
    };
  }

  return {
    snapshot(threadIds: readonly string[]): Record<string, ModelActivity> {
      const known: Set<string> = new Set(threadIds);
      const snapshot: Record<string, ModelActivity> = Object.create(null) as Record<string, ModelActivity>;
      for (const [id, group] of threads) {
        if (known.has(id)) {
          const operations: AgentOperation[] = [...group.active.values(), ...group.recent];
          snapshot[id] = operations.length ? { ...group.counts, operations } : { ...group.counts };
        } else if (!group.active.size && !group.counts.requesting && !group.counts.accepted && !group.counts.streaming) {
          threads.delete(id);
        }
      }
      return snapshot;
    },
    clearOutcome(threadId: string): void {
      const group: ThreadActivity | undefined = threads.get(threadId);
      if (group && !group.active.size && !group.counts.requesting && !group.counts.accepted && !group.counts.streaming) threads.delete(threadId);
    },
    observe,
    track,
  };
}
