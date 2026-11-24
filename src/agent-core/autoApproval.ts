import type { Iteration, PendingConfirmation, Run, Thread } from "./types";

export function autoApprovalEnabled(thread: Thread): boolean {
  return Boolean(thread.autoApproval && thread.autoApproval.workspaceId === thread.workspace?.id);
}

export function canAutoApprove(thread: Thread, action: PendingConfirmation): boolean {
  if (!autoApprovalEnabled(thread)) return false;
  switch (action.kind) {
    case "brief":
      return Boolean(thread.brief?.intent.trim() && thread.brief.outcome.trim() && thread.brief.constraints.trim());
    case "run":
      return thread.runs.some((run: Run): boolean => run.id === action.runId && run.status === "pending");
    case "iteration": {
      const run: Run | undefined = thread.runs.find(({ id }: Run): boolean => id === action.runId);
      const round: Iteration | undefined = run?.iterations?.at(-1);
      if (run?.status !== "in_progress" || round?.id !== action.iterationId || round.approval !== action.phase) return false;
      return action.phase === "next" || (round.stage === "checks" && thread.workspace !== undefined &&
        round.checkAwaitingWorkspaceId === thread.workspace.id);
    }
    default:
      return false;
  }
}
