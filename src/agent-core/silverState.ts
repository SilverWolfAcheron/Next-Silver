import type { AppearanceState, InspectorTab, Thread } from "./types";
import { getPreset } from "./presets";
import type { Preset } from "./presets";
import { mergeThreads, sortThreads } from "./localData";
import { normalizeDevelopConcurrency } from "./seats";
import { DEFAULT_PROVIDERS } from "./provider/presets";
import type { ProviderConfig } from "./provider/presets";
export interface SilverState {
  threads: Thread[];
  currentThreadId: string | null;
  providers: ProviderConfig[];
  appearance: AppearanceState;
  providerPanelOpen: boolean;
  lastPresetId: string;
  developmentConcurrency: number;
}

export interface DesktopSnapshot {
  revision: number;
  state: SilverState;
  busyThreads: string[];
  workspaceVersions?: Record<string, number>;
}

export type Action =
  | { type: "NEW_THREAD"; thread: Thread }
  | { type: "SELECT_THREAD"; id: string }
  | { type: "UPDATE_THREAD"; threadId: string; update: (thread: Thread) => Thread }
  | { type: "RENAME_THREAD"; threadId: string; title: string }
  | { type: "TOGGLE_THREAD_PIN"; threadId: string }
  | { type: "DELETE_THREAD"; threadId: string }
  | { type: "IMPORT_THREADS"; threads: Thread[] }
  | { type: "SET_INSPECTOR_TAB"; threadId: string; tab: InspectorTab }
  | { type: "SET_INSPECTOR_OPEN"; threadId: string; open: boolean }
  | { type: "SET_PROVIDERS"; providers: ProviderConfig[] }
  | { type: "SET_APPEARANCE"; appearance: AppearanceState }
  | { type: "REMEMBER_PRESET"; presetId: string }
  | { type: "SET_DEVELOPMENT_CONCURRENCY"; value: number }
  | { type: "SET_PROVIDER_PANEL_OPEN"; open: boolean };

function mapThread(state: SilverState, id: string, fn: (thread: Thread) => Thread): SilverState {
  const index: number = state.threads.findIndex((thread: Thread): boolean => thread.id === id);
  if (index === -1) return state;
  const existing: Thread = state.threads[index];
  const next: Thread = fn(existing);
  if (next === existing) return state;
  const threads: Thread[] = [...state.threads];
  threads[index] = next;
  return { ...state, threads };
}

export function reduceSilver(state: SilverState, action: Action): SilverState {
  switch (action.type) {
    case "NEW_THREAD":
      return {
        ...state,
        threads: [action.thread, ...state.threads],
        currentThreadId: action.thread.id,
        lastPresetId: action.thread.presetId,
        providerPanelOpen: false,
      };
    case "SELECT_THREAD":
      return { ...state, currentThreadId: action.id, providerPanelOpen: false };
    case "UPDATE_THREAD":
      return mapThread(state, action.threadId, action.update);
    case "RENAME_THREAD":
      return mapThread(state, action.threadId, (thread: Thread): Thread => ({
        ...thread, title: action.title.trim() || thread.title, titleEdited: true, updatedAt: Date.now(),
      }));
    case "TOGGLE_THREAD_PIN":
      return mapThread(state, action.threadId, (thread: Thread): Thread => ({ ...thread, pinned: !thread.pinned }));
    case "DELETE_THREAD": {
      const threads: Thread[] = state.threads.filter(({ id }: Thread): boolean => id !== action.threadId);
      return {
        ...state, threads,
        currentThreadId: state.currentThreadId === action.threadId
          ? sortThreads(threads)[0]?.id ?? null : state.currentThreadId,
      };
    }
    case "IMPORT_THREADS":
      return { ...state, threads: mergeThreads(state.threads, action.threads) };
    case "SET_INSPECTOR_TAB":
      return mapThread(state, action.threadId, (thread: Thread): Thread => ({ ...thread, inspectorTab: action.tab }));
    case "SET_INSPECTOR_OPEN":
      return mapThread(state, action.threadId, (thread: Thread): Thread => ({ ...thread, inspectorOpen: action.open }));
    case "SET_PROVIDERS":
      return { ...state, providers: action.providers };
    case "SET_APPEARANCE":
      return { ...state, appearance: action.appearance };
    case "REMEMBER_PRESET":
      return { ...state, lastPresetId: action.presetId };
    case "SET_DEVELOPMENT_CONCURRENCY":
      return { ...state, developmentConcurrency: normalizeDevelopConcurrency(action.value) };
    case "SET_PROVIDER_PANEL_OPEN":
      return { ...state, providerPanelOpen: action.open };
  }
}

export function initialState(saved: Partial<SilverState> = {}): SilverState {
  return {
    threads: saved.threads ?? [],
    currentThreadId: saved.currentThreadId ?? null,
    providers: saved.providers ?? DEFAULT_PROVIDERS,
    appearance: saved.appearance ?? { theme: "system" },
    lastPresetId: saved.lastPresetId ?? "develop",
    developmentConcurrency: normalizeDevelopConcurrency(saved.developmentConcurrency),
    providerPanelOpen: false,
  };
}

export function makeThread(presetId: string): Thread {
  const preset: Preset = getPreset(presetId);
  return {
    id: crypto.randomUUID(),
    title: preset.label,
    presetId: preset.id,
    mode: preset.mode,
    messages: [],
    brief: null,
    runs: [],
    artifacts: [],
    modelId: "",
    inspectorTab: preset.defaultTab,
    inspectorOpen: false,
    intakeStep: "questioning",
    updatedAt: Date.now(),
  };
}
