import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SilverState } from "./silverState";

export interface DesktopSnapshot {
  revision: number;
  state: SilverState;
  busyThreads: string[];
  workspaceVersions?: Record<string, number>;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await invoke<{ status: number; body: T }>("desktop_request", { method, path, body });
  if (response.status >= 400) {
    const data = response.body as { error?: unknown };
    throw new Error(typeof data?.error === "string" ? data.error : "Silver 本机请求失败。");
  }
  return response.body;
}

export const desktopAvailable = isTauri;
export const desktopState = () => request<DesktopSnapshot>("GET", "/state");
export const desktopAction = <T = void>(name: string, ...args: unknown[]) =>
  request<T>("POST", "/action", { name, args });
export const listenDesktop = (accept: (snapshot: DesktopSnapshot) => void) =>
  listen<DesktopSnapshot>("silver://state", ({ payload }) => accept(payload));
export const chooseDirectory = () => invoke<string | null>("choose_workspace");
export const syncWindowTheme = (
  dark: boolean,
  bg: [number, number, number],
  fg: [number, number, number],
  border: [number, number, number],
) => {
  if (!isTauri()) return;
  void invoke("set_window_theme", { dark, bg, fg, border }).catch(() => undefined);
};
