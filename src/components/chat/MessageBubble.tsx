import type { JSX } from "react";
import { MESSAGE_ACTION_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { MessageBubbleProps } from "../../types/chat";
import { CopyButton } from "../common/CopyButton";

export function MessageBubble({
  message,
  queued,
  onRetry,
  onChoose,
  onConfirm,
}: MessageBubbleProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const isUser: boolean = message.role === "user";

  return (
    <article className={`flex min-w-0 flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`min-w-0 ${isUser ? "max-w-[88%] rounded-[18px] bg-fill px-4 py-2" : "max-w-full"}`}
      >
        {queued && <p className="mb-1 text-[13px] text-secondary">{t.chat.queuedLabel}</p>}

        {message.text && (
          <div className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">
            {message.text}
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <ul aria-label={t.chat.attachmentsLabel} className="mt-2 flex flex-wrap gap-1">
            {message.attachments.map((path: string): JSX.Element => (
              <li
                key={path}
                className="rounded-[10px] border border-separator px-2 py-1 font-mono text-[13px] wrap-anywhere text-secondary"
              >
                {path}
              </li>
            ))}
          </ul>
        )}

        {message.assumptions && message.assumptions.length > 0 && (
          <ul className="mt-2 space-y-1 text-[13px] text-secondary">
            {message.assumptions.map((assumption: string, index: number): JSX.Element => (
              <li key={index}>{assumption}</li>
            ))}
          </ul>
        )}

        {onChoose && message.choices && message.choices.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.choices.slice(0, 4).map((choice: string, index: number): JSX.Element => (
              <button
                key={index}
                type="button"
                onClick={(): void => onChoose(choice)}
                className="inline-flex min-h-11 items-center rounded-full border border-separator px-3 text-left text-[13px] text-accent hover:bg-fill"
              >
                {choice}
              </button>
            ))}
          </div>
        )}

        {onConfirm && message.confirm && (
          <div className="mt-3 border-t border-separator pt-2">
            <p className="text-[13px] text-secondary">{message.confirm.summary}</p>
            <div className="flex flex-wrap gap-x-2">
              <button
                type="button"
                onClick={(): void => onConfirm(true)}
                className={`${MESSAGE_ACTION_CLASS} font-semibold text-accent`}
              >
                {message.confirm.acceptLabel ?? t.chat.confirmAcceptDefault}
              </button>
              <button
                type="button"
                onClick={(): void => onConfirm(false)}
                className={`${MESSAGE_ACTION_CLASS} text-secondary`}
              >
                {message.confirm.declineLabel ?? t.chat.confirmDeclineDefault}
              </button>
            </div>
          </div>
        )}

        {message.error && (
          <p role="status" className="mt-2 text-[13px] text-danger">
            {formatError(message.error, t)}
          </p>
        )}
      </div>

      {(message.text || onRetry) && (
        <div className="flex flex-wrap items-center gap-x-1">
          {message.text && <CopyButton text={message.text} />}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={`${MESSAGE_ACTION_CLASS} text-secondary hover:text-label`}
            >
              {t.common.retry}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
