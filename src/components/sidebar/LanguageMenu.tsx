import type { JSX } from "react";
import { LOCALE_OPTIONS } from "../../constants/i18n";
import { useI18n } from "../../hooks/useI18n";
import type { Locale } from "../../types/i18n";
import type { LanguageMenuProps } from "../../types/sidebar";
import { CheckIcon } from "../common/Icons";

export function LanguageMenu({ onSelect }: LanguageMenuProps): JSX.Element {
  const { locale, setLocale }: ReturnType<typeof useI18n> = useI18n();

  return (
    <div className="mx-1 my-1 flex flex-col gap-0.5 rounded-[8px] border border-separator bg-surface p-1.5">
      {LOCALE_OPTIONS.map((option: { id: Locale; label: string }): JSX.Element => {
        const active: boolean = option.id === locale;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={(): void => {
              setLocale(option.id);
              onSelect?.();
            }}
            className={`flex h-8 w-full items-center justify-between gap-2 rounded-[6px] px-2.5 text-left text-[12px] transition-colors ${
              active ? "bg-fill font-medium text-label" : "text-label hover:bg-fill/75"
            }`}
          >
            <span>{option.label}</span>
            {active && <CheckIcon />}
          </button>
        );
      })}
    </div>
  );
}
