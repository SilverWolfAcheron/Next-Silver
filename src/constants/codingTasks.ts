export const CODING_TASK_LIMITS: Readonly<{ count: number; title: number; notes: number }> = {
  count: 8,
  title: 120,
  notes: 200,
};

export const CODING_TASK_ID_PATTERN: RegExp = /^[a-z][a-z0-9_-]{0,23}$/u;

export const CODING_TASK_ERRORS: Readonly<Record<string, string>> = {
  invalid: "任务参数无效。",
  limit: "任务数量达到上限。",
  duplicate: "任务 ID 重复。",
  dependency: "任务依赖不存在、重复或形成环路。",
  waiting: "请先完成该任务的依赖。",
  missing: "任务不存在。",
  transition: "不允许这个状态变更。",
  stale: "任务状态已变更，请重新读取 task_list。",
};
