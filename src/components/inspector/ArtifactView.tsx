import { Fragment, useLayoutEffect, useRef } from "react";
import type { JSX, RefObject } from "react";
import type { FileDecision } from "../../agent-core/diff";
import type { Artifact, Run } from "../../agent-core/types";
import { useI18n } from "../../hooks/useI18n";
import type { ArtifactViewProps } from "../../types/inspector";
import { groupArtifactsByRun } from "../../utils/inspectorData";
import { Button } from "../common/Button";
import { DiffArtifact } from "./DiffArtifact";
import { DocArtifact } from "./DocArtifact";

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
}: ArtifactViewProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const selectedGroupRef: RefObject<HTMLElement | null> = useRef<HTMLElement>(null);
  const selectedItemRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const runTitles: Map<string, string> = new Map(
    runs.map((run: Run): [string, string] => [run.id, run.title])
  );
  const groups: Map<string | undefined, Artifact[]> = groupArtifactsByRun(artifacts);

  useLayoutEffect((): void => {
    const target: HTMLElement | null = selectedItemRef.current ?? selectedGroupRef.current;
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }, [selectedRunId, selectedArtifactId]);

  return (
    <div className={`flex min-w-0 flex-col gap-4 p-4 ${artifacts.length === 0 ? "h-full" : ""}`}>
      {onPromote && (
        <Button variant="ghost" type="button" className="self-end text-[13px]" onClick={onPromote}>
          {t.inspector.promoteToProject}
        </Button>
      )}

      {artifacts.length === 0 && (
        <div className="flex min-h-40 flex-1 items-center justify-center text-[15px] text-secondary">
          {t.inspector.emptyArtifact}
        </div>
      )}

      {Array.from(
        groups,
        ([runId, items]: [string | undefined, Artifact[]]): JSX.Element => (
          <section
            key={runId ? `run:${runId}` : "unassigned"}
            ref={runId && selectedRunId === runId ? selectedGroupRef : undefined}
            tabIndex={runId && selectedRunId === runId ? -1 : undefined}
            className="flex min-w-0 scroll-mt-4 flex-col gap-3"
          >
            {runId && runTitles.get(runId) && (
              <h2 className="text-[13px] font-semibold wrap-anywhere text-secondary">
                {runTitles.get(runId)}
              </h2>
            )}
            {items.map((artifact: Artifact): JSX.Element => (
              <div
                key={artifact.id}
                ref={artifact.id === selectedArtifactId ? selectedItemRef : undefined}
                tabIndex={artifact.id === selectedArtifactId ? -1 : undefined}
                className={`min-w-0 scroll-mt-3 rounded-[12px] border border-separator bg-group ${
                  artifact.kind === "diff" ? "overflow-hidden" : "p-4"
                }`}
              >
                {artifact.kind === "diff" ? (
                  <Fragment>
                    <div className="border-b border-separator px-3 py-2">
                      <h2 className="text-[13px] font-semibold wrap-anywhere text-label">
                        {artifact.title}
                      </h2>
                    </div>
                    <div className="p-2">
                      <DiffArtifact
                        artifact={artifact}
                        workspace={workspace}
                        writePolicy={writePolicy}
                        onDecision={(path: string, decision: FileDecision): void =>
                          onFileDecision(artifact, path, decision)
                        }
                        onAcceptFile={(path: string, confirmed: boolean): Promise<void> =>
                          onAcceptFile(artifact, path, confirmed)
                        }
                      />
                    </div>
                  </Fragment>
                ) : (
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
        )
      )}
    </div>
  );
}
