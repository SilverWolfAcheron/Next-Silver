import type { Action } from "../agent-core/silverState";
import type {
  desktopAction,
  desktopAvailable,
  desktopState,
  listenDesktop,
} from "../services/desktopClient";
import type {
  notifyWorkspaceChange,
  readWorkspaceFile,
  selectWorkspace,
} from "../services/workspaceClient";

export type UIAction = Exclude<
  Action,
  { type: "UPDATE_THREAD" | "NEW_THREAD" | "SET_PROVIDERS" | "REMEMBER_PRESET" }
>;

export type DesktopConnection = "connecting" | "ready" | "unavailable";

export interface RuntimeStoreDeps {
  desktopAction: typeof desktopAction;
  desktopAvailable: typeof desktopAvailable;
  desktopState: typeof desktopState;
  listenDesktop: typeof listenDesktop;
  notifyWorkspaceChange: typeof notifyWorkspaceChange;
  selectWorkspace: typeof selectWorkspace;
}

export interface EditorStoreDeps {
  readWorkspaceFile: typeof readWorkspaceFile;
}
