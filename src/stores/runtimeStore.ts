import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { ERROR_CODES, serializeErrorCode } from "../agent-core/errors";
import type { ProviderConfig } from "../agent-core/provider/presets";
import { initialState } from "../agent-core/silverState";
import type { DesktopSnapshot } from "../agent-core/silverState";
import type { Brief, ChatDraft, Thread, WorkspaceSummary } from "../agent-core/types";
import { logError } from "../i18n/errors";
import {
  desktopAction,
  desktopAvailable,
  desktopState,
  listenDesktop,
} from "../services/desktopClient";
import {
  notifyWorkspaceChange,
  selectWorkspace,
  workspaceErrorText,
} from "../services/workspaceClient";
import type { RuntimeStoreDeps, UIAction } from "../types/runtime";
import type { AcceptFileParams, FileDecisionParams, RuntimeStore } from "../types/stores";
import { useEditorStore } from "./editorStore";

const defaultDeps: RuntimeStoreDeps = {
  desktopAction,
  desktopAvailable,
  desktopState,
  listenDesktop,
  notifyWorkspaceChange,
  selectWorkspace,
};

function createRuntimeStore(
  deps: RuntimeStoreDeps = defaultDeps
): UseBoundStore<StoreApi<RuntimeStore>> {
  let previousVersions: DesktopSnapshot["workspaceVersions"] = undefined;

  return create<RuntimeStore>(
    (
      set: StoreApi<RuntimeStore>["setState"],
      get: StoreApi<RuntimeStore>["getState"]
    ): RuntimeStore => {
      function runAction(name: string, ...args: unknown[]): void {
        set({ error: "" });
        void deps.desktopAction(name, ...args).catch((failure: unknown): void => {
          logError(failure, undefined, ERROR_CODES.DESKTOP_REQUEST_FAILED);
          set({ error: workspaceErrorText(failure) });
        });
      }

      return {
        revision: -1,
        state: initialState(),
        busyThreads: [],
        workspaceVersions: undefined,
        currentThread: null,
        connection: "connecting",
        connectionError: "",
        error: "",

        connectDesktop: (): (() => void) => {
          if (!deps.desktopAvailable()) {
            set({ connection: "unavailable" });
            return (): undefined => undefined;
          }
          let active: boolean = true;
          let unlisten: (() => void) | undefined = undefined;
          let retrieving: boolean = false;

          function accept(next: DesktopSnapshot): void {
            if (!active) return;
            const prevVersions: DesktopSnapshot["workspaceVersions"] = previousVersions;
            let updated: boolean = false;
            set((current: RuntimeStore): RuntimeStore | Partial<RuntimeStore> => {
              if (next.revision <= current.revision) {
                return current.connection === "ready" && !current.connectionError
                  ? current
                  : { connection: "ready", connectionError: "" };
              }
              updated = true;
              const stateChanged: boolean = next.stateRevision === undefined || next.stateRevision !== current.stateRevision;
              return {
                revision: next.revision,
                stateRevision: next.stateRevision,
                state: stateChanged ? next.state : current.state,
                busyThreads: next.busyThreads,
                modelActivity: next.modelActivity,
                workspaceVersions: next.workspaceVersions,
                currentThread: stateChanged
                  ? next.state.threads.find(
                    ({ id }: Thread): boolean => id === next.state.currentThreadId
                  ) ?? null
                  : current.currentThread,
                connection: "ready",
                connectionError: "",
              };
            });
            if (updated) {
              previousVersions = next.workspaceVersions;
              for (const [workspaceId, version] of Object.entries(next.workspaceVersions ?? {})) {
                if (version !== (prevVersions?.[workspaceId] ?? 0)) {
                  deps.notifyWorkspaceChange(workspaceId);
                }
              }
            }
          }

          function refresh(): void {
            if (retrieving) return;
            retrieving = true;
            void deps
              .desktopState()
              .then(accept, (failure: unknown): void => {
                if (active) {
                  set({
                    connectionError: serializeErrorCode(
                      failure,
                      ERROR_CODES.DESKTOP_CONNECTION_LOST
                    ),
                  });
                }
              })
              .finally((): void => {
                retrieving = false;
              });
          }

          void deps
            .listenDesktop(accept)
            .then((dispose: () => void): void => {
              if (active) unlisten = dispose;
              else dispose();
            })
            .catch((): undefined => undefined);

          refresh();
          const timer: ReturnType<typeof setInterval> = globalThis.setInterval(refresh, 1_000);
          return (): void => {
            active = false;
            unlisten?.();
            globalThis.clearInterval(timer);
          };
        },

        clearError: (): void => set({ error: "" }),

        dispatch: (value: UIAction): void => {
          if (value.type === "DELETE_THREAD") {
            useEditorStore.getState().clearThreadTabs(value.threadId);
          }
          runAction("dispatch", value);
        },

        newThread: (presetId: string): void => runAction("newThread", presetId),

        stop: (threadId: string): boolean => {
          if (!get().busyThreads.includes(threadId)) return false;
          runAction("stop", threadId);
          return true;
        },

        submitComposer: (threadId: string | undefined, draft: ChatDraft): Promise<void> =>
          deps.desktopAction("submitComposer", threadId, draft),
        saveDraft: (threadId: string, draft: ChatDraft): Promise<void> =>
          deps.desktopAction("saveDraft", threadId, draft),
        changePreset: (threadId: string | undefined, presetId: string): void =>
          runAction("changePreset", threadId, presetId),
        selectModel: (
          threadId: string | undefined,
          modelId: string,
          modelName?: string
        ): void => runAction("selectModel", threadId, modelId, modelName),
        retryMessage: (threadId: string, messageId: string): void =>
          runAction("retryMessage", threadId, messageId),
        retryRun: (threadId: string, runId: string): void =>
          runAction("retryRun", threadId, runId),
        updateBrief: (threadId: string, brief: Brief): void =>
          runAction("updateBrief", threadId, brief),
        resolveConfirmation: (threadId: string, messageId: string, accepted: boolean): void =>
          runAction("resolveConfirmation", threadId, messageId, accepted),
        setAutoApproval: (threadId: string, enabled: boolean, workspaceId?: string): void =>
          runAction("setAutoApproval", threadId, enabled, workspaceId),
        patchFinding: (threadId: string, finding: string): void =>
          runAction("patchFinding", threadId, finding),

        attachWorkspace: async (workspace: WorkspaceSummary): Promise<void> => {
          set({ error: "" });
          try {
            const threadId: string =
              get().state.currentThreadId ??
              (await deps.desktopAction<string>("newThread", "develop"));
            await deps.desktopAction("bindWorkspace", threadId, workspace.id);
          } catch (failure: unknown) {
            logError(failure, undefined, ERROR_CODES.WORKSPACE_ACCESS_FAILED);
            set({ error: workspaceErrorText(failure) });
          }
        },

        openFolder: async (): Promise<void> => {
          set({ error: "" });
          try {
            const workspace: WorkspaceSummary = await deps.selectWorkspace();
            const threadId: string =
              get().state.currentThreadId ??
              (await deps.desktopAction<string>("newThread", "develop"));
            await deps.desktopAction("bindWorkspace", threadId, workspace.id);
          } catch (failure: unknown) {
            if (failure instanceof DOMException && failure.name === "AbortError") return;
            logError(failure, undefined, ERROR_CODES.WORKSPACE_ACCESS_FAILED);
            set({ error: workspaceErrorText(failure) });
          }
        },

        acceptFile: (params: AcceptFileParams): Promise<void> =>
          deps.desktopAction(
            "acceptFile",
            params.threadId,
            params.artifactId,
            params.path,
            params.confirmed
          ),
        decideFile: (params: FileDecisionParams): void =>
          runAction(
            "decideFile",
            params.threadId,
            params.artifactId,
            params.path,
            params.decision
          ),
        saveProvider: (config: ProviderConfig, replacementKey?: string): Promise<void> =>
          deps.desktopAction("saveProvider", config, replacementKey),
        testProvider: (config: ProviderConfig, replacementKey?: string): Promise<string[]> =>
          deps.desktopAction<string[]>("testProvider", config, replacementKey),
      };
    }
  );
}

export const useRuntimeStore: UseBoundStore<StoreApi<RuntimeStore>> = createRuntimeStore();
