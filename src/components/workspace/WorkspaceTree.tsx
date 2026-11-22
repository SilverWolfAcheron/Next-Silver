import { useState } from "react";
import type { Dispatch, DragEvent, JSX, SetStateAction } from "react";
import type { WorkspaceEntry } from "../../agent-core/types";
import { WORKSPACE_PATH_MIME } from "../../constants/workspace";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import { useWorkspaceListing } from "../../hooks/useWorkspaceListing";
import type { WorkspaceTreeProps, WorkspaceTreeRowProps } from "../../types/workspace";
import { FileTreeIcon, FolderTreeIcon } from "../common/FileIcons";
import { ChevronRightIcon } from "../common/Icons";

export function WorkspaceTree({
  workspace,
  path,
  depth,
  refreshEpoch,
  selectedPath,
  onPreview,
}: WorkspaceTreeProps): JSX.Element | null {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const { listing, sorted, reconnecting, reconnect }: ReturnType<typeof useWorkspaceListing> =
    useWorkspaceListing({ workspace, path, refreshEpoch });

  if (listing.state === "loading") {
    return (
      <p
        role="status"
        style={{ paddingLeft: `${depth * 12 + 24}px` }}
        className="py-1 text-[12px] text-tertiary"
      >
        {t.workspace.loading}
      </p>
    );
  }

  if (listing.state === "error") {
    return (
      <div style={{ paddingLeft: `${depth * 12 + 12}px` }} className="pr-2 py-1 text-[12px] text-danger">
        <p role="status">{formatError(listing.text, t)}</p>
        {listing.canReconnect && (
          <button
            type="button"
            disabled={reconnecting}
            className="mt-1 h-7 text-accent hover:underline"
            onClick={(): void => {
              void reconnect();
            }}
          >
            {reconnecting ? t.workspace.reconnecting : t.workspace.reconnect}
          </button>
        )}
      </div>
    );
  }

  if (sorted.length === 0) {
    return depth === 0 ? (
      <p className="px-3 py-1.5 text-[12px] text-tertiary">{t.workspace.emptyFolder}</p>
    ) : null;
  }

  return (
    <ul
      role={depth === 0 ? "tree" : "group"}
      aria-label={depth === 0 ? workspace.name : undefined}
      className="flex min-w-0 flex-col"
    >
      {sorted.map((entry: WorkspaceEntry): JSX.Element => (
        <WorkspaceTreeRow
          key={entry.path}
          workspace={workspace}
          entry={entry}
          depth={depth}
          refreshEpoch={refreshEpoch}
          selectedPath={selectedPath}
          onPreview={onPreview}
        />
      ))}
    </ul>
  );
}

function WorkspaceTreeRow({
  workspace,
  entry,
  depth,
  refreshEpoch,
  selectedPath,
  onPreview,
}: WorkspaceTreeRowProps): JSX.Element {
  const [expanded, setExpanded]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const directory: boolean = entry.kind === "directory";
  const selected: boolean = !directory && entry.path === selectedPath;

  return (
    <li
      role="treeitem"
      aria-expanded={directory ? expanded : undefined}
      aria-selected={selected || undefined}
      className="min-w-0"
    >
      <button
        type="button"
        draggable={!directory}
        title={entry.path}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={(): void => {
          if (directory) setExpanded((open: boolean): boolean => !open);
          else onPreview(entry.path);
        }}
        onDragStart={(event: DragEvent<HTMLButtonElement>): void => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(WORKSPACE_PATH_MIME, entry.path);
        }}
        className={`relative flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-[7px] pr-2 text-left text-[13px] leading-[26px] select-none transition-colors ${
          selected
            ? "bg-fill font-medium text-label"
            : "text-label/90 hover:bg-fill/60 hover:text-label"
        }`}
      >
        {depth > 0 &&
          Array.from(
            { length: depth },
            (_: unknown, level: number): JSX.Element => (
              <span
                key={level}
                aria-hidden="true"
                style={{ left: `${level * 12 + 14}px` }}
                className="pointer-events-none absolute inset-y-0 w-px bg-separator/55 group-hover/tree:bg-separator"
              />
            )
          )}
        {directory ? (
          <ChevronRightIcon expanded={expanded} className="h-3.5 w-3.5 shrink-0 text-secondary" />
        ) : (
          <span aria-hidden="true" className="w-3.5 shrink-0" />
        )}
        {directory ? <FolderTreeIcon open={expanded} /> : <FileTreeIcon name={entry.name} />}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {directory && expanded && (
        <WorkspaceTree
          workspace={workspace}
          path={entry.path}
          depth={depth + 1}
          refreshEpoch={refreshEpoch}
          selectedPath={selectedPath}
          onPreview={onPreview}
        />
      )}
    </li>
  );
}
