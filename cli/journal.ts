import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelClient } from "../src/provider/client";
import { ProviderError } from "../src/provider/client";
import { writePrivateJson } from "./host";

export interface RequestJournal {
  model(operation: string, underlying: ModelClient, live?: boolean): ModelClient;
  clear(operation: string): void;
}

export function createRequestJournal(dataDir: string): RequestJournal {
  const folder = (operation: string) => join(dataDir, "requests",
    createHash("sha256").update(operation).digest("hex"));

  return {
    model(operation, underlying, live = false) {
      let sequence = 0;
      return {
        listModels: (signal) => underlying.listModels(signal),
        async *streamChat(input) {
          input.signal?.throwIfAborted();
          const file = join(folder(operation), `${sequence++}.json`);
          if (existsSync(file)) {
            const completed = JSON.parse(readFileSync(file, "utf8")) as { text: string };
            if (completed.text) yield completed.text;
            return;
          }

          for (let attempt = 0; ; attempt++) {
            input.signal?.throwIfAborted();
            let text = "";
            try {
              for await (const chunk of underlying.streamChat(input)) {
                text += chunk;
                if (live) yield chunk;
              }
              input.signal?.throwIfAborted();
              writePrivateJson(file, { text });
              if (!live && text) yield text;
              return;
            } catch (error) {
              input.signal?.throwIfAborted();
              if (live || !(error instanceof ProviderError) ||
                !(error.kind === "stream" || error.kind === "network" || error.status === 429 ||
                  (error.status !== undefined && error.status >= 500))) throw error;
              await delay(Math.min(30_000, 2_000 * (attempt + 1)), undefined,
                { signal: input.signal });
            }
          }
        },
      };
    },
    clear(operation) {
      const directory = folder(operation);
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory)) {
        if (/^\d+\.json$/u.test(entry)) unlinkSync(join(directory, entry));
      }
      try { rmdirSync(directory); } catch { /* A leftover temporary file does not affect playback. */ }
    },
  };
}
