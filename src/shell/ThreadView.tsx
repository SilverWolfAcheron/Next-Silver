import { useLayoutEffect, useRef } from "react";
import { useSilverStore } from "../state/silverStore";
import type { ChatMessage } from "../model/types";
import { CopyButton } from "../ui/CopyButton";

interface ThreadViewProps {
  centered?: boolean;
  onPickReferenceFile?: () => void;
}

export function ThreadView({ centered = false, onPickReferenceFile }: ThreadViewProps) {
  const currentThread = useSilverStore((s) => s.currentThread);
  const retryMessage = useSilverStore((s) => s.retryMessage);
  const chooseMessage = useSilverStore((s) => s.chooseMessage);
  const resolveConfirmation = useSilverStore((s) => s.resolveConfirmation);
  const openFolder = useSilverStore((s) => s.openFolder);
  const viewport = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const lastThreadId = useRef<string | undefined>(undefined);
  const threadId = currentThread?.id;
  const workspace = currentThread?.workspace;
  const messages = currentThread?.messages;
  const queuedMessages = currentThread?.queuedMessages;

  useLayoutEffect(() => {
    const changedThread = lastThreadId.current !== threadId;
    lastThreadId.current = threadId;
    if (changedThread) followMessages.current = true;
    if (viewport.current && followMessages.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [threadId, messages, queuedMessages]);

  let precedingUserId: string | undefined;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const { scrollHeight, clientHeight, scrollTop } = event.currentTarget;
          followMessages.current = scrollHeight - clientHeight - scrollTop < 64;
        }}
      >
        {currentThread && (currentThread.messages.length > 0 || Boolean(queuedMessages?.length)) ? (
          <div className={`flex flex-col gap-3 px-4 py-4 ${centered ? "mx-auto w-full max-w-4xl" : ""}`}>
            {currentThread.messages.map((message) => {
              if (message.role === "user") precedingUserId = message.id;
              const retryId = message.role === "user" || message.error ? precedingUserId : undefined;
              return (
                <Message
                  key={message.id}
                  message={message}
                  onRetry={retryId ? () => retryMessage(currentThread.id, retryId) : undefined}
                  onChoose={(choice) => chooseMessage(currentThread.id, message.id, choice)}
                  onConfirm={(accepted) => resolveConfirmation(currentThread.id, message.id, accepted)}
                />
              );
            })}
            {queuedMessages?.map((message) => <Message key={message.id} message={message} queued />)}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            {centered ? (
              <>
                <h1 className="text-[28px] font-semibold text-label">
                  {workspace?.name ?? "打开项目"}
                </h1>
                <p className="mt-3 max-w-md text-[15px] leading-6 text-secondary">
                  {workspace
                    ? "在下方描述要改的文件或行为，输入 @ 点名文件，或点击下方添加参考文件。"
                    : "选择一个本地文件夹。对话、文件预览、差异和检查都会从这里开始。"}
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {workspace ? (
                    onPickReferenceFile && (
                      <button
                        type="button"
                        onClick={onPickReferenceFile}
                        className="inline-flex min-h-10 items-center rounded-full border border-separator bg-group px-4 text-[14px] font-medium text-label hover:bg-fill"
                      >
                        选择参考文件
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openFolder()}
                      className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-[15px] font-medium text-on-accent hover:opacity-90"
                    >
                      打开文件夹
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-secondary">描述要改的文件或行为。输入 @ 可以点名项目里的文件。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface MessageProps {
  message: ChatMessage;
  queued?: boolean;
  onRetry?: () => void;
  onChoose?: (choice: string) => void;
  onConfirm?: (accepted: boolean) => void;
}

const messageAction = "min-h-11 rounded-[10px] px-2 text-[13px] hover:bg-fill";

function Message({ message, queued, onRetry, onChoose, onConfirm }: MessageProps) {
  const isUser = message.role === "user";
  return (
    <article className={`flex min-w-0 flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`min-w-0 ${isUser ? "max-w-[88%] rounded-[18px] bg-fill px-4 py-2" : "max-w-full"}`}
      >
        {queued && <p className="mb-1 text-[13px] text-secondary">等待发送</p>}
        {message.text && (
          <div className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">
            {message.text}
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <ul aria-label="附件" className="mt-2 flex flex-wrap gap-1">
            {message.attachments.map((path) => (
              <li key={path} className="rounded-[10px] border border-separator px-2 py-1 font-mono text-[13px] wrap-anywhere text-secondary">
                {path}
              </li>
            ))}
          </ul>
        )}

        {message.assumptions && message.assumptions.length > 0 && (
          <ul className="mt-2 space-y-1 text-[13px] text-secondary">
            {message.assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </ul>
        )}

        {onChoose && message.choices && message.choices.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.choices.slice(0, 4).map((choice, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onChoose(choice)}
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
                onClick={() => onConfirm(true)}
                className={`${messageAction} font-semibold text-accent`}
              >
                {message.confirm.acceptLabel ?? "就这样"}
              </button>
              <button
                type="button"
                onClick={() => onConfirm(false)}
                className={`${messageAction} text-secondary`}
              >
                {message.confirm.declineLabel ?? "这只是补充"}
              </button>
            </div>
          </div>
        )}

        {message.error && <p role="status" className="mt-2 text-[13px] text-danger">{message.error}</p>}
      </div>

      {(message.text || onRetry) && (
        <div className="flex flex-wrap items-center gap-x-1">
          {message.text && <CopyButton text={message.text} />}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={`${messageAction} text-secondary hover:text-label`}
            >
              重试
            </button>
          )}
        </div>
      )}
    </article>
  );
}
