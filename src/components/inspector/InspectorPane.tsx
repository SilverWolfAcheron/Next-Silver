import { useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import type { FileDecision } from "../../agent-core/diff";
import { getDomain } from "../../agent-core/domains/pcb";
import type { DomainPack } from "../../agent-core/domains/pcb";
import { getPreset } from "../../agent-core/presets";
import type { Preset } from "../../agent-core/presets";
import { requirementSequence } from "../../agent-core/session";
import type { Artifact, Brief, ChatMessage, InspectorTab, Thread } from "../../agent-core/types";
import { INSPECTOR_TAB_IDS } from "../../constants/layout";
import { useI18n } from "../../hooks/useI18n";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { InspectorPaneProps, ThreadInspectorProps } from "../../types/inspector";
import type { UIAction } from "../../types/runtime";
import type { AcceptFileParams, FileDecisionParams, RuntimeStore } from "../../types/stores";
import { ArtifactView } from "./ArtifactView";
import { BriefView } from "./BriefView";
import { ProgressView } from "./ProgressView";

export function InspectorPane({ embedded = false }: InspectorPaneProps): JSX.Element | null {
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  if (!currentThread) return null;
  if (!embedded && !currentThread.inspectorOpen) return null;
  return <ThreadInspector key={currentThread.id} thread={currentThread} embedded={embedded} />;
}

function ThreadInspector({ thread, embedded = false }: ThreadInspectorProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const dispatch: (action: UIAction) => void = useRuntimeStore(
    (s: RuntimeStore): ((action: UIAction) => void) => s.dispatch
  );
  const updateBrief: (threadId: string, brief: Brief) => void = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string, brief: Brief) => void) => s.updateBrief
  );
  const retryRun: (threadId: string, runId: string) => void = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string, runId: string) => void) => s.retryRun
  );
  const promoteThread: (threadId: string) => void = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string) => void) => s.promoteThread
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

  const [selectedRunId, setSelectedRunId]: [
    string | undefined,
    Dispatch<SetStateAction<string | undefined>>
  ] = useState<string | undefined>(undefined);
  const [selectedArtifactId, setSelectedArtifactId]: [
    string | undefined,
    Dispatch<SetStateAction<string | undefined>>
  ] = useState<string | undefined>(undefined);

  const preset: Preset = getPreset(thread.presetId);
  const domain: DomainPack | undefined = preset.domainId ? getDomain(preset.domainId) : undefined;
  const confirmationPending: boolean = Boolean(
    thread.pendingConfirmation && thread.pendingConfirmation.kind !== "brief"
  );
  const artifactRunIds: Set<string> = new Set(
    thread.artifacts.flatMap((artifact: Artifact): string[] =>
      artifact.runId ? [artifact.runId] : []
    )
  );
  const artifactIds: Set<string> = new Set(
    thread.artifacts.map((artifact: Artifact): string => artifact.id)
  );

  function setTab(tab: InspectorTab): void {
    dispatch({ type: "SET_INSPECTOR_TAB", threadId: thread.id, tab });
  }

  function viewArtifact(runId: string, artifactId?: string): void {
    setSelectedRunId(runId);
    setSelectedArtifactId(artifactId);
    setTab("artifact");
  }

  return (
    <aside
      aria-label={t.inspector.asideLabel}
      className={`flex h-full max-w-full shrink-0 flex-col ${
        embedded ? "w-full bg-surface" : "w-[320px] border-l border-separator bg-canvas"
      }`}
    >
      {!embedded && (
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <div
            className="flex flex-1 overflow-hidden rounded-[10px] border border-separator bg-group"
            aria-label={t.inspector.tabGroupLabel}
            role="group"
          >
            {INSPECTOR_TAB_IDS.map((tabId: InspectorTab): JSX.Element => (
              <button
                key={tabId}
                type="button"
                onClick={(): void => setTab(tabId)}
                aria-pressed={thread.inspectorTab === tabId}
                className={`min-h-11 flex-1 py-1.5 text-[13px] font-medium ${
                  thread.inspectorTab === tabId ? "bg-fill text-label" : "text-secondary hover:text-label"
                }`}
              >
                {t.inspector.tabs[tabId]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={t.inspector.closeInspector}
            onClick={(): void =>
              dispatch({ type: "SET_INSPECTOR_OPEN", threadId: thread.id, open: false })
            }
            className="flex min-h-11 min-w-11 items-center justify-center rounded-[10px] text-[17px] text-secondary hover:bg-fill hover:text-label"
          >
            ✕
          </button>
        </div>
      )}

      <div key={thread.inspectorTab} className="min-h-0 flex-1 overflow-y-auto">
        {thread.inspectorTab === "brief" &&
          (thread.brief ? (
            <BriefView
              brief={thread.brief}
              domain={domain}
              requirementSequence={requirementSequence(thread)}
              confirmationPending={confirmationPending}
              onSave={(brief: Brief): void => updateBrief(thread.id, brief)}
            />
          ) : (
            <EmptyPane text={t.inspector.emptyBrief} />
          ))}

        {thread.inspectorTab === "progress" &&
          (thread.runs.length > 0 ? (
            <ProgressView
              runs={thread.runs}
              artifactRunIds={artifactRunIds}
              artifactIds={artifactIds}
              selectedRunId={selectedRunId}
              onSelect={(runId: string): void => {
                setSelectedRunId((selected: string | undefined): string | undefined =>
                  selected === runId ? undefined : runId
                );
                setSelectedArtifactId(undefined);
              }}
              onViewArtifact={viewArtifact}
              onViewIteration={viewArtifact}
              onRetry={(runId: string): void => retryRun(thread.id, runId)}
            />
          ) : (
            <EmptyPane text={t.inspector.emptyProgress} />
          ))}

        {thread.inspectorTab === "artifact" && (
          <ArtifactView
            artifacts={thread.artifacts}
            runs={thread.runs}
            workspace={thread.workspace}
            writePolicy={preset.writePolicy}
            selectedRunId={selectedRunId}
            selectedArtifactId={selectedArtifactId}
            onPromote={
              thread.mode === "single" &&
              thread.messages.some((message: ChatMessage): boolean => message.role === "user")
                ? (): void => promoteThread(thread.id)
                : undefined
            }
            onPatchFinding={(finding: string): void => patchFinding(thread.id, finding)}
            onFileDecision={(artifact: Artifact, path: string, decision: FileDecision): void =>
              decideFile({ threadId: thread.id, artifactId: artifact.id, path, decision })
            }
            onAcceptFile={(artifact: Artifact, path: string, confirmed: boolean): Promise<void> =>
              acceptFile({ threadId: thread.id, artifactId: artifact.id, path, confirmed })
            }
          />
        )}
      </div>
    </aside>
  );
}

function EmptyPane({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[15px] text-secondary">
      {text}
    </div>
  );
}
