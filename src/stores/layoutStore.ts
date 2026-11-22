import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import {
  CENTER_MIN_WIDTH,
  LAYOUT_STORAGE_KEYS,
  LEFT_SIDEBAR_BOUNDS,
  RIGHT_SIDEBAR_BOUNDS,
  SHELL_HORIZONTAL_CHROME,
} from "../constants/layout";
import type {
  AgentTab,
  CenterMode,
  ResizeSide,
  SidebarBounds,
  WorkspaceSearchMode,
} from "../types/layout";
import type { LayoutStore, SidebarClampParams } from "../types/stores";

function readStoredWidth(key: string, bounds: SidebarBounds): number {
  try {
    const raw: string | null | undefined = globalThis.localStorage?.getItem(key);
    const parsed: number = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, parsed));
    }
  } catch {
    // Ignore storage errors.
  }
  return bounds.defaultWidth;
}

function persistWidth(key: string, value: number): void {
  try {
    globalThis.localStorage?.setItem(key, String(Math.round(value)));
  } catch {
    // Ignore storage errors.
  }
}

export function clampSidebarWidth(params: SidebarClampParams): number {
  const bounds: SidebarBounds =
    params.side === "left" ? LEFT_SIDEBAR_BOUNDS : RIGHT_SIDEBAR_BOUNDS;
  const maxForViewport: number = Math.max(
    bounds.minWidth,
    params.viewportWidth - params.otherWidth - CENTER_MIN_WIDTH - SHELL_HORIZONTAL_CHROME
  );
  return Math.round(
    Math.min(bounds.maxWidth, maxForViewport, Math.max(bounds.minWidth, params.rawWidth))
  );
}

export const useLayoutStore: UseBoundStore<StoreApi<LayoutStore>> = create<LayoutStore>(
  (set: StoreApi<LayoutStore>["setState"]): LayoutStore => ({
    sidebarCollapsed: false,
    sidebarOverlay: false,
    filesOpen: false,
    leftWidth: readStoredWidth(LAYOUT_STORAGE_KEYS.leftWidth, LEFT_SIDEBAR_BOUNDS),
    rightWidth: readStoredWidth(LAYOUT_STORAGE_KEYS.rightWidth, RIGHT_SIDEBAR_BOUNDS),
    resizing: null,
    centerMode: "agent",
    agentTab: "chat",
    searchMode: null,

    setSidebarCollapsed: (sidebarCollapsed: boolean): void => set({ sidebarCollapsed }),
    setSidebarOverlay: (sidebarOverlay: boolean): void => set({ sidebarOverlay }),
    toggleSidebar: (narrow: boolean): void =>
      set((current: LayoutStore): Partial<LayoutStore> =>
        narrow
          ? { filesOpen: false, sidebarOverlay: !current.sidebarOverlay }
          : { sidebarCollapsed: !current.sidebarCollapsed }
      ),
    setFilesOpen: (filesOpen: boolean): void => set({ filesOpen }),
    toggleFilesPane: (narrow: boolean): void =>
      set((current: LayoutStore): Partial<LayoutStore> =>
        narrow
          ? { sidebarOverlay: false, filesOpen: !current.filesOpen }
          : { filesOpen: !current.filesOpen }
      ),
    setLeftWidth: (width: number): void => {
      const clamped: number = Math.round(
        Math.min(LEFT_SIDEBAR_BOUNDS.maxWidth, Math.max(LEFT_SIDEBAR_BOUNDS.minWidth, width))
      );
      persistWidth(LAYOUT_STORAGE_KEYS.leftWidth, clamped);
      set({ leftWidth: clamped });
    },
    setRightWidth: (width: number): void => {
      const clamped: number = Math.round(
        Math.min(RIGHT_SIDEBAR_BOUNDS.maxWidth, Math.max(RIGHT_SIDEBAR_BOUNDS.minWidth, width))
      );
      persistWidth(LAYOUT_STORAGE_KEYS.rightWidth, clamped);
      set({ rightWidth: clamped });
    },
    resetWidth: (side: ResizeSide): void => {
      if (side === "left") {
        persistWidth(LAYOUT_STORAGE_KEYS.leftWidth, LEFT_SIDEBAR_BOUNDS.defaultWidth);
        set({ leftWidth: LEFT_SIDEBAR_BOUNDS.defaultWidth });
      } else {
        persistWidth(LAYOUT_STORAGE_KEYS.rightWidth, RIGHT_SIDEBAR_BOUNDS.defaultWidth);
        set({ rightWidth: RIGHT_SIDEBAR_BOUNDS.defaultWidth });
      }
    },
    setResizing: (resizing: ResizeSide | null): void => set({ resizing }),
    setCenterMode: (centerMode: CenterMode): void => set({ centerMode }),
    setAgentTab: (agentTab: AgentTab): void => set({ agentTab }),
    setSearchMode: (searchMode: WorkspaceSearchMode | null): void => set({ searchMode }),
    closeOverlays: (): void => set({ sidebarOverlay: false, searchMode: null }),
  })
);
