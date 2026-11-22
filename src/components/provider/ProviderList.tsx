import type { JSX } from "react";
import { isConfiguredProvider, PROTOCOL_LABELS } from "../../agent-core/provider/presets";
import type { ProviderConfig } from "../../agent-core/provider/presets";
import { useI18n } from "../../hooks/useI18n";
import type { ProviderListProps } from "../../types/provider";
import { ChevronRightIcon } from "../common/Icons";

export function ProviderList({ providers, onSelect }: ProviderListProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <div className="flex flex-col gap-1.5 p-3">
      {providers.map((provider: ProviderConfig): JSX.Element => {
        const configured: boolean = isConfiguredProvider(provider);
        const label: string =
          provider.id === "custom" ? t.provider.customProviderLabel : provider.label;
        return (
          <button
            type="button"
            key={provider.id}
            onClick={(): void => onSelect(provider)}
            className="flex min-h-12 items-center justify-between gap-3 rounded-[10px] border border-separator/70 bg-surface px-3.5 py-2 text-left transition-colors hover:bg-fill/75"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-label">{label}</span>
              <span className="truncate font-mono text-[11px] text-tertiary">
                {provider.model || PROTOCOL_LABELS[provider.protocol]}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-[5px] px-1.5 py-0.5 text-[11px] ${
                  configured ? "bg-success/15 text-success" : "bg-fill text-tertiary"
                }`}
              >
                {configured ? t.provider.configured : t.provider.unconfigured}
              </span>
              <ChevronRightIcon className="h-3.5 w-3.5 text-tertiary" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
