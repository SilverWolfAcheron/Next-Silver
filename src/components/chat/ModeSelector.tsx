import type { JSX } from "react";
import { COMPOSER_MODES } from "../../constants/composer";
import { COMPOSER_MENU_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import type { ModeSelectorProps } from "../../types/chat";
import type { ComposerModeItem } from "../../types/composer";
import { CheckIcon, ChevronDownIcon, ModeIcon } from "../common/Icons";
import { Pill } from "../common/Pill";

export function ModeSelector({
  presetId,
  presetLabel,
  open,
  onToggle,
  onSelect,
}: ModeSelectorProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <div className="relative">
      <Pill
        type="button"
        className="h-[30px] gap-1.5 px-2.5 text-[12px] text-label"
        aria-expanded={open}
        aria-label={t.composer.modeAriaLabel(presetLabel)}
        onClick={onToggle}
      >
        <ModeIcon id={presetId} className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span>{presetLabel}</span>
        <ChevronDownIcon open={open} />
      </Pill>

      {open && (
        <div className={`${COMPOSER_MENU_CLASS} left-0 w-56`} aria-label={t.composer.modeMenuLabel}>
          {COMPOSER_MODES.map((entry: ComposerModeItem): JSX.Element => {
            const active: boolean = entry.id === presetId;
            return (
              <button
                type="button"
                key={entry.id}
                aria-pressed={active}
                onClick={(): void => onSelect(entry.id)}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-fill text-label" : "text-label hover:bg-fill/70"
                }`}
              >
                <ModeIcon
                  id={entry.id}
                  className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-secondary"}`}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-medium leading-4">{entry.label}</span>
                  <span className="mt-0.5 text-[11px] leading-3.5 text-tertiary">
                    {t.composer.modeHints[entry.id]}
                  </span>
                </span>
                {active && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
