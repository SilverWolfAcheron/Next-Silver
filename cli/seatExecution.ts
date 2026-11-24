import { mergeDiffArtifacts, parseDiff } from "../src/utils/diff";
import type { DiffFile } from "../src/types/diff";
import { SessionError } from "../src/agent-core/session";
import { runSeat } from "./seatWorker";
import type { SeatResult } from "./seatWorker";
import {
  retainedFindings, scheduleSeats, scopeIncludesPath, settleSeats, syncAuditSeats, SCOPE_WAIT_NOTE,
} from "../src/agent-core/seats";
import type { SeatSchedule } from "../src/agent-core/seats";
import type { AgentSeat, Artifact, Run, Thread } from "../src/agent-core/types";
import { describeProviderError } from "../src/agent-core/provider/client";
import type { ModelClient } from "../src/agent-core/provider/client";
import type { SilverState } from "../src/agent-core/silverState";
import type { RequestJournal } from "./journal";
import type { ModelRequest } from "./conversationHelpers";

export interface SeatRunOutcome {
  status: "completed" | "blocked";
  artifacts: Artifact[];
}

export interface ExecuteSeatRunOptions {
  thread: Thread;
  run: Run;
  client: ModelClient;
  request: ModelRequest;
}

export interface SeatExecution {
  executeRun(options: ExecuteSeatRunOptions): Promise<SeatRunOutcome | undefined>;
  requestPulse(): void;
}

interface Parent {
  key: string;
  threadId: string;
  runId: string;
  workspace: Thread["workspace"];
  client: ModelClient;
  request: ModelRequest;
  finish: (result?: SeatRunOutcome) => void;
}

function finalArtifacts(run: Run, findings: string[], workspace: Parent["workspace"]): Artifact[] {
  const drafts: Artifact[] = run.seats?.flatMap((seat: AgentSeat): Artifact[] => {
    if (seat.role !== "develop" || seat.parentId || seat.status !== "completed") return [];
    return (seat.drafts ?? []).filter((draft: Artifact): boolean => draft.kind === "diff" && draft.workspaceId === workspace?.id &&
      parseDiff(draft.body).every(({ change }: DiffFile): boolean | undefined => change && scopeIncludesPath(seat.scope, change.path)));
  }) ?? [];
  const merged: Artifact[] = mergeDiffArtifacts([], drafts);
  const result: Artifact[] = [];
  const fields: { runId: string; workspaceId: string | undefined; } = { runId: run.id, workspaceId: workspace?.id };
  if (merged.length) {
    result.push({
      ...fields, id: crypto.randomUUID(), kind: "diff", title: `${run.title} · 合并差异`,
      body: merged.map(({ body }: Artifact): string => body.replace(/(?:\r?\n)+$/u, "")).join("\n") + "\n",
    });
  }
  if (findings.length) {
    result.push({
      ...fields, id: crypto.randomUUID(), kind: "doc", title: `${run.title} · 审计保留的发现`,
      body: findings.map((finding: string, index: number): string => `## 发现 ${index + 1}\n\n${finding}`).join("\n\n"),
    });
  }
  return result;
}

export function createSeatExecution(
  latest: { current: SilverState },
  edit: (threadId: string, update: (thread: Thread) => Thread) => void,
  journal: RequestJournal
): SeatExecution {
  const parents: { current: Map<string, Parent>; } = { current: new Map<string, Parent>() };
  const workers: { current: Map<Parent, Map<string, AgentSeat>>; } = { current: new Map<Parent, Map<string, AgentSeat>>() };
  const pulseScheduled: { current: boolean; } = { current: false };

  function snapshot(parent: Parent): { thread: Thread; run: Run; } | undefined {
    const thread: Thread | undefined = latest.current.threads.find(({ id }: Thread): boolean => id === parent.threadId);
    const run: Run | undefined = thread?.runs.find(({ id }: Run): boolean => id === parent.runId);
    if (thread && run?.status === "in_progress" && !parent.request.signal.aborted) return { thread, run };
  }

  function editRun(parent: Parent, update: (run: Run) => Run): void {
    edit(parent.threadId, (thread: Thread): Thread => ({
      ...thread, runs: thread.runs.map((run: Run): Run => run.id === parent.runId ? update(run) : run),
    }));
  }

  function editSeat(parent: Parent, seatId: string, update: (seat: AgentSeat) => AgentSeat): void {
    if (parents.current.get(parent.key) !== parent || !snapshot(parent)) return;
    editRun(parent, (run: Run): Run => ({
      ...run, seats: run.seats?.map((seat: AgentSeat): AgentSeat => seat.id === seatId ? update(seat) : seat),
    }));
  }

  function requestPulse(): void {
    if (pulseScheduled.current) return;
    pulseScheduled.current = true;
    queueMicrotask((): void => {
      pulseScheduled.current = false;
      dispatchSeats();
    });
  }

  async function execute(parent: Parent, seatId: string): Promise<void> {
    const active: { thread: Thread; run: Run; } | undefined = snapshot(parent);
    const seat: AgentSeat | undefined = active?.run.seats?.find(({ id }: AgentSeat): boolean => id === seatId);
    if (!active || seat?.status !== "in_progress") return;
    const reservations: Map<string, AgentSeat> = workers.current.get(parent) ?? new Map<string, AgentSeat>();
    reservations.set(seatId, seat);
    workers.current.set(parent, reservations);
    const stamp: string = active.run.iterations?.at(-1)?.id ?? "legacy";
    const operation: string = `${parent.key}:${stamp}:seat:${seat.id}:${seat.attempt ?? ""}`;
    try {
      const result: SeatResult = await parent.request.track({
        kind: seat.role === "audit" ? "auditSeat" : "developSeat", target: seat.title,
      }, (): Promise<SeatResult> => runSeat({
        thread: { ...active.thread, presetId: "develop", workspace: parent.workspace },
        run: active.run,
        seat,
        client: journal.model(operation, parent.client),
        request: parent.request,
        onProgress: (note: string): void => editSeat(parent, seatId, (current: AgentSeat): AgentSeat => ({ ...current, note })),
      }));
      if (!parent.request.signal.aborted) editSeat(parent, seatId, (current: AgentSeat): AgentSeat => ({ ...current, ...result }));
      if (!parent.request.signal.aborted) journal.clear(operation);
    } catch (error) {
      if (!parent.request.signal.aborted) {
        editSeat(parent, seatId, (current: AgentSeat): AgentSeat => ({
          ...current, status: "blocked",
          note: error instanceof SessionError ? error.message : describeProviderError(error),
        }));
      }
    } finally {
      reservations.delete(seatId);
      if (!reservations.size) workers.current.delete(parent);
      requestPulse();
    }
  }

  function inspectParent(parent: Parent): Run | undefined {
    const active: { thread: Thread; run: Run; } | undefined = snapshot(parent);
    if (!active) {
      parent.finish();
      return;
    }
    const existing: AgentSeat[] = active.run.seats ?? [];
    const seats: AgentSeat[] = syncAuditSeats(existing, (): `${string}-${string}-${string}-${string}-${string}` => crypto.randomUUID());
    const run: Run = { ...active.run, seats };
    const status: "in_progress" | "completed" | "blocked" = settleSeats(seats);
    if (status === "in_progress") {
      if (seats !== existing) editRun(parent, (current: Run): Run => ({ ...current, seats }));
      return { ...run, id: parent.key };
    }

    const findings: string[] = retainedFindings(seats);
    const artifacts: Artifact[] = finalArtifacts(run, findings, parent.workspace);
    const note: "席位与审计已完成" | "仍有开发席位阻塞，可重试" = status === "completed" ? "席位与审计已完成" : "仍有开发席位阻塞，可重试";
    editRun(parent, (current: Run): Run => ({ ...current, seats, note }));
    parent.finish({ status, artifacts });
  }

  function dispatchSeats(): void {
    const runs: Run[] = [];
    const snapshots: Set<Parent> = new Set();
    for (const parent of parents.current.values()) {
      const run: Run | undefined = inspectParent(parent);
      if (!run) continue;
      runs.push(run);
      snapshots.add(parent);
    }
    // Ignore stale results after cancellation but hold their capacity and scope until abort settles.
    for (const [parent, reserved] of workers.current) {
      if (snapshots.has(parent)) continue;
      runs.push({
        id: `aborting:${parent.key}:${reserved.keys().next().value}`,
        title: "", dependsOn: [], status: "in_progress", note: "",
        seats: [...reserved.values()],
      });
    }
    const { starts, blockedByScope }: SeatSchedule = scheduleSeats(runs, latest.current.developmentConcurrency);
    for (const { runId, seatId } of blockedByScope) {
      const parent: Parent | undefined = parents.current.get(runId);
      if (!parent) continue;
      const seat: AgentSeat | undefined = snapshot(parent)?.run.seats?.find(({ id }: AgentSeat): boolean => id === seatId);
      if (seat?.note !== SCOPE_WAIT_NOTE) editSeat(parent, seatId, (current: AgentSeat): AgentSeat => ({ ...current, note: SCOPE_WAIT_NOTE }));
    }
    for (const { runId, seatId } of starts) {
      const parent: Parent | undefined = parents.current.get(runId);
      if (!parent || !snapshot(parent)) continue;
      editSeat(parent, seatId, (seat: AgentSeat): AgentSeat => ({
        ...seat, status: "in_progress",
        note: seat.role === "develop" ? "正在处理范围内的文件" : "正在独立核对发现",
      }));
      void execute(parent, seatId);
    }
  }

  function executeRun(options: ExecuteSeatRunOptions): Promise<SeatRunOutcome | undefined> {
    const { thread, run, client, request }: ExecuteSeatRunOptions = options;
    return new Promise<SeatRunOutcome | undefined>((resolve: (value: SeatRunOutcome | undefined) => void): void => {
      const key: string = JSON.stringify([thread.id, run.id]);
      const parent: Parent = {
        key, threadId: thread.id, runId: run.id, workspace: thread.workspace, client, request,
        finish(result: SeatRunOutcome | undefined): void {
          if (parents.current.get(key) === parent) parents.current.delete(key);
          request.signal.removeEventListener("abort", onAbort);
          resolve(result);
          requestPulse();
        },
      };
      const onAbort = (): void => parent.finish();
      if (request.signal.aborted) return resolve(undefined);
      parents.current.set(key, parent);
      request.signal.addEventListener("abort", onAbort, { once: true });
      requestPulse();
    });
  }

  return { executeRun, requestPulse };
}
