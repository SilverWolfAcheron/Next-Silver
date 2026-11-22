import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, JSX, RefObject, SetStateAction } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { ChatArtifactCardProps } from "../../types/chat";
import { summarizeDiffArtifact } from "../../utils/chatArtifacts";
import type { DiffArtifactSummary } from "../../utils/chatArtifacts";
import { ChevronRightIcon } from "../common/Icons";
import { DiffArtifact } from "../inspector/DiffArtifact";
import { DocArtifact } from "../inspector/DocArtifact";

export function ChatArtifactCard({
  artifact,
  runTitle,
  workspace,
  writePolicy,
  focused = false,
  defaultExpanded,
  onPatchFinding,
  onFileDecision,
  onAcceptFile,
}: ChatArtifactCardProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const cardRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);

  const diffSummary: DiffArtifactSummary | null = useMemo(
    (): DiffArtifactSummary | null =>
      artifact.kind === "diff" ? summarizeDiffArtifact(artifact) : null,
    [artifact]
  );

  const initialExpanded: boolean =
    defaultExpanded ??
    (focused ||
      artifact.kind !== "diff" ||
      Boolean(diffSummary && (!diffSummary.hasDecidableFiles || diffSummary.pendingCount > 0)));

  const [expanded, setExpanded]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(initialExpanded);

  useEffect((): void => {
    if (!focused) return;
    setExpanded(true);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);

  return (
    <div
      ref={cardRef}
      className={`min-w-0 overflow-hidden rounded-[12px] border bg-group/90 transition-shadow ${
        focused ? "border-accent/65 ring-1 ring-accent/45" : "border-separator/85"
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(): void => setExpanded((open: boolean): boolean => !open)}
        className="flex w-full min-w-0 items-center gap-2 bg-canvas/60 px-3 py-2 text-left transition-colors hover:bg-fill/45"
      >
        <ChevronRightIcon expanded={expanded} className="h-3.5 w-3.5 shrink-0 text-secondary" />
        <span className="shrink-0 rounded-full border border-separator/80 bg-surface px-2 py-0.5 text-[11px] font-medium text-secondary">
          {t.gitDiff.agentArtifactLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-label">
          {runTitle && runTitle !== artifact.title
            ? `${runTitle} · ${artifact.title}`
            : artifact.title}
        </span>

        {diffSummary && (
          <span className="flex shrink-0 items-center gap-2 font-mono text-[12px]">
            <span className="text-secondary">{t.gitDiff.agentArtifactFiles(diffSummary.fileCount)}</span>
            {diffSummary.additions > 0 && (
              <span className="text-success">+{diffSummary.additions}</span>
            )}
            {diffSummary.deletions > 0 && (
              <span className="text-danger">−{diffSummary.deletions}</span>
            )}
            {diffSummary.hasDecidableFiles && (
              <span
                className={`rounded-full px-1.5 py-0.5 font-sans text-[11px] ${
                  diffSummary.pendingCount > 0
                    ? "bg-accent/15 text-accent"
                    : "bg-success/15 text-success"
                }`}
              >
                {diffSummary.pendingCount > 0
                  ? t.gitDiff.agentArtifactPending(diffSummary.pendingCount)
                  : t.gitDiff.agentArtifactSettled}
              </span>
            )}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-separator/80 p-3">
          {artifact.kind === "diff" ? (
            <DiffArtifact
              artifact={artifact}
              workspace={workspace}
              writePolicy={writePolicy}
              onDecision={onFileDecision}
              onAcceptFile={onAcceptFile}
            />
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
      )}
    </div>
  );
}
