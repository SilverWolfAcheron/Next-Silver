import type { JSX } from "react";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { ErrorToastProps } from "../../types/shell";

export function ErrorToast({ error, onDismiss }: ErrorToastProps): JSX.Element | null {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  if (!error) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-3 z-[60] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-[12px] border border-separator bg-group px-4 py-2 text-[13px] text-danger"
    >
      <span>{formatError(error, t)}</span>
      <button type="button" className="min-h-11 px-2 text-secondary" onClick={onDismiss}>
        {t.common.close}
      </button>
    </div>
  );
}
