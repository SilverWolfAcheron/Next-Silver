import type { Protocol } from "../model/types";
import { providerAddress, type ModelClient } from "./client";
import { OpenAIClient } from "./openai";
import { AnthropicClient } from "./anthropic";
import { GeminiClient } from "./gemini";

export interface ProviderConfig {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl?: string;
  key: string;
  hasKey?: boolean;
  model: string;
}

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  openai: "OpenAI Chat Completions",
  anthropic: "Anthropic Messages",
  gemini: "Gemini",
};

export const PROTOCOL_ADDRESSES: Record<Protocol, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
};

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "newapi",
    label: "New API",
    protocol: "openai",
    baseUrl: "",
    key: "",
    model: "gpt-4o",
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: PROTOCOL_ADDRESSES.openai,
    key: "",
    model: "gpt-4o",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    key: "",
    model: "",
  },
  {
    id: "gemini",
    label: "Gemini",
    protocol: "gemini",
    key: "",
    model: "",
  },
  {
    id: "custom",
    label: "自定义兼容",
    protocol: "openai",
    baseUrl: "",
    key: "",
    model: "",
  },
];

export function requiresProviderAddress(config: ProviderConfig): boolean {
  return config.id === "newapi" || config.id === "custom";
}

function getAddress(config: ProviderConfig): URL {
  return providerAddress(
    requiresProviderAddress(config)
      ? config.baseUrl
      : config.baseUrl?.trim() || PROTOCOL_ADDRESSES[config.protocol],
  );
}

export function isConfiguredProvider(config: ProviderConfig): boolean {
  if ((!config.key.trim() && !config.hasKey) || !config.model.trim()) return false;
  try {
    getAddress(config);
    return true;
  } catch {
    return false;
  }
}

export function makeClient(config: ProviderConfig): ModelClient {
  const connection = { baseUrl: getAddress(config), key: config.key };
  switch (config.protocol) {
    case "openai":
      return new OpenAIClient(connection);
    case "anthropic":
      return new AnthropicClient(connection);
    case "gemini":
      return new GeminiClient(connection);
  }
}
