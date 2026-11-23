import type { CodingToolLimits, CodingToolStop } from "../types/codingToolLoop";

export const CODING_TOOL_LIMITS: CodingToolLimits = {
  batchSize: 4,
  roundCount: 16,
  requestCount: 40,
  stalledRounds: 3,
  requestChars: 2_048,
  resultChars: 32_000,
  transcriptChars: 96_000,
};

export const CODING_TOOL_MAX_FIELDS: number = 16;
export const CODING_TOOL_MAX_ARGUMENT_DEPTH: number = 4;
export const CODING_TOOL_MAX_LABEL: number = 180;
export const CODING_TOOL_MAX_TRACE: number = 24;

export const CODING_TOOL_STOP_TEXT: Record<CodingToolStop, string> = {
  rounds: "工具轮次已用完",
  requests: "本次读取次数已用完",
  stalled: "连续请求未获取新的可用证据",
};

export const CODING_TOOL_CONTINUE: string =
  "请根据已有证据给出当前任务要求的最终 JSON。不要再返回 tools；缺少关键证据时请具体说明，不能声称已验证。";

export const CODING_TOOL_OMISSION: string =
  "较早的工作区工具往返已从当前模型上下文省略。不要假定省略的证据仍可见。";

export const CODING_TOOL_TRUNCATION: string =
  "\n[工具结果已截断，只能引用可见部分]";
