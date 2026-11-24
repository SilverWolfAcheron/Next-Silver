export type Mode = "project" | "single";
export type Autonomy = "ask" | "decide" | "act";
export type WritePolicy = "code" | "docs" | "none";
export type InspectorTab = "brief" | "progress" | "artifact";
export type Intent = "steer" | "revise" | "patch";
export type RunStatus = "pending" | "in_progress" | "completed" | "blocked" | "paused";
export type Protocol = "openai" | "anthropic" | "gemini";
export type ArtifactKind = "diff" | "doc" | "findings";
export type SeatRole = "develop" | "audit";
export type SeatStatus = RunStatus;
export type AuditVerdict = "refuted" | "retained";
export type IterationVerdict = "continue" | "done" | "blocked";

export interface WorkspaceSummary {
  id: string;
  name: string;
  path?: string;
}

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
}

export interface WorkspaceTextMatch {
  path: string;
  line: number;
  text: string;
}

export interface IterationGap {
  requirementId: string;
  missing: string;
}

export interface IterationCheck {
  command: string;
  exitCode: number;
  output: string;
}

export interface Iteration {
  id: string;
  index: number;
  title: string;
  status: "in_progress" | "completed" | "blocked" | "paused";
  gaps: IterationGap[];
  evidence: string[];
  verdict?: IterationVerdict;
  artifactIds: string[];
  note: string;
  nextTitle?: string;
  checks?: IterationCheck[];
  stage?: "produce" | "apply" | "checks" | "judge";
  writes?: { path: string; before: string | null; after: string | null; artifactId: string }[];
  approval?: "apply" | "next";
  attempt?: string;
  checkSequence?: number;
  checksApprovedWorkspaceId?: string;
  checksApprovedAutomatically?: boolean;
  checkAwaitingWorkspaceId?: string;
  replyId?: string;
}

export interface AgentSeat {
  id: string;
  parentId?: string;
  role: SeatRole;
  title: string;
  status: SeatStatus;
  scope: string[];
  summary: string;
  findings: string[];
  refutations: string[];
  note: string;
  auditFor?: string;
  verdicts?: AuditVerdict[];
  drafts?: Artifact[];
  attempt?: string;
}

export interface Requirement {
  id: string;
  text: string;
}

export interface Brief {
  intent: string;
  outcome: string;
  requirements: Requirement[];
  constraints: string;
  autonomy: Autonomy;
  outOfScope: string[];
  domainFields: Record<string, string>;
  requirementSequence?: number;
}

export interface Run {
  id: string;
  title: string;
  dependsOn: string[];
  status: RunStatus;
  note: string;
  parallelGroup?: string;
  messageId?: string;
  supplements?: string[];
  seats?: AgentSeat[];
  seatsWorkspaceId?: string;
  seatPlan?: AgentSeat[];
  iterations?: Iteration[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  choices?: string[];
  assumptions?: string[];
  error?: string;
  retryRunId?: string;
  attachments?: string[];
  workspaceId?: string;
  confirm?: { intent: Intent; summary: string; acceptLabel?: string; declineLabel?: string };
}

export type PendingConfirmation = { messageId: string } & (
  | { kind: "brief" }
  | { kind: "revise"; brief: Brief; source: string }
  | { kind: "preset"; presetId: string }
  | { kind: "run"; runId: string }
  | { kind: "promote" }
  | { kind: "iteration"; runId: string; iterationId: string; phase: "apply" | "next" }
);

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  body: string;
  runId?: string;
  fileDecisions?: Record<string, "accepted" | "rejected">;
  workspaceId?: string;
}

export type IntakeStep = "questioning" | "confirmed" | "done";

export interface ChatDraft {
  text: string;
  attachments: string[];
  workspaceId?: string;
}

export interface Thread {
  id: string;
  title: string;
  presetId: string;
  mode: Mode;
  messages: ChatMessage[];
  brief: Brief | null;
  runs: Run[];
  artifacts: Artifact[];
  modelId: string;
  modelName?: string;
  inspectorTab: InspectorTab;
  inspectorOpen: boolean;
  intakeStep: IntakeStep;
  pinned?: boolean;
  updatedAt?: number;
  titleEdited?: boolean;
  pendingConfirmation?: PendingConfirmation;
  autoApproval?: { workspaceId?: string };
  pendingPlan?: { messageId: string; revised: boolean };
  queuedMessages?: ChatMessage[];
  draft?: ChatDraft;
  activeRequest?: { kind: "message" | "plan"; messageId: string; attempt: string; revised?: boolean; replyId?: string };
  workspace?: WorkspaceSummary;
}

export interface ProviderPreset {
  id: string;
  label: string;
  protocol: Protocol;
  baseUrl?: string;
  key: string;
  model: string;
}

export interface AppearanceState {
  theme: "system" | "light" | "dark";
}
