import type { ChatInput, ModelClient } from "../src/agent-core/provider/client";
import { BYTES_PER_ESTIMATED_TOKEN, MODEL_RATE_INTERVAL_MS } from "../src/constants/modelActivity";
import type { ModelActivity, ModelStreamOutcome, ModelStreamPhase } from "../src/types/modelActivity";

interface ThreadActivity {
  counts: ModelActivity;
  sampleBytes: number;
  sampledAt: number;
  timer?: ReturnType<typeof setInterval>;
}

export function createModelActivity(publish: () => void): {
  snapshot: (threadIds: readonly string[]) => Record<string, ModelActivity>;
  observe: (threadId: string, client: ModelClient) => ModelClient;
  clearOutcome: (threadId: string) => void;
} {
  const threads: Map<string, ThreadActivity> = new Map();

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
        const group: ThreadActivity = threads.get(threadId) ?? {
          counts: { requesting: 0, accepted: 0, streaming: 0 }, sampleBytes: 0, sampledAt: 0,
        };
        let phase: ModelStreamPhase | undefined = "requesting";
        group.counts.requesting++;
        delete group.counts.outcome;
        threads.set(threadId, group);

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
        if (known.has(id)) snapshot[id] = { ...group.counts };
        else if (group.counts.outcome) threads.delete(id);
      }
      return snapshot;
    },
    clearOutcome(threadId: string): void {
      if (threads.get(threadId)?.counts.outcome) threads.delete(threadId);
    },
    observe,
  };
}
