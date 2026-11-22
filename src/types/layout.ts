import type { InspectorTab } from "../agent-core/types";

export type AgentTab = "chat" | InspectorTab;
export type CenterMode = "agent" | "editor";
export type ResizeSide = "left" | "right";
export type WorkspaceSearchMode = "files" | "text" | "attach";

export interface SidebarBounds {
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}

export interface UseGlobalShortcutsOptions {
  onSelectAgentTab: (tab: AgentTab) => void;
}
