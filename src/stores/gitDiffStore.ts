import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { ERROR_CODES, serializeErrorCode } from "../agent-core/errors";
import type { WorkspaceSummary } from "../agent-core/types";
import { logError } from "../i18n/errors";
import { readWorkspaceGitDiff } from "../services/workspaceClient";
import type { GitDiffFile, WorkspaceGitDiff } from "../types/git";
import type { GitDiffStore } from "../types/stores";

let requestSequence: number = 0;

export const useGitDiffStore: UseBoundStore<StoreApi<GitDiffStore>> = create<GitDiffStore>(
  (
    set: StoreApi<GitDiffStore>["setState"],
    get: StoreApi<GitDiffStore>["getState"]
  ): GitDiffStore => ({
    workspaceId: null,
    status: "idle",
    diff: null,
    error: "",
    selectedPath: null,
    selectionSeq: 0,

    loadGitDiff: async (workspace: WorkspaceSummary): Promise<void> => {
      const seq: number = ++requestSequence;
      const current: GitDiffStore = get();
      const sameWorkspace: boolean = current.workspaceId === workspace.id;
      set({
        workspaceId: workspace.id,
        status: sameWorkspace && current.status === "ready" ? "ready" : "loading",
        error: "",
        ...(sameWorkspace ? {} : { diff: null, selectedPath: null }),
      });

      try {
        const result: WorkspaceGitDiff = await readWorkspaceGitDiff(workspace);
        if (seq !== requestSequence) return;
        const previousSelected: string | null = get().selectedPath;
        const stillExists: boolean =
          previousSelected !== null &&
          result.files.some((file: GitDiffFile): boolean => file.path === previousSelected);
        set({
          workspaceId: workspace.id,
          status: "ready",
          diff: result,
          error: "",
          selectedPath: stillExists ? previousSelected : null,
        });
      } catch (failure: unknown) {
        if (seq !== requestSequence) return;
        logError(failure, undefined, ERROR_CODES.WORKSPACE_GIT_DIFF_FAILED);
        set({
          workspaceId: workspace.id,
          status: "error",
          error: serializeErrorCode(failure, ERROR_CODES.WORKSPACE_GIT_DIFF_FAILED),
        });
      }
    },

    selectDiffPath: (path: string | null): void => {
      set((current: GitDiffStore): Partial<GitDiffStore> => ({
        selectedPath: path,
        selectionSeq: current.selectionSeq + 1,
      }));
    },

    clearGitDiff: (): void => {
      requestSequence += 1;
      set({
        workspaceId: null,
        status: "idle",
        diff: null,
        error: "",
        selectedPath: null,
        selectionSeq: 0,
      });
    },
  })
);
