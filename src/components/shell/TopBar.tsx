import type { JSX } from "react";
import { AGENT_TAB_IDS } from "../../constants/layout";
import { useI18n } from "../../hooks/useI18n";
import type { AgentTab } from "../../types/layout";
import type { TopBarProps } from "../../types/shell";
import { SidebarLeftIcon, SidebarRightIcon } from "../common/Icons";

export function TopBar({
  sidebarCollapsed,
  filesOpen,
  centerMode,
  agentTab,
  hasOpenFiles,
  workspaceName,
  onToggleSidebar,
  onSelectAgentTab,
  onSelectEditorMode,
  onToggleFilesPane,
}: TopBarProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <header className="@container grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 overflow-hidden border-b border-separator/70 bg-surface px-2.5">
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        <button
          type="button"
          aria-label={sidebarCollapsed ? t.layout.openLeftSidebar : t.layout.hideLeftSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-pressed={!sidebarCollapsed}
          title={
            sidebarCollapsed ? t.layout.openLeftSidebarShortcut : t.layout.hideLeftSidebarShortcut
          }
          onClick={onToggleSidebar}
          className={`flex h-8 min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-[9px] px-2 text-[12px] transition-colors @[580px]:px-2.5 ${
            !sidebarCollapsed
              ? "bg-fill font-medium text-label"
              : "text-secondary hover:bg-fill hover:text-label"
          }`}
        >
          <span className="inline-flex shrink-0">
            <SidebarLeftIcon active={!sidebarCollapsed} />
          </span>
          <span className="hidden truncate @[580px]:inline">{t.layout.sessionButton}</span>
        </button>
      </div>

      <div
        role="group"
        aria-label={t.layout.mainViewSwitch}
        className="inline-flex min-w-0 max-w-full items-center gap-0.5 justify-self-center overflow-x-auto rounded-[11px] border border-separator/80 bg-canvas p-0.5"
      >
        {AGENT_TAB_IDS.map((tabId: AgentTab): JSX.Element => {
          const active: boolean = centerMode === "agent" && agentTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              aria-pressed={active}
              onClick={(): void => onSelectAgentTab(tabId)}
              className={`h-8 shrink-0 whitespace-nowrap rounded-[8px] px-2.5 text-[13px] transition-colors @[520px]:px-3 ${
                active
                  ? "bg-fill font-medium text-label"
                  : "text-secondary hover:bg-fill/60 hover:text-label"
              }`}
            >
              {t.layout.tabs[tabId]}
            </button>
          );
        })}

        {(hasOpenFiles || centerMode === "editor") && (
          <button
            type="button"
            aria-pressed={centerMode === "editor"}
            onClick={onSelectEditorMode}
            className={`h-8 shrink-0 whitespace-nowrap rounded-[8px] px-2.5 text-[13px] transition-colors @[520px]:px-3 ${
              centerMode === "editor"
                ? "bg-fill font-medium text-label"
                : "text-secondary hover:bg-fill/60 hover:text-label"
            }`}
          >
            {t.layout.tabs.file}
          </button>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden">
        <button
          type="button"
          aria-label={filesOpen ? t.layout.hideRightSidebar : t.layout.openRightSidebar}
          aria-expanded={filesOpen}
          aria-pressed={filesOpen}
          title={
            workspaceName
              ? `${workspaceName} · ${filesOpen ? t.layout.hideRightSidebar : t.layout.openRightSidebar}`
              : filesOpen
                ? t.layout.hideRightSidebar
                : t.layout.openRightSidebar
          }
          onClick={onToggleFilesPane}
          className={`flex h-8 min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-[9px] px-2 text-[12px] transition-colors @[580px]:px-2.5 ${
            filesOpen
              ? "bg-fill font-medium text-label"
              : "text-secondary hover:bg-fill hover:text-label"
          }`}
        >
          <span className="inline-flex shrink-0">
            <SidebarRightIcon active={filesOpen} />
          </span>
          <span className={`hidden truncate @[580px]:inline ${workspaceName ? "font-mono" : ""}`}>
            {workspaceName ?? t.layout.filesButton}
          </span>
        </button>
      </div>
    </header>
  );
}
