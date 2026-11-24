export type CodingTaskStatus = "pending" | "in_progress" | "blocked" | "completed";

export interface CodingTask {
  id: string;
  title: string;
  dependsOn: string[];
  status: CodingTaskStatus;
  notes?: string;
}

export type CodingTaskResult = { tasks: CodingTask[]; revision: number } | { error: string };

export interface CodingTasks {
  readonly revision: number;
  dispatch(fields: Record<string, unknown>): CodingTaskResult | undefined;
}
