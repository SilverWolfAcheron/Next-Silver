import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { WorkspaceSummary } from "../agent-core/types";
import { subscribeWorkspaceChanges, workspaceSupported } from "../services/workspaceClient";
import { useGitDiffStore } from "../stores/gitDiffStore";
import type { GitDiffLoadStatus, WorkspaceGitDiff } from "../types/git";
import type { GitDiffStore } from "../types/stores";

export function useWorkspaceGitDiff(
  workspace: WorkspaceSummary | undefined,
  active: boolean
): {
  status: GitDiffLoadStatus;
  diff: WorkspaceGitDiff | null;
  error: string;
  selectedPath: string | null;
  refresh: () => void;
  selectPath: (path: string | null) => void;
} {
  const workspaceId: string | null = useGitDiffStore(
    (s: GitDiffStore): string | null => s.workspaceId
  );
  const status: GitDiffLoadStatus = useGitDiffStore(
    (s: GitDiffStore): GitDiffLoadStatus => s.status
  );
  const diff: WorkspaceGitDiff | null = useGitDiffStore(
    (s: GitDiffStore): WorkspaceGitDiff | null => s.diff
  );
  const error: string = useGitDiffStore((s: GitDiffStore): string => s.error);
  const selectedPath: string | null = useGitDiffStore(
    (s: GitDiffStore): string | null => s.selectedPath
  );
  const loadGitDiff: (target: WorkspaceSummary) => Promise<void> = useGitDiffStore(
    (s: GitDiffStore): ((target: WorkspaceSummary) => Promise<void>) => s.loadGitDiff
  );
  const selectDiffPath: (path: string | null) => void = useGitDiffStore(
    (s: GitDiffStore): ((path: string | null) => void) => s.selectDiffPath
  );
  const clearGitDiff: () => void = useGitDiffStore(
    (s: GitDiffStore): (() => void) => s.clearGitDiff
  );

  const supported: boolean = workspaceSupported();
  const targetWorkspaceId: string | undefined = workspace?.id;
  const targetWorkspaceName: string | undefined = workspace?.name;
  const workspaceRef: RefObject<WorkspaceSummary | undefined> =
    useRef<WorkspaceSummary | undefined>(workspace);
  workspaceRef.current = workspace;

  const refresh: () => void = useCallback((): void => {
    const target: WorkspaceSummary | undefined = workspaceRef.current;
    if (!target || !supported) return;
    void loadGitDiff(target);
  }, [loadGitDiff, supported]);

  useEffect((): (() => void) | undefined => {
    if (!active) return undefined;
    const current: WorkspaceSummary | undefined = workspaceRef.current;
    if (!targetWorkspaceId || !current || !supported) {
      clearGitDiff();
      return undefined;
    }

    void loadGitDiff(current);

    const unsubscribe: () => void = subscribeWorkspaceChanges(current, (): void => {
      const latest: WorkspaceSummary | undefined = workspaceRef.current;
      if (latest) void loadGitDiff(latest);
    });

    function onWindowFocus(): void {
      const latest: WorkspaceSummary | undefined = workspaceRef.current;
      if (latest) void loadGitDiff(latest);
    }

    window.addEventListener("focus", onWindowFocus);
    return (): void => {
      unsubscribe();
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [active, clearGitDiff, loadGitDiff, supported, targetWorkspaceId, targetWorkspaceName]);

  const matchesWorkspace: boolean = Boolean(targetWorkspaceId && workspaceId === targetWorkspaceId);

  return {
    status: matchesWorkspace
      ? status
      : targetWorkspaceId && supported && active
        ? "loading"
        : "idle",
    diff: matchesWorkspace ? diff : null,
    error: matchesWorkspace ? error : "",
    selectedPath: matchesWorkspace ? selectedPath : null,
    refresh,
    selectPath: selectDiffPath,
  };
}
