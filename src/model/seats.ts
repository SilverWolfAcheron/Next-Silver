import { isDiffPath } from "./diff.ts";
import type { AgentSeat, Run } from "./types";

export const DEFAULT_DEVELOP_CONCURRENCY = 16;
export const MAX_AUDIT_CONCURRENCY = 4;
export const SCOPE_WAIT_NOTE = "范围与正在写的席位重叠";

interface SeatRef {
  runId: string;
  seatId: string;
}

interface SeatSchedule {
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
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  if (seatById.size !== seats.length) throw new Error("开发席位编号重复。");

  for (const seat of seats) {
    const paths = new Set(seat.scope.map(pathKey));
    if (seat.role !== "develop" || !seat.id.trim()) throw new Error("开发席位的角色或编号无效。");
    if (!paths.size || paths.size !== seat.scope.length || seat.scope.some((path) => !isDiffPath(path))) {
      throw new Error("开发席位必须使用明确且不重复的工作区相对文件路径。");
    }
    if (!seat.parentId) continue;
    const parent = seatById.get(seat.parentId);
    if (!parent || parent.role !== "develop") throw new Error("子席位的父开发席位不存在。");
    if (parent.parentId) throw new Error("开发席位最多两层。");
    if (seat.scope.some((path) => !scopeIncludesPath(parent.scope, path))) {
      throw new Error("子席位的范围超出父席位。");
    }
  }
}

function ended(seat: AgentSeat): boolean {
  return seat.status === "completed" || seat.status === "blocked";
}

export function scheduleSeats(runs: Run[], configured: unknown): SeatSchedule {
  const seats = runs.filter((run) => run.status === "in_progress").flatMap((run) => {
    const group = run.seats ?? [];
    return group.map((seat) => ({ runId: run.id, seatId: seat.id, seat, group }));
  });
  const running = seats.filter(({ seat }) => seat.status === "in_progress");
  const developing = running.filter(({ seat }) => seat.role === "develop");
  const locked = new Set(developing.flatMap(({ seat }) => seat.scope.map(pathKey)));
  let developSlots = normalizeDevelopConcurrency(configured) - developing.length;
  let auditSlots = MAX_AUDIT_CONCURRENCY - running.filter(({ seat }) => seat.role === "audit").length;
  const starts: SeatRef[] = [];
  const blockedByScope: SeatRef[] = [];

  for (const { runId, seatId, seat, group } of seats) {
    if (seat.status !== "pending") continue;
    const ref = { runId, seatId };
    if (seat.role === "audit") {
      const developer = group.find((candidate) => candidate.id === seat.auditFor && candidate.role === "develop");
      if (auditSlots <= 0 || !developer || !ended(developer) || !developer.findings.length) continue;
      auditSlots--;
      starts.push(ref);
      continue;
    }

    // A parent scope contains its children's paths. Finish the children before locking it.
    if (group.some((child) => child.parentId === seatId && !ended(child))) continue;
    const paths = seat.scope.map(pathKey);
    if (paths.some((path) => locked.has(path))) {
      blockedByScope.push(ref);
      continue;
    }
    if (developSlots <= 0) continue;
    developSlots--;
    paths.forEach((path) => locked.add(path));
    starts.push(ref);
  }
  return { starts, blockedByScope };
}

export function syncAuditSeats(seats: AgentSeat[], auditId?: (developer: AgentSeat) => string): AgentSeat[] {
  const audited = new Set(seats.filter((seat) => seat.role === "audit").map((seat) => seat.auditFor));
  const ids = new Set(seats.map((seat) => seat.id));
  const additions: AgentSeat[] = [];
  for (const developer of seats) {
    if (developer.role !== "develop" || !ended(developer) || !developer.findings.length || audited.has(developer.id)) continue;
    const base = auditId?.(developer) || `audit:${developer.id}`;
    let id = base;
    let suffix = 1;
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
  const evidence = normalizeEvidence(reason);
  const claim = normalizeEvidence(finding);
  const boilerplate = /^(?:原样重复|原样保留|反驳不成立|反驳成立|经核对|经确认|开发所述|独立证据|该发现|这条发现|保留|反驳|结论|理由|原因|依据|证据|因此|因为|所以|成立|所述|如下|确认|通过|属实|同上|确实|是的|refuted|retained|confirmed|verified|passed|accepted|rejected|evidence|reason|finding|true|false)*/u;
  if (!evidence || evidence === claim) return false;
  const substantive = claim ? evidence.replaceAll(claim, "") : evidence;
  return Array.from(substantive.replace(boilerplate, "")).length >= 3;
}

export function isValidAudit(audit: AgentSeat, developer: AgentSeat): boolean {
  const { verdicts, refutations } = audit;
  const count = developer.findings.length;
  if (
    developer.role !== "develop" || audit.role !== "audit" || audit.status !== "completed" || audit.auditFor !== developer.id ||
    verdicts?.length !== count || refutations.length !== count ||
    new Set(refutations.map(normalizeEvidence)).size !== count
  ) return false;
  return developer.findings.every((finding, index) =>
    (verdicts[index] === "refuted" || verdicts[index] === "retained") && hasIndependentEvidence(refutations[index], finding),
  );
}

function validAudits(seats: AgentSeat[], developers: AgentSeat[]): Map<string, AgentSeat> {
  const sources = new Map(developers.map((seat) => [seat.id, seat]));
  const audits = new Map<string, AgentSeat>();
  const duplicates = new Set<string>();
  for (const audit of seats) {
    if (audit.role !== "audit" || !audit.auditFor) continue;
    const developer = sources.get(audit.auditFor);
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
  const developers = seats.filter((seat) => seat.role === "develop");
  if (developers.some((seat) => !ended(seat))) return "in_progress";
  if (seats.some((seat) => seat.status === "pending" || seat.status === "in_progress")) return "in_progress";
  const audits = validAudits(seats, developers);
  if (developers.some((seat) => seat.findings.length > 0 && !audits.has(seat.id))) return "in_progress";
  return developers.some((seat) => seat.status === "blocked") ? "blocked" : "completed";
}

export function retainedFindings(seats: AgentSeat[]): string[] {
  const developers = seats.filter((seat) => seat.role === "develop" && ended(seat));
  const audits = validAudits(seats, developers);
  return developers.flatMap((seat) => {
    const verdicts = audits.get(seat.id)?.verdicts;
    return seat.findings.filter((_, index) => verdicts?.[index] === "retained");
  });
}

export function pauseSeats(seats: AgentSeat[] | undefined, note = "已暂停", allUnfinished = false): AgentSeat[] {
  return (seats ?? []).map((seat) =>
    seat.status === "in_progress" || (allUnfinished && seat.status !== "completed")
      ? { ...seat, status: "paused", note } : seat,
  );
}

export function retrySeats(seats: AgentSeat[] | undefined): AgentSeat[] {
  const current = seats ?? [];
  const retrying = (seat: AgentSeat) => seat.status === "blocked" || seat.status === "paused";
  const developers = current.filter((seat) => seat.role === "develop");
  const reset = new Set(developers.filter(retrying).map((seat) => seat.id));
  const audits = validAudits(current, developers);
  const developerIds = new Set(developers.map((seat) => seat.id));
  const includedAudits = new Set<string>();
  return syncAuditSeats(current.flatMap((seat) => {
    if (seat.role === "audit") {
      const source = seat.auditFor;
      if (!source || !developerIds.has(source) || reset.has(source) || includedAudits.has(source)) return [];
      const valid = audits.get(source);
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
