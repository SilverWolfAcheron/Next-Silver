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
    const key: string = requireKey(this.config.key);
    const url: URL = endpoint(this.config.baseUrl, "v1beta", "models");
    const models: unknown[] = [];
    const pageTokens: Set<string> = new Set();

    while (true) {
      const response: Response = await request(url, { headers: { "x-goog-api-key": key }, signal });
      const page: ModelPage = await readModelPage<ModelPage>(response, signal);
      if (page.models !== undefined && !Array.isArray(page.models)) invalidModelList();
      for (const model of page.models ?? []) {
        if (typeof model?.name !== "string") continue;
        const methods: string[] | undefined = model.supportedGenerationMethods;
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
    const key: string = requireKey(this.config.key);
    const model: string = requireModel(requireModel(input.model).replace(/^models\//, ""));
    const contents: { role: string; parts: { text: string; }[]; }[] = input.messages
      .filter((message: { role: "user" | "assistant" | "system"; content: string; }): boolean => message.role !== "system")
      .map((message: { role: "user" | "assistant" | "system"; content: string; }): { role: string; parts: { text: string; }[]; } => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    const system: string = input.messages.filter((message: { role: "user" | "assistant" | "system"; content: string; }): boolean => message.role === "system")
      .map((message: { role: "user" | "assistant" | "system"; content: string; }): string => message.content).join("\n\n");
    const url: URL = endpoint(this.config.baseUrl, "v1beta", `models/${encodeURIComponent(model)}:streamGenerateContent`);
    url.searchParams.set("alt", "sse");
    const response: Response = await request(url, {
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

    let finished: boolean = false;
    for await (const event of streamEvents(response, input.signal)) {
      const chunk: GenerateChunk = readStreamEvent<GenerateChunk>(event);
      if (chunk.promptFeedback?.blockReason && chunk.promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") {
        throw new ProviderError("stream", ERROR_CODES.API_CONTENT_FILTERED);
      }
      const candidate: NonNullable<GenerateChunk["candidates"]>[number] | undefined = chunk.candidates?.[0];
      const parts: NonNullable<NonNullable<NonNullable<GenerateChunk["candidates"]>[number]["content"]>["parts"]> | undefined =
        candidate?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (!part?.thought && typeof part?.text === "string" && part.text) yield part.text;
        }
      }
      const reason: string | undefined = candidate?.finishReason;
      if (reason === "STOP") finished = true;
      else if (reason === "MAX_TOKENS") {
        throw new ProviderError("stream", ERROR_CODES.API_MAX_TOKENS);
      } else if (reason && reason !== "FINISH_REASON_UNSPECIFIED") {
        throw new ProviderError("stream", ERROR_CODES.API_STOPPED);
      }
    }
    if (!finished) throw interruptedStream();
  }
}
