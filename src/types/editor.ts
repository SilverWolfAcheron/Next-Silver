import type { Root } from "hast";
import type { RefObject } from "react";

export interface EditorTabState {
  paths: string[];
  active: string;
}

export interface FilePreview {
  threadId: string;
  workspaceId: string;
  path: string;
  line?: number;
  body?: string;
  error?: string;
}

export interface MatchRange {
  start: number;
  end: number;
  active: boolean;
}

export interface HighlightedDocument {
  language: string;
  label: string;
  root: Root;
}

export interface ScrollPosition {
  top: number;
  left: number;
}

export interface WalkState {
  offset: number;
  matchCursor: number;
  attachedRef: boolean;
  keySeq: number;
}

export interface CodeViewProps {
  source: string;
  root?: Root | null;
  language?: string | null;
  offsets: number[];
  activeOffset?: number;
  queryLength: number;
  activeMarkRef: RefObject<HTMLElement | null>;
}

export interface EditorPaneProps {
  onOpenSidebar?: () => void;
  onOpenAgent?: () => void;
  onOpenQuickFiles?: () => void;
  onAttachFile?: (path: string) => void;
  onAllTabsClosed?: () => void;
  showSidebarButton?: boolean;
  showAgentButton?: boolean;
  embedded?: boolean;
}

export interface EditorTabBarProps {
  paths: string[];
  activePath: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export interface EditorToolbarProps {
  embedded: boolean;
  showSidebarButton: boolean;
  showAgentButton: boolean;
  path?: string;
  workspaceName?: string;
  hasBody: boolean;
  findOpen: boolean;
  detectedLabel: string | null;
  onOpenSidebar?: () => void;
  onOpenAgent?: () => void;
  onOpenFind: () => void;
  onReload: () => void;
  onAttachFile?: (path: string) => void;
}

export interface EditorFindBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  matchIndex: number;
  matchCount: number;
  onChangeQuery: (value: string) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
}
