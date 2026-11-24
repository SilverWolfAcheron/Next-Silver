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

interface OpenAIModelItem {
  id?: unknown;
}

interface OpenAIModelPage {
  data?: OpenAIModelItem[];
}

interface CompletionChoice {
  delta?: { content?: unknown };
  finish_reason?: string | null;
}

interface CompletionChunk {
  choices?: CompletionChoice[];
}

export class OpenAIClient implements ModelClient {
  constructor(private readonly config: ProviderConnection) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const key: string = requireKey(this.config.key);
    const response: Response = await request(endpoint(this.config.baseUrl, "v1", "models"), {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    });
    const page: OpenAIModelPage = await readModelPage<OpenAIModelPage>(response, signal);
    if (!Array.isArray(page.data)) invalidModelList();
    return modelNames(page.data.map((model: OpenAIModelItem): unknown => model?.id), key);
  }

  async *streamChat(input: ChatInput): AsyncIterable<string> {
    const key: string = requireKey(this.config.key);
    const model: string = requireModel(input.model);
    const response: Response = await request(endpoint(this.config.baseUrl, "v1", "chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages: input.messages, stream: true }),
      signal: input.signal,
    });

    let finished: boolean = false;
    for await (const event of streamEvents(response, input.signal, input.onAccepted)) {
      if (event.data === "[DONE]") return;
      const chunk: CompletionChunk = readStreamEvent<CompletionChunk>(event);
      const choice: CompletionChoice | undefined = chunk.choices?.[0];
      const text: unknown = choice?.delta?.content;
      if (typeof text === "string" && text) yield text;
      if (choice?.finish_reason === "length") {
        throw new ProviderError("stream", ERROR_CODES.API_MAX_TOKENS);
      }
      if (choice?.finish_reason === "content_filter") {
        throw new ProviderError("stream", ERROR_CODES.API_CONTENT_FILTERED);
      }
      if (choice?.finish_reason) finished = true;
    }
    if (!finished) throw interruptedStream();
  }
}
