import { chooseDirectory, desktopAction, desktopAvailable } from "./desktopClient";

export interface WorkspaceSummary {
  id: string;
  name: string;
  path?: string;
}

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: "directory" | "file";
}

export interface WorkspaceTextMatch {
  path: string;
  line: number;
  text: string;
}

export const WORKSPACE_PATH_MIME = "text/x-silver-workspace-path";
const changes = new EventTarget();

export class WorkspaceAccessError extends Error {
  constructor(readonly reason: "permission" | "unavailable", message: string) {
    super(message);
  }
}

export const workspaceSupported = desktopAvailable;

export function subscribeWorkspaceChanges(workspace: WorkspaceSummary, listener: () => void) {
  changes.addEventListener(workspace.id, listener);
  return () => changes.removeEventListener(workspace.id, listener);
}

export async function selectWorkspace(): Promise<WorkspaceSummary> {
  const path = await chooseDirectory();
  if (!path) throw new DOMException("已取消", "AbortError");
  return desktopAction("workspace.bind", path);
}

export const requestWorkspaceAccess = (workspace: WorkspaceSummary) =>
  desktopAction<void>("workspace.access", workspace.id);
export const listWorkspace = (workspace: WorkspaceSummary, path = "") =>
  desktopAction<WorkspaceEntry[]>("workspace.list", workspace.id, path);
export const readWorkspaceFile = (workspace: WorkspaceSummary, path: string) =>
  desktopAction<string>("workspace.read", workspace.id, path);

export function searchWorkspaceFiles(workspace: WorkspaceSummary, query: string, limit?: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return desktopAction<WorkspaceEntry[]>("workspace.search", workspace.id, query, limit);
}

export async function exportWorkspaceDocument(workspace: WorkspaceSummary, filename: string, body: string) {
  const path = await desktopAction<string>("workspace.export", workspace.id, filename, body);
  changes.dispatchEvent(new Event(workspace.id));
  return path;
}

export function workspaceErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "无法访问工作区文件。";
}

export function splitWorkspacePath(path: string): string[] {
  const parts = path.split("/");
  if (parts.some((part) => {
    const trimmed = part.trimEnd();
    if (!trimmed || trimmed === "." || trimmed === ".." || /[:\\\p{Cc}]/u.test(part)) return true;
    const basename = part.split(".", 1)[0].trimEnd();
    return /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|(?:com|lpt)[1-9¹²³])$/iu.test(basename);
  })) {
    throw new Error("路径必须指向工作区中的文件或目录。");
  }
  return parts;
}

