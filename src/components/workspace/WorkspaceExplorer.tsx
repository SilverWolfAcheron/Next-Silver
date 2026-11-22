import { Fragment, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import { WORKSPACE_ICON_BUTTON_CLASS } from "../../constants/styles";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import { selectWorkspace, workspaceErrorText, workspaceSupported } from "../../services/workspaceClient";
import type { WorkspaceExplorerProps } from "../../types/workspace";
import {
  ChevronRightIcon,
  CollapseAllIcon,
  FolderOutlineIcon,
  RefreshIcon,
  SearchIcon,
} from "../common/Icons";
import { WorkspaceTree } from "./WorkspaceTree";

export function WorkspaceExplorer({
  workspace,
  selectedPath,
  onBind,
  onPreview,
  onSearchText,
}: WorkspaceExplorerProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const [opening, setOpening]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [openError, setOpenError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [sectionOpen, setSectionOpen]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(true);
  const [refreshEpoch, setRefreshEpoch]: [number, Dispatch<SetStateAction<number>>] =
    useState<number>(0);
  const [collapseEpoch, setCollapseEpoch]: [number, Dispatch<SetStateAction<number>>] =
    useState<number>(0);
  const supported: boolean = workspaceSupported();

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

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[13px]">
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
    </div>
  );
}
