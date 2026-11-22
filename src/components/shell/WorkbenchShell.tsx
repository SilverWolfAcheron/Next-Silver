import { useCallback } from "react";
import type { CSSProperties, JSX, KeyboardEvent, PointerEvent } from "react";
import type { Thread, WorkspaceSummary } from "../../agent-core/types";
import {
  LEFT_SIDEBAR_BOUNDS,
  NARROW_BREAKPOINT_QUERY,
  RIGHT_SIDEBAR_BOUNDS,
} from "../../constants/layout";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { useI18n } from "../../hooks/useI18n";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { useWorkspaceGitDiff } from "../../hooks/useWorkspaceGitDiff";
import { useComposerStore } from "../../stores/composerStore";
import { useEditorStore } from "../../stores/editorStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { EditorTabState, FilePreview } from "../../types/editor";
import type { AgentTab, CenterMode, WorkspaceSearchMode } from "../../types/layout";
import type { UIAction } from "../../types/runtime";
import type {
  ComposerStore,
  EditorStore,
  FilePreviewRequest,
  LayoutStore,
  RuntimeStore,
} from "../../types/stores";
import { makeEditorScope } from "../../utils/editorData";
import { AgentPane } from "../chat/AgentPane";
import { ResizeHandle } from "../common/ResizeHandle";
import { EditorPane } from "../editor/EditorPane";
import { ProviderModal } from "../provider/ProviderModal";
import { SessionSidebar } from "../sidebar/SessionSidebar";
import { WorkspaceExplorer } from "../workspace/WorkspaceExplorer";
import { WorkspaceSearchModal } from "../workspace/WorkspaceSearchModal";
import { TopBar } from "./TopBar";

export function WorkbenchShell(): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const providerPanelOpen: boolean = useRuntimeStore(
    (s: RuntimeStore): boolean => s.state.providerPanelOpen
  );
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  const dispatch: (action: UIAction) => void = useRuntimeStore(
    (s: RuntimeStore): ((action: UIAction) => void) => s.dispatch
  );
  const openFolder: () => Promise<void> = useRuntimeStore(
    (s: RuntimeStore): (() => Promise<void>) => s.openFolder
  );
  const attachWorkspace: (workspace: WorkspaceSummary) => Promise<void> = useRuntimeStore(
    (s: RuntimeStore): ((workspace: WorkspaceSummary) => Promise<void>) => s.attachWorkspace
  );

  const filePreview: FilePreview | null = useEditorStore(
    (s: EditorStore): FilePreview | null => s.filePreview
  );
  const editorTabs: Record<string, EditorTabState> = useEditorStore(
    (s: EditorStore): Record<string, EditorTabState> => s.editorTabs
  );
  const previewFile: (request: FilePreviewRequest) => Promise<void> = useEditorStore(
    (s: EditorStore): ((request: FilePreviewRequest) => Promise<void>) => s.previewFile
  );
  const closeFilePreview: () => void = useEditorStore(
    (s: EditorStore): (() => void) => s.closeFilePreview
  );

  const attachToComposer: (thread: Thread | null, path: string) => void = useComposerStore(
    (s: ComposerStore): ((thread: Thread | null, path: string) => void) => s.attachToComposer
  );

  const sidebarCollapsed: boolean = useLayoutStore((s: LayoutStore): boolean => s.sidebarCollapsed);
  const sidebarOverlay: boolean = useLayoutStore((s: LayoutStore): boolean => s.sidebarOverlay);
  const filesOpen: boolean = useLayoutStore((s: LayoutStore): boolean => s.filesOpen);
  const centerMode: CenterMode = useLayoutStore((s: LayoutStore): CenterMode => s.centerMode);
  const agentTab: AgentTab = useLayoutStore((s: LayoutStore): AgentTab => s.agentTab);
  const searchMode: WorkspaceSearchMode | null = useLayoutStore(
    (s: LayoutStore): WorkspaceSearchMode | null => s.searchMode
  );
  const setSidebarOverlay: (open: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((open: boolean) => void) => s.setSidebarOverlay
  );
  const setFilesOpen: (open: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((open: boolean) => void) => s.setFilesOpen
  );
  const toggleSidebar: (narrow: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((narrow: boolean) => void) => s.toggleSidebar
  );
  const toggleFilesPane: (narrow: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((narrow: boolean) => void) => s.toggleFilesPane
  );
  const setCenterMode: (mode: CenterMode) => void = useLayoutStore(
    (s: LayoutStore): ((mode: CenterMode) => void) => s.setCenterMode
  );
  const setAgentTab: (tab: AgentTab) => void = useLayoutStore(
    (s: LayoutStore): ((tab: AgentTab) => void) => s.setAgentTab
  );
  const setSearchMode: (mode: WorkspaceSearchMode | null) => void = useLayoutStore(
    (s: LayoutStore): ((mode: WorkspaceSearchMode | null) => void) => s.setSearchMode
  );

  const {
    leftWidth,
    rightWidth,
    isNarrowViewport,
    resizing,
    startResize,
    handleResizeKey,
    resetWidth,
  }: ReturnType<typeof useSidebarResize> = useSidebarResize();

  const threadId: string | undefined = currentThread?.id;
  const workspace: WorkspaceSummary | undefined = currentThread?.workspace;
  const changesMode: boolean = centerMode === "agent" && agentTab === "artifact";
  const {
    selectedPath: selectedDiffPath,
    selectPath: selectDiffPath,
  }: ReturnType<typeof useWorkspaceGitDiff> = useWorkspaceGitDiff(workspace, changesMode);
  const scope: string = makeEditorScope(threadId, workspace?.id);
  const activePreview: FilePreview | null =
    filePreview?.threadId === threadId && workspace?.id === filePreview?.workspaceId
      ? filePreview
      : null;
  const hasOpenFiles: boolean = Boolean(
    activePreview ?? (scope && editorTabs[scope]?.paths.length)
  );

  const isNarrow = (): boolean => window.matchMedia(NARROW_BREAKPOINT_QUERY).matches;

  const selectAgentTab: (tab: AgentTab) => void = useCallback(
    (tab: AgentTab): void => {
      setAgentTab(tab);
      setCenterMode("agent");
      if (!currentThread) return;
      if (providerPanelOpen) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
      if (tab !== "chat") {
        dispatch({ type: "SET_INSPECTOR_TAB", threadId: currentThread.id, tab });
        dispatch({ type: "SET_INSPECTOR_OPEN", threadId: currentThread.id, open: true });
      }
    },
    [currentThread, dispatch, providerPanelOpen, setAgentTab, setCenterMode]
  );

  useGlobalShortcuts({ onSelectAgentTab: selectAgentTab });

  function openFileInCenter(path: string, line?: number): void {
    if (!currentThread || !workspace) return;
    void previewFile({ threadId: currentThread.id, workspace, path, line });
    if (providerPanelOpen) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    setCenterMode("editor");
    if (isNarrow()) setFilesOpen(false);
  }

  function handleAttachFile(path: string): void {
    dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    setAgentTab("chat");
    setCenterMode("agent");
    attachToComposer(currentThread, path);
  }

  const sidebarClass: string = sidebarOverlay
    ? "absolute inset-y-1.5 left-1.5 z-50 flex w-[260px] max-w-[85vw] overflow-hidden rounded-[14px] border border-separator bg-canvas shadow-lg"
    : sidebarCollapsed
      ? "hidden"
      : "hidden h-full shrink-0 min-[960px]:flex min-[960px]:w-[var(--sidebar-w)]";

  const rightFilesClass: string = filesOpen
    ? "absolute inset-y-1.5 right-1.5 z-40 flex w-[280px] max-w-[85vw] overflow-hidden rounded-[14px] border border-separator bg-canvas shadow-lg min-[960px]:static min-[960px]:z-auto min-[960px]:h-full min-[960px]:shrink-0 min-[960px]:rounded-none min-[960px]:border-0 min-[960px]:w-[var(--files-w)] min-[960px]:shadow-none"
    : "hidden";

  const layoutVars: CSSProperties = {
    "--sidebar-w": `${leftWidth}px`,
    "--files-w": `${rightWidth}px`,
  } as CSSProperties;

  return (
    <div style={layoutVars} className="relative flex h-full overflow-hidden bg-canvas p-1.5 pt-1">
      {(sidebarOverlay || filesOpen) && (
        <button
          type="button"
          aria-label={t.layout.closePanel}
          className="absolute inset-0 z-30 bg-scrim min-[960px]:hidden"
          onClick={(): void => {
            setSidebarOverlay(false);
            setFilesOpen(false);
          }}
        />
      )}

      <div className={sidebarClass}>
        <SessionSidebar onNavigate={(): void => setSidebarOverlay(false)} />
      </div>

      {!sidebarCollapsed && !sidebarOverlay && !isNarrowViewport && (
        <ResizeHandle
          label={t.layout.resizeLeftSidebar}
          tooltip={t.layout.resizeTooltip}
          value={leftWidth}
          min={LEFT_SIDEBAR_BOUNDS.minWidth}
          max={LEFT_SIDEBAR_BOUNDS.maxWidth}
          active={resizing === "left"}
          onPointerDown={(event: PointerEvent<HTMLDivElement>): void => startResize("left", event)}
          onDoubleClick={(): void => resetWidth("left")}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>): void => handleResizeKey("left", event)}
        />
      )}

      <main className="flex min-h-0 min-w-[min(100%,480px)] flex-1 flex-col overflow-hidden rounded-[14px] border border-separator/85 bg-surface shadow-[0_1px_8px_rgba(44,36,27,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.22)]">
        <TopBar
          sidebarCollapsed={isNarrowViewport ? !sidebarOverlay : sidebarCollapsed}
          filesOpen={filesOpen}
          centerMode={centerMode}
          agentTab={agentTab}
          hasOpenFiles={hasOpenFiles}
          workspaceName={workspace?.name}
          onToggleSidebar={(): void => toggleSidebar(isNarrow())}
          onSelectAgentTab={selectAgentTab}
          onSelectEditorMode={(): void => {
            if (providerPanelOpen) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
            setCenterMode("editor");
          }}
          onToggleFilesPane={(): void => toggleFilesPane(isNarrow())}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {centerMode === "editor" ? (
            <EditorPane
              embedded
              onOpenQuickFiles={(): void => setSearchMode("files")}
              onAttachFile={handleAttachFile}
              onAllTabsClosed={(): void => setCenterMode("agent")}
            />
          ) : (
            <AgentPane
              tab={agentTab}
              onTab={selectAgentTab}
              hideTabs
              centered
              onPickReferenceFile={(): void => setSearchMode("attach")}
              onOpenFile={(path: string): void => openFileInCenter(path)}
            />
          )}
        </div>
      </main>

      {filesOpen && !isNarrowViewport && (
        <ResizeHandle
          label={t.layout.resizeRightSidebar}
          tooltip={t.layout.resizeTooltip}
          value={rightWidth}
          min={RIGHT_SIDEBAR_BOUNDS.minWidth}
          max={RIGHT_SIDEBAR_BOUNDS.maxWidth}
          active={resizing === "right"}
          onPointerDown={(event: PointerEvent<HTMLDivElement>): void => startResize("right", event)}
          onDoubleClick={(): void => resetWidth("right")}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>): void => handleResizeKey("right", event)}
        />
      )}

      <aside aria-label={t.layout.workspaceFilesPanel} className={rightFilesClass}>
        {filesOpen && (
          <WorkspaceExplorer
            workspace={workspace}
            changesMode={changesMode}
            selectedPath={changesMode ? (selectedDiffPath ?? undefined) : activePreview?.path}
            onBind={(nextWorkspace: WorkspaceSummary): void => {
              if (currentThread && filePreview?.threadId === currentThread.id) closeFilePreview();
              void attachWorkspace(nextWorkspace);
            }}
            onPreview={(path: string): void => openFileInCenter(path)}
            onSelectChangedFile={(path: string): void => {
              selectDiffPath(path);
              if (isNarrow()) setFilesOpen(false);
            }}
            onSearchText={(): void => setSearchMode("text")}
          />
        )}
      </aside>

      {providerPanelOpen && <ProviderModal />}

      {searchMode && (
        <WorkspaceSearchModal
          mode={searchMode}
          workspace={workspace}
          onMode={setSearchMode}
          onClose={(): void => setSearchMode(null)}
          onOpenFolder={(): void => {
            void openFolder();
          }}
          onOpen={(path: string, line?: number): void => openFileInCenter(path, line)}
          onAttach={(path: string): void => handleAttachFile(path)}
        />
      )}
    </div>
  );
}
