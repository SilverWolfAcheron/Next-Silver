import type { InspectorTab } from "../agent-core/types";
import type { AgentTab, SidebarBounds } from "../types/layout";

export const LEFT_SIDEBAR_BOUNDS: SidebarBounds = {
  defaultWidth: 260,
  minWidth: 200,
  maxWidth: 460,
};

export const RIGHT_SIDEBAR_BOUNDS: SidebarBounds = {
  defaultWidth: 280,
  minWidth: 200,
  maxWidth: 520,
};

export const CENTER_MIN_WIDTH: number = 480;
export const SHELL_HORIZONTAL_CHROME: number = 28;
export const NARROW_BREAKPOINT_WIDTH: number = 960;
export const RESIZE_KEYBOARD_STEP: number = 16;
export const NARROW_BREAKPOINT_QUERY: string = "(max-width: 959px)";

export const LAYOUT_STORAGE_KEYS: { readonly leftWidth: string; readonly rightWidth: string } = {
  leftWidth: "silver.leftWidth",
  rightWidth: "silver.rightWidth",
};

export const AGENT_TAB_IDS: readonly AgentTab[] = ["chat", "brief", "progress", "artifact"];
export const INSPECTOR_TAB_IDS: readonly InspectorTab[] = ["brief", "progress", "artifact"];
export const SHORTCUT_INSPECTOR_TABS: readonly InspectorTab[] = ["brief", "progress", "artifact"];
