import type { DiffLineKind } from "../agent-core/diff";
import type { WorkspaceSummary } from "../agent-core/types";

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export type GitDiffLoadStatus = "idle" | "loading" | "ready" | "error";

export interface GitDiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface GitDiffFile {
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
  lines: GitDiffLine[];
}

export interface WorkspaceGitDiff {
  isRepo: boolean;
  branch: string;
  files: GitDiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
}

export interface GitTreeNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  children?: GitTreeNode[];
  file?: GitDiffFile;
  additions: number;
  deletions: number;
}

export interface GitStatusBadgeStyle {
  letter: string;
  className: string;
}

export interface GitDiffViewProps {
  workspace?: WorkspaceSummary;
  onOpenFile?: (path: string) => void;
}

export interface GitDiffFileCardProps {
  file: GitDiffFile;
  selected: boolean;
  collapsed: boolean;
  cardRef?: (element: HTMLElement | null) => void;
  onToggleCollapse: () => void;
  onOpenFile?: (path: string) => void;
}

export interface WorkspaceChangesTreeProps {
  workspace: WorkspaceSummary;
  collapseEpoch: number;
  selectedPath?: string;
  onSelect: (path: string) => void;
}

export interface WorkspaceChangesNodeProps {
  node: GitTreeNode;
  depth: number;
  collapseEpoch: number;
  selectedPath?: string;
  onSelect: (path: string) => void;
}
