import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Event, UnlistenFn } from "@tauri-apps/api/event";
import { AppError, ERROR_CODES, extractErrorCode } from "../agent-core/errors";
import type { DesktopSnapshot } from "../agent-core/silverState";
import type { WindowThemePayload } from "../types/common";
import type { ErrorParams, ParsedErrorCode } from "../types/errors";

export type { DesktopSnapshot };

function extractParams(body: unknown): ErrorParams | undefined {
  if (!body || typeof body !== "object" || !("params" in body)) return undefined;
  const raw: unknown = body.params;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const params: ErrorParams = {};
  let hasEntry: boolean = false;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      params[key] = value;
      hasEntry = true;
    }
  }
  return hasEntry ? params : undefined;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let response: { status: number; body: T };
  try {
    response = await invoke<{ status: number; body: T }>("desktop_request", {
      method,
      path,
      body,
    });
  } catch (failure: unknown) {
    const parsed: ParsedErrorCode = extractErrorCode(failure, ERROR_CODES.DESKTOP_CONNECTION_LOST);
    throw new AppError(parsed.code, { params: parsed.params, cause: failure });
  }
  if (response.status >= 400) {
    const data: { code?: unknown; error?: unknown; params?: unknown } = response.body as {
      code?: unknown;
      error?: unknown;
      params?: unknown;
    };
    const parsed: ParsedErrorCode = extractErrorCode(
      data?.code ?? data?.error,
      ERROR_CODES.DESKTOP_REQUEST_FAILED
    );
    const params: ErrorParams | undefined = extractParams(data) ?? parsed.params;
    throw new AppError(parsed.code, { params });
  }
  return response.body;
}

export const desktopAvailable: () => boolean = isTauri;

export const desktopState = (): Promise<DesktopSnapshot> =>
  request<DesktopSnapshot>("GET", "/state");

export const desktopAction = <T = void>(name: string, ...args: unknown[]): Promise<T> =>
  request<T>("POST", "/action", { name, args });

export const listenDesktop = (
  accept: (snapshot: DesktopSnapshot) => void
): Promise<UnlistenFn> =>
  listen<DesktopSnapshot>("silver://state", ({ payload }: Event<DesktopSnapshot>): void => {
    accept(payload);
  });

export async function chooseDirectory(): Promise<string | null> {
  try {
    return await invoke<string | null>("choose_workspace");
  } catch (failure: unknown) {
    const parsed: ParsedErrorCode = extractErrorCode(failure, ERROR_CODES.DESKTOP_DIALOG_OPEN_FAILED);
    throw new AppError(parsed.code, { params: parsed.params, cause: failure });
  }
}

export const syncWindowTheme = (payload: WindowThemePayload): void => {
  if (!isTauri()) return;
  void invoke("set_window_theme", {
    dark: payload.dark,
    bg: payload.bg,
    fg: payload.fg,
    border: payload.border,
  }).catch((): undefined => undefined);
};
