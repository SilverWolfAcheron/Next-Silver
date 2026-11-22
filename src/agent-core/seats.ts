import { isDiffPath } from "./diff.ts";
import { AppError, ERROR_CODES } from "./errors.ts";
import type { AgentSeat, Run } from "./types";

export const DEFAULT_DEVELOP_CONCURRENCY: number = 16;
export const MAX_AUDIT_CONCURRENCY: number = 4;
export const SCOPE_WAIT_NOTE: string = "范围与正在写的席位重叠";

interface SeatRef {
  runId: string;
  seatId: string;
}

export interface SeatSchedule {
  starts: SeatRef[];
  blockedByScope: SeatRef[];
}

export function normalizeDevelopConcurrency(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 9 && value <= 32
    ? value : DEFAULT_DEVELOP_CONCURRENCY;
}

function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export function scopeIncludesPath(scope: string[], path: string): boolean {
  return isDiffPath(path) && scope.includes(path);
}

export function validateDeveloperPlan(seats: AgentSeat[]): void {
  const seatById: Map<string, AgentSeat> = new Map(seats.map((seat: AgentSeat): [string, AgentSeat] => [seat.id, seat]));
  if (seatById.size !== seats.length) throw new AppError(ERROR_CODES.SEAT_DUPLICATE_ID);

  for (const seat of seats) {
    const paths: Set<string> = new Set(seat.scope.map(pathKey));
    if (seat.role !== "develop" || !seat.id.trim()) throw new AppError(ERROR_CODES.SEAT_INVALID_ROLE_OR_ID);
    if (!paths.size || paths.size !== seat.scope.length || seat.scope.some((path: string): boolean => !isDiffPath(path))) {
      throw new AppError(ERROR_CODES.SEAT_INVALID_SCOPE_PATH);
    }
    if (!seat.parentId) continue;
    const parent: AgentSeat | undefined = seatById.get(seat.parentId);
    if (parent?.role !== "develop") throw new AppError(ERROR_CODES.SEAT_PARENT_NOT_FOUND);
    if (parent.parentId) throw new AppError(ERROR_CODES.SEAT_MAX_DEPTH_EXCEEDED);
    if (seat.scope.some((path: string): boolean => !scopeIncludesPath(parent.scope, path))) {
      throw new AppError(ERROR_CODES.SEAT_SCOPE_EXCEEDS_PARENT);
    }
  }
}

function ended(seat: AgentSeat): boolean {
  return seat.status === "completed" || seat.status === "blocked";
}

export function scheduleSeats(runs: Run[], configured: unknown): SeatSchedule {
  const seats: { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }[] = runs.filter((run: Run): boolean => run.status === "in_progress").flatMap((run: Run): { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }[] => {
    const group: AgentSeat[] = run.seats ?? [];
    return group.map((seat: AgentSeat): { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; } => ({ runId: run.id, seatId: seat.id, seat, group }));
  });
  const running: { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }[] = seats.filter(({ seat }: { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }): boolean => seat.status === "in_progress");
  const developing: { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }[] = running.filter(({ seat }: { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }): boolean => seat.role === "develop");
  const locked: Set<string> = new Set(developing.flatMap(({ seat }: { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }): string[] => seat.scope.map(pathKey)));
  let developSlots: number = normalizeDevelopConcurrency(configured) - developing.length;
  let auditSlots: number = MAX_AUDIT_CONCURRENCY - running.filter(({ seat }: { runId: string; seatId: string; seat: AgentSeat; group: AgentSeat[]; }): boolean => seat.role === "audit").length;
  const starts: SeatRef[] = [];
  const blockedByScope: SeatRef[] = [];

  for (const { runId, seatId, seat, group } of seats) {
    if (seat.status !== "pending") continue;
    const ref: { runId: string; seatId: string; } = { runId, seatId };
    if (seat.role === "audit") {
      const developer: AgentSeat | undefined = group.find((candidate: AgentSeat): boolean => candidate.id === seat.auditFor && candidate.role === "develop");
      if (auditSlots <= 0 || !developer || !ended(developer) || !developer.findings.length) continue;
      auditSlots--;
      starts.push(ref);
      continue;
    }

    // A parent scope contains its children's paths. Finish the children before locking it.
    if (group.some((child: AgentSeat): boolean => child.parentId === seatId && !ended(child))) continue;
    const paths: string[] = seat.scope.map(pathKey);
    if (paths.some((path: string): boolean => locked.has(path))) {
      blockedByScope.push(ref);
      continue;
    }
    if (developSlots <= 0) continue;
    developSlots--;
    paths.forEach((path: string): Set<string> => locked.add(path));
    starts.push(ref);
  }
  return { starts, blockedByScope };
}

export function syncAuditSeats(seats: AgentSeat[], auditId?: (developer: AgentSeat) => string): AgentSeat[] {
  const audited: Set<string | undefined> = new Set(seats.filter((seat: AgentSeat): boolean => seat.role === "audit").map((seat: AgentSeat): string | undefined => seat.auditFor));
  const ids: Set<string> = new Set(seats.map((seat: AgentSeat): string => seat.id));
  const additions: AgentSeat[] = [];
  for (const developer of seats) {
    if (developer.role !== "develop" || !ended(developer) || !developer.findings.length || audited.has(developer.id)) continue;
    const base: string = auditId?.(developer) || `audit:${developer.id}`;
    let id: string = base;
    let suffix: number = 1;
    while (ids.has(id)) id = `${base}:${suffix++}`;
    ids.add(id);
    additions.push({
      id, role: "audit", auditFor: developer.id, title: `审计 · ${developer.title}`, status: "pending",
      scope: [...developer.scope], summary: "", findings: [], refutations: [], note: "",
    });
  }
  return additions.length ? [...seats, ...additions] : seats;
}

function normalizeEvidence(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function hasIndependentEvidence(reason: string, finding: string): boolean {
  const evidence: string = normalizeEvidence(reason);
  const claim: string = normalizeEvidence(finding);
  const boilerplate: RegExp = /^(?:原样重复|原样保留|反驳不成立|反驳成立|经核对|经确认|开发所述|独立证据|该发现|这条发现|保留|反驳|结论|理由|原因|依据|证据|因此|因为|所以|成立|所述|如下|确认|通过|属实|同上|确实|是的|refuted|retained|confirmed|verified|passed|accepted|rejected|evidence|reason|finding|true|false)*/u;
  if (!evidence || evidence === claim) return false;
  const substantive: string = claim ? evidence.replaceAll(claim, "") : evidence;
  return Array.from(substantive.replace(boilerplate, "")).length >= 3;
}

export function isValidAudit(audit: AgentSeat, developer: AgentSeat): boolean {
  const { verdicts, refutations }: AgentSeat = audit;
  const count: number = developer.findings.length;
  if (
    developer.role !== "develop" || audit.role !== "audit" || audit.status !== "completed" || audit.auditFor !== developer.id ||
    verdicts?.length !== count || refutations.length !== count ||
    new Set(refutations.map(normalizeEvidence)).size !== count
  ) return false;
  return developer.findings.every((finding: string, index: number): boolean =>
    (verdicts[index] === "refuted" || verdicts[index] === "retained") && hasIndependentEvidence(refutations[index], finding)
  );
}

function validAudits(seats: AgentSeat[], developers: AgentSeat[]): Map<string, AgentSeat> {
  const sources: Map<string, AgentSeat> = new Map(developers.map((seat: AgentSeat): [string, AgentSeat] => [seat.id, seat]));
  const audits: Map<string, AgentSeat> = new Map();
  const duplicates: Set<string> = new Set();
  for (const audit of seats) {
    if (audit.role !== "audit" || !audit.auditFor) continue;
    const developer: AgentSeat | undefined = sources.get(audit.auditFor);
    if (!developer || duplicates.has(developer.id) || !isValidAudit(audit, developer)) continue;
    if (audits.has(developer.id)) {
      audits.delete(developer.id);
      duplicates.add(developer.id);
    } else {
      audits.set(developer.id, audit);
    }
  }
  return audits;
}

export function settleSeats(seats: AgentSeat[]): "in_progress" | "completed" | "blocked" {
  const developers: AgentSeat[] = seats.filter((seat: AgentSeat): boolean => seat.role === "develop");
  if (developers.some((seat: AgentSeat): boolean => !ended(seat))) return "in_progress";
  if (seats.some((seat: AgentSeat): boolean => seat.status === "pending" || seat.status === "in_progress")) return "in_progress";
  const audits: Map<string, AgentSeat> = validAudits(seats, developers);
  if (developers.some((seat: AgentSeat): boolean => seat.findings.length > 0 && !audits.has(seat.id))) return "in_progress";
  return developers.some((seat: AgentSeat): boolean => seat.status === "blocked") ? "blocked" : "completed";
}

export function retainedFindings(seats: AgentSeat[]): string[] {
  const developers: AgentSeat[] = seats.filter((seat: AgentSeat): boolean => seat.role === "develop" && ended(seat));
  const audits: Map<string, AgentSeat> = validAudits(seats, developers);
  return developers.flatMap((seat: AgentSeat): string[] => {
    const verdicts: AgentSeat["verdicts"] = audits.get(seat.id)?.verdicts;
    return seat.findings.filter((_: string, index: number): boolean => verdicts?.[index] === "retained");
  });
}

export function pauseSeats(seats: AgentSeat[] | undefined, note: string = "已暂停", allUnfinished: boolean = false): AgentSeat[] {
  return (seats ?? []).map((seat: AgentSeat): AgentSeat =>
    seat.status === "in_progress" || (allUnfinished && seat.status !== "completed")
      ? { ...seat, status: "paused", note } : seat
  );
}

export function retrySeats(seats: AgentSeat[] | undefined): AgentSeat[] {
  const current: AgentSeat[] = seats ?? [];
  const retrying = (seat: AgentSeat): boolean => seat.status === "blocked" || seat.status === "paused";
  const developers: AgentSeat[] = current.filter((seat: AgentSeat): boolean => seat.role === "develop");
  const reset: Set<string> = new Set(developers.filter(retrying).map((seat: AgentSeat): string => seat.id));
  const audits: Map<string, AgentSeat> = validAudits(current, developers);
  const developerIds: Set<string> = new Set(developers.map((seat: AgentSeat): string => seat.id));
  const includedAudits: Set<string> = new Set();
  return syncAuditSeats(current.flatMap((seat: AgentSeat): AgentSeat[] => {
    if (seat.role === "audit") {
      const source: string | undefined = seat.auditFor;
      if (!source || !developerIds.has(source) || reset.has(source) || includedAudits.has(source)) return [];
      const valid: AgentSeat | undefined = audits.get(source);
      if (valid && valid !== seat) return [];
      includedAudits.add(source);
      if (valid || seat.status === "pending" || seat.status === "in_progress") return [seat];
      return [{ ...seat, status: "pending", summary: "", refutations: [], verdicts: undefined, note: "" }];
    }
    return retrying(seat)
      ? [{ ...seat, status: "pending", summary: "", findings: [], refutations: [], note: "", drafts: undefined }]
      : [seat];
  }));
}
