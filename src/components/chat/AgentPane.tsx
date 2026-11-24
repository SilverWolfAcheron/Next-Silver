import type { JSX } from "react";
import type { PendingConfirmation, Thread } from "../../agent-core/types";
import { AGENT_TAB_IDS } from "../../constants/layout";
import { useI18n } from "../../hooks/useI18n";
import { useLayoutStore } from "../../stores/layoutStore";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { AgentPaneProps } from "../../types/chat";
import type { AgentTab } from "../../types/layout";
import type { UIAction } from "../../types/runtime";
import type { LayoutStore, RuntimeStore } from "../../types/stores";
import { InspectorPane } from "../inspector/InspectorPane";
import { AgentActivity } from "./AgentActivity";
import { Composer } from "./Composer";
import { ThreadView } from "./ThreadView";

export function AgentPane({
  tab,
  onTab,
  hideTabs = false,
  centered = false,
  onPickReferenceFile,
  onOpenFile,
}: AgentPaneProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  const dispatch: (action: UIAction) => void = useRuntimeStore(
    (s: RuntimeStore): ((action: UIAction) => void) => s.dispatch
  );
  const setFocusedArtifactId: (artifactId: string | null) => void = useLayoutStore(
    (s: LayoutStore): ((artifactId: string | null) => void) => s.setFocusedArtifactId
  );
  const confirmation: PendingConfirmation | undefined = currentThread?.pendingConfirmation;

  function select(next: AgentTab): void {
    onTab(next);
    if (next !== "chat" && currentThread) {
      dispatch({ type: "SET_INSPECTOR_TAB", threadId: currentThread.id, tab: next });
      dispatch({ type: "SET_INSPECTOR_OPEN", threadId: currentThread.id, open: true });
    }
  }

  function handleViewArtifactInChat(artifactId: string): void {
    setFocusedArtifactId(artifactId);
    select("chat");
  }

  return (
    <aside aria-label={t.chat.asideLabel} className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface">
      {!hideTabs && (
        <div
          className="flex shrink-0 gap-0.5 border-b border-separator px-2 py-1"
          role="group"
          aria-label={t.chat.tabGroupLabel}
        >
          {AGENT_TAB_IDS.map((tabId: AgentTab): JSX.Element => (
            <button
              key={tabId}
              type="button"
              aria-pressed={tab === tabId}
              onClick={(): void => select(tabId)}
              className={`min-h-10 flex-1 rounded-[8px] text-[13px] ${
                tab === tabId ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill"
              }`}
            >
              {t.layout.tabs[tabId]}
            </button>
          ))}
        </div>
      )}

      {tab !== "chat" && confirmation && (
        <button
          type="button"
          onClick={(): void => select("chat")}
          className={`min-h-10 shrink-0 border-b border-separator px-3 text-[13px] text-accent hover:bg-fill ${
            centered ? "text-center" : "text-left"
          }`}
        >
          {t.chat.pendingConfirmBanner}
        </button>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "chat" || !currentThread ? (
          <ThreadView centered={centered} onPickReferenceFile={onPickReferenceFile} />
        ) : centered ? (
          <div className="flex min-h-0 flex-1 justify-center bg-surface">
            <div
              className={`flex min-h-0 w-full flex-col ${
                tab === "artifact" ? "max-w-5xl" : "max-w-4xl"
              }`}
            >
              <InspectorPane
                embedded
                onOpenFile={onOpenFile}
                onViewArtifactInChat={handleViewArtifactInChat}
              />
            </div>
          </div>
        ) : (
          <InspectorPane
            embedded
            onOpenFile={onOpenFile}
            onViewArtifactInChat={handleViewArtifactInChat}
          />
        )}
      </div>
      <AgentActivity key={currentThread?.id} />
      <Composer />
    </aside>
  );
}
