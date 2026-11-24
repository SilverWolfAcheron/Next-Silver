import type { Artifact, ChatMessage, Thread, WorkspaceEntry, WorkspaceSummary, WritePolicy } from "../agent-core/types";
import type { ModelMenuState } from "./composer";
import type { FileDecision } from "./diff";
import type { AgentTab } from "./layout";

export interface AgentPaneProps {
  tab: AgentTab;
  onTab: (tab: AgentTab) => void;
  hideTabs?: boolean;
  centered?: boolean;
  onPickReferenceFile?: () => void;
  onOpenFile?: (path: string) => void;
}

export interface ChatArtifactBuckets {
  byMessageId: Map<string, Artifact[]>;
  trailing: Artifact[];
}

export interface ChatArtifactCardProps {
  artifact: Artifact;
  runTitle?: string;
  workspace?: WorkspaceSummary;
  writePolicy: WritePolicy;
  focused?: boolean;
  defaultExpanded?: boolean;
  onPatchFinding: (finding: string) => void;
  onFileDecision: (path: string, decision: FileDecision) => void;
  onAcceptFile: (path: string, confirmed: boolean) => Promise<void>;
}

export interface ThreadViewProps {
  centered?: boolean;
  onPickReferenceFile?: () => void;
}

export interface AgentActivityView {
  label: string;
  details: string[];
  rate?: string;
  rateHint?: string;
}

export interface ApprovalSelectorProps {
  thread: Thread;
  open: boolean;
  onToggle: () => void;
}

export interface MessageBubbleProps {
  message: ChatMessage;
  delivery?: "queued" | "submitted";
  onRetry?: () => void;
  onChoose?: (choice: string) => void;
  onConfirm?: (accepted: boolean) => void;
}

export interface MentionMenuProps {
  listId: string;
  matches: WorkspaceEntry[];
  activeIndex: number;
  searching: boolean;
  fileError: string;
  onHover: (index: number) => void;
  onSelect: (path: string) => void;
}

export interface ModeSelectorProps {
  presetId: string;
  presetLabel: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (presetId: string) => void;
}

export interface ModelSelectorProps {
  modelMenu: ModelMenuState;
  open: boolean;
  onToggle: () => void;
  onSelect: (providerId: string, model: string) => void;
}
