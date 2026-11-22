import { Fragment, useLayoutEffect, useMemo, useRef } from "react";
import type { JSX, RefObject, UIEvent } from "react";
import type { FileDecision } from "../../agent-core/diff";
import { getPreset } from "../../agent-core/presets";
import type { Artifact, ChatMessage, Thread, WorkspaceSummary, WritePolicy } from "../../agent-core/types";
import { useI18n } from "../../hooks/useI18n";
import { useComposerStore } from "../../stores/composerStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { ChatArtifactBuckets, ThreadViewProps } from "../../types/chat";
import type {
  AcceptFileParams,
  ComposerStore,
  FileDecisionParams,
  LayoutStore,
  RuntimeStore,
} from "../../types/stores";
import { buildRunTitleMap, mapArtifactsToChat } from "../../utils/chatArtifacts";
import { ChatArtifactCard } from "./ChatArtifactCard";
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
  const patchFinding: (threadId: string, finding: string) => void = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string, finding: string) => void) => s.patchFinding
  );
  const decideFile: (params: FileDecisionParams) => void = useRuntimeStore(
    (s: RuntimeStore): ((params: FileDecisionParams) => void) => s.decideFile
  );
  const acceptFile: (params: AcceptFileParams) => Promise<void> = useRuntimeStore(
    (s: RuntimeStore): ((params: AcceptFileParams) => Promise<void>) => s.acceptFile
  );
  const chooseMessage: (thread: Thread | undefined, messageId: string, choice: string) => void =
    useComposerStore(
      (s: ComposerStore): ((thread: Thread | undefined, messageId: string, choice: string) => void) =>
        s.chooseMessage
    );
  const focusedArtifactId: string | null = useLayoutStore(
    (s: LayoutStore): string | null => s.focusedArtifactId
  );
  const setFocusedArtifactId: (artifactId: string | null) => void = useLayoutStore(
    (s: LayoutStore): ((artifactId: string | null) => void) => s.setFocusedArtifactId
  );

  const viewportRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const followMessages: RefObject<boolean> = useRef<boolean>(true);
  const lastThreadId: RefObject<string | undefined> = useRef<string | undefined>(undefined);

  const threadId: string | undefined = currentThread?.id;
  const workspace: WorkspaceSummary | undefined = currentThread?.workspace;
  const messages: ChatMessage[] | undefined = currentThread?.messages;
  const queuedMessages: ChatMessage[] | undefined = currentThread?.queuedMessages;
  const artifacts: Artifact[] | undefined = currentThread?.artifacts;
  const writePolicy: WritePolicy = currentThread
    ? getPreset(currentThread.presetId).writePolicy
    : "code";

  const artifactBuckets: ChatArtifactBuckets = useMemo(
    (): ChatArtifactBuckets =>
      currentThread
        ? mapArtifactsToChat(currentThread)
        : { byMessageId: new Map(), trailing: [] },
    [currentThread]
  );

  const runTitles: Map<string, string> = useMemo(
    (): Map<string, string> =>
      currentThread ? buildRunTitleMap(currentThread.runs) : new Map<string, string>(),
    [currentThread]
  );

  useLayoutEffect((): void => {
    const changedThread: boolean = lastThreadId.current !== threadId;
    lastThreadId.current = threadId;
    if (changedThread) {
      followMessages.current = true;
      if (focusedArtifactId) setFocusedArtifactId(null);
    }
    if (viewportRef.current && followMessages.current && !focusedArtifactId) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [threadId, messages, queuedMessages, artifacts, focusedArtifactId, setFocusedArtifactId]);

  let precedingUserId: string | undefined = undefined;
  const hasConversationContent: boolean = Boolean(
    currentThread &&
      (currentThread.messages.length > 0 ||
        Boolean(queuedMessages?.length) ||
        currentThread.artifacts.length > 0)
  );

  function renderArtifactCard(thread: Thread, artifact: Artifact): JSX.Element {
    return (
      <ChatArtifactCard
        key={artifact.id}
        artifact={artifact}
        runTitle={artifact.runId ? runTitles.get(artifact.runId) : undefined}
        workspace={thread.workspace}
        writePolicy={writePolicy}
        focused={focusedArtifactId === artifact.id}
        onPatchFinding={(finding: string): void => patchFinding(thread.id, finding)}
        onFileDecision={(path: string, decision: FileDecision): void =>
          decideFile({ threadId: thread.id, artifactId: artifact.id, path, decision })
        }
        onAcceptFile={(path: string, confirmed: boolean): Promise<void> =>
          acceptFile({ threadId: thread.id, artifactId: artifact.id, path, confirmed })
        }
      />
    );
  }

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
        {currentThread && hasConversationContent ? (
          <div className={`flex flex-col gap-3 px-4 py-4 ${centered ? "mx-auto w-full max-w-4xl" : ""}`}>
            {currentThread.messages.map((message: ChatMessage): JSX.Element => {
              if (message.role === "user") precedingUserId = message.id;
              const retryId: string | undefined =
                message.role === "user" || message.error ? precedingUserId : undefined;
              const linkedArtifacts: Artifact[] | undefined = artifactBuckets.byMessageId.get(
                message.id
              );

              return (
                <Fragment key={message.id}>
                  <MessageBubble
                    message={message}
                    onRetry={retryId ? (): void => retryMessage(currentThread.id, retryId) : undefined}
                    onChoose={(choice: string): void => chooseMessage(currentThread, message.id, choice)}
                    onConfirm={(accepted: boolean): void =>
                      resolveConfirmation(currentThread.id, message.id, accepted)
                    }
                  />
                  {linkedArtifacts && linkedArtifacts.length > 0 && (
                    <div className="flex min-w-0 flex-col gap-2">
                      {linkedArtifacts.map((artifact: Artifact): JSX.Element =>
                        renderArtifactCard(currentThread, artifact)
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}

            {artifactBuckets.trailing.length > 0 && (
              <div className="flex min-w-0 flex-col gap-2">
                {artifactBuckets.trailing.map((artifact: Artifact): JSX.Element =>
                  renderArtifactCard(currentThread, artifact)
                )}
              </div>
            )}

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
