import type { JSX } from "react";
import { useGitDiffView } from "../../hooks/useGitDiffView";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { GitDiffFile, GitDiffViewProps } from "../../types/git";
import { GitBranchIcon, RefreshIcon } from "../common/Icons";
import { GitDiffFileCard } from "./GitDiffFileCard";

export function GitDiffView({ workspace, onOpenFile }: GitDiffViewProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const {
    supported,
    status,
    diff,
    error,
    selectedPath,
    collapsedPaths,
    allCollapsed,
    refresh,
    toggleCollapse,
    expandAll,
    collapseAll,
    registerCardRef,
  }: ReturnType<typeof useGitDiffView> = useGitDiffView(workspace);

  if (!supported) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[14px] text-secondary">
        {t.workspace.desktopOnlyHint}
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[14px] text-secondary">
        {t.gitDiff.noWorkspace}
      </div>
    );
  }

  if (status === "loading" && !diff) {
    return (
      <div
        role="status"
        className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[14px] text-secondary"
      >
        {t.gitDiff.loading}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="alert" className="text-[14px] text-danger">
          {formatError(error, t)}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-separator bg-group px-3 text-[12.5px] text-label transition-colors hover:bg-fill"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          <span>{t.common.retry}</span>
        </button>
      </div>
    );
  }

  if (diff && !diff.isRepo) {
    return (
      <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[14px] text-secondary">
        {t.gitDiff.notGitRepo}
      </div>
    );
  }

  const files: GitDiffFile[] = diff?.files ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-separator/85 bg-group px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px]">
          {diff?.branch && (
            <span className="inline-flex items-center gap-1 rounded-full border border-separator/80 bg-canvas px-2.5 py-0.5 font-mono text-[12px] text-label">
              <GitBranchIcon className="h-3.5 w-3.5 text-secondary" />
              <span className="truncate">{diff.branch}</span>
            </span>
          )}
          <span className="text-secondary">{t.gitDiff.filesSummary(files.length)}</span>
          {diff && (diff.totalAdditions > 0 || diff.totalDeletions > 0) && (
            <span
              className="flex items-center gap-1.5 font-mono text-[12px] font-medium"
              aria-label={t.diff.statsAriaLabel(diff.totalAdditions, diff.totalDeletions)}
            >
              <span className="text-success">+{diff.totalAdditions}</span>
              <span className="text-danger">−{diff.totalDeletions}</span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {files.length > 0 && (
            <button
              type="button"
              onClick={allCollapsed ? expandAll : collapseAll}
              className="h-7 rounded-[7px] px-2 text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
            >
              {allCollapsed ? t.gitDiff.expandAll : t.gitDiff.collapseAll}
            </button>
          )}
          <button
            type="button"
            aria-label={t.gitDiff.refresh}
            title={t.gitDiff.refresh}
            onClick={refresh}
            className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            <RefreshIcon className="h-3.5 w-3.5" />
            <span>{t.gitDiff.refresh}</span>
          </button>
        </div>
      </div>

      {diff?.truncated && (
        <p className="rounded-[10px] border border-separator/80 bg-canvas/65 px-3 py-2 text-[12px] text-secondary">
          {t.gitDiff.truncatedWorkspace}
        </p>
      )}

      {files.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center rounded-[12px] border border-dashed border-separator px-6 text-center text-[14px] text-secondary">
          {t.gitDiff.cleanWorkingTree}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {files.map((file: GitDiffFile): JSX.Element => (
            <GitDiffFileCard
              key={file.path}
              file={file}
              selected={selectedPath === file.path}
              collapsed={collapsedPaths.has(file.path)}
              cardRef={(element: HTMLElement | null): void => registerCardRef(file.path, element)}
              onToggleCollapse={(): void => toggleCollapse(file.path)}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
