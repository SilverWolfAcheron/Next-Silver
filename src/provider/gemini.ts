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

interface ModelPage {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
  nextPageToken?: string;
}

interface GenerateChunk {
  candidates?: {
    content?: { parts?: { text?: unknown; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

export class GeminiClient implements ModelClient {
  constructor(private readonly config: ProviderConnection) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const key = requireKey(this.config.key);
    const url = endpoint(this.config.baseUrl, "v1beta", "models");
    const models: unknown[] = [];
    const pageTokens = new Set<string>();

    while (true) {
      const response = await request(url, { headers: { "x-goog-api-key": key }, signal });
      const page = await readModelPage<ModelPage>(response, signal);
      if (page.models !== undefined && !Array.isArray(page.models)) invalidModelList();
      for (const model of page.models ?? []) {
        if (typeof model?.name !== "string") continue;
        const methods = model.supportedGenerationMethods;
        if (Array.isArray(methods) && !methods.includes("generateContent")) continue;
        models.push(model.name.replace(/^models\//, ""));
      }
      if (!page.nextPageToken) return modelNames(models, key);
      if (typeof page.nextPageToken !== "string" || pageTokens.has(page.nextPageToken)) {
        invalidModelList();
      }
      pageTokens.add(page.nextPageToken);
      url.searchParams.set("pageToken", page.nextPageToken);
    }
  }

  async *streamChat(input: ChatInput): AsyncIterable<string> {
    const key = requireKey(this.config.key);
    const model = requireModel(requireModel(input.model).replace(/^models\//, ""));
    const contents = input.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    const system = input.messages.filter((message) => message.role === "system")
      .map((message) => message.content).join("\n\n");
    const url = endpoint(this.config.baseUrl, "v1beta", `models/${encodeURIComponent(model)}:streamGenerateContent`);
    url.searchParams.set("alt", "sse");
    const response = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents,
        generationConfig: { maxOutputTokens: 4096 },
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      }),
      signal: input.signal,
    });

    let finished = false;
    for await (const event of streamEvents(response, input.signal)) {
      const chunk = readStreamEvent<GenerateChunk>(event);
      if (chunk.promptFeedback?.blockReason && chunk.promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") {
        throw new ProviderError("stream", "供应商拦截了这次请求。");
      }
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (!part?.thought && typeof part?.text === "string" && part.text) yield part.text;
        }
      }
      const reason = candidate?.finishReason;
      if (reason === "STOP") finished = true;
      else if (reason === "MAX_TOKENS") {
        throw new ProviderError("stream", "回复达到了模型的输出长度上限。");
      } else if (reason && reason !== "FINISH_REASON_UNSPECIFIED") {
        throw new ProviderError("stream", "供应商停止了这次回复。");
      }
    }
    if (!finished) throw interruptedStream();
  }
}
