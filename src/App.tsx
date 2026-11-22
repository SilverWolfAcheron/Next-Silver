import { useEffect, useState } from "react";
import { SilverProvider, useSilver } from "./state/SilverContext";
import { Sidebar } from "./shell/Sidebar";
import { Editor } from "./shell/Editor";
import { AgentPane } from "./shell/AgentPane";
import { WorkspaceSearch, type WorkspaceSearchMode } from "./shell/WorkspaceSearch";
import type { InspectorTab } from "./model/types";

type AgentTab = "chat" | InspectorTab;

function Shell() {
  const { state, currentThread, dispatch, newThread, stop, openFolder, previewFile, attachToComposer } = useSilver();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  const [agentOverlay, setAgentOverlay] = useState(false);
  const [agentTab, setAgentTab] = useState<AgentTab>("chat");
  const [search, setSearch] = useState<WorkspaceSearchMode>();

  useEffect(() => {
    const root = document.documentElement;
    const { theme } = state.appearance;
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
  }, [state.appearance]);

  const narrowQuery = "(max-width: 959px)";

  function toggleSidebar() {
    if (window.matchMedia(narrowQuery).matches) {
      setAgentOverlay(false);
      setSidebarOverlay((open) => !open);
    } else setSidebarCollapsed((closed) => !closed);
  }

  function openAgent() {
    if (window.matchMedia(narrowQuery).matches) {
      setSidebarOverlay(false);
      setAgentOverlay(true);
    }
  }

  function showInspector(tab: InspectorTab) {
    setAgentTab(tab);
    openAgent();
    if (!currentThread) return;
    dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
    dispatch({ type: "SET_INSPECTOR_TAB", threadId: currentThread.id, tab });
    dispatch({ type: "SET_INSPECTOR_OPEN", threadId: currentThread.id, open: true });
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
      if (search) return;
      if (event.key === "Escape") {
        if (currentThread && stop(currentThread.id)) event.preventDefault();
        else if (narrow && (sidebarOverlay || agentOverlay)) {
          setSidebarOverlay(false);
          setAgentOverlay(false);
        } else if (agentTab !== "chat") setAgentTab("chat");
        return;
      }
      if (!shortcut || event.shiftKey) return;
      switch (key) {
        case "n":
          event.preventDefault();
          newThread(state.lastPresetId);
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
          if (agentTab === "chat") showInspector(currentThread?.inspectorTab ?? "artifact");
          else setAgentTab("chat");
          break;
        case "1":
        case "2":
        case "3": {
          event.preventDefault();
          const tabs = ["brief", "progress", "artifact"] as const;
          showInspector(tabs[Number(event.key) - 1]);
          break;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sidebarClass = sidebarOverlay
    ? "absolute inset-y-0 left-0 z-50 flex h-full"
    : sidebarCollapsed
      ? "hidden"
      : "hidden h-full shrink-0 min-[960px]:flex";
  const agentClass = agentOverlay
    ? "absolute inset-y-0 right-0 z-40 flex h-full w-[400px] max-w-full border-l border-separator"
    : "hidden h-full w-[400px] max-w-full shrink-0 border-l border-separator min-[960px]:flex";

  return (
    <div className="relative flex h-full overflow-hidden bg-canvas">
      {(sidebarOverlay || agentOverlay) && (
        <button
          type="button"
          aria-label="关闭面板"
          className="absolute inset-0 z-30 bg-label/15 min-[960px]:hidden"
          onClick={() => { setSidebarOverlay(false); setAgentOverlay(false); }}
        />
      )}
      <div className={sidebarClass}>
        <Sidebar onNavigate={() => setSidebarOverlay(false)} />
      </div>
      <Editor
        showSidebarButton={sidebarCollapsed || sidebarOverlay}
        showAgentButton
        onOpenSidebar={toggleSidebar}
        onOpenQuickFiles={() => setSearch("files")}
        onAttachFile={(path) => {
          dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: false });
          setAgentTab("chat");
          openAgent();
          attachToComposer(path);
        }}
        onOpenAgent={() => {
          if (window.matchMedia(narrowQuery).matches) openAgent();
          else setAgentTab("chat");
        }}
      />
      <div className={agentClass}>
        <AgentPane tab={agentTab} onTab={setAgentTab} />
      </div>
      {search && (
        <WorkspaceSearch
          mode={search}
          workspace={currentThread?.workspace}
          onMode={setSearch}
          onClose={() => setSearch(undefined)}
          onOpenFolder={() => void openFolder()}
          onOpen={(path, line) => {
            if (currentThread) void previewFile(currentThread.id, path, line);
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <SilverProvider>
      <Shell />
    </SilverProvider>
  );
}
