import { Fragment, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { CopyButtonProps } from "../../types/common";

export function CopyButton({ text }: CopyButtonProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const [status, setStatus]: [
    "idle" | "copied" | "failed",
    Dispatch<SetStateAction<"idle" | "copied" | "failed">>
  ] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  const feedback: string =
    status === "copied" ? t.common.copied : status === "failed" ? t.common.copyFailed : "";

  return (
    <Fragment>
      <button
        type="button"
        onClick={(): void => {
          void copy();
        }}
        className="min-h-11 rounded-[10px] px-2 text-[13px] text-secondary hover:bg-fill hover:text-label"
      >
        {t.common.copy}
      </button>
      <span role="status" className="text-[13px] text-secondary">
        {feedback}
      </span>
    </Fragment>
  );
}
