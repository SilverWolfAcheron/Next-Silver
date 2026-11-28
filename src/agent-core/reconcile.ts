import type { Brief, Requirement, Run } from "./types";
import type { DomainPack } from "./domains/pcb";
import { pauseSeats } from "./seats";
import { pauseIterations } from "./iterate";

/**
 * Reconcile runs against a changed brief.
 *
 * Rules (written in the client, not the model):
 * - A requirement that was deleted, or whose text changed, pauses every
 *   non-completed run that depends on it.
 * - Completed runs stay completed.
 * - A domain field change is treated as a change to the requirement it binds
 *   to. Binding lives in the domain pack data (e.g. PCB stackup -> R1).
 */
interface ReconcileOptions {
  before: Brief | null;
  after: Brief | null;
  runs: Run[];
  domain?: DomainPack;
}

export function reconcile(options: ReconcileOptions): Run[] {
  const { before, after, runs, domain }: ReconcileOptions = options;
  if (!after) return runs;
  if (!before) return runs;

  const changedReqIds: Set<string> = new Set();

  const beforeReqs: Map<string, string> = new Map(before.requirements.map((r: Requirement): [string, string] => [r.id, r.text]));
  for (const r of after.requirements) {
    const prev: string | undefined = beforeReqs.get(r.id);
    if (prev === undefined || prev !== r.text) {
      changedReqIds.add(r.id);
    }
  }
  for (const id of before.requirements.map((r: Requirement): string => r.id)) {
    if (!after.requirements.some((r: Requirement): boolean => r.id === id)) {
      changedReqIds.add(id);
    }
  }

  if (domain) {
    for (const field of domain.fields) {
      const prevVal: string = before.domainFields?.[field.key] ?? "";
      const afterVal: string = after.domainFields?.[field.key] ?? "";
      if (prevVal !== afterVal && field.requirementBinding) {
        changedReqIds.add(field.requirementBinding);
      }
    }
  }

  if (changedReqIds.size === 0) return runs;

  return runs.map((run: Run): Run => {
    if (run.status === "completed") return run;
    const depends: boolean = run.dependsOn.some((id: string): boolean => changedReqIds.has(id));
    if (depends) {
      return { ...run, status: "paused", seats: pauseSeats(run.seats, "简报已修订", true),
        iterations: pauseIterations(run.iterations, "简报已修订") };
    }
    return run;
  });
}
