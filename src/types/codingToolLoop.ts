import type { ModelMessage } from "../agent-core/session";

export type CodingToolArgument = null | boolean | number | string | CodingToolArgument[] | CodingToolFields;

export interface CodingToolFields {
  [key: string]: CodingToolArgument;
}

export interface CodingToolRequest extends CodingToolFields {
  name: string;
}

export interface CodingToolLimits {
  batchSize: number;
  roundCount: number;
  requestCount: number;
  stalledRounds: number;
  requestChars: number;
  resultChars: number;
  transcriptChars: number;
}

export type CodingToolStop = "rounds" | "requests" | "stalled";

export type CodingToolStep =
  | { status: "executed"; count: number; skipped: number }
  | { status: "rejected"; count: 0; skipped: number }
  | { status: "finalize"; count: number; skipped: number; reason: CodingToolStop };

export interface CodingToolLoopOptions {
  signal: AbortSignal;
  execute: (tools: unknown[], signal: AbortSignal) => Promise<ModelMessage>;
  limits?: Partial<CodingToolLimits>;
  limitError?: () => Error;
}

export interface CodingToolLoop {
  accept(tools: unknown): Promise<CodingToolStep>;
  messages(base: readonly ModelMessage[]): ModelMessage[];
  reads(): string[];
  readonly stopReason: CodingToolStop | undefined;
}

export interface CodingToolBatch {
  tools: CodingToolRequest[];
  invalid: number;
}

export interface CodingToolTurn {
  request: ModelMessage;
  response: ModelMessage;
  size: number;
}
