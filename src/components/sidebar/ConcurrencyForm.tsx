import type { ChangeEvent, JSX, SyntheticEvent } from "react";
import { CONCURRENCY_BOUNDS } from "../../constants/provider";
import { useI18n } from "../../hooks/useI18n";
import type { ConcurrencyFormProps } from "../../types/sidebar";
import { stepConcurrencyDraft } from "../../utils/sidebarData";

export function ConcurrencyForm({
  draft,
  onChange,
  onSubmit,
}: ConcurrencyFormProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <form
      id="development-concurrency-settings"
      noValidate
      className="mx-1 my-1 flex flex-col gap-2 rounded-[8px] border border-separator bg-surface p-2.5"
      onSubmit={(event: SyntheticEvent<HTMLFormElement>): void => {
        event.preventDefault();
        onSubmit(Number(draft));
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="development-concurrency" className="text-[12px] font-medium text-label">
          {t.sidebar.concurrencyTitle}
        </label>
        <span className="rounded-[4px] bg-fill/75 px-1.5 py-0.5 font-mono text-[10px] leading-none text-secondary">
          {CONCURRENCY_BOUNDS.min}–{CONCURRENCY_BOUNDS.max}
        </span>
      </div>

      <div className="flex h-8 items-center overflow-hidden rounded-[7px] border border-separator bg-group focus-within:border-accent">
        <button
          type="button"
          aria-label={t.sidebar.concurrencyDecrease}
          onClick={(): void => onChange(stepConcurrencyDraft(draft, -1))}
          className="flex h-full w-8 shrink-0 items-center justify-center border-r border-separator/70 text-secondary transition-colors hover:bg-fill hover:text-label"
        >
          −
        </button>
        <input
          id="development-concurrency"
          aria-describedby="development-concurrency-range"
          type="number"
          min={CONCURRENCY_BOUNDS.min}
          max={CONCURRENCY_BOUNDS.max}
          inputMode="numeric"
          value={draft}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => onChange(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-center font-mono text-[13px] text-label outline-none"
        />
        <button
          type="button"
          aria-label={t.sidebar.concurrencyIncrease}
          onClick={(): void => onChange(stepConcurrencyDraft(draft, 1))}
          className="flex h-full w-8 shrink-0 items-center justify-center border-l border-separator/70 text-secondary transition-colors hover:bg-fill hover:text-label"
        >
          +
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <p id="development-concurrency-range" className="min-w-0 text-[11px] leading-4 text-tertiary">
          {t.sidebar.concurrencyHint(CONCURRENCY_BOUNDS.min, CONCURRENCY_BOUNDS.defaultValue)}
        </p>
        <button
          type="submit"
          className="h-7 shrink-0 rounded-[7px] bg-accent px-3 text-[12px] font-medium text-on-accent transition-opacity hover:opacity-90"
        >
          {t.common.save}
        </button>
      </div>
    </form>
  );
}
