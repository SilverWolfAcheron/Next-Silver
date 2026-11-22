import { Fragment, useLayoutEffect, useRef } from "react";
import type { JSX, RefObject, UIEvent } from "react";
import type { ChatMessage, Thread, WorkspaceSummary } from "../../agent-core/types";
import { useI18n } from "../../hooks/useI18n";
import { useComposerStore } from "../../stores/composerStore";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { ThreadViewProps } from "../../types/chat";
import type { ComposerStore, RuntimeStore } from "../../types/stores";
import { MessageBubble } from "./MessageBubble";

export function ThreadView({
  centered = false,
  onPickReferenceFile,
}: ThreadViewProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  const retryMessage: (threadId: string, messageId: string) => void = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string, messageId: string) => void) => s.retryMessage
  );
  const resolveConfirmation: (threadId: string, messageId: string, accepted: boolean) => void =
    useRuntimeStore(
      (s: RuntimeStore): ((threadId: string, messageId: string, accepted: boolean) => void) =>
        s.resolveConfirmation
    );
  const openFolder: () => Promise<void> = useRuntimeStore(
    (s: RuntimeStore): (() => Promise<void>) => s.openFolder
  );
  const chooseMessage: (thread: Thread | undefined, messageId: string, choice: string) => void =
    useComposerStore(
      (s: ComposerStore): ((thread: Thread | undefined, messageId: string, choice: string) => void) =>
        s.chooseMessage
    );

  const viewportRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const followMessages: RefObject<boolean> = useRef<boolean>(true);
  const lastThreadId: RefObject<string | undefined> = useRef<string | undefined>(undefined);

  const threadId: string | undefined = currentThread?.id;
  const workspace: WorkspaceSummary | undefined = currentThread?.workspace;
  const messages: ChatMessage[] | undefined = currentThread?.messages;
  const queuedMessages: ChatMessage[] | undefined = currentThread?.queuedMessages;

  useLayoutEffect((): void => {
    const changedThread: boolean = lastThreadId.current !== threadId;
    lastThreadId.current = threadId;
    if (changedThread) followMessages.current = true;
    if (viewportRef.current && followMessages.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [threadId, messages, queuedMessages]);

  let precedingUserId: string | undefined = undefined;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event: UIEvent<HTMLDivElement>): void => {
          const {
            scrollHeight,
            clientHeight,
            scrollTop,
          }: { scrollHeight: number; clientHeight: number; scrollTop: number } = event.currentTarget;
          followMessages.current = scrollHeight - clientHeight - scrollTop < 64;
        }}
      >
        {currentThread && (currentThread.messages.length > 0 || Boolean(queuedMessages?.length)) ? (
          <div className={`flex flex-col gap-3 px-4 py-4 ${centered ? "mx-auto w-full max-w-4xl" : ""}`}>
            {currentThread.messages.map((message: ChatMessage): JSX.Element => {
              if (message.role === "user") precedingUserId = message.id;
              const retryId: string | undefined =
                message.role === "user" || message.error ? precedingUserId : undefined;
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onRetry={retryId ? (): void => retryMessage(currentThread.id, retryId) : undefined}
                  onChoose={(choice: string): void => chooseMessage(currentThread, message.id, choice)}
                  onConfirm={(accepted: boolean): void =>
                    resolveConfirmation(currentThread.id, message.id, accepted)
                  }
                />
              );
            })}
            {queuedMessages?.map((message: ChatMessage): JSX.Element => (
              <MessageBubble key={message.id} message={message} queued />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            {centered ? (
              <Fragment>
                <h1 className="text-[28px] font-semibold text-label">
                  {workspace?.name ?? t.chat.emptyProjectHeading}
                </h1>
                <p className="mt-3 max-w-md text-[15px] leading-6 text-secondary">
                  {workspace ? t.chat.emptyWithWorkspaceHint : t.chat.emptyWithoutWorkspaceHint}
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {workspace ? (
                    onPickReferenceFile && (
                      <button
                        type="button"
                        onClick={onPickReferenceFile}
                        className="inline-flex min-h-10 items-center rounded-full border border-separator bg-group px-4 text-[14px] font-medium text-label hover:bg-fill"
                      >
                        {t.chat.pickReferenceFile}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={(): void => {
                        void openFolder();
                      }}
                      className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-[15px] font-medium text-on-accent hover:opacity-90"
                    >
                      {t.common.openFolder}
                    </button>
                  )}
                </div>
              </Fragment>
            ) : (
              <p className="text-[13px] text-secondary">{t.chat.compactEmptyHint}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
