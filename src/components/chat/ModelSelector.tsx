import type { JSX } from "react";
import { COMPOSER_MENU_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import type { ModelSelectorProps } from "../../types/chat";
import type { ModelOption } from "../../types/composer";
import { CheckIcon, ChevronDownIcon } from "../common/Icons";
import { Pill } from "../common/Pill";

export function ModelSelector({
  modelMenu,
  open,
  onToggle,
  onSelect,
}: ModelSelectorProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const { usingMockModels, grouped, activeOption }: ModelSelectorProps["modelMenu"] = modelMenu;

  const formatProviderLabel = (providerId: string, fallback: string): string =>
    providerId === "custom" ? t.provider.customProviderLabel : fallback;

  const activeText: string = activeOption
    ? usingMockModels
      ? activeOption.displayName
      : `${formatProviderLabel(activeOption.providerId, activeOption.providerLabel)} · ${activeOption.displayName}`
    : t.composer.selectModel;

  return (
    <div className="relative min-w-0">
      <Pill
        type="button"
        selected={Boolean(activeOption)}
        className="h-[28px] min-w-[144px] max-w-[260px] justify-between gap-2 px-3.5 text-[12px]"
        aria-expanded={open}
        aria-label={
          activeOption ? t.composer.modelAriaLabel(activeOption.displayName) : t.composer.selectModel
        }
        onClick={onToggle}
      >
        <span className="truncate">{activeText}</span>
        <ChevronDownIcon open={open} />
      </Pill>

      {open && (
        <div className={`${COMPOSER_MENU_CLASS} left-0 w-64`} aria-label={t.composer.modelMenuLabel}>
          {usingMockModels && (
            <p className="border-b border-separator/70 px-2.5 pt-1 pb-1.5 text-[11px] text-tertiary">
              {t.composer.mockPreviewNotice}
            </p>
          )}
          <div className="flex flex-col gap-1.5 pt-1">
            {grouped.map(([groupLabel, options]: [string, ModelOption[]]): JSX.Element => {
              const displayGroup: string =
                options[0]?.providerId === "custom" ? t.provider.customProviderLabel : groupLabel;
              return (
                <div key={groupLabel} className="flex flex-col gap-0.5">
                  <span className="px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-tertiary uppercase">
                    {displayGroup}
                  </span>
                  {options.map((option: ModelOption): JSX.Element => {
                    const active: boolean =
                      option.providerId === activeOption?.providerId &&
                      option.model === activeOption?.model;
                    const tagText: string | undefined = option.tag
                      ? (t.composer.mockTags[option.tag] ?? option.tag)
                      : undefined;
                    return (
                      <button
                        type="button"
                        key={`${option.providerId}:${option.model}`}
                        aria-pressed={active}
                        onClick={(): void => onSelect(option.providerId, option.model)}
                        className={`flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors ${
                          active ? "bg-fill text-label" : "text-label hover:bg-fill/70"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium">{option.displayName}</span>
                          {tagText && (
                            <span className="shrink-0 rounded-[4px] border border-separator/80 bg-surface px-1.5 py-0.5 text-[10px] leading-none text-secondary">
                              {tagText}
                            </span>
                          )}
                        </span>
                        {active && <CheckIcon />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
