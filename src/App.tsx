import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useSilverStore } from "./state/silverStore";
import { Sidebar } from "./shell/Sidebar";
import { Editor } from "./shell/Editor";
import { AGENT_TABS, AgentPane } from "./shell/AgentPane";
import { ProviderPanel } from "./shell/ProviderPanel";
import { WorkspacePanel } from "./shell/WorkspacePanel";
import { WorkspaceSearch, type WorkspaceSearchMode } from "./shell/WorkspaceSearch";
import type { InspectorTab } from "./model/types";

type AgentTab = "chat" | InspectorTab;
type CenterMode = "agent" | "editor";
type ResizeSide = "left" | "right";

const LEFT_DEFAULT = 260;
const LEFT_MIN = 200;
const LEFT_MAX = 460;
const RIGHT_DEFAULT = 280;
const RIGHT_MIN = 200;
const RIGHT_MAX = 520;
const CENTER_MIN = 360;

function readWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = Number(window.localStorage.getItem(key));
    if (Number.isFinite(raw)) return Math.min(max, Math.max(min, Math.round(raw)));
  } catch {
    // Ignore storage unavailability
  }
  return fallback;
}

function saveWidth(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Ignore storage unavailability
  }
}

function Shell() {
  const theme = useSilverStore((s) => s.state.appearance.theme);
  const lastPresetId = useSilverStore((s) => s.state.lastPresetId);
  const providerPanelOpen = useSilverStore((s) => s.state.providerPanelOpen);
  const currentThread = useSilverStore((s) => s.currentThread);
  const filePreview = useSilverStore((s) => s.filePreview);
  const editorTabs = useSilverStore((s) => s.editorTabs);
  const dispatch = useSilverStore((s) => s.dispatch);
  const newThread = useSilverStore((s) => s.newThread);
  const stop = useSilverStore((s) => s.stop);
  const openFolder = useSilverStore((s) => s.openFolder);
  const previewFile = useSilverStore((s) => s.previewFile);
  const closeFilePreview = useSilverStore((s) => s.closeFilePreview);
  const attachWorkspace = useSilverStore((s) => s.attachWorkspace);
  const attachToComposer = useSilverStore((s) => s.attachToComposer);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => readWidth("silver.leftWidth", LEFT_DEFAULT, LEFT_MIN, LEFT_MAX));
  const [rightWidth, setRightWidth] = useState(() => readWidth("silver.rightWidth", RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX));
  const [resizing, setResizing] = useState<ResizeSide | null>(null);
  const [centerMode, setCenterMode] = useState<CenterMode>("agent");
  const [agentTab, setAgentTab] = useState<AgentTab>("chat");
  const [search, setSearch] = useState<WorkspaceSearchMode>();

  function clampLeft(next: number): number {
    const other = filesOpen ? rightWidth : 0;
    const maxByWindow = Math.max(LEFT_MIN, window.innerWidth - other - CENTER_MIN);
    return Math.min(LEFT_MAX, maxByWindow, Math.max(LEFT_MIN, Math.round(next)));
  }

  function clampRight(next: number): number {
    const other = !sidebarCollapsed ? leftWidth : 0;
    const maxByWindow = Math.max(RIGHT_MIN, window.innerWidth - other - CENTER_MIN);
    return Math.min(RIGHT_MAX, maxByWindow, Math.max(RIGHT_MIN, Math.round(next)));
  }

  function startResize(side: ResizeSide, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const initial = side === "left" ? leftWidth : rightWidth;
    let latest = initial;
    setResizing(side);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(moveEvent: PointerEvent) {
      const delta = moveEvent.clientX - startX;
      if (side === "left") {
        latest = clampLeft(initial + delta);
        setLeftWidth(latest);
      } else {
        latest = clampRight(initial - delta);
        setRightWidth(latest);
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      setResizing(null);
      saveWidth(side === "left" ? "silver.leftWidth" : "silver.rightWidth", latest);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const threadId = currentThread?.id;
  const workspace = currentThread?.workspace;
  const scope = threadId && workspace ? JSON.stringify([threadId, workspace.id]) : "";
  const activePreview = filePreview && filePreview.threadId === threadId && workspace &&
    workspace.id === filePreview.workspaceId ? filePreview : null;
  const hasOpenFiles = Boolean(activePreview || (scope && editorTabs[scope]?.paths.length));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      root.classList.toggle("dark", mq.matches);
      const handler = (e: MediaQueryListEvent) =>
        root.classList.toggle("dark", e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  const narrowQuery = "(max-width: 959px)";

  function toggleSidebar() {
    if (window.matchMedia(narrowQuery).matches) {
      setFilesOpen(false);
      setSidebarOverlay((open) => !open);
    } else {
      setSidebarCollapsed((closed) => !closed);
    }
  }

  function toggleFilesPane() {
    if (window.matchMedia(narrowQuery).matches) {
      setSidebarOverlay(false);
    }
    setFilesOpen((open) => !open);
  }

  function selectAgentTab(tab: AgentTab) {
    setAgentTab(tab);
    setCenterMode("agent");
    if (!currentThread) return;
    if (providerPanelOpen) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    if (tab !== "chat") {
      dispatch({ type: "SET_INSPECTOR_TAB", threadId: currentThread.id, tab });
      dispatch({ type: "SET_INSPECTOR_OPEN", threadId: currentThread.id, open: true });
    }
  }

  function openFileInCenter(path: string, line?: number) {
    if (!currentThread) return;
    void previewFile(currentThread.id, path, line);
    if (providerPanelOpen) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    setCenterMode("editor");
    if (window.matchMedia(narrowQuery).matches) {
      setFilesOpen(false);
    }
  }

  function handleAttachFile(path: string) {
    dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    setAgentTab("chat");
    setCenterMode("agent");
    attachToComposer(path);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const narrow = window.matchMedia(narrowQuery).matches;
      const key = event.key.toLowerCase();
      const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (shortcut && ((key === "p" && !event.shiftKey) || (key === "f" && event.shiftKey))) {
        event.preventDefault();
        setSearch(key === "p" ? "files" : "text");
        return;
      }
      if (search || providerPanelOpen) return;
      if (event.key === "Escape") {
        if (currentThread && stop(currentThread.id)) event.preventDefault();
        else if (narrow && (sidebarOverlay || filesOpen)) {
          setSidebarOverlay(false);
          setFilesOpen(false);
        } else if (centerMode === "editor") {
          setCenterMode("agent");
        } else if (agentTab !== "chat") {
          setAgentTab("chat");
        }
        return;
      }
      if (!shortcut || event.shiftKey) return;
      switch (key) {
        case "n":
          event.preventDefault();
          newThread(lastPresetId);
          setCenterMode("agent");
          break;
        case "k":
          event.preventDefault();
          if (narrow) setSidebarOverlay(true);
          else setSidebarCollapsed(false);
          requestAnimationFrame(() => document.getElementById("thread-search")?.focus());
          break;
        case "b":
          event.preventDefault();
          toggleSidebar();
          break;
        case "i":
          event.preventDefault();
          if (agentTab === "chat" || centerMode === "editor") selectAgentTab(currentThread?.inspectorTab ?? "artifact");
          else selectAgentTab("chat");
          break;
        case "1":
        case "2":
        case "3": {
          event.preventDefault();
          const tabs = ["brief", "progress", "artifact"] as const;
          selectAgentTab(tabs[Number(event.key) - 1]);
          break;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sidebarClass = sidebarOverlay
    ? "absolute inset-y-0 left-0 z-50 flex h-full w-[260px] max-w-[85vw] shadow-lg"
    : sidebarCollapsed
      ? "hidden"
      : "hidden h-full shrink-0 min-[960px]:flex min-[960px]:w-[var(--sidebar-w)]";

  const rightFilesClass = filesOpen
    ? "absolute inset-y-0 right-0 z-40 flex h-full w-[280px] max-w-[85vw] border-l border-separator bg-canvas shadow-lg min-[960px]:static min-[960px]:z-auto min-[960px]:shrink-0 min-[960px]:w-[var(--files-w)] min-[960px]:shadow-none"
    : "hidden";

  const layoutVars = {
    "--sidebar-w": `${leftWidth}px`,
    "--files-w": `${rightWidth}px`,
  } as CSSProperties;

  return (
    <div style={layoutVars} className="relative flex h-full overflow-hidden bg-canvas">
      {(sidebarOverlay || filesOpen) && (
        <button
          type="button"
          aria-label="关闭面板"
          className="absolute inset-0 z-30 bg-label/15 min-[960px]:hidden"
          onClick={() => { setSidebarOverlay(false); setFilesOpen(false); }}
        />
      )}

      <div className={sidebarClass}>
        <Sidebar onNavigate={() => setSidebarOverlay(false)} />
      </div>

      {!sidebarCollapsed && !sidebarOverlay && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左侧会话栏宽度"
          aria-valuenow={leftWidth}
          aria-valuemin={LEFT_MIN}
          aria-valuemax={LEFT_MAX}
          tabIndex={0}
          title="拖动调整宽度，双击恢复默认"
          onPointerDown={(event) => startResize("left", event)}
          onDoubleClick={() => { setLeftWidth(LEFT_DEFAULT); saveWidth("silver.leftWidth", LEFT_DEFAULT); }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = clampLeft(leftWidth + (event.key === "ArrowRight" ? 16 : -16));
            setLeftWidth(next);
            saveWidth("silver.leftWidth", next);
          }}
          className="group/resizer relative z-20 -mx-1 hidden w-2 shrink-0 cursor-col-resize select-none min-[960px]:flex justify-center focus:outline-none"
        >
          <span
            aria-hidden="true"
            className={`h-full w-0.5 transition-colors ${
              resizing === "left"
                ? "bg-accent"
                : "bg-transparent group-hover/resizer:bg-accent/55 group-focus-visible/resizer:bg-accent"
            }`}
          />
        </div>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-separator bg-surface px-2.5">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-label={sidebarCollapsed ? "打开左侧会话栏" : "隐藏左侧会话栏"}
              aria-expanded={!sidebarCollapsed}
              aria-pressed={!sidebarCollapsed}
              title={sidebarCollapsed ? "打开左侧会话栏 (Ctrl+B)" : "隐藏左侧会话栏 (Ctrl+B)"}
              onClick={toggleSidebar}
              className={`flex h-8 max-w-[160px] items-center gap-1.5 rounded-[7px] px-2 text-[12px] transition-colors ${
                !sidebarCollapsed ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill hover:text-label"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0">
                {!sidebarCollapsed && (
                  <path d="M3.5 2.5h2.25v11H3.5A1.5 1.5 0 0 1 2 12V4a1.5 1.5 0 0 1 1.5-1.5Z" fill="currentColor" />
                )}
                <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5.75 2.5v11" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span className="hidden truncate font-mono sm:inline">Session</span>
            </button>
          </div>

          <div
            role="group"
            aria-label="主视图切换"
            className="inline-flex items-center gap-0.5 justify-self-center rounded-[10px] border border-separator bg-canvas p-0.5"
          >
            {AGENT_TABS.map((item) => {
              const active = centerMode === "agent" && agentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectAgentTab(item.id)}
                  className={`h-8 rounded-[8px] px-3 text-[13px] transition-colors ${
                    active ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill/60 hover:text-label"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
            {(hasOpenFiles || centerMode === "editor") && (
              <button
                type="button"
                aria-pressed={centerMode === "editor"}
                onClick={() => {
                  if (providerPanelOpen) dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
                  setCenterMode("editor");
                }}
                className={`h-8 rounded-[8px] px-3 text-[13px] transition-colors ${
                  centerMode === "editor" ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill/60 hover:text-label"
                }`}
              >
                文件
              </button>
            )}
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1">
            <button
              type="button"
              aria-label={filesOpen ? "隐藏右侧文件栏" : "打开右侧文件栏"}
              aria-expanded={filesOpen}
              aria-pressed={filesOpen}
              title={filesOpen ? "隐藏右侧文件栏" : "打开右侧文件栏"}
              onClick={toggleFilesPane}
              className={`flex h-8 max-w-[180px] items-center gap-1.5 rounded-[7px] px-2 text-[12px] transition-colors ${
                filesOpen ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill hover:text-label"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0">
                {filesOpen && (
                  <path d="M10.25 2.5h2.25A1.5 1.5 0 0 1 14 4v8a1.5 1.5 0 0 1-1.5 1.5h-2.25v-11Z" fill="currentColor" />
                )}
                <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M10.25 2.5v11" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span className="hidden truncate font-mono sm:inline">{workspace?.name ?? "文件"}</span>
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {centerMode === "editor" ? (
            <Editor
              embedded
              onOpenQuickFiles={() => setSearch("files")}
              onAttachFile={handleAttachFile}
              onAllTabsClosed={() => setCenterMode("agent")}
            />
          ) : (
            <AgentPane
              tab={agentTab}
              onTab={selectAgentTab}
              hideTabs
              centered
              onPickReferenceFile={() => setSearch("attach")}
            />
          )}
        </div>
      </main>

      {filesOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧文件栏宽度"
          aria-valuenow={rightWidth}
          aria-valuemin={RIGHT_MIN}
          aria-valuemax={RIGHT_MAX}
          tabIndex={0}
          title="拖动调整宽度，双击恢复默认"
          onPointerDown={(event) => startResize("right", event)}
          onDoubleClick={() => { setRightWidth(RIGHT_DEFAULT); saveWidth("silver.rightWidth", RIGHT_DEFAULT); }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = clampRight(rightWidth + (event.key === "ArrowLeft" ? 16 : -16));
            setRightWidth(next);
            saveWidth("silver.rightWidth", next);
          }}
          className="group/resizer relative z-20 -mx-1 hidden w-2 shrink-0 cursor-col-resize select-none min-[960px]:flex justify-center focus:outline-none"
        >
          <span
            aria-hidden="true"
            className={`h-full w-0.5 transition-colors ${
              resizing === "right"
                ? "bg-accent"
                : "bg-transparent group-hover/resizer:bg-accent/55 group-focus-visible/resizer:bg-accent"
            }`}
          />
        </div>
      )}

      <aside aria-label="工作区文件栏" className={rightFilesClass}>
        {filesOpen && (
          <WorkspacePanel
            workspace={workspace}
            selectedPath={activePreview?.path}
            onBind={(nextWorkspace) => {
              if (currentThread && filePreview?.threadId === currentThread.id) closeFilePreview();
              void attachWorkspace(nextWorkspace);
            }}
            onPreview={(path) => openFileInCenter(path)}
            onSearchText={() => setSearch("text")}
          />
        )}
      </aside>

      {providerPanelOpen && <ProviderPanel />}

      {search && (
        <WorkspaceSearch
          mode={search}
          workspace={workspace}
          onMode={setSearch}
          onClose={() => setSearch(undefined)}
          onOpenFolder={() => void openFolder()}
          onOpen={(path, line) => openFileInCenter(path, line)}
          onAttach={(path) => handleAttachFile(path)}
        />
      )}
    </div>
  );
}

export default function App() {
  const connection = useSilverStore((s) => s.connection);
  const connectionError = useSilverStore((s) => s.connectionError);
  const error = useSilverStore((s) => s.error);
  const clearError = useSilverStore((s) => s.clearError);
  const connectDesktop = useSilverStore((s) => s.connectDesktop);

  useEffect(() => connectDesktop(), [connectDesktop]);

  if (connection !== "ready") return (
    <main className="flex h-full items-center justify-center bg-surface px-4 text-center text-secondary">
      <div>
        <p>{connection === "unavailable" ? "请从 Windows 开始菜单打开 Silver 桌面程序。" : "正在连接 Silver 本机运行时…"}</p>
        {connectionError && <p className="mt-2 text-[13px] text-danger">{connectionError}</p>}
      </div>
    </main>
  );

  return (
    <>
      <Shell />
      {error && (
        <div role="alert" className="fixed inset-x-4 bottom-3 z-[60] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-[12px] border border-separator bg-group px-4 py-2 text-[13px] text-danger">
          {error}
          <button type="button" className="min-h-11 px-2 text-secondary" onClick={clearError}>关闭</button>
        </div>
      )}
    </>
  );
}
