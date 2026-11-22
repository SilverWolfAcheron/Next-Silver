import type { JSX } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { EditorTabBarProps } from "../../types/editor";
import { resolveFileTabLabel } from "../../utils/editorData";
import { CloseIcon } from "../common/Icons";

export function EditorTabBar({
  paths,
  activePath,
  dirtyPath,
  onSelect,
  onClose,
}: EditorTabBarProps): JSX.Element | null {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  if (!paths.length) return null;

  return (
    <div
      role="tablist"
      aria-label={t.editor.openFilesLabel}
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-separator/70 bg-canvas/55 px-2 py-1.5"
    >
      {paths.map((entry: string, index: number): JSX.Element => {
        const selected: boolean = entry === activePath;
        return (
          <div
            key={entry}
            className={`relative flex h-8 max-w-60 shrink-0 items-center rounded-[9px] border pr-1.5 transition-colors ${
              selected
                ? "border-separator/85 bg-surface text-label shadow-[0_1px_2px_rgba(44,36,27,0.06)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.22)]"
                : "border-transparent bg-transparent text-secondary hover:bg-fill/55 hover:text-label"
            }`}
          >
            {selected && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 top-0 h-[1px] rounded-full bg-accent"
              />
            )}
            <button
              type="button"
              role="tab"
              id={`editor-tab-${index}`}
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls="editor-file"
              aria-label={entry}
              title={entry}
              onClick={(): void => onSelect(entry)}
              className="flex h-full min-w-0 items-center gap-1.5 truncate pl-3 pr-1.5 text-left font-mono text-[12px] text-inherit outline-none focus-visible:underline"
            >
              <span className="truncate">{resolveFileTabLabel(paths, entry)}</span>
              {dirtyPath === entry && (
                <span
                  aria-label={t.editor.unsavedLabel}
                  title={t.editor.unsavedLabel}
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                />
              )}
            </button>
            <button
              type="button"
              aria-label={t.editor.closeFile(entry)}
              title={t.editor.closeFile(entry)}
              onClick={(): void => onClose(entry)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-fill hover:text-label"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
