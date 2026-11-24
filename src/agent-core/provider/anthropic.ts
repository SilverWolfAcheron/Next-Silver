import { ERROR_CODES } from "../errors";
import {
  endpoint,
  interruptedStream,
  invalidModelList,
  modelNames,
  ProviderError,
  readModelPage,
  readStreamEvent,
  request,
  requireKey,
  requireModel,
  streamEvents,
} from "./client";
import type { ChatInput, ModelClient, ProviderConnection } from "./client";

interface ModelPage {
  data?: { id?: unknown }[];
  has_more?: boolean;
  last_id?: string;
}

interface MessageEvent {
  type?: string;
  content_block?: { type?: string; text?: unknown };
  delta?: { type?: string; text?: unknown; stop_reason?: string };
}

function headers(key: string): Record<string, string> {
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

export class AnthropicClient implements ModelClient {
  constructor(private readonly config: ProviderConnection) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const key: string = requireKey(this.config.key);
    const url: URL = endpoint(this.config.baseUrl, "v1", "models");
    const models: unknown[] = [];
    const cursors: Set<string> = new Set();

    while (true) {
      const response: Response = await request(url, { headers: headers(key), signal });
      const page: ModelPage = await readModelPage<ModelPage>(response, signal);
      if (!Array.isArray(page.data)) invalidModelList();
      for (const model of page.data) models.push(model?.id);
      if (!page.has_more) return modelNames(models, key);
      if (typeof page.last_id !== "string" || !page.last_id || cursors.has(page.last_id)) {
        invalidModelList();
      }
      cursors.add(page.last_id);
      url.searchParams.set("after_id", page.last_id);
    }
  }

  async *streamChat(input: ChatInput): AsyncIterable<string> {
    const key: string = requireKey(this.config.key);
    const model: string = requireModel(input.model);
    const system: string = input.messages.filter((message: { role: "user" | "assistant" | "system"; content: string; }): boolean => message.role === "system")
      .map((message: { role: "user" | "assistant" | "system"; content: string; }): string => message.content).join("\n\n");
    const messages: { role: "user" | "assistant" | "system"; content: string; }[] = input.messages.filter((message: { role: "user" | "assistant" | "system"; content: string; }): boolean => message.role !== "system");
    const response: Response = await request(endpoint(this.config.baseUrl, "v1", "messages"), {
      method: "POST",
      headers: {
        ...headers(key),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ model, max_tokens: 4096, stream: true, system: system || undefined, messages }),
      signal: input.signal,
    });

    for await (const event of streamEvents(response, input.signal, input.onAccepted)) {
      const chunk: MessageEvent = readStreamEvent<MessageEvent>(event);
      const type: string = chunk.type ?? event.type;
      if (type === "message_stop") return;
      if (type === "message_delta" && chunk.delta?.stop_reason === "max_tokens") {
        throw new ProviderError("stream", ERROR_CODES.API_MAX_TOKENS);
      }
      if (type === "message_delta" && chunk.delta?.stop_reason === "refusal") {
        throw new ProviderError("stream", ERROR_CODES.API_REFUSED);
      }
      const block: MessageEvent["content_block"] | MessageEvent["delta"] =
        type === "content_block_start" ? chunk.content_block : chunk.delta;
      if (
        (type === "content_block_start" && block?.type === "text") ||
        (type === "content_block_delta" && block?.type === "text_delta")
      ) {
        if (typeof block.text === "string" && block.text) yield block.text;
      }
    }
    throw interruptedStream();
  }
}
