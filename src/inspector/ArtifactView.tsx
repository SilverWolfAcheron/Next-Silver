import { useLayoutEffect, useRef } from "react";
import type { Artifact, Run, WritePolicy } from "../model/types";
import type { WorkspaceSummary } from "../model/workspace";
import { DiffArtifact } from "./DiffArtifact";
import { DocArtifact } from "./DocArtifact";
import { Button } from "../ui/Button";

interface ArtifactViewProps {
  artifacts: Artifact[];
  runs: Run[];
  workspace?: WorkspaceSummary;
  writePolicy: WritePolicy;
  selectedRunId?: string;
  selectedArtifactId?: string;
  onPromote?: () => void;
  onPatchFinding: (finding: string) => void;
  onFileDecision: (artifact: Artifact, path: string, decision: "accepted" | "rejected") => void;
  onAcceptFile: (artifact: Artifact, path: string, confirmed: boolean) => Promise<void>;
}

export function ArtifactView({
  artifacts,
  runs,
  workspace,
  writePolicy,
  selectedRunId,
  selectedArtifactId,
  onPromote,
  onPatchFinding,
  onFileDecision,
  onAcceptFile,
}: ArtifactViewProps) {
  const selectedGroup = useRef<HTMLElement>(null);
  const selectedItem = useRef<HTMLDivElement>(null);
  const runTitles = new Map(runs.map((run) => [run.id, run.title]));
  const groups = new Map<string | undefined, Artifact[]>();
  for (const artifact of artifacts) {
    const group = groups.get(artifact.runId);
    if (group) group.push(artifact);
    else groups.set(artifact.runId, [artifact]);
  }

  useLayoutEffect(() => {
    const target = selectedItem.current ?? selectedGroup.current;
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [selectedRunId, selectedArtifactId]);

  return (
    <div className={`flex min-w-0 flex-col gap-4 p-4 ${artifacts.length === 0 ? "h-full" : ""}`}>
      {onPromote && (
        <Button variant="ghost" type="button" className="self-end text-[13px]" onClick={onPromote}>
          升成项目
        </Button>
      )}
      {artifacts.length === 0 && (
        <div className="flex min-h-40 flex-1 items-center justify-center text-[15px] text-secondary">暂无产物</div>
      )}
      {Array.from(groups, ([runId, items]) => (
        <section
          key={runId ? `run:${runId}` : "unassigned"}
          ref={runId && selectedRunId === runId ? selectedGroup : undefined}
          tabIndex={runId && selectedRunId === runId ? -1 : undefined}
          className="flex min-w-0 scroll-mt-4 flex-col gap-3"
        >
          {runId && runTitles.get(runId) && (
            <h2 className="text-[13px] font-semibold wrap-anywhere text-secondary">{runTitles.get(runId)}</h2>
          )}
          {items.map((artifact) => (
            <div
              key={artifact.id}
              ref={artifact.id === selectedArtifactId ? selectedItem : undefined}
              tabIndex={artifact.id === selectedArtifactId ? -1 : undefined}
              className={`min-w-0 scroll-mt-3 rounded-[12px] border border-separator bg-group ${artifact.kind === "diff" ? "overflow-hidden" : "p-4"}`}
            >
              {artifact.kind === "diff" ? <>
                <div className="border-b border-separator px-3 py-2">
                  <h2 className="text-[13px] font-semibold wrap-anywhere text-label">{artifact.title}</h2>
                </div>
                <div className="p-2">
                  <DiffArtifact
                    artifact={artifact}
                    workspace={workspace}
                    writePolicy={writePolicy}
                    onDecision={(path, decision) => onFileDecision(artifact, path, decision)}
                    onAcceptFile={(path, confirmed) => onAcceptFile(artifact, path, confirmed)}
                  />
                </div>
              </> : (
                <DocArtifact
                  title={artifact.title}
                  body={artifact.body}
                  kind={artifact.kind}
                  workspace={writePolicy === "none" ? undefined : workspace}
                  onPatchFinding={onPatchFinding}
                />
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
