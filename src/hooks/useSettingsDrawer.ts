import { useRef, useState } from "react";
import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";
import { ERROR_CODES } from "../agent-core/errors";
import { exportThreads, importThreads } from "../agent-core/localData";
import type { AppearanceState, Thread } from "../agent-core/types";
import { formatError, logError } from "../i18n/errors";
import { useRuntimeStore } from "../stores/runtimeStore";
import type { UIAction } from "../types/runtime";
import type { DataStatusNotice } from "../types/sidebar";
import type { RuntimeStore } from "../types/stores";
import { triggerBackupDownload } from "../utils/sidebarData";
import { useI18n } from "./useI18n";

export function useSettingsDrawer(options: {
  onNavigate?: () => void;
  onAfterImport: () => void;
}): {
  providerPanelOpen: boolean;
  developmentConcurrency: number;
  theme: AppearanceState["theme"];
  settingsOpen: boolean;
  dataMenuOpen: boolean;
  languageMenuOpen: boolean;
  dataStatus: DataStatusNotice | undefined;
  concurrencyDraft: string | null;
  importInputRef: RefObject<HTMLInputElement | null>;
  setDataMenuOpen: Dispatch<SetStateAction<boolean>>;
  setLanguageMenuOpen: Dispatch<SetStateAction<boolean>>;
  setConcurrencyDraft: Dispatch<SetStateAction<string | null>>;
  openProviders: () => void;
  toggleConcurrency: () => void;
  saveConcurrency: (value: number) => void;
  toggleSettings: () => void;
  handleExportBackup: () => void;
  handleImportBackup: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  cycleTheme: () => void;
} {
  const { onNavigate, onAfterImport }: typeof options = options;
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const threads: Thread[] = useRuntimeStore((s: RuntimeStore): Thread[] => s.state.threads);
  const providerPanelOpen: boolean = useRuntimeStore(
    (s: RuntimeStore): boolean => s.state.providerPanelOpen
  );
  const developmentConcurrency: number = useRuntimeStore(
    (s: RuntimeStore): number => s.state.developmentConcurrency
  );
  const theme: AppearanceState["theme"] = useRuntimeStore(
    (s: RuntimeStore): AppearanceState["theme"] => s.state.appearance.theme
  );
  const dispatch: (action: UIAction) => void = useRuntimeStore(
    (s: RuntimeStore): ((action: UIAction) => void) => s.dispatch
  );

  const [settingsOpen, setSettingsOpen]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(false);
  const [dataMenuOpen, setDataMenuOpen]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(false);
  const [languageMenuOpen, setLanguageMenuOpen]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(false);
  const [dataStatus, setDataStatus]: [
    DataStatusNotice | undefined,
    Dispatch<SetStateAction<DataStatusNotice | undefined>>
  ] = useState<DataStatusNotice | undefined>(undefined);
  const [concurrencyDraft, setConcurrencyDraft]: [
    string | null,
    Dispatch<SetStateAction<string | null>>
  ] = useState<string | null>(null);
  const importInputRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);

  function openProviders(): void {
    dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
    onNavigate?.();
  }

  function toggleConcurrency(): void {
    setConcurrencyDraft(concurrencyDraft === null ? String(developmentConcurrency) : null);
  }

  function saveConcurrency(value: number): void {
    dispatch({ type: "SET_DEVELOPMENT_CONCURRENCY", value });
    setConcurrencyDraft(null);
  }

  function toggleSettings(): void {
    setSettingsOpen((open: boolean): boolean => {
      if (open) {
        setDataMenuOpen(false);
        setLanguageMenuOpen(false);
        setConcurrencyDraft(null);
      }
      return !open;
    });
  }

  function handleExportBackup(): void {
    try {
      triggerBackupDownload(exportThreads(threads));
      setDataMenuOpen(false);
      setDataStatus({ text: t.sidebar.exportedBackup(threads.length) });
    } catch (error: unknown) {
      logError(error, undefined, ERROR_CODES.UNKNOWN_ERROR);
      setDataStatus({ text: t.sidebar.exportFailed, error: true });
    }
  }

  async function handleImportBackup(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file: File | undefined = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const imported: Thread[] = importThreads(await file.text());
      dispatch({ type: "IMPORT_THREADS", threads: imported });
      onAfterImport();
      setDataMenuOpen(false);
      setDataStatus({ text: t.sidebar.importedBackup(imported.length) });
    } catch (error: unknown) {
      logError(error, undefined, ERROR_CODES.BACKUP_INVALID_FORMAT);
      const text: string =
        error instanceof SyntaxError || error instanceof DOMException
          ? t.sidebar.importFailed
          : formatError(error, t, ERROR_CODES.BACKUP_INVALID_FORMAT);
      setDataStatus({ text, error: true });
    }
  }

  function cycleTheme(): void {
    dispatch({
      type: "SET_APPEARANCE",
      appearance: {
        theme: theme === "dark" ? "light" : theme === "light" ? "system" : "dark",
      },
    });
  }

  return {
    providerPanelOpen,
    developmentConcurrency,
    theme,
    settingsOpen,
    dataMenuOpen,
    languageMenuOpen,
    dataStatus,
    concurrencyDraft,
    importInputRef,
    setDataMenuOpen,
    setLanguageMenuOpen,
    setConcurrencyDraft,
    openProviders,
    toggleConcurrency,
    saveConcurrency,
    toggleSettings,
    handleExportBackup,
    handleImportBackup,
    cycleTheme,
  };
}
