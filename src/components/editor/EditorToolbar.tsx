import type { JSX } from "react";
import { EDITOR_CONTROL_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import type { EditorToolbarProps } from "../../types/editor";

export function EditorToolbar({
  embedded,
  showSidebarButton,
  showAgentButton,
  path,
  workspaceName,
  hasBody,
  findOpen,
  detectedLabel,
  onOpenSidebar,
  onOpenAgent,
  onOpenFind,
  onReload,
  onAttachFile,
}: EditorToolbarProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-separator/65 px-3">
      {!embedded && onOpenSidebar && (
        <button
          type="button"
          aria-label={t.editor.toggleSidebar}
          onClick={onOpenSidebar}
          className={`${EDITOR_CONTROL_CLASS} ${showSidebarButton ? "" : "min-[960px]:hidden"}`}
        >
          {t.editor.sidebarButton}
        </button>
      )}

      <span className="min-w-0 truncate font-mono text-[12px] text-secondary" title={path}>
        {path ?? workspaceName ?? t.common.unopenedProject}
      </span>

      {path && (
        <div className="flex shrink-0 items-center gap-0.5 pl-1">
          <button
            type="button"
            aria-label={t.editor.findInFile}
            aria-expanded={findOpen}
            title={t.editor.findInFileShortcut}
            disabled={!hasBody}
            onClick={onOpenFind}
            className={EDITOR_CONTROL_CLASS}
          >
            {t.editor.findButton}
          </button>
          <button
            type="button"
            aria-label={t.editor.reloadFile}
            onClick={onReload}
            className={EDITOR_CONTROL_CLASS}
          >
            {t.editor.reloadButton}
          </button>
          {onAttachFile && (
            <button
              type="button"
              aria-label={t.editor.attachToChatLabel}
              disabled={!hasBody}
              onClick={(): void => onAttachFile(path)}
              className={EDITOR_CONTROL_CLASS}
            >
              {t.editor.attachToChatButton}
            </button>
          )}
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {path && detectedLabel && (
          <span
            aria-label={t.editor.syntaxHighlightLabel(detectedLabel)}
            className="hidden shrink-0 rounded-full bg-fill/80 px-2.5 py-0.5 font-mono text-[11px] text-secondary sm:inline"
          >
            {detectedLabel}
          </span>
        )}
        {!embedded && showAgentButton && onOpenAgent && (
          <button
            type="button"
            aria-label={t.editor.openChatLabel}
            onClick={onOpenAgent}
            className={`${EDITOR_CONTROL_CLASS} min-[960px]:hidden`}
          >
            {t.editor.chatButton}
          </button>
        )}
      </div>
    </header>
  );
}
