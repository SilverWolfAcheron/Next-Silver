import type { Protocol } from "../agent-core/types";

export const PROTOCOL_OPTIONS: readonly Protocol[] = ["openai", "anthropic", "gemini"];

export const CONCURRENCY_BOUNDS: { readonly min: number; readonly max: number; readonly defaultValue: number } = {
  min: 9,
  max: 32,
  defaultValue: 16,
};
