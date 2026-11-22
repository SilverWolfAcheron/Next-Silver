import { useEffect, useMemo, useState } from "react";
import type { Dispatch, JSX, SetStateAction } from "react";
import { GIT_STATUS_BADGES } from "../../constants/git";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import { useGitDiffStore } from "../../stores/gitDiffStore";
import type {
  GitDiffFile,
  GitDiffLoadStatus,
  GitStatusBadgeStyle,
  GitTreeNode,
  WorkspaceChangesNodeProps,
  WorkspaceChangesTreeProps,
  WorkspaceGitDiff,
} from "../../types/git";
import type { GitDiffStore } from "../../types/stores";
import { buildGitChangesTree } from "../../utils/diff";
import { FileTreeIcon, FolderTreeIcon } from "../common/FileIcons";
import { ChevronRightIcon } from "../common/Icons";

export function WorkspaceChangesTree({
  workspace,
  collapseEpoch,
  selectedPath,
  onSelect,
}: WorkspaceChangesTreeProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const storeWorkspaceId: string | null = useGitDiffStore(
    (s: GitDiffStore): string | null => s.workspaceId
  );
  const storeStatus: GitDiffLoadStatus = useGitDiffStore(
    (s: GitDiffStore): GitDiffLoadStatus => s.status
  );
  const storeDiff: WorkspaceGitDiff | null = useGitDiffStore(
    (s: GitDiffStore): WorkspaceGitDiff | null => s.diff
  );
  const storeError: string = useGitDiffStore((s: GitDiffStore): string => s.error);

  const matchesWorkspace: boolean = storeWorkspaceId === workspace.id;
  const diff: WorkspaceGitDiff | null = matchesWorkspace ? storeDiff : null;
  const status: GitDiffLoadStatus = matchesWorkspace ? storeStatus : "loading";
  const error: string = matchesWorkspace ? storeError : "";

  const nodes: GitTreeNode[] = useMemo(
    (): GitTreeNode[] => (diff ? buildGitChangesTree(diff.files) : []),
    [diff]
  );

  if (status === "loading" && !diff) {
    return (
      <p role="status" className="px-3 py-2 text-[12px] text-tertiary">
        {t.gitDiff.loading}
      </p>
    );
  }

  if (status === "error") {
    return (
      <p role="status" className="px-3 py-2 text-[12px] text-danger">
        {formatError(error, t)}
      </p>
    );
  }

  if (diff && !diff.isRepo) {
    return <p className="px-3 py-2 text-[12px] text-tertiary">{t.gitDiff.notGitRepo}</p>;
  }

  if (nodes.length === 0) {
    return <p className="px-3 py-2 text-[12px] text-tertiary">{t.gitDiff.changedTreeEmpty}</p>;
  }

  return (
    <ul role="tree" aria-label={workspace.name} className="flex min-w-0 flex-col">
      {nodes.map((node: GitTreeNode): JSX.Element => (
        <WorkspaceChangesNode
          key={node.path}
          node={node}
          depth={0}
          collapseEpoch={collapseEpoch}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function WorkspaceChangesNode({
  node,
  depth,
  collapseEpoch,
  selectedPath,
  onSelect,
}: WorkspaceChangesNodeProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const [expanded, setExpanded]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(
    true
  );

  useEffect((): void => {
    if (collapseEpoch > 0) setExpanded(false);
  }, [collapseEpoch]);

  const isDirectory: boolean = node.kind === "directory";
  const file: GitDiffFile | undefined = node.file;
  const selected: boolean = !isDirectory && node.path === selectedPath;
  const badge: GitStatusBadgeStyle | undefined = file ? GIT_STATUS_BADGES[file.status] : undefined;

  return (
    <li
      role="treeitem"
      aria-expanded={isDirectory ? expanded : undefined}
      aria-selected={selected || undefined}
      className="min-w-0"
    >
      <button
        type="button"
        title={file?.oldPath ? `${file.oldPath} → ${node.path}` : node.path}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={(): void => {
          if (isDirectory) setExpanded((open: boolean): boolean => !open);
          else onSelect(node.path);
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
        {isDirectory ? (
          <ChevronRightIcon expanded={expanded} className="h-3.5 w-3.5 shrink-0 text-secondary" />
        ) : (
          <span aria-hidden="true" className="w-3.5 shrink-0" />
        )}
        {isDirectory ? <FolderTreeIcon open={expanded} /> : <FileTreeIcon name={node.name} />}
        <span
          className={`min-w-0 flex-1 truncate ${
            file?.status === "deleted" ? "text-danger/85 line-through" : ""
          }`}
        >
          {node.name}
        </span>

        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px]">
          {node.additions > 0 && <span className="text-success">+{node.additions}</span>}
          {node.deletions > 0 && <span className="text-danger">−{node.deletions}</span>}
          {badge && file && (
            <span
              title={t.gitDiff.statuses[file.status]}
              className={`ml-0.5 w-3 text-center font-semibold ${badge.className}`}
            >
              {badge.letter}
            </span>
          )}
        </span>
      </button>

      {isDirectory && expanded && node.children && node.children.length > 0 && (
        <ul role="group" className="flex min-w-0 flex-col">
          {node.children.map((child: GitTreeNode): JSX.Element => (
            <WorkspaceChangesNode
              key={child.path}
              node={child}
              depth={depth + 1}
              collapseEpoch={collapseEpoch}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
