import type { JSX } from "react";
import { autoApprovalEnabled } from "../../agent-core/autoApproval";
import { COMPOSER_MENU_CLASS, COMPOSER_OPTION_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { ApprovalSelectorProps } from "../../types/chat";
import type { RuntimeStore } from "../../types/stores";
import { CheckIcon, ChevronDownIcon } from "../common/Icons";
import { Pill } from "../common/Pill";

export function ApprovalSelector({ thread, open, onToggle }: ApprovalSelectorProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const setAutoApproval: RuntimeStore["setAutoApproval"] = useRuntimeStore(
    (s: RuntimeStore): RuntimeStore["setAutoApproval"] => s.setAutoApproval
  );
  const enabled: boolean = autoApprovalEnabled(thread);
  const copy: typeof t.composer.approval = t.composer.approval;

  function select(automatic: boolean): void {
    if (automatic !== enabled) setAutoApproval(thread.id, automatic, thread.workspace?.id);
    onToggle();
  }

  return (
    <div>
      <Pill type="button" selected={enabled} className="h-[30px] gap-1.5 px-2.5 text-[12px]"
        aria-expanded={open} onClick={onToggle}>
        {enabled ? copy.automatic : copy.manual}
        <ChevronDownIcon open={open} />
      </Pill>
      {open && (
        <div className={`${COMPOSER_MENU_CLASS} left-4 w-60 max-w-[calc(100%-2rem)]`}>
          <button type="button" className={COMPOSER_OPTION_CLASS} aria-pressed={!enabled} onClick={(): void => select(false)}>
            <span className="flex items-center justify-between gap-2 font-medium">
              {copy.manual}{!enabled && <CheckIcon />}
            </span>
          </button>
          <button type="button" className={COMPOSER_OPTION_CLASS} aria-pressed={enabled} onClick={(): void => select(true)}>
            <span className="flex items-center justify-between gap-2 font-medium">
              {copy.automatic}{enabled && <CheckIcon />}
            </span>
            <span className="mt-1 block text-secondary">{copy.automaticHint}</span>
            {thread.workspace && <span className="mt-1 block wrap-anywhere text-secondary">{copy.checks(thread.workspace.name)}</span>}
          </button>
          <p className="px-2.5 py-1.5 text-[11px] text-secondary">{copy.manualChanges}</p>
        </div>
      )}
    </div>
  );
}
