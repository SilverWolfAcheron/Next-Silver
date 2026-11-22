import type { ChangeEvent, FocusEvent, JSX, KeyboardEvent } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { SessionItemProps } from "../../types/sidebar";

export function SessionItem({
  thread,
  selected,
  running,
  menuOpen,
  renamingTitle,
  onSelect,
  onToggleMenu,
  onStartRename,
  onChangeRename,
  onCancelRename,
  onSubmitRename,
  onTogglePin,
  onDelete,
}: SessionItemProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const pending: boolean = Boolean(thread.pendingConfirmation);
  const workspaceName: string | undefined = thread.workspace?.name;

  if (renamingTitle !== null) {
    return (
      <form
        onSubmit={onSubmitRename}
        className="my-1 flex flex-col gap-1.5 rounded-[10px] border border-separator bg-group p-2"
      >
        <input
          autoFocus
          aria-label={t.sidebar.renameLabel}
          value={renamingTitle}
          onFocus={(event: FocusEvent<HTMLInputElement>): void => event.target.select()}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => onChangeRename(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onCancelRename();
            }
          }}
          className="h-8 w-full rounded-[7px] border border-accent bg-surface px-2.5 text-[13px] text-label outline-none"
        />
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onCancelRename}
            className="h-7 rounded-[6px] px-2.5 text-[12px] text-secondary hover:bg-fill"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={!renamingTitle.trim()}
            className="h-7 rounded-[6px] bg-fill px-2.5 text-[12px] font-medium text-accent hover:opacity-90 disabled:opacity-45"
          >
            {t.common.save}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="group/item">
      <div
        className={`relative flex items-center rounded-[9px] transition-colors ${
          selected ? "bg-fill text-label" : "text-label/90 hover:bg-fill/55"
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pr-1 pl-3 text-left select-none"
        >
          <span
            className={`truncate text-[13px] leading-[18px] ${
              selected ? "font-medium text-label" : "text-label/90"
            }`}
          >
            {thread.title}
          </span>
          {(workspaceName || pending || running) && (
            <span className="flex items-center gap-1.5 text-[11px] leading-[15px] text-tertiary">
              {workspaceName && <span className="truncate font-mono">{workspaceName}</span>}
              {pending && <span className="shrink-0 font-medium text-accent">{t.sidebar.pendingConfirm}</span>}
              {!pending && running && (
                <span className="inline-flex shrink-0 items-center gap-1 text-secondary">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                  {t.sidebar.running}
                </span>
              )}
            </span>
          )}
        </button>

        <button
          type="button"
          aria-label={t.sidebar.threadActions(thread.title)}
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
          className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-secondary transition-opacity hover:bg-group hover:text-label ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </div>

      {menuOpen && (
        <div className="mt-1 mb-1.5 grid grid-cols-3 gap-0.5 rounded-[8px] border border-separator bg-group p-0.5">
          <button
            type="button"
            className="h-7 rounded-[6px] text-[12px] text-label hover:bg-fill"
            onClick={onStartRename}
          >
            {t.sidebar.rename}
          </button>
          <button
            type="button"
            className="h-7 rounded-[6px] text-[12px] text-label hover:bg-fill"
            onClick={onTogglePin}
          >
            {thread.pinned ? t.sidebar.unpin : t.sidebar.pin}
          </button>
          <button
            type="button"
            className="h-7 rounded-[6px] text-[12px] text-danger hover:bg-fill"
            onClick={onDelete}
          >
            {t.sidebar.delete}
          </button>
        </div>
      )}
    </div>
  );
}
