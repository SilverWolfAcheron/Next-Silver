import { mergeDiffArtifacts, parseDiff } from "../src/model/diff";
import { SessionError } from "../src/model/session";
import { runSeat } from "./seatWorker";
import {
  retainedFindings, scheduleSeats, scopeIncludesPath, settleSeats, syncAuditSeats, SCOPE_WAIT_NOTE,
} from "../src/model/seats";
import type { AgentSeat, Artifact, Run, Thread } from "../src/model/types";
import { describeProviderError, type ModelClient } from "../src/provider/client";
import type { SilverState } from "../src/model/silverState";
import type { RequestJournal } from "./journal";

interface Parent {
  key: string;
  threadId: string;
  runId: string;
  workspace: Thread["workspace"];
  client: ModelClient;
  request: { model: string; signal: AbortSignal };
  finish: (result?: { status: "completed" | "blocked"; artifacts: Artifact[] }) => void;
}

function finalArtifacts(run: Run, findings: string[], workspace: Parent["workspace"]): Artifact[] {
  const drafts = run.seats?.flatMap((seat) => {
    if (seat.role !== "develop" || seat.parentId || seat.status !== "completed") return [];
    return (seat.drafts ?? []).filter((draft) => draft.kind === "diff" && draft.workspaceId === workspace?.id &&
      parseDiff(draft.body).every(({ change }) => change && scopeIncludesPath(seat.scope, change.path)));
  }) ?? [];
  const merged = mergeDiffArtifacts([], drafts);
  const result: Artifact[] = [];
  const fields = { runId: run.id, workspaceId: workspace?.id };
  if (merged.length) result.push({
    ...fields, id: crypto.randomUUID(), kind: "diff", title: `${run.title} · 合并差异`,
    body: merged.map(({ body }) => body.replace(/(?:\r?\n)+$/u, "")).join("\n") + "\n",
  });
  if (findings.length) result.push({
    ...fields, id: crypto.randomUUID(), kind: "doc", title: `${run.title} · 审计保留的发现`,
    body: findings.map((finding, index) => `## 发现 ${index + 1}\n\n${finding}`).join("\n\n"),
  });
  return result;
}

export function createSeatExecution(
  latest: { current: SilverState },
  edit: (threadId: string, update: (thread: Thread) => Thread) => void,
  journal: RequestJournal,
) {
  const parents = { current: new Map<string, Parent>() };
  const workers = { current: new Map<Parent, Map<string, AgentSeat>>() };
  const pulseScheduled = { current: false };

  function snapshot(parent: Parent) {
    const thread = latest.current.threads.find(({ id }) => id === parent.threadId);
    const run = thread?.runs.find(({ id }) => id === parent.runId);
    if (thread && run && run.status === "in_progress" && !parent.request.signal.aborted) return { thread, run };
  }

  function editRun(parent: Parent, update: (run: Run) => Run) {
    edit(parent.threadId, (thread) => ({
      ...thread, runs: thread.runs.map((run) => run.id === parent.runId ? update(run) : run),
    }));
  }

  function editSeat(parent: Parent, seatId: string, update: (seat: AgentSeat) => AgentSeat) {
    if (parents.current.get(parent.key) !== parent || !snapshot(parent)) return;
    editRun(parent, (run) => ({
      ...run, seats: run.seats?.map((seat) => seat.id === seatId ? update(seat) : seat),
    }));
  }

  function requestPulse() {
    if (pulseScheduled.current) return;
    pulseScheduled.current = true;
    queueMicrotask(() => {
      pulseScheduled.current = false;
      dispatchSeats();
    });
  }

  async function execute(parent: Parent, seatId: string) {
    const active = snapshot(parent);
    const seat = active?.run.seats?.find(({ id }) => id === seatId);
    if (!active || !seat || seat.status !== "in_progress") return;
    const reservations = workers.current.get(parent) ?? new Map<string, AgentSeat>();
    reservations.set(seatId, seat);
    workers.current.set(parent, reservations);
    const stamp = active.run.iterations?.at(-1)?.id ?? "legacy";
    const operation = `${parent.key}:${stamp}:seat:${seat.id}:${seat.attempt ?? ""}`;
    try {
      const result = await runSeat(
        { ...active.thread, presetId: "develop", workspace: parent.workspace },
        active.run,
        seat, journal.model(operation, parent.client), parent.request,
        (note) => editSeat(parent, seatId, (current) => ({ ...current, note })),
      );
      if (!parent.request.signal.aborted) editSeat(parent, seatId, (current) => ({ ...current, ...result }));
      if (!parent.request.signal.aborted) journal.clear(operation);
    } catch (error) {
      if (!parent.request.signal.aborted) editSeat(parent, seatId, (current) => ({
        ...current, status: "blocked",
        note: error instanceof SessionError ? error.message : describeProviderError(error),
      }));
    } finally {
      reservations.delete(seatId);
      if (!reservations.size) workers.current.delete(parent);
      requestPulse();
    }
  }

  function inspectParent(parent: Parent): Run | undefined {
    const active = snapshot(parent);
    if (!active) {
      parent.finish();
      return;
    }
    const existing = active.run.seats ?? [];
    const seats = syncAuditSeats(existing, () => crypto.randomUUID());
    const run = { ...active.run, seats };
    const status = settleSeats(seats);
    if (status === "in_progress") {
      if (seats !== existing) editRun(parent, (current) => ({ ...current, seats }));
      return { ...run, id: parent.key };
    }

    const findings = retainedFindings(seats);
    const artifacts = finalArtifacts(run, findings, parent.workspace);
    const note = status === "completed" ? "席位与审计已完成" : "仍有开发席位阻塞，可重试";
    editRun(parent, (current) => ({ ...current, seats, note }));
    parent.finish({ status, artifacts });
  }

  function dispatchSeats() {
    const runs: Run[] = [];
    const snapshots = new Set<Parent>();
    for (const parent of parents.current.values()) {
      const run = inspectParent(parent);
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
    const { starts, blockedByScope } = scheduleSeats(runs, latest.current.developmentConcurrency);
    for (const { runId, seatId } of blockedByScope) {
      const parent = parents.current.get(runId);
      if (!parent) continue;
      const seat = snapshot(parent)?.run.seats?.find(({ id }) => id === seatId);
      if (seat?.note !== SCOPE_WAIT_NOTE) editSeat(parent, seatId, (current) => ({ ...current, note: SCOPE_WAIT_NOTE }));
    }
    for (const { runId, seatId } of starts) {
      const parent = parents.current.get(runId);
      if (!parent || !snapshot(parent)) continue;
      editSeat(parent, seatId, (seat) => ({
        ...seat, status: "in_progress",
        note: seat.role === "develop" ? "正在处理范围内的文件" : "正在独立核对发现",
      }));
      void execute(parent, seatId);
    }
  }

  function executeRun(thread: Thread, run: Run, client: ModelClient, request: Parent["request"]) {
    return new Promise<{ status: "completed" | "blocked"; artifacts: Artifact[] } | undefined>((resolve) => {
      const key = JSON.stringify([thread.id, run.id]);
      const parent: Parent = {
        key, threadId: thread.id, runId: run.id, workspace: thread.workspace, client, request,
        finish(result) {
          if (parents.current.get(key) === parent) parents.current.delete(key);
          request.signal.removeEventListener("abort", onAbort);
          resolve(result);
          requestPulse();
        },
      };
      const onAbort = () => parent.finish();
      if (request.signal.aborted) return resolve(undefined);
      parents.current.set(key, parent);
      request.signal.addEventListener("abort", onAbort, { once: true });
      requestPulse();
    });
  }

  return { executeRun, requestPulse };
}
