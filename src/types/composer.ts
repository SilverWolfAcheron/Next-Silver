import type { ChatDraft } from "../agent-core/types";

export type ComposerMenu = "preset" | "model" | "approval" | null;

export interface ComposerModeItem {
  id: "develop" | "review" | "explain" | "academic";
  label: string;
}

export interface ModelOption {
  providerId: string;
  providerLabel: string;
  model: string;
  displayName: string;
  tag?: string;
}

export interface MentionQuery {
  text: string;
  from: number;
  to: number;
}

export interface ModelMenuState {
  usingMockModels: boolean;
  options: ModelOption[];
  grouped: [string, ModelOption[]][];
  activeOption?: ModelOption;
}

export interface ComposerPrompt {
  threadId: string;
  text: string;
}

export interface ComposerAttachment {
  threadId: string;
  workspaceId: string;
  path: string;
}

export interface DraftEntry {
  value: ChatDraft;
  timer?: number;
  saving?: Promise<void>;
  dirty?: boolean;
}
