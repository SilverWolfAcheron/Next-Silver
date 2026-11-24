import { CODING_TASK_ERRORS as ERR, CODING_TASK_ID_PATTERN, CODING_TASK_LIMITS } from "../src/constants/codingTasks.ts";
import type { CodingTask, CodingTaskResult, CodingTasks, CodingTaskStatus } from "../src/types/codingTasks.ts";

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function readId(input: unknown): string | undefined {
  return typeof input === "string" && CODING_TASK_ID_PATTERN.test(input) ? input : undefined;
}

function readText(input: unknown, max: number): string | undefined {
  if (typeof input !== "string" || input.length > max) return;
  return input.trim();
}

function readTask(input: unknown): CodingTask | undefined {
  if (!isRecord(input)) return;
  const id: string | undefined = readId(input.id);
  const title: string | undefined = readText(input.title, CODING_TASK_LIMITS.title);
  if (!id || !title) return;
  const dependsOn: string[] = [];
  if (input.dependsOn !== undefined) {
    if (!Array.isArray(input.dependsOn) || input.dependsOn.length > CODING_TASK_LIMITS.count) return;
    for (const entry of input.dependsOn) {
      const dependency: string | undefined = readId(entry);
      if (!dependency || dependsOn.includes(dependency)) return;
      dependsOn.push(dependency);
    }
  }
  return { id, title, dependsOn, status: "pending" };
}

function dependenciesValid(tasks: ReadonlyMap<string, CodingTask>): boolean {
  const visited: Set<string> = new Set();
  const visiting: Set<string> = new Set();
  function visit(id: string): boolean {
    const task: CodingTask | undefined = tasks.get(id);
    if (!task || visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    if (!task.dependsOn.every(visit)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  for (const id of tasks.keys()) if (!visit(id)) return false;
  return true;
}

function isStatus(value: unknown): value is CodingTaskStatus {
  return value === "pending" || value === "in_progress" || value === "blocked" || value === "completed";
}

function canTransition(from: CodingTaskStatus, to: CodingTaskStatus): boolean {
  if (from === to) return true;
  if (from === "completed") return false;
  if (to === "completed") return from === "in_progress";
  return true;
}

export function createCodingTasks(): CodingTasks {
  let tasks: Map<string, CodingTask> = new Map();
  let revision: number = 0;

  function snapshot(): CodingTaskResult {
    return {
      tasks: [...tasks.values()].map((task: CodingTask): CodingTask => ({ ...task, dependsOn: [...task.dependsOn] })),
      revision,
    };
  }

  function plan(input: unknown): CodingTaskResult {
    if (!Array.isArray(input) || input.length === 0) return { error: ERR.invalid };
    if (tasks.size + input.length > CODING_TASK_LIMITS.count) return { error: ERR.limit };
    const proposed: Map<string, CodingTask> = new Map(tasks);
    for (const entry of input) {
      const task: CodingTask | undefined = readTask(entry);
      if (!task) return { error: ERR.invalid };
      if (proposed.has(task.id)) return { error: ERR.duplicate };
      proposed.set(task.id, task);
    }
    if (!dependenciesValid(proposed)) return { error: ERR.dependency };
    tasks = proposed;
    revision++;
    return snapshot();
  }

  function update(fields: Record<string, unknown>): CodingTaskResult {
    const id: string | undefined = readId(fields.id);
    if (!id || (fields.status === undefined && fields.notes === undefined)) return { error: ERR.invalid };
    const task: CodingTask | undefined = tasks.get(id);
    if (!task) return { error: ERR.missing };
    const next: unknown = fields.status ?? task.status;
    if (fields.status === null || !isStatus(next)) return { error: ERR.invalid };
    if (!canTransition(task.status, next)) return { error: ERR.transition };
    if ((next === "in_progress" || next === "completed") &&
      !task.dependsOn.every((dependency: string): boolean => tasks.get(dependency)?.status === "completed")) {
      return { error: ERR.waiting };
    }
    const notes: string | undefined = fields.notes === undefined
      ? task.notes : readText(fields.notes, CODING_TASK_LIMITS.notes);
    if (fields.notes !== undefined && notes === undefined) return { error: ERR.invalid };
    if (next !== task.status || notes !== task.notes) {
      tasks.set(id, { ...task, status: next, notes });
      revision++;
    }
    return snapshot();
  }

  return {
    get revision(): number { return revision; },
    dispatch(fields: Record<string, unknown>): CodingTaskResult | undefined {
      const { name, revision: expected }: Record<string, unknown> = fields;
      if (name === "task_list") return snapshot();
      if (name !== "task_plan" && name !== "task_update") return;
      if (expected !== undefined && expected !== revision) return { error: ERR.stale };
      return name === "task_plan" ? plan(fields.tasks) : update(fields);
    },
  };
}
