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
  type ChatInput,
  type ModelClient,
  type ProviderConnection,
} from "./client";

interface CompletionChunk {
  choices?: {
    delta?: { content?: unknown };
    finish_reason?: string | null;
  }[];
}

export class OpenAIClient implements ModelClient {
  constructor(private readonly config: ProviderConnection) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const key = requireKey(this.config.key);
    const response = await request(endpoint(this.config.baseUrl, "v1", "models"), {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    });
    const page = await readModelPage<{ data?: { id?: unknown }[] }>(response, signal);
    if (!Array.isArray(page.data)) invalidModelList();
    return modelNames(page.data.map((model) => model?.id), key);
  }

  async *streamChat(input: ChatInput): AsyncIterable<string> {
    const key = requireKey(this.config.key);
    const model = requireModel(input.model);
    const response = await request(endpoint(this.config.baseUrl, "v1", "chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages: input.messages, stream: true }),
      signal: input.signal,
    });

    let finished = false;
    for await (const event of streamEvents(response, input.signal)) {
      if (event.data === "[DONE]") return;
      const chunk = readStreamEvent<CompletionChunk>(event);
      const choice = chunk.choices?.[0];
      const text = choice?.delta?.content;
      if (typeof text === "string" && text) yield text;
      if (choice?.finish_reason === "length") {
        throw new ProviderError("stream", "回复达到了模型的输出长度上限。");
      }
      if (choice?.finish_reason === "content_filter") {
        throw new ProviderError("stream", "供应商的内容过滤停止了这次回复。");
      }
      if (choice?.finish_reason) finished = true;
    }
    if (!finished) throw interruptedStream();
  }
}
