import type { ChangeEvent, JSX, KeyboardEvent } from "react";
import { EDITOR_CONTROL_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import type { EditorFindBarProps } from "../../types/editor";

export function EditorFindBar({
  inputRef,
  query,
  matchIndex,
  matchCount,
  onChangeQuery,
  onStep,
  onClose,
}: EditorFindBarProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <div
      role="search"
      aria-label={t.editor.findRegionLabel}
      className="mx-3 mt-2 flex shrink-0 items-center gap-1 rounded-[10px] border border-separator bg-group px-2 py-1"
    >
      <input
        ref={inputRef}
        type="search"
        value={query}
        aria-label={t.editor.findInputLabel}
        placeholder={t.editor.findInputPlaceholder}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => onChangeQuery(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
          if (event.nativeEvent.isComposing || event.key !== "Enter") return;
          event.preventDefault();
          onStep(event.shiftKey ? -1 : 1);
        }}
        className="h-8 min-w-16 flex-1 rounded-[6px] bg-transparent px-2 text-[13px] text-label focus:outline-accent"
      />
      <span role="status" aria-live="polite" className="shrink-0 text-[12px] text-secondary">
        {query &&
          (matchCount
            ? t.editor.findMatchCount(Math.min(matchIndex + 1, matchCount), matchCount)
            : t.editor.findNoMatch)}
      </span>
      <button
        type="button"
        aria-label={t.editor.prevMatch}
        title={t.editor.prevMatchShortcut}
        disabled={!matchCount}
        onClick={(): void => onStep(-1)}
        className={EDITOR_CONTROL_CLASS}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={t.editor.nextMatch}
        title={t.editor.nextMatchShortcut}
        disabled={!matchCount}
        onClick={(): void => onStep(1)}
        className={EDITOR_CONTROL_CLASS}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label={t.editor.closeFind}
        onClick={onClose}
        className={EDITOR_CONTROL_CLASS}
      >
        ×
      </button>
    </div>
  );
}
