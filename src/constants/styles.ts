import type { DiffLineKind } from "../agent-core/diff";
import type { RunStatus } from "../agent-core/types";

export const COMPOSER_MENU_CLASS: string =
  "absolute bottom-full z-20 mb-2 flex max-h-64 min-w-44 flex-col overflow-y-auto rounded-[12px] border border-separator bg-group p-1 shadow-[0_8px_24px_rgba(44,36,27,0.14)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.45)]";

export const COMPOSER_OPTION_CLASS: string =
  "min-h-8 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-label hover:bg-fill";

export const MESSAGE_ACTION_CLASS: string =
  "min-h-11 rounded-[10px] px-2 text-[13px] hover:bg-fill";

export const CODE_ACTIVE_MARK_CLASS: string =
  "rounded-[2px] bg-accent/35 text-label ring-1 ring-accent/55";

export const CODE_INACTIVE_MARK_CLASS: string =
  "rounded-[2px] bg-accent/18 text-inherit";

export const EDITOR_CONTROL_CLASS: string =
  "h-7 shrink-0 rounded-[8px] px-2 text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label disabled:opacity-45";

export const BRIEF_FIELD_LABEL_CLASS: string =
  "text-[12px] font-semibold text-secondary";

export const BRIEF_FIELD_INPUT_CLASS: string =
  "min-h-11 w-full rounded-[10px] border border-separator bg-group px-3 py-2 text-[17px] leading-[22px] text-label focus-visible:outline-2 focus-visible:outline-accent";

export const DIFF_ACTION_CLASS: string =
  "min-h-[44px] rounded-[10px] px-2 text-[13px] hover:bg-fill disabled:opacity-40";

export const PROVIDER_FIELD_CLASS: string =
  "h-9 min-w-0 w-full rounded-[8px] border border-separator bg-surface px-3 text-[13px] text-label outline-none placeholder:text-tertiary focus:border-accent";

export const PROVIDER_BUTTON_CLASS: string =
  "inline-flex h-8 items-center justify-center rounded-[8px] border border-separator bg-surface px-3 text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label disabled:opacity-45";

export const WORKSPACE_ICON_BUTTON_CLASS: string =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-secondary transition-colors hover:bg-fill hover:text-label disabled:opacity-40";

export const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  pending: "text-secondary",
  in_progress: "text-accent",
  completed: "text-success",
  blocked: "text-warning",
  paused: "text-secondary",
};

export const DIFF_LINE_STYLES: Record<DiffLineKind, string> = {
  added: "bg-success/10 text-label",
  removed: "bg-danger/10 text-danger",
  meta: "text-secondary",
  context: "text-label",
};
