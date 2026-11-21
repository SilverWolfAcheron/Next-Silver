import type { InspectorTab } from "../model/types";
import { useSilver } from "../state/SilverContext";
import { Composer } from "./Composer";
import { Inspector } from "./Inspector";
import { ProviderPanel } from "./ProviderPanel";
import { ThreadView } from "./ThreadView";

const TABS: { id: "chat" | InspectorTab; label: string }[] = [
  { id: "chat", label: "对话" },
  { id: "brief", label: "简报" },
  { id: "progress", label: "进度" },
  { id: "artifact", label: "改动" },
];

interface AgentPaneProps {
  tab: "chat" | InspectorTab;
  onTab: (tab: "chat" | InspectorTab) => void;
}

export function AgentPane({ tab, onTab }: AgentPaneProps) {
  const { state, currentThread, dispatch } = useSilver();

  function select(next: "chat" | InspectorTab) {
    onTab(next);
    if (next !== "chat" && currentThread) {
      dispatch({ type: "SET_INSPECTOR_TAB", threadId: currentThread.id, tab: next });
      dispatch({ type: "SET_INSPECTOR_OPEN", threadId: currentThread.id, open: true });
    }
  }

  if (state.providerPanelOpen) return <ProviderPanel />;

  return (
    <aside aria-label="对话" className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface">
      <div className="flex shrink-0 gap-0.5 border-b border-separator px-2 py-1" role="group" aria-label="对话页面">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => select(item.id)}
            className={`min-h-11 flex-1 rounded-[10px] text-[13px] ${tab === item.id ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "chat" || !currentThread ? <ThreadView /> : <Inspector embedded />}
      </div>
      <Composer />
    </aside>
  );
}
