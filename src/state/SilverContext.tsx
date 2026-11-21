import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { desktopAction, desktopAvailable, desktopState, listenDesktop, type DesktopSnapshot } from "../model/desktopClient";
import { initialState, type Action, type SilverState } from "../model/silverState";
import type { Brief, Thread, WorkspaceSummary } from "../model/types";
import type { ProviderConfig } from "../provider/presets";
import { readWorkspaceFile, selectWorkspace, workspaceErrorText } from "../model/workspace";

type UIAction = Exclude<Action, { type: "UPDATE_THREAD" | "NEW_THREAD" | "SET_PROVIDERS" | "REMEMBER_PRESET" }>;
type FilePreview = { threadId: string; path: string; body?: string; error?: string };
type ComposerPrompt = { threadId: string; text: string };

interface SilverContextValue {
  state: SilverState;
  currentThread: Thread | null;
  providerPanelOpen: boolean;
  dispatch: (action: UIAction) => void;
  newThread: (presetId: string) => void;
  openSample: () => void;
  isGenerating: (threadId: string) => boolean;
  stop: (threadId: string) => boolean;
  sendMessage: (threadId: string | undefined, text: string, attachments?: string[]) => void;
  chooseMessage: (threadId: string, messageId: string, choice: string) => void;
  composerPrompt?: ComposerPrompt;
  consumeComposerPrompt: (prompt: ComposerPrompt) => void;
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
  filePreview: FilePreview | null;
  previewFile: (threadId: string, path: string) => Promise<void>;
  closeFilePreview: () => void;
}

const SilverContext = createContext<SilverContextValue | null>(null);

export function SilverProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>({ revision: -1, state: initialState(), busyThreads: [] });
  const [connection, setConnection] = useState<"connecting" | "ready" | "unavailable">("connecting");
  const [connectionError, setConnectionError] = useState("");
  const [error, setError] = useState("");
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [composerPrompt, setComposerPrompt] = useState<ComposerPrompt>();
  const previewRequest = useRef<AbortController>();

  useEffect(() => {
    if (!desktopAvailable()) {
      setConnection("unavailable");
      return;
    }
    let mounted = true;
    let unlisten: (() => void) | undefined;
    function accept(next: DesktopSnapshot) {
      if (!mounted) return;
      setSnapshot((current) => next.revision >= current.revision ? next : current);
      setConnection("ready");
      setConnectionError("");
    }
    function refresh() {
      void desktopState().then(accept, (failure: unknown) => {
        if (mounted) setConnectionError(typeof failure === "string" ? failure : workspaceErrorText(failure));
      });
    }
    void listenDesktop(accept).then((dispose) => {
      if (mounted) unlisten = dispose;
      else dispose();
    }).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      mounted = false;
      unlisten?.();
      window.clearInterval(timer);
    };
  }, []);

  function action(name: string, ...args: unknown[]) {
    setError("");
    void desktopAction(name, ...args).catch((failure: unknown) => setError(workspaceErrorText(failure)));
  }

  function closeFilePreview() {
    previewRequest.current?.abort();
    setFilePreview(null);
  }

  function dispatch(value: UIAction) {
    if (value.type === "DELETE_THREAD" && value.threadId === filePreview?.threadId) closeFilePreview();
    action("dispatch", value);
  }

  async function previewFile(threadId: string, path: string) {
    const workspace = snapshot.state.threads.find(({ id }) => id === threadId)?.workspace;
    if (!workspace) return;
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setFilePreview({ threadId, path });
    try {
      const body = await readWorkspaceFile(workspace, path);
      if (!controller.signal.aborted) setFilePreview({ threadId, path, body });
    } catch (failure) {
      if (!controller.signal.aborted) setFilePreview({ threadId, path, error: workspaceErrorText(failure) });
    }
  }

  if (connection !== "ready") return (
    <main className="flex h-full items-center justify-center bg-surface px-4 text-center text-secondary">
      <div>
        <p>{connection === "unavailable" ? "请从 Windows 开始菜单打开 Silver 桌面程序。" : "正在连接 Silver 本机运行时…"}</p>
        {connectionError && <p className="mt-2 text-[13px] text-danger">{connectionError}</p>}
      </div>
    </main>
  );

  const { state, busyThreads } = snapshot;
  return (
    <SilverContext.Provider value={{
      state, dispatch, filePreview, previewFile, closeFilePreview, composerPrompt,
      providerPanelOpen: state.providerPanelOpen,
      currentThread: state.threads.find(({ id }) => id === state.currentThreadId) ?? null,
      newThread: (presetId) => action("newThread", presetId),
      openSample: () => action("openSample"),
      isGenerating: (threadId) => busyThreads.includes(threadId),
      stop: (threadId) => {
        if (!busyThreads.includes(threadId)) return false;
        action("stop", threadId);
        return true;
      },
      sendMessage: (...args) => action("sendMessage", ...args),
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
        setError("");
        try {
          const threadId = snapshot.state.currentThreadId ?? await desktopAction<string>("newThread", "develop");
          await desktopAction("bindWorkspace", threadId, workspace.id);
        } catch (failure) {
          setError(workspaceErrorText(failure));
        }
      },
      openFolder: async () => {
        setError("");
        try {
          const workspace = await selectWorkspace();
          const threadId = snapshot.state.currentThreadId ?? await desktopAction<string>("newThread", "develop");
          await desktopAction("bindWorkspace", threadId, workspace.id);
        } catch (failure) {
          if (failure instanceof DOMException && failure.name === "AbortError") return;
          setError(workspaceErrorText(failure));
        }
      },
      acceptFile: (...args) => desktopAction("acceptFile", ...args),
      decideFile: (...args) => action("decideFile", ...args),
      saveProvider: (...args) => desktopAction("saveProvider", ...args),
      testProvider: (...args) => desktopAction<string[]>("testProvider", ...args),
      chooseMessage: (threadId, messageId, choice) => {
        const thread = state.threads.find(({ id }) => id === threadId);
        if (thread?.messages.find(({ id }) => id === messageId)?.choices?.includes(choice)) {
          setComposerPrompt({ threadId, text: choice });
        }
      },
      consumeComposerPrompt: (prompt) => setComposerPrompt((current) => current === prompt ? undefined : current),
    }}>
      {children}
      {error && (
        <div role="alert" className="fixed inset-x-4 bottom-3 z-[60] mx-auto flex max-w-lg items-center justify-between gap-3 rounded-[12px] border border-separator bg-group px-4 py-2 text-[13px] text-danger">
          {error}
          <button type="button" className="min-h-11 px-2 text-secondary" onClick={() => setError("")}>关闭</button>
        </div>
      )}
    </SilverContext.Provider>
  );
}

export function useSilver(): SilverContextValue {
  const context = useContext(SilverContext);
  if (!context) throw new Error("useSilver must be used inside SilverProvider");
  return context;
}
