import type { JSX, MouseEvent } from "react";
import type { WorkspaceEntry } from "../../agent-core/types";
import { COMPOSER_MENU_CLASS, COMPOSER_OPTION_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { MentionMenuProps } from "../../types/chat";

export function MentionMenu({
  listId,
  matches,
  activeIndex,
  searching,
  fileError,
  onHover,
  onSelect,
}: MentionMenuProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <div
      className={`${COMPOSER_MENU_CLASS} inset-x-2`}
      id={listId}
      role="listbox"
      aria-label={t.composer.workspaceFilesLabel}
    >
      {matches.map((entry: WorkspaceEntry, index: number): JSX.Element => (
        <div
          key={entry.path}
          id={`${listId}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          className={`${COMPOSER_OPTION_CLASS} flex items-center break-all ${
            index === activeIndex ? "bg-fill" : ""
          }`}
          onPointerMove={(): void => onHover(index)}
          onMouseDown={(event: MouseEvent<HTMLDivElement>): void => event.preventDefault()}
          onClick={(): void => onSelect(entry.path)}
        >
          {entry.path}
        </div>
      ))}
      {!matches.length && (
        <p role="status" className="px-3 py-2 text-[13px] text-secondary">
          {searching
            ? t.composer.searchingFiles
            : fileError
              ? formatError(fileError, t)
              : t.composer.noMatchingFiles}
        </p>
      )}
    </div>
  );
}
