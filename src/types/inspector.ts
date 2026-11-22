import type { DomainPack } from "../agent-core/domains/pcb";
import type {
  AgentSeat,
  Artifact,
  Brief,
  Iteration,
  Run,
  Thread,
  WorkspaceSummary,
  WritePolicy,
} from "../agent-core/types";
import type { FileChange, FileDecision } from "./diff";

export interface ParallelRunEntry {
  key: string;
  parallel: boolean;
  runs: Run[];
}

export interface FindingSection {
  text: string;
  finding: boolean;
}

export interface PendingAcceptance {
  changes: FileChange[];
  workspaceId: string;
  body: string;
  policy: WritePolicy;
}

export interface InspectorPaneProps {
  embedded?: boolean;
  onOpenFile?: (path: string) => void;
  onViewArtifactInChat?: (artifactId: string) => void;
}

export interface ThreadInspectorProps {
  thread: Thread;
  embedded?: boolean;
  onOpenFile?: (path: string) => void;
  onViewArtifactInChat?: (artifactId: string) => void;
}

export interface BriefViewProps {
  brief: Brief;
  domain?: DomainPack;
  requirementSequence: number;
  confirmationPending: boolean;
  onSave: (brief: Brief) => void;
}

export interface BriefEditorProps {
  brief: Brief;
  domain?: DomainPack;
  requirementSequence: number;
  onCancel: () => void;
  onSave: (brief: Brief) => void;
}

export interface BriefFieldProps {
  label: string;
  value: string;
}

export interface BriefTextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

export interface ProgressViewProps {
  runs: Run[];
  artifactRunIds: ReadonlySet<string>;
  artifactIds?: ReadonlySet<string>;
  selectedRunId?: string;
  onSelect: (runId: string) => void;
  onViewArtifact: (runId: string) => void;
  onViewIteration?: (runId: string, artifactId: string) => void;
  onRetry: (runId: string) => void;
}

export interface RunRowProps {
  run: Run;
  selected: boolean;
  onSelect?: () => void;
  onViewArtifact?: () => void;
  artifactIds?: ReadonlySet<string>;
  onViewIteration?: (artifactId: string) => void;
  onRetry: () => void;
}

export interface IterationRowProps {
  iteration: Iteration;
  onViewArtifact?: () => void;
}

export interface SeatProgressProps {
  seats: AgentSeat[];
}

export interface SeatRowProps {
  seat: AgentSeat;
  parentTitle?: string;
}

export interface ArtifactViewProps {
  artifacts: Artifact[];
  runs: Run[];
  workspace?: WorkspaceSummary;
  writePolicy: WritePolicy;
  selectedRunId?: string;
  selectedArtifactId?: string;
  onPromote?: () => void;
  onPatchFinding: (finding: string) => void;
  onFileDecision: (artifact: Artifact, path: string, decision: FileDecision) => void;
  onAcceptFile: (artifact: Artifact, path: string, confirmed: boolean) => Promise<void>;
}

export interface DiffArtifactProps {
  artifact: Artifact;
  workspace?: WorkspaceSummary;
  writePolicy: WritePolicy;
  onDecision: (path: string, decision: FileDecision) => void;
  onAcceptFile: (path: string, confirmed: boolean) => Promise<void>;
}

export interface DocArtifactProps {
  title: string;
  body: string;
  kind: "doc" | "findings";
  workspace?: WorkspaceSummary;
  onPatchFinding: (finding: string) => void;
}
