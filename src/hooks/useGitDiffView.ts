import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { WorkspaceSummary } from "../agent-core/types";
import { workspaceSupported } from "../services/workspaceClient";
import { useGitDiffStore } from "../stores/gitDiffStore";
import type { GitDiffFile, GitDiffLoadStatus, WorkspaceGitDiff } from "../types/git";
import type { GitDiffStore } from "../types/stores";

export function useGitDiffView(workspace?: WorkspaceSummary): {
  supported: boolean;
  status: GitDiffLoadStatus;
  diff: WorkspaceGitDiff | null;
  error: string;
  selectedPath: string | null;
  collapsedPaths: Set<string>;
  allCollapsed: boolean;
  refresh: () => void;
  toggleCollapse: (path: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  registerCardRef: (path: string, element: HTMLElement | null) => void;
} {
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
  const selectedPath: string | null = useGitDiffStore(
    (s: GitDiffStore): string | null => s.selectedPath
  );
  const selectionSeq: number = useGitDiffStore((s: GitDiffStore): number => s.selectionSeq);
  const loadGitDiff: (target: WorkspaceSummary) => Promise<void> = useGitDiffStore(
    (s: GitDiffStore): ((target: WorkspaceSummary) => Promise<void>) => s.loadGitDiff
  );

  const [collapsedPaths, setCollapsedPaths]: [
    Set<string>,
    Dispatch<SetStateAction<Set<string>>>
  ] = useState<Set<string>>((): Set<string> => new Set());
  const cardRefs: RefObject<Map<string, HTMLElement>> = useRef<Map<string, HTMLElement>>(new Map());
  const supported: boolean = workspaceSupported();

  const matchesWorkspace: boolean = workspace?.id === storeWorkspaceId && Boolean(storeWorkspaceId);
  const diff: WorkspaceGitDiff | null = matchesWorkspace ? storeDiff : null;
  const status: GitDiffLoadStatus = matchesWorkspace
    ? storeStatus
    : workspace && supported
      ? "loading"
      : "idle";
  const error: string = matchesWorkspace ? storeError : "";

  const refresh: () => void = useCallback((): void => {
    if (!workspace || !supported) return;
    void loadGitDiff(workspace);
  }, [loadGitDiff, supported, workspace]);

  const toggleCollapse: (path: string) => void = useCallback((path: string): void => {
    setCollapsedPaths((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll: () => void = useCallback((): void => {
    setCollapsedPaths(new Set());
  }, []);

  const collapseAll: () => void = useCallback((): void => {
    if (!diff) return;
    setCollapsedPaths(new Set(diff.files.map((file: GitDiffFile): string => file.path)));
  }, [diff]);

  const registerCardRef: (path: string, element: HTMLElement | null) => void = useCallback(
    (path: string, element: HTMLElement | null): void => {
      if (element) cardRefs.current.set(path, element);
      else cardRefs.current.delete(path);
    },
    []
  );

  useEffect((): void => {
    if (!selectedPath) return;
    setCollapsedPaths((prev: Set<string>): Set<string> => {
      if (!prev.has(selectedPath)) return prev;
      const next: Set<string> = new Set(prev);
      next.delete(selectedPath);
      return next;
    });
    const target: HTMLElement | undefined = cardRefs.current.get(selectedPath);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedPath, selectionSeq]);

  const allCollapsed: boolean =
    Boolean(diff && diff.files.length > 0) &&
    Boolean(diff?.files.every((file: GitDiffFile): boolean => collapsedPaths.has(file.path)));

  return {
    supported,
    status,
    diff,
    error,
    selectedPath: matchesWorkspace ? selectedPath : null,
    collapsedPaths,
    allCollapsed,
    refresh,
    toggleCollapse,
    expandAll,
    collapseAll,
    registerCardRef,
  };
}
