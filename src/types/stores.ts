import type { ProviderConfig } from "../agent-core/provider/presets";
import type { DesktopSnapshot, SilverState } from "../agent-core/silverState";
import type { Brief, ChatDraft, Thread, WorkspaceSummary } from "../agent-core/types";
import type { ComposerAttachment, ComposerPrompt } from "./composer";
import type { EditorTabState, FilePreview } from "./editor";
import type { GitDiffLoadStatus, WorkspaceGitDiff } from "./git";
import type { Locale } from "./i18n";
import type { AgentTab, CenterMode, ResizeSide, WorkspaceSearchMode } from "./layout";
import type { DesktopConnection, UIAction } from "./runtime";

export interface FilePreviewRequest {
  threadId: string;
  workspace: WorkspaceSummary;
  path: string;
  line?: number;
}

export interface AcceptFileParams {
  threadId: string;
  artifactId: string;
  path: string;
  confirmed: boolean;
}

export interface FileDecisionParams {
  threadId: string;
  artifactId: string;
  path: string;
  decision: "accepted" | "rejected";
}

export interface SidebarClampParams {
  side: ResizeSide;
  rawWidth: number;
  viewportWidth: number;
  otherWidth: number;
}

export interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export interface ComposerStore {
  composerPrompt?: ComposerPrompt;
  composerAttachment?: ComposerAttachment;
  chooseMessage: (thread: Thread | undefined, messageId: string, choice: string) => void;
  consumeComposerPrompt: (prompt: ComposerPrompt) => void;
  attachToComposer: (thread: Thread | null, path: string) => void;
  consumeComposerAttachment: (request: ComposerAttachment) => void;
}

export interface EditorStore {
  filePreview: FilePreview | null;
  editorTabs: Record<string, EditorTabState>;
  previewFile: (request: FilePreviewRequest) => Promise<void>;
  updatePreviewBody: (path: string, body: string) => void;
  closeFilePreview: () => void;
  ensureEditorTab: (scope: string, path: string) => void;
  closeEditorTab: (scope: string, path: string) => { next?: string; closingActive: boolean };
  clearThreadTabs: (threadId: string) => void;
}

export interface GitDiffStore {
  workspaceId: string | null;
  status: GitDiffLoadStatus;
  diff: WorkspaceGitDiff | null;
  error: string;
  selectedPath: string | null;
  selectionSeq: number;
  loadGitDiff: (workspace: WorkspaceSummary) => Promise<void>;
  selectDiffPath: (path: string | null) => void;
  clearGitDiff: () => void;
}

export interface LayoutStore {
  sidebarCollapsed: boolean;
  sidebarOverlay: boolean;
  filesOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  resizing: ResizeSide | null;
  centerMode: CenterMode;
  agentTab: AgentTab;
  searchMode: WorkspaceSearchMode | null;
  focusedArtifactId: string | null;

  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarOverlay: (open: boolean) => void;
  toggleSidebar: (narrow: boolean) => void;
  setFilesOpen: (open: boolean) => void;
  toggleFilesPane: (narrow: boolean) => void;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  resetWidth: (side: ResizeSide) => void;
  setResizing: (side: ResizeSide | null) => void;
  setCenterMode: (mode: CenterMode) => void;
  setAgentTab: (tab: AgentTab) => void;
  setSearchMode: (mode: WorkspaceSearchMode | null) => void;
  setFocusedArtifactId: (artifactId: string | null) => void;
  closeOverlays: () => void;
}

export interface RuntimeStore {
  revision: number;
  stateRevision?: number;
  state: SilverState;
  busyThreads: string[];
  modelActivity?: DesktopSnapshot["modelActivity"];
  workspaceVersions?: Record<string, number>;
  currentThread: Thread | null;
  connection: DesktopConnection;
  connectionError: string;
  error: string;

  connectDesktop: () => () => void;
  clearError: () => void;
  dispatch: (action: UIAction) => void;
  newThread: (presetId: string) => void;
  openSample: () => void;
  isGenerating: (threadId: string) => boolean;
  stop: (threadId: string) => boolean;
  submitComposer: (threadId: string | undefined, draft: ChatDraft) => Promise<void>;
  saveDraft: (threadId: string, draft: ChatDraft) => Promise<void>;
  changePreset: (threadId: string | undefined, presetId: string) => void;
  selectModel: (threadId: string | undefined, modelId: string, modelName?: string) => void;
  retryMessage: (threadId: string, messageId: string) => void;
  retryRun: (threadId: string, runId: string) => void;
  updateBrief: (threadId: string, brief: Brief) => void;
  resolveConfirmation: (threadId: string, messageId: string, accepted: boolean) => void;
  setAutoApproval: (threadId: string, enabled: boolean, workspaceId?: string) => void;
  promoteThread: (threadId: string) => void;
  patchFinding: (threadId: string, finding: string) => void;
  bindWorkspace: (threadId: string, workspace: WorkspaceSummary) => void;
  openFolder: () => Promise<void>;
  attachWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
  acceptFile: (params: AcceptFileParams) => Promise<void>;
  decideFile: (params: FileDecisionParams) => void;
  saveProvider: (config: ProviderConfig, replacementKey?: string) => Promise<void>;
  testProvider: (config: ProviderConfig, replacementKey?: string) => Promise<string[]>;
}
