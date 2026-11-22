import { useState } from "react";
import { useSilverStore } from "../state/silverStore";
import type { InspectorTab, Thread } from "../model/types";
import { BriefView } from "../inspector/BriefView";
import { ProgressView } from "../inspector/ProgressView";
import { ArtifactView } from "../inspector/ArtifactView";
import { getDomain } from "../model/domains/pcb";
import { getPreset } from "../model/presets";
import { requirementSequence } from "../model/session";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "brief", label: "简报" },
  { id: "progress", label: "进度" },
  { id: "artifact", label: "产物" },
];

export function Inspector({ embedded = false }: { embedded?: boolean }) {
  const currentThread = useSilverStore((s) => s.currentThread);
  if (!currentThread) return null;
  if (!embedded && !currentThread.inspectorOpen) return null;
  return <ThreadInspector key={currentThread.id} thread={currentThread} embedded={embedded} />;
}

function ThreadInspector({ thread, embedded = false }: { thread: Thread; embedded?: boolean }) {
  const dispatch = useSilverStore((s) => s.dispatch);
  const updateBrief = useSilverStore((s) => s.updateBrief);
  const retryRun = useSilverStore((s) => s.retryRun);
  const promoteThread = useSilverStore((s) => s.promoteThread);
  const patchFinding = useSilverStore((s) => s.patchFinding);
  const decideFile = useSilverStore((s) => s.decideFile);
  const acceptFile = useSilverStore((s) => s.acceptFile);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const preset = getPreset(thread.presetId);
  const domain = preset.domainId ? getDomain(preset.domainId) : undefined;
  const confirmationPending = Boolean(thread.pendingConfirmation && thread.pendingConfirmation.kind !== "brief");
  const artifactRunIds = new Set(thread.artifacts.flatMap((artifact) => artifact.runId ? [artifact.runId] : []));
  const artifactIds = new Set(thread.artifacts.map((artifact) => artifact.id));

  function setTab(tab: InspectorTab) {
    dispatch({ type: "SET_INSPECTOR_TAB", threadId: thread.id, tab });
  }

  function viewArtifact(runId: string, artifactId?: string) {
    setSelectedRunId(runId);
    setSelectedArtifactId(artifactId);
    setTab("artifact");
  }

  return (
    <aside
      aria-label="检查器"
      className={`flex h-full max-w-full shrink-0 flex-col ${embedded ? "w-full bg-surface" : "w-[320px] border-l border-separator bg-canvas"}`}
    >
      {!embedded && <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <div className="flex flex-1 overflow-hidden rounded-[10px] border border-separator bg-group" aria-label="检查器页面" role="group">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              aria-pressed={thread.inspectorTab === tab.id}
              className={`min-h-11 flex-1 py-1.5 text-[13px] font-medium ${thread.inspectorTab === tab.id
                ? "bg-fill text-label"
                : "text-secondary hover:text-label"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="关闭检查器"
          onClick={() => dispatch({ type: "SET_INSPECTOR_OPEN", threadId: thread.id, open: false })}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-[17px] text-secondary hover:bg-fill hover:text-label"
        >
          ✕
        </button>
      </div>}

      <div key={thread.inspectorTab} className="min-h-0 flex-1 overflow-y-auto">
        {thread.inspectorTab === "brief" && (
          thread.brief ? (
            <BriefView
              brief={thread.brief}
              domain={domain}
              requirementSequence={requirementSequence(thread)}
              confirmationPending={confirmationPending}
              onSave={(brief) => updateBrief(thread.id, brief)}
            />
          ) : (
            <EmptyPane text="简报将在目标明确后出现" />
          )
        )}
        {thread.inspectorTab === "progress" && (
          thread.runs.length > 0 ? (
            <ProgressView
              runs={thread.runs}
              artifactRunIds={artifactRunIds}
              artifactIds={artifactIds}
              selectedRunId={selectedRunId}
              onSelect={(runId) => {
                setSelectedRunId((selected) => selected === runId ? undefined : runId);
                setSelectedArtifactId(undefined);
              }}
              onViewArtifact={viewArtifact}
              onViewIteration={viewArtifact}
              onRetry={(runId) => retryRun(thread.id, runId)}
            />
          ) : (
            <EmptyPane text="工作项将在派发后出现" />
          )
        )}
        {thread.inspectorTab === "artifact" && (
            <ArtifactView
              artifacts={thread.artifacts}
              runs={thread.runs}
              workspace={thread.workspace}
              writePolicy={preset.writePolicy}
              selectedRunId={selectedRunId}
              selectedArtifactId={selectedArtifactId}
              onPromote={thread.mode === "single" && thread.messages.some((message) => message.role === "user")
                ? () => promoteThread(thread.id)
                : undefined}
              onPatchFinding={(finding) => patchFinding(thread.id, finding)}
              onFileDecision={(artifact, path, decision) => decideFile(thread.id, artifact.id, path, decision)}
              onAcceptFile={(artifact, path, confirmed) => acceptFile(thread.id, artifact.id, path, confirmed)}
            />
        )}
      </div>
    </aside>
  );
}

function EmptyPane({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[15px] text-secondary">
      {text}
    </div>
  );
}
