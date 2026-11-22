import { Fragment } from "react";
import type { JSX, MouseEvent } from "react";
import { EDITOR_CONTROL_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { EditorToolbarProps } from "../../types/editor";

export function EditorToolbar({
  embedded,
  showSidebarButton,
  showAgentButton,
  path,
  workspaceName,
  hasBody,
  findOpen,
  isEditing,
  isDirty,
  saving,
  savedNotice,
  saveError,
  detectedLabel,
  onOpenSidebar,
  onOpenAgent,
  onOpenFind,
  onReload,
  onToggleEdit,
  onSave,
  onDiscard,
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
            disabled={!hasBody}
            aria-pressed={isEditing}
            onClick={onToggleEdit}
            className={`${EDITOR_CONTROL_CLASS} ${isEditing ? "bg-fill font-medium text-label" : ""}`}
          >
            {isEditing ? t.editor.previewButton : t.editor.editButton}
          </button>

          {isEditing && (
            <Fragment>
              <button
                type="button"
                title={t.editor.saveShortcut}
                disabled={!isDirty || saving}
                onMouseDown={(event: MouseEvent<HTMLButtonElement>): void => event.preventDefault()}
                onClick={onSave}
                className={`${EDITOR_CONTROL_CLASS} ${
                  isDirty ? "font-medium text-accent hover:text-accent" : ""
                }`}
              >
                {t.editor.saveButton}
              </button>
              <button
                type="button"
                disabled={!isDirty || saving}
                onClick={onDiscard}
                className={EDITOR_CONTROL_CLASS}
              >
                {t.editor.discardButton}
              </button>
            </Fragment>
          )}

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

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {saveError && (
          <span role="alert" className="max-w-60 truncate text-[11.5px] text-danger" title={formatError(saveError, t)}>
            {formatError(saveError, t)}
          </span>
        )}
        {!saveError && saving && (
          <span role="status" className="text-[11.5px] text-secondary">
            {t.editor.savingButton}
          </span>
        )}
        {!saveError && !saving && savedNotice && (
          <span role="status" className="text-[11.5px] font-medium text-success">
            {t.editor.savedNotice}
          </span>
        )}
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
