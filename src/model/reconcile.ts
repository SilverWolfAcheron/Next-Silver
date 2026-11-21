import type { Brief, Run } from "./types";
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
export function reconcile(
  before: Brief | null,
  after: Brief | null,
  runs: Run[],
  domain?: DomainPack
): Run[] {
  if (!after) return runs;
  if (!before) return runs;

  const changedReqIds = new Set<string>();

  const beforeReqs = new Map(before.requirements.map((r) => [r.id, r.text]));
  for (const r of after.requirements) {
    const prev = beforeReqs.get(r.id);
    if (prev === undefined || prev !== r.text) {
      changedReqIds.add(r.id);
    }
  }
  for (const id of before.requirements.map((r) => r.id)) {
    if (!after.requirements.some((r) => r.id === id)) {
      changedReqIds.add(id);
    }
  }

  if (domain) {
    for (const field of domain.fields) {
      const prevVal = before.domainFields?.[field.key] ?? "";
      const afterVal = after.domainFields?.[field.key] ?? "";
      if (prevVal !== afterVal && field.requirementBinding) {
        changedReqIds.add(field.requirementBinding);
      }
    }
  }

  if (changedReqIds.size === 0) return runs;

  return runs.map((run) => {
    if (run.status === "completed") return run;
    const depends = run.dependsOn.some((id) => changedReqIds.has(id));
    if (depends) {
      return { ...run, status: "paused", seats: pauseSeats(run.seats, "简报已修订", true),
        iterations: pauseIterations(run.iterations, "简报已修订") };
    }
    return run;
  });
}
