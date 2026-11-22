import type { AgentTab, CenterMode } from "./layout";
import type { DesktopConnection } from "./runtime";

export interface ConnectionScreenProps {
  connection: Exclude<DesktopConnection, "ready">;
  connectionError: string;
}

export interface ErrorToastProps {
  error: string;
  onDismiss: () => void;
}

export interface TopBarProps {
  sidebarCollapsed: boolean;
  filesOpen: boolean;
  centerMode: CenterMode;
  agentTab: AgentTab;
  hasOpenFiles: boolean;
  workspaceName?: string;
  onToggleSidebar: () => void;
  onSelectAgentTab: (tab: AgentTab) => void;
  onSelectEditorMode: () => void;
  onToggleFilesPane: () => void;
}
