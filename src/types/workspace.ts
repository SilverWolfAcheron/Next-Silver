import type { WorkspaceEntry, WorkspaceSummary } from "../agent-core/types";
import type { WorkspaceSearchMode } from "./layout";

export interface WorkspaceSearchResult {
  path: string;
  line?: number;
  text?: string;
}

export type WorkspaceListing =
  | { state: "loading" }
  | { state: "ready"; entries: WorkspaceEntry[] }
  | { state: "error"; text: string; canReconnect: boolean };

export interface WorkspaceSearchOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface WorkspaceExplorerProps {
  workspace?: WorkspaceSummary;
  selectedPath?: string;
  onBind: (workspace: WorkspaceSummary) => void;
  onPreview: (path: string) => void;
  onSearchText?: () => void;
}

export interface WorkspaceTreeProps {
  workspace: WorkspaceSummary;
  path?: string;
  depth: number;
  refreshEpoch: number;
  selectedPath?: string;
  onPreview: (path: string) => void;
}

export interface WorkspaceTreeRowProps {
  workspace: WorkspaceSummary;
  entry: WorkspaceEntry;
  depth: number;
  refreshEpoch: number;
  selectedPath?: string;
  onPreview: (path: string) => void;
}

export interface WorkspaceSearchModalProps {
  mode: WorkspaceSearchMode;
  workspace?: WorkspaceSummary;
  onMode: (mode: WorkspaceSearchMode) => void;
  onClose: () => void;
  onOpenFolder: () => void;
  onOpen: (path: string, line?: number) => void;
  onAttach?: (path: string) => void;
}
