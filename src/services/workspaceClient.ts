import { AppError, ERROR_CODES, serializeErrorCode } from "../agent-core/errors";
import type { WorkspaceEntry, WorkspaceSummary, WorkspaceTextMatch } from "../agent-core/types";
import type { AppErrorOptions, ErrorCode } from "../types/errors";
import type { WorkspaceGitDiff } from "../types/git";
import type { WorkspaceSearchOptions } from "../types/workspace";
import { chooseDirectory, desktopAction, desktopAvailable } from "./desktopClient";

export type { WorkspaceEntry, WorkspaceSummary, WorkspaceTextMatch };

const changes: EventTarget = new EventTarget();

export class WorkspaceAccessError extends AppError {
  readonly reason: "permission" | "unavailable";

  constructor(reason: "permission" | "unavailable", code: ErrorCode, options?: AppErrorOptions) {
    super(code, options);
    this.name = "WorkspaceAccessError";
    this.reason = reason;
  }
}

export const workspaceSupported: () => boolean = desktopAvailable;

export function subscribeWorkspaceChanges(
  workspace: WorkspaceSummary,
  listener: () => void
): () => void {
  changes.addEventListener(workspace.id, listener);
  return (): void => {
    changes.removeEventListener(workspace.id, listener);
  };
}

export function notifyWorkspaceChange(workspaceId: string): void {
  changes.dispatchEvent(new Event(workspaceId));
}

export async function selectWorkspace(): Promise<WorkspaceSummary> {
  const path: string | null = await chooseDirectory();
  if (!path) throw new DOMException(ERROR_CODES.REQUEST_ABORTED, "AbortError");
  return desktopAction<WorkspaceSummary>("workspace.bind", path);
}

export const requestWorkspaceAccess = (workspace: WorkspaceSummary): Promise<void> =>
  desktopAction<void>("workspace.access", workspace.id);

export const listWorkspace = (
  workspace: WorkspaceSummary,
  path: string = ""
): Promise<WorkspaceEntry[]> =>
  desktopAction<WorkspaceEntry[]>("workspace.list", workspace.id, path);

export const readWorkspaceFile = (
  workspace: WorkspaceSummary,
  path: string
): Promise<string> =>
  desktopAction<string>("workspace.read", workspace.id, path);

export function searchWorkspaceFiles(
  workspace: WorkspaceSummary,
  query: string,
  options?: WorkspaceSearchOptions
): Promise<WorkspaceEntry[]> {
  options?.signal?.throwIfAborted();
  return desktopAction<WorkspaceEntry[]>("workspace.search", workspace.id, query, options?.limit);
}

export function searchWorkspaceText(
  workspace: WorkspaceSummary,
  query: string,
  options?: WorkspaceSearchOptions
): Promise<WorkspaceTextMatch[]> {
  options?.signal?.throwIfAborted();
  return desktopAction<WorkspaceTextMatch[]>(
    "workspace.searchText",
    workspace.id,
    query,
    options?.limit
  );
}

export const exportWorkspaceDocument = (
  workspace: WorkspaceSummary,
  filename: string,
  body: string
): Promise<string> =>
  desktopAction<string>("workspace.export", workspace.id, filename, body);

export const readWorkspaceGitDiff = (
  workspace: WorkspaceSummary
): Promise<WorkspaceGitDiff> =>
  desktopAction<WorkspaceGitDiff>("workspace.gitDiff", workspace.id);

export function workspaceErrorText(error: unknown): string {
  return serializeErrorCode(error, ERROR_CODES.WORKSPACE_ACCESS_FAILED);
}

export function splitWorkspacePath(path: string): string[] {
  const parts: string[] = path.split("/");
  if (parts.some((part: string): boolean => {
    const trimmed: string = part.trimEnd();
    if (!trimmed || trimmed === "." || trimmed === ".." || /[:\\\p{Cc}]/u.test(part)) return true;
    const basename: string = part.split(".", 1)[0].trimEnd();
    return /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|(?:com|lpt)[1-9¹²³])$/iu.test(basename);
  })) {
    throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
  }
  return parts;
}
