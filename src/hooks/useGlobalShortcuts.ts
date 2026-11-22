import { useEffect } from "react";
import type { InspectorTab, Thread } from "../agent-core/types";
import { NARROW_BREAKPOINT_QUERY, SHORTCUT_INSPECTOR_TABS } from "../constants/layout";
import { useLayoutStore } from "../stores/layoutStore";
import { useRuntimeStore } from "../stores/runtimeStore";
import type {
  AgentTab,
  CenterMode,
  UseGlobalShortcutsOptions,
  WorkspaceSearchMode,
} from "../types/layout";
import type { LayoutStore, RuntimeStore } from "../types/stores";

export function useGlobalShortcuts({ onSelectAgentTab }: UseGlobalShortcutsOptions): void {
  const lastPresetId: string = useRuntimeStore((s: RuntimeStore): string => s.state.lastPresetId);
  const providerPanelOpen: boolean = useRuntimeStore(
    (s: RuntimeStore): boolean => s.state.providerPanelOpen
  );
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  const newThread: (presetId: string) => void = useRuntimeStore(
    (s: RuntimeStore): ((presetId: string) => void) => s.newThread
  );
  const stop: (threadId: string) => boolean = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string) => boolean) => s.stop
  );

  const sidebarOverlay: boolean = useLayoutStore((s: LayoutStore): boolean => s.sidebarOverlay);
  const filesOpen: boolean = useLayoutStore((s: LayoutStore): boolean => s.filesOpen);
  const centerMode: CenterMode = useLayoutStore((s: LayoutStore): CenterMode => s.centerMode);
  const agentTab: AgentTab = useLayoutStore((s: LayoutStore): AgentTab => s.agentTab);
  const searchMode: WorkspaceSearchMode | null = useLayoutStore(
    (s: LayoutStore): WorkspaceSearchMode | null => s.searchMode
  );
  const toggleSidebar: (narrow: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((narrow: boolean) => void) => s.toggleSidebar
  );
  const setSidebarOverlay: (open: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((open: boolean) => void) => s.setSidebarOverlay
  );
  const setSidebarCollapsed: (collapsed: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((collapsed: boolean) => void) => s.setSidebarCollapsed
  );
  const setFilesOpen: (open: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((open: boolean) => void) => s.setFilesOpen
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

  useEffect((): (() => void) => {
    function onKey(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return;
      const narrow: boolean = window.matchMedia(NARROW_BREAKPOINT_QUERY).matches;
      const key: string = event.key.toLowerCase();
      const shortcut: boolean = (event.ctrlKey || event.metaKey) && !event.altKey;

      if (shortcut && ((key === "p" && !event.shiftKey) || (key === "f" && event.shiftKey))) {
        event.preventDefault();
        setSearchMode(key === "p" ? "files" : "text");
        return;
      }
      if (searchMode || providerPanelOpen) return;

      if (event.key === "Escape") {
        if (currentThread && stop(currentThread.id)) {
          event.preventDefault();
        } else if (narrow && (sidebarOverlay || filesOpen)) {
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
          requestAnimationFrame((): void => document.getElementById("thread-search")?.focus());
          break;
        case "b":
          event.preventDefault();
          toggleSidebar(narrow);
          break;
        case "i":
          event.preventDefault();
          if (agentTab === "chat" || centerMode === "editor") {
            onSelectAgentTab(currentThread?.inspectorTab ?? "artifact");
          } else {
            onSelectAgentTab("chat");
          }
          break;
        case "1":
        case "2":
        case "3": {
          event.preventDefault();
          const targetTab: InspectorTab | undefined = SHORTCUT_INSPECTOR_TABS[Number(event.key) - 1];
          if (targetTab) onSelectAgentTab(targetTab);
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [
    agentTab,
    centerMode,
    currentThread,
    filesOpen,
    lastPresetId,
    newThread,
    onSelectAgentTab,
    providerPanelOpen,
    searchMode,
    setAgentTab,
    setCenterMode,
    setFilesOpen,
    setSearchMode,
    setSidebarCollapsed,
    setSidebarOverlay,
    sidebarOverlay,
    stop,
    toggleSidebar,
  ]);
}
