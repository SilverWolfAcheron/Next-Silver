import { isDiffPath } from "./diff.ts";
import { DOMAIN_PACKS } from "./domains/pcb.ts";
import { isIteration, pauseIterations } from "./iterate.ts";
import { PRESETS, getPreset } from "./presets.ts";
import { isValidAudit, pauseSeats, validateDeveloperPlan } from "./seats.ts";
import type {
  AgentSeat,
  Artifact,
  Brief,
  ChatMessage,
  Iteration,
  PendingConfirmation,
  Run,
  Thread,
} from "./types";

const EXPORT_VERSION = 1;
const DOMAIN_FIELDS = new Set(DOMAIN_PACKS.flatMap((pack) => pack.fields.map(({ key }) => key)));
const IMPORT_PAUSE_NOTE = "已从备份导入，可以重试。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isList<T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(isItem);
}

function isId(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isKnownPreset(value: unknown): value is string {
  return PRESETS.some((preset) => preset.id === value);
}

function isBrief(value: unknown): value is Brief {
  return isRecord(value) && isString(value.intent) && isString(value.outcome) &&
    isString(value.constraints) && (value.autonomy === "ask" || value.autonomy === "decide" || value.autonomy === "act") &&
    Array.isArray(value.requirements) && value.requirements.every((requirement: unknown) =>
      isRecord(requirement) && isId(requirement.id) && isString(requirement.text)
    ) && isList(value.outOfScope, isString) && isRecord(value.domainFields) &&
    Object.values(value.domainFields).every(isString) &&
    (value.requirementSequence === undefined ||
      (typeof value.requirementSequence === "number" && Number.isSafeInteger(value.requirementSequence) && value.requirementSequence >= 0));
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value) || !isId(value.id) || !isString(value.text)) return false;
  if (value.role !== "user" && value.role !== "assistant") return false;
  if (value.choices !== undefined && !isList(value.choices, isString)) return false;
  if (value.assumptions !== undefined && !isList(value.assumptions, isString)) return false;
  if (value.attachments !== undefined && !isList(value.attachments, isString)) return false;
  if (value.workspaceId !== undefined && !isId(value.workspaceId)) return false;
  if (value.error !== undefined && !isString(value.error)) return false;

  const confirm = value.confirm;
  return confirm === undefined || (
    isRecord(confirm) && (confirm.intent === "steer" || confirm.intent === "revise" || confirm.intent === "patch") &&
    isString(confirm.summary) && (confirm.acceptLabel === undefined || isString(confirm.acceptLabel)) &&
    (confirm.declineLabel === undefined || isString(confirm.declineLabel))
  );
}

function isRun(value: unknown): value is Run {
  return isRecord(value) && isId(value.id) && isString(value.title) && isString(value.note) &&
    isList(value.dependsOn, isString) && typeof value.status === "string" &&
    ["pending", "in_progress", "completed", "blocked", "paused"].includes(value.status) &&
    (value.parallelGroup === undefined || isString(value.parallelGroup)) &&
    (value.messageId === undefined || isId(value.messageId)) &&
    (value.supplements === undefined || isList(value.supplements, isString)) &&
    (value.seatsWorkspaceId === undefined || isId(value.seatsWorkspaceId));
}

function isSeat(value: unknown): value is AgentSeat {
  return isRecord(value) && isId(value.id) && isId(value.title) &&
    (value.role === "develop" || value.role === "audit") && typeof value.status === "string" &&
    ["pending", "in_progress", "completed", "blocked", "paused"].includes(value.status) &&
    isString(value.summary) && isString(value.note) && isList(value.scope, isString) &&
    isList(value.findings, isString) && isList(value.refutations, isString) &&
    (value.parentId === undefined || isId(value.parentId)) &&
    (value.auditFor === undefined || isId(value.auditFor)) &&
    (value.verdicts === undefined || (Array.isArray(value.verdicts) &&
      value.verdicts.every((verdict) => verdict === "refuted" || verdict === "retained"))) &&
    (value.drafts === undefined || isList(value.drafts, isArtifact));
}

function isArtifact(value: unknown): value is Artifact {
  return isRecord(value) && isId(value.id) && isString(value.title) && isString(value.body) &&
    (value.kind === "diff" || value.kind === "doc" || value.kind === "findings") &&
    (value.runId === undefined || isId(value.runId)) &&
    (value.workspaceId === undefined || isId(value.workspaceId));
}

function isPendingConfirmation(value: unknown): value is PendingConfirmation {
  if (!isRecord(value) || !isId(value.messageId)) return false;

  switch (value.kind) {
    case "brief":
    case "promote":
      return true;
    case "revise":
      return isBrief(value.brief) && isString(value.source);
    case "preset":
      return isKnownPreset(value.presetId);
    case "run":
      return isId(value.runId);
    case "iteration":
      return isId(value.runId) && isId(value.iterationId) && (value.phase === "apply" || value.phase === "next");
    default:
      return false;
  }
}

function selectFields<T extends object, K extends keyof T>(value: T, fields: K[]): Pick<T, K> {
  return Object.fromEntries(fields.map((field) => [field, value[field]])) as Pick<T, K>;
}

function projectBrief(brief: Brief): Brief {
  return {
    ...selectFields(brief, ["intent", "outcome", "constraints", "autonomy", "outOfScope", "requirementSequence"]),
    requirements: brief.requirements.map((requirement) => selectFields(requirement, ["id", "text"])),
    domainFields: Object.fromEntries(Object.entries(brief.domainFields).filter(([key]) => DOMAIN_FIELDS.has(key))),
  };
}

function projectChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...selectFields(message, ["id", "role", "text", "choices", "assumptions", "error", "attachments", "workspaceId"]),
    confirm: message.confirm && selectFields(message.confirm, ["intent", "summary", "acceptLabel", "declineLabel"]),
  };
}

function projectConfirmation(confirmation: PendingConfirmation): PendingConfirmation {
  const { messageId, kind } = confirmation;
  switch (kind) {
    case "revise":
      return { messageId, kind, brief: projectBrief(confirmation.brief), source: confirmation.source };
    case "run":
      return { messageId, kind, runId: confirmation.runId };
    case "preset":
      return { messageId, kind, presetId: confirmation.presetId };
    case "iteration":
      return { messageId, kind, runId: confirmation.runId, iterationId: confirmation.iterationId, phase: confirmation.phase };
    default:
      return { messageId, kind };
  }
}

function projectArtifact(artifact: Artifact): Artifact {
  const fields = selectFields(artifact, ["id", "kind", "title", "body", "runId", "workspaceId"]);
  if (!isRecord(artifact.fileDecisions)) return fields;

  const fileDecisions: [string, "accepted" | "rejected"][] = [];
  for (const [path, decision] of Object.entries(artifact.fileDecisions)) {
    if ((decision === "accepted" || decision === "rejected") && isDiffPath(path)) fileDecisions.push([path, decision]);
  }
  return { ...fields, fileDecisions: Object.fromEntries(fileDecisions) };
}

function projectSeat(seat: AgentSeat): AgentSeat {
  return {
    ...selectFields(seat, [
      "id", "parentId", "role", "title", "status", "scope", "summary", "findings",
      "refutations", "note", "auditFor", "verdicts",
    ]),
    drafts: seat.drafts?.map(projectArtifact),
  };
}

function projectIteration(iteration: Iteration): Iteration {
  return {
    ...selectFields(iteration, ["id", "index", "title", "status", "evidence", "verdict", "artifactIds", "note", "nextTitle"]),
    gaps: iteration.gaps.map((gap) => selectFields(gap, ["requirementId", "missing"])),
    checks: iteration.checks?.map((check) => selectFields(check, ["command", "exitCode", "output"])),
  };
}

function readSeats(value: unknown): AgentSeat[] {
  if (!isList(value, isSeat)) return [];
  try {
    if (new Set(value.map(({ id }) => id)).size !== value.length) return [];
    const developers = value.filter(({ role }) => role === "develop");
    validateDeveloperPlan(developers);
    const targets = new Set<string>();
    const developerById = new Map(developers.map((seat) => [seat.id, seat]));
    const audits = value.flatMap((seat): AgentSeat[] => {
      if (seat.role !== "audit" || !seat.auditFor || targets.has(seat.auditFor)) return [];
      const developer = developerById.get(seat.auditFor);
      if (!developer?.findings.length || (developer.status !== "completed" && developer.status !== "blocked")) return [];
      targets.add(seat.auditFor);
      if (seat.status === "completed" && !isValidAudit(seat, developer)) {
        return [{ ...seat, status: "blocked", note: "保存的审计结果不完整，可以重试", verdicts: undefined, refutations: [] }];
      }
      return [seat];
    });
    return [...developers, ...audits];
  } catch {
    return [];
  }
}

function projectThread(thread: Thread): Thread {
  return {
    ...selectFields(thread, [
      "id", "title", "presetId", "mode", "modelId", "modelName", "inspectorTab", "inspectorOpen",
      "intakeStep", "pinned", "updatedAt", "titleEdited",
    ]),
    brief: thread.brief && projectBrief(thread.brief),
    messages: thread.messages.map(projectChatMessage),
    runs: thread.runs.map((run) => ({
      ...selectFields(run, [
        "id", "title", "dependsOn", "status", "note", "parallelGroup",
        "messageId", "supplements", "seatsWorkspaceId",
      ]),
      seats: (run.seats ?? []).map(projectSeat),
      iterations: (run.iterations ?? []).map(projectIteration),
    })),
    artifacts: thread.artifacts.map(projectArtifact),
    queuedMessages: thread.queuedMessages?.map(projectChatMessage),
    pendingConfirmation: thread.pendingConfirmation && projectConfirmation(thread.pendingConfirmation),
    pendingPlan: thread.pendingPlan && selectFields(thread.pendingPlan, ["messageId", "revised"]),
    workspace: thread.workspace && selectFields(thread.workspace, ["id", "name"]),
  };
}

function readThread(value: unknown): Thread | undefined {
  if (!isRecord(value) || !isId(value.id) || !isKnownPreset(value.presetId)) return;
  if (!isList(value.messages, isChatMessage) || !isList(value.runs, isRun) || !isList(value.artifacts, isArtifact)) return;
  if (value.brief !== null && value.brief !== undefined && !isBrief(value.brief)) return;

  const preset = getPreset(value.presetId);
  const pending = value.pendingConfirmation;
  const { workspace } = value;
  const pendingConfirmation = isPendingConfirmation(pending) && pending.kind !== "iteration" && value.messages.some(
    (message) => message.id === pending.messageId && message.role === "assistant" && message.confirm
  ) ? pending : undefined;
  const savedMessages = new Set(value.messages.map(({ id }) => id));
  const pendingMessages = isList(value.queuedMessages, isChatMessage)
    ? value.queuedMessages.filter((entry) => entry.role === "user" && !savedMessages.has(entry.id)) : [];

  return projectThread({
    id: value.id,
    title: isId(value.title) ? value.title : preset.label,
    titleEdited: value.titleEdited === true,
    pinned: value.pinned === true,
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : undefined,
    presetId: preset.id,
    mode: preset.mode,
    messages: [...value.messages, ...pendingMessages].map((message) => {
      if (!message.confirm || message.id === pendingConfirmation?.messageId) return message;
      const { confirm: _confirm, ...resolved } = message;
      return resolved;
    }),
    brief: value.brief ?? null,
    runs: value.runs.map((run) => {
      const isActive = run.status === "pending" || run.status === "in_progress";
      const seats = pauseSeats(readSeats(run.seats), IMPORT_PAUSE_NOTE, isActive);
      const iterations = isList(run.iterations, isIteration) ? run.iterations : [];
      return {
        ...run, seats, iterations: pauseIterations(iterations, IMPORT_PAUSE_NOTE),
        status: isActive ? "paused" : run.status, note: isActive ? IMPORT_PAUSE_NOTE : run.note,
      };
    }),
    artifacts: value.artifacts,
    modelId: isString(value.modelId) ? value.modelId : "",
    modelName: isString(value.modelName) ? value.modelName : undefined,
    inspectorTab: value.inspectorTab === "brief" || value.inspectorTab === "progress" || value.inspectorTab === "artifact"
      ? value.inspectorTab : preset.defaultTab,
    inspectorOpen: value.inspectorOpen === true,
    intakeStep: value.intakeStep === "questioning" || value.intakeStep === "confirmed" || value.intakeStep === "done"
      ? value.intakeStep : value.runs.length ? "done" : "questioning",
    pendingConfirmation,
    workspace: isRecord(workspace) && isId(workspace.id) && isId(workspace.name)
      ? { id: workspace.id, name: workspace.name } : undefined,
  });
}

export function sortThreads(threads: Thread[]): Thread[] {
  return [...threads].sort((left, right) =>
    Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  );
}

export function mergeThreads(existing: Thread[], incoming: Thread[]): Thread[] {
  const threads = new Map(existing.map((thread) => [thread.id, thread]));
  for (const thread of incoming) threads.set(thread.id, thread);
  return [...threads.values()];
}

export function exportThreads(threads: Thread[]): string {
  return JSON.stringify({ version: EXPORT_VERSION, threads: threads.map(projectThread) }, null, 2);
}

export function importThreads(json: string): Thread[] {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || (value.version !== undefined && value.version !== EXPORT_VERSION) || !Array.isArray(value.threads)) {
    throw new Error("文件不是 Silver 对话备份。");
  }

  const threads = value.threads.map((item: unknown) => readThread(item));
  if (threads.some((thread) => thread === undefined)) {
    throw new Error("备份中有无法读取的对话。");
  }

  return mergeThreads([], threads.filter((thread) => thread !== undefined));
}
