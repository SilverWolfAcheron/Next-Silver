import type { ChatMessage, WorkspaceEntry } from "../agent-core/types";
import type { ModelMenuState } from "./composer";
import type { AgentTab } from "./layout";

export interface AgentPaneProps {
  tab: AgentTab;
  onTab: (tab: AgentTab) => void;
  hideTabs?: boolean;
  centered?: boolean;
  onPickReferenceFile?: () => void;
}

export interface ThreadViewProps {
  centered?: boolean;
  onPickReferenceFile?: () => void;
}

export interface MessageBubbleProps {
  message: ChatMessage;
  queued?: boolean;
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
