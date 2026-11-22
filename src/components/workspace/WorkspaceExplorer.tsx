import { Fragment, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import type { WorkspaceSummary } from "../../agent-core/types";
import { WORKSPACE_ICON_BUTTON_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import { selectWorkspace, workspaceErrorText, workspaceSupported } from "../../services/workspaceClient";
import { useGitDiffStore } from "../../stores/gitDiffStore";
import type { WorkspaceGitDiff } from "../../types/git";
import type { GitDiffStore } from "../../types/stores";
import type { WorkspaceExplorerProps } from "../../types/workspace";
import {
  ChevronRightIcon,
  CollapseAllIcon,
  FolderOutlineIcon,
  RefreshIcon,
  SearchIcon,
} from "../common/Icons";
import { WorkspaceChangesTree } from "./WorkspaceChangesTree";
import { WorkspaceTree } from "./WorkspaceTree";

export function WorkspaceExplorer({
  workspace,
  selectedPath,
  selectedDiffPath,
  onBind,
  onPreview,
  onOpenChanges,
  onSelectChangedFile,
  onSearchText,
}: WorkspaceExplorerProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const [opening, setOpening]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [openError, setOpenError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [sectionOpen, setSectionOpen]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(true);
  const [changesOpen, setChangesOpen]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(false);
  const [refreshEpoch, setRefreshEpoch]: [number, Dispatch<SetStateAction<number>>] =
    useState<number>(0);
  const [collapseEpoch, setCollapseEpoch]: [number, Dispatch<SetStateAction<number>>] =
    useState<number>(0);
  const [changesCollapseEpoch, setChangesCollapseEpoch]: [
    number,
    Dispatch<SetStateAction<number>>
  ] = useState<number>(0);

  const diffWorkspaceId: string | null = useGitDiffStore(
    (s: GitDiffStore): string | null => s.workspaceId
  );
  const gitDiff: WorkspaceGitDiff | null = useGitDiffStore(
    (s: GitDiffStore): WorkspaceGitDiff | null => s.diff
  );
  const loadGitDiff: (target: WorkspaceSummary) => Promise<void> = useGitDiffStore(
    (s: GitDiffStore): ((target: WorkspaceSummary) => Promise<void>) => s.loadGitDiff
  );

  const supported: boolean = workspaceSupported();
  const activeDiff: WorkspaceGitDiff | null =
    workspace?.id === diffWorkspaceId ? gitDiff : null;

  async function bind(): Promise<void> {
    setOpening(true);
    setOpenError("");
    try {
      onBind(await selectWorkspace());
      setSectionOpen(true);
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setOpenError(workspaceErrorText(error));
      }
    } finally {
      setOpening(false);
    }
  }

  function handleToggleChanges(): void {
    const nextOpen: boolean = !changesOpen;
    setChangesOpen(nextOpen);
    if (nextOpen) {
      if (workspace) void loadGitDiff(workspace);
      onOpenChanges?.();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col text-[13px]">
      <section className={`flex min-h-0 flex-col ${sectionOpen ? "flex-1" : "shrink-0"}`}>
        <div className="flex h-12 shrink-0 items-center gap-1 px-2.5 select-none">
          <button
            type="button"
            aria-expanded={sectionOpen}
            onClick={(): void => setSectionOpen((open: boolean): boolean => !open)}
            title={workspace?.path ?? workspace?.name ?? t.workspace.explorer}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] px-1 py-1 text-left text-[12px] font-semibold tracking-wider text-secondary uppercase hover:text-label"
          >
            <ChevronRightIcon expanded={sectionOpen} className="h-3.5 w-3.5 shrink-0 text-secondary" />
            <span className="min-w-0 truncate">{workspace ? workspace.name : t.workspace.explorer}</span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            {workspace && supported && (
              <Fragment>
                {onSearchText && (
                  <button
                    type="button"
                    aria-label={t.workspace.searchTextLabel}
                    title={t.workspace.searchTextShortcut}
                    onClick={onSearchText}
                    className={WORKSPACE_ICON_BUTTON_CLASS}
                  >
                    <SearchIcon />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t.workspace.refreshTree}
                  title={t.workspace.refreshTree}
                  onClick={(): void => setRefreshEpoch((n: number): number => n + 1)}
                  className={WORKSPACE_ICON_BUTTON_CLASS}
                >
                  <RefreshIcon />
                </button>
                <button
                  type="button"
                  aria-label={t.workspace.collapseAll}
                  title={t.workspace.collapseAll}
                  onClick={(): void => setCollapseEpoch((n: number): number => n + 1)}
                  className={WORKSPACE_ICON_BUTTON_CLASS}
                >
                  <CollapseAllIcon />
                </button>
              </Fragment>
            )}
            <button
              type="button"
              disabled={opening || !supported}
              aria-label={workspace ? t.workspace.changeFolder : t.workspace.openFolder}
              title={workspace ? t.workspace.changeFolder : t.workspace.openFolder}
              onClick={(): void => {
                void bind();
              }}
              className={WORKSPACE_ICON_BUTTON_CLASS}
            >
              <FolderOutlineIcon />
            </button>
          </div>
        </div>

        {sectionOpen && (
          <div className="group/tree min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            <div aria-hidden="true" className="mx-1.5 mb-1.5 border-t border-separator/55" />
            {!supported && <p className="px-3 py-2 text-[12px] text-secondary">{t.workspace.desktopOnlyHint}</p>}
            {openError && (
              <p role="status" className="px-3 py-1.5 text-[12px] text-danger">
                {formatError(openError, t)}
              </p>
            )}
            {workspace && supported ? (
              <WorkspaceTree
                key={`${workspace.id}:${collapseEpoch}`}
                workspace={workspace}
                depth={0}
                refreshEpoch={refreshEpoch}
                selectedPath={selectedPath}
                onPreview={onPreview}
              />
            ) : (
              supported && (
                <div className="flex flex-col gap-2 px-3 py-3">
                  <p className="text-[12px] leading-5 text-secondary">{t.workspace.noFolderHint}</p>
                  <button
                    type="button"
                    disabled={opening}
                    onClick={(): void => {
                      void bind();
                    }}
                    className="flex h-8 w-full items-center justify-center rounded-[6px] bg-accent px-3 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
                  >
                    {opening ? t.common.opening : t.common.openFolder}
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </section>

      {workspace && supported && (
        <section
          className={`flex min-h-0 flex-col border-t border-separator ${
            changesOpen
              ? sectionOpen
                ? "max-h-[45%] min-h-[140px] shrink-0"
                : "flex-1"
              : "shrink-0"
          }`}
        >
          <div className="flex h-12 shrink-0 items-center gap-1 px-2.5 select-none">
            <button
              type="button"
              aria-expanded={changesOpen}
              onClick={handleToggleChanges}
              title={t.gitDiff.sectionTitle}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] px-1 py-1 text-left text-[12px] font-semibold tracking-wider text-secondary uppercase hover:text-label"
            >
              <ChevronRightIcon expanded={changesOpen} className="h-3.5 w-3.5 shrink-0 text-secondary" />
              <span className="min-w-0 truncate">{t.gitDiff.sectionTitle}</span>
              {activeDiff?.isRepo && (
                <span className="shrink-0 rounded-full bg-fill px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-normal text-label normal-case">
                  {activeDiff.files.length}
                </span>
              )}
            </button>

            <div className="flex shrink-0 items-center gap-0.5">
              {activeDiff?.isRepo && (activeDiff.totalAdditions > 0 || activeDiff.totalDeletions > 0) && (
                <span className="mr-1 flex shrink-0 items-center gap-1 font-mono text-[11px]">
                  {activeDiff.totalAdditions > 0 && (
                    <span className="text-success">+{activeDiff.totalAdditions}</span>
                  )}
                  {activeDiff.totalDeletions > 0 && (
                    <span className="text-danger">−{activeDiff.totalDeletions}</span>
                  )}
                </span>
              )}
              <button
                type="button"
                aria-label={t.gitDiff.refreshChanges}
                title={t.gitDiff.refreshChanges}
                onClick={(): void => {
                  void loadGitDiff(workspace);
                }}
                className={WORKSPACE_ICON_BUTTON_CLASS}
              >
                <RefreshIcon />
              </button>
              <button
                type="button"
                aria-label={t.gitDiff.collapseChanges}
                title={t.gitDiff.collapseChanges}
                onClick={(): void => setChangesCollapseEpoch((n: number): number => n + 1)}
                className={WORKSPACE_ICON_BUTTON_CLASS}
              >
                <CollapseAllIcon />
              </button>
            </div>
          </div>

          {changesOpen && (
            <div className="group/tree min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              <div aria-hidden="true" className="mx-1.5 mb-1.5 border-t border-separator/55" />
              <WorkspaceChangesTree
                key={`changes:${workspace.id}`}
                workspace={workspace}
                collapseEpoch={changesCollapseEpoch}
                selectedPath={selectedDiffPath}
                onSelect={(path: string): void => {
                  if (onSelectChangedFile) onSelectChangedFile(path);
                  else onPreview(path);
                }}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
