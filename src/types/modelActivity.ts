export type ModelStreamPhase = "requesting" | "accepted" | "streaming";
export type ModelStreamOutcome = "ended" | "stopped" | "interrupted";

export type ModelActivity = Record<ModelStreamPhase, number> & {
  estimatedTokensPerSecond?: number;
  outcome?: ModelStreamOutcome;
};
