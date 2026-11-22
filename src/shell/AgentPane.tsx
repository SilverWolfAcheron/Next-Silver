import type { InspectorTab } from "../model/types";
import { useSilverStore } from "../state/silverStore";
import { Composer } from "./Composer";
import { Inspector } from "./Inspector";
import { ThreadView } from "./ThreadView";

export const AGENT_TABS: { id: "chat" | InspectorTab; label: string }[] = [
  { id: "chat", label: "对话" },
  { id: "brief", label: "简报" },
  { id: "progress", label: "进度" },
  { id: "artifact", label: "改动" },
];

interface AgentPaneProps {
  tab: "chat" | InspectorTab;
  onTab: (tab: "chat" | InspectorTab) => void;
  hideTabs?: boolean;
  centered?: boolean;
  onPickReferenceFile?: () => void;
}

export function AgentPane({ tab, onTab, hideTabs = false, centered = false, onPickReferenceFile }: AgentPaneProps) {
  const currentThread = useSilverStore((s) => s.currentThread);
  const running = useSilverStore((s) =>
    s.currentThread ? s.busyThreads.includes(s.currentThread.id) : false,
  );
  const dispatch = useSilverStore((s) => s.dispatch);
  const confirmation = currentThread?.pendingConfirmation;

  function select(next: "chat" | InspectorTab) {
    onTab(next);
    if (next !== "chat" && currentThread) {
      dispatch({ type: "SET_INSPECTOR_TAB", threadId: currentThread.id, tab: next });
      dispatch({ type: "SET_INSPECTOR_OPEN", threadId: currentThread.id, open: true });
    }
  }

  return (
    <aside aria-label="对话" className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface">
      {!hideTabs && (
        <div className="flex shrink-0 gap-0.5 border-b border-separator px-2 py-1" role="group" aria-label="对话页面">
          {AGENT_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => select(item.id)}
              className={`min-h-10 flex-1 rounded-[8px] text-[13px] ${tab === item.id ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {tab !== "chat" && confirmation && (
        <button
          type="button"
          onClick={() => select("chat")}
          className={`min-h-10 shrink-0 border-b border-separator px-3 text-[13px] text-accent hover:bg-fill ${centered ? "text-center" : "text-left"}`}
        >
          有一项待确认，查看对话
        </button>
      )}
      {tab === "chat" && running && !confirmation && (
        <p role="status" className={`shrink-0 border-b border-separator px-3 py-1.5 text-[13px] text-secondary ${centered ? "text-center" : ""}`}>
          运行中
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "chat" || !currentThread ? (
          <ThreadView centered={centered} onPickReferenceFile={onPickReferenceFile} />
        ) : centered ? (
          <div className="flex min-h-0 flex-1 justify-center bg-surface">
            <div className="flex min-h-0 w-full max-w-4xl flex-col">
              <Inspector embedded />
            </div>
          </div>
        ) : (
          <Inspector embedded />
        )}
      </div>
      <Composer />
    </aside>
  );
}
