export type ModelStreamPhase = "requesting" | "accepted" | "streaming";
export type ModelStreamOutcome = "ended" | "stopped" | "interrupted";

export type AgentToolKind = "project" | "list" | "read" | "search" | "symbol" | "checks"
  | "task_plan" | "task_list" | "task_update" | "plugin_list" | "plugin_call" | "tool";

export type AgentOperationKind = AgentToolKind | "brief" | "plan" | "classify" | "produce"
  | "developSeat" | "auditSeat" | "preflight" | "apply" | "check" | "judge";

export type AgentOperationStatus = "running" | "finished" | "failed" | "cancelled";

export interface AgentOperationInput {
  kind: AgentOperationKind;
  target?: string;
}

export interface AgentOperation extends AgentOperationInput {
  id: number;
  status: AgentOperationStatus;
}

export type TrackAgentOperation = <T>(operation: AgentOperationInput, run: () => Promise<T>) => Promise<T>;

export type ModelActivity = Record<ModelStreamPhase, number> & {
  estimatedTokensPerSecond?: number;
  outcome?: ModelStreamOutcome;
  operations?: AgentOperation[];
};
