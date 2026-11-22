import { create } from "zustand";
import {
  desktopAction,
  desktopAvailable,
  desktopState,
  listenDesktop,
  type DesktopSnapshot,
} from "../model/desktopClient";
import { initialState, type Action, type SilverState } from "../model/silverState";
import type { Brief, ChatDraft, Thread, WorkspaceSummary } from "../model/types";
import type { ProviderConfig } from "../provider/presets";
import {
  notifyWorkspaceChange,
  readWorkspaceFile,
  selectWorkspace,
  workspaceErrorText,
} from "../model/workspace";

export type UIAction = Exclude<
  Action,
  { type: "UPDATE_THREAD" | "NEW_THREAD" | "SET_PROVIDERS" | "REMEMBER_PRESET" }
>;
export type FilePreview = {
  threadId: string;
  workspaceId: string;
  path: string;
  line?: number;
  body?: string;
  error?: string;
};
export type ComposerPrompt = { threadId: string; text: string };
export type ComposerAttachment = { threadId: string; workspaceId: string; path: string };
export type DesktopConnection = "connecting" | "ready" | "unavailable";
export interface EditorTabState {
  paths: string[];
  active: string;
}

export interface SilverStoreDeps {
  desktopAction: typeof desktopAction;
  desktopAvailable: typeof desktopAvailable;
  desktopState: typeof desktopState;
  listenDesktop: typeof listenDesktop;
  notifyWorkspaceChange: typeof notifyWorkspaceChange;
  readWorkspaceFile: typeof readWorkspaceFile;
  selectWorkspace: typeof selectWorkspace;
}

const defaultDeps: SilverStoreDeps = {
  desktopAction,
  desktopAvailable,
  desktopState,
  listenDesktop,
  notifyWorkspaceChange,
  readWorkspaceFile,
  selectWorkspace,
};

export interface SilverStore {
  revision: number;
  state: SilverState;
  busyThreads: string[];
  workspaceVersions?: Record<string, number>;
  currentThread: Thread | null;
  connection: DesktopConnection;
  connectionError: string;
  error: string;
  filePreview: FilePreview | null;
  editorTabs: Record<string, EditorTabState>;
  composerPrompt?: ComposerPrompt;
  composerAttachment?: ComposerAttachment;

  connectDesktop: () => () => void;
  clearError: () => void;
  dispatch: (action: UIAction) => void;
  newThread: (presetId: string) => void;
  openSample: () => void;
  isGenerating: (threadId: string) => boolean;
  stop: (threadId: string) => boolean;
  submitComposer: (threadId: string | undefined, draft: ChatDraft) => Promise<void>;
  saveDraft: (threadId: string, draft: ChatDraft) => Promise<void>;
  chooseMessage: (threadId: string, messageId: string, choice: string) => void;
  consumeComposerPrompt: (prompt: ComposerPrompt) => void;
  attachToComposer: (path: string) => void;
  consumeComposerAttachment: (request: ComposerAttachment) => void;
  changePreset: (threadId: string | undefined, presetId: string) => void;
  selectModel: (threadId: string | undefined, modelId: string, modelName?: string) => void;
  retryMessage: (threadId: string, messageId: string) => void;
  retryRun: (threadId: string, runId: string) => void;
  updateBrief: (threadId: string, brief: Brief) => void;
  resolveConfirmation: (threadId: string, messageId: string, accepted: boolean) => void;
  promoteThread: (threadId: string) => void;
  patchFinding: (threadId: string, finding: string) => void;
  bindWorkspace: (threadId: string, workspace: WorkspaceSummary) => void;
  openFolder: () => Promise<void>;
  attachWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
  acceptFile: (threadId: string, artifactId: string, path: string, confirmed: boolean) => Promise<void>;
  decideFile: (threadId: string, artifactId: string, path: string, decision: "accepted" | "rejected") => void;
  saveProvider: (config: ProviderConfig, replacementKey?: string) => Promise<void>;
  testProvider: (config: ProviderConfig, replacementKey?: string) => Promise<string[]>;
  previewFile: (threadId: string, path: string, line?: number) => Promise<void>;
  closeFilePreview: () => void;
  ensureEditorTab: (scope: string, path: string) => void;
  closeEditorTab: (scope: string, path: string) => { next?: string; closingActive: boolean };
}

export function createSilverStore(deps: SilverStoreDeps = defaultDeps) {
  let previewRequest: AbortController | undefined;
  let previousVersions: DesktopSnapshot["workspaceVersions"];

  return create<SilverStore>((set, get) => {
    function action(name: string, ...args: unknown[]) {
      set({ error: "" });
      void deps.desktopAction(name, ...args).catch((failure: unknown) => {
        set({ error: workspaceErrorText(failure) });
      });
    }

    function closeFilePreview() {
      previewRequest?.abort();
      previewRequest = undefined;
      set({ filePreview: null });
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
      filePreview: null,
      editorTabs: {},
      composerPrompt: undefined,
      composerAttachment: undefined,

      connectDesktop: () => {
        if (!deps.desktopAvailable()) {
          set({ connection: "unavailable" });
          return () => undefined;
        }
        let active = true;
        let unlisten: (() => void) | undefined;
        let retrieving = false;

        function accept(next: DesktopSnapshot) {
          if (!active) return;
          const prevVersions = previousVersions;
          let updated = false;
          set((current) => {
            if (next.revision <= current.revision) {
              return current.connection === "ready" && !current.connectionError
                ? current
                : { connection: "ready", connectionError: "" };
            }
            updated = true;
            return {
              revision: next.revision,
              state: next.state,
              busyThreads: next.busyThreads,
              workspaceVersions: next.workspaceVersions,
              currentThread: next.state.threads.find(({ id }) => id === next.state.currentThreadId) ?? null,
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

        function refresh() {
          if (retrieving) return;
          retrieving = true;
          void deps.desktopState().then(accept, (failure: unknown) => {
            if (active) {
              set({ connectionError: typeof failure === "string" ? failure : workspaceErrorText(failure) });
            }
          }).finally(() => {
            retrieving = false;
          });
        }

        void deps.listenDesktop(accept).then((dispose) => {
          if (active) unlisten = dispose;
          else dispose();
        }).catch(() => undefined);

        refresh();
        const timer = globalThis.setInterval(refresh, 1_000);
        return () => {
          active = false;
          unlisten?.();
          globalThis.clearInterval(timer);
        };
      },

      clearError: () => set({ error: "" }),

      dispatch: (value) => {
        if (value.type === "DELETE_THREAD") {
          if (value.threadId === get().filePreview?.threadId) closeFilePreview();
          const prefix = `${JSON.stringify([value.threadId]).slice(0, -1)},`;
          set((current) => {
            const entries = Object.entries(current.editorTabs).filter(([key]) => !key.startsWith(prefix));
            return entries.length === Object.keys(current.editorTabs).length
              ? current
              : { editorTabs: Object.fromEntries(entries) };
          });
        }
        action("dispatch", value);
      },

      newThread: (presetId) => action("newThread", presetId),
      openSample: () => action("openSample"),
      isGenerating: (threadId) => get().busyThreads.includes(threadId),

      stop: (threadId) => {
        if (!get().busyThreads.includes(threadId)) return false;
        action("stop", threadId);
        return true;
      },

      submitComposer: (...args) => deps.desktopAction("submitComposer", ...args),
      saveDraft: (...args) => deps.desktopAction("saveDraft", ...args),
      changePreset: (...args) => action("changePreset", ...args),
      selectModel: (...args) => action("selectModel", ...args),
      retryMessage: (...args) => action("retryMessage", ...args),
      retryRun: (...args) => action("retryRun", ...args),
      updateBrief: (...args) => action("updateBrief", ...args),
      resolveConfirmation: (...args) => action("resolveConfirmation", ...args),
      promoteThread: (...args) => action("promoteThread", ...args),
      patchFinding: (...args) => action("patchFinding", ...args),
      bindWorkspace: (threadId, workspace) => action("bindWorkspace", threadId, workspace.id),

      attachWorkspace: async (workspace) => {
        set({ error: "" });
        try {
          const threadId = get().state.currentThreadId ?? await deps.desktopAction<string>("newThread", "develop");
          await deps.desktopAction("bindWorkspace", threadId, workspace.id);
        } catch (failure) {
          set({ error: workspaceErrorText(failure) });
        }
      },

      openFolder: async () => {
        set({ error: "" });
        try {
          const workspace = await deps.selectWorkspace();
          const threadId = get().state.currentThreadId ?? await deps.desktopAction<string>("newThread", "develop");
          await deps.desktopAction("bindWorkspace", threadId, workspace.id);
        } catch (failure) {
          if (failure instanceof DOMException && failure.name === "AbortError") return;
          set({ error: workspaceErrorText(failure) });
        }
      },

      acceptFile: (...args) => deps.desktopAction("acceptFile", ...args),
      decideFile: (...args) => action("decideFile", ...args),
      saveProvider: (...args) => deps.desktopAction("saveProvider", ...args),
      testProvider: (...args) => deps.desktopAction<string[]>("testProvider", ...args),

      chooseMessage: (threadId, messageId, choice) => {
        const thread = get().state.threads.find(({ id }) => id === threadId);
        if (thread?.messages.find(({ id }) => id === messageId)?.choices?.includes(choice)) {
          set({ composerPrompt: { threadId, text: choice } });
        }
      },

      consumeComposerPrompt: (prompt) => {
        set((current) => (current.composerPrompt === prompt ? { composerPrompt: undefined } : current));
      },

      attachToComposer: (path) => {
        const thread = get().currentThread;
        if (thread?.workspace) {
          set({ composerAttachment: { threadId: thread.id, workspaceId: thread.workspace.id, path } });
        }
      },

      consumeComposerAttachment: (request) => {
        set((current) => (current.composerAttachment === request ? { composerAttachment: undefined } : current));
      },

      previewFile: async (threadId, path, line) => {
        const workspace = get().state.threads.find(({ id }) => id === threadId)?.workspace;
        if (!workspace) return;
        previewRequest?.abort();
        const controller = new AbortController();
        previewRequest = controller;
        const preview: FilePreview = { threadId, workspaceId: workspace.id, path, line };
        set({ filePreview: preview });
        try {
          const body = await deps.readWorkspaceFile(workspace, path);
          if (!controller.signal.aborted) set({ filePreview: { ...preview, body } });
        } catch (failure) {
          if (!controller.signal.aborted) {
            set({ filePreview: { ...preview, error: workspaceErrorText(failure) } });
          }
        }
      },

      closeFilePreview,

      ensureEditorTab: (scope, path) => {
        if (!scope || !path) return;
        set((current) => {
          const previous = current.editorTabs[scope] ?? { paths: [], active: "" };
          if (previous.active === path && previous.paths.includes(path)) return current;
          const paths = previous.paths.includes(path) ? previous.paths : [...previous.paths, path];
          return { editorTabs: { ...current.editorTabs, [scope]: { paths, active: path } } };
        });
      },

      closeEditorTab: (scope, closed) => {
        const current = get();
        const saved = current.editorTabs[scope] ?? { paths: [], active: "" };
        const previewPath = current.filePreview?.path;
        const paths = previewPath && !saved.paths.includes(previewPath) &&
          JSON.stringify([current.filePreview?.threadId, current.filePreview?.workspaceId]) === scope
          ? [...saved.paths, previewPath]
          : saved.paths;
        const index = paths.indexOf(closed);
        if (index < 0) return { next: saved.active || undefined, closingActive: false };
        const rest = paths.filter((entry) => entry !== closed);
        const activePath = (JSON.stringify([current.filePreview?.threadId, current.filePreview?.workspaceId]) === scope
          ? current.filePreview?.path
          : undefined) ?? saved.active;
        const closingActive = activePath === closed;
        const next = closingActive ? rest[Math.min(index, rest.length - 1)] : saved.active;
        set({
          editorTabs: { ...current.editorTabs, [scope]: { paths: rest, active: next ?? "" } },
        });
        return { next: next || undefined, closingActive };
      },
    };
  });
}

export const useSilverStore = createSilverStore();
