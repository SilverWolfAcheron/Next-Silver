import type { ModelOption } from "../types/composer";

export const MOCK_MODELS: readonly ModelOption[] = [
  { providerId: "anthropic", providerLabel: "Anthropic", model: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", tag: "推荐" },
  { providerId: "anthropic", providerLabel: "Anthropic", model: "claude-opus-4-6", displayName: "Claude Opus 4.6", tag: "深度推理" },
  { providerId: "openai", providerLabel: "OpenAI", model: "gpt-5.2", displayName: "GPT-5.2", tag: "通用" },
  { providerId: "openai", providerLabel: "OpenAI", model: "o3-mini", displayName: "o3-mini", tag: "快推" },
  { providerId: "gemini", providerLabel: "Gemini", model: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", tag: "长上下文" },
  { providerId: "gemini", providerLabel: "Gemini", model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", tag: "极速" },
];
