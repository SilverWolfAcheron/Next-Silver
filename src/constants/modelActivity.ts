import type { AgentToolKind } from "../types/modelActivity";

export const MODEL_RATE_INTERVAL_MS: number = 1_000;
export const BYTES_PER_ESTIMATED_TOKEN: number = 4;
export const RECENT_AGENT_OPERATIONS: number = 16;
export const ACTIVITY_TARGET_CHARS: number = 160;
export const AGENT_TOOL_KINDS: readonly AgentToolKind[] = [
  "project", "list", "read", "search", "symbol", "checks", "task_plan", "task_list", "task_update", "plugin_list", "plugin_call", "tool",
];
export const MODEL_STREAM_PHASES: readonly ["requesting", "accepted", "streaming"] = [
  "requesting", "accepted", "streaming",
];
