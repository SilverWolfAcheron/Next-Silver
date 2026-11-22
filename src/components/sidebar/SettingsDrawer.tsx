import { Fragment } from "react";
import type { ChangeEvent, JSX } from "react";
import { useI18n } from "../../hooks/useI18n";
import { useSettingsDrawer } from "../../hooks/useSettingsDrawer";
import type { SettingsDrawerProps } from "../../types/sidebar";
import { ChevronDownIcon, ChevronRightIcon, SettingsGearIcon } from "../common/Icons";
import { BackupMenu } from "./BackupMenu";
import { ConcurrencyForm } from "./ConcurrencyForm";
import { LanguageMenu } from "./LanguageMenu";

export function SettingsDrawer({ onNavigate, onAfterImport }: SettingsDrawerProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const {
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
  }: ReturnType<typeof useSettingsDrawer> = useSettingsDrawer({ onNavigate, onAfterImport });

  const themeLabel: string =
    theme === "dark"
      ? t.sidebar.themeDark
      : theme === "light"
        ? t.sidebar.themeLight
        : t.sidebar.themeSystem;

  return (
    <div className="shrink-0 px-2 pt-1.5 pb-1">
      <div aria-hidden="true" className="mx-1 mb-2 border-t border-separator/60" />
      {settingsOpen && (
        <div
          id="sidebar-settings-menu"
          className="mb-1.5 flex flex-col gap-0.5 rounded-[12px] border border-separator/85 bg-group p-1.5"
        >
          <button
            type="button"
            onClick={openProviders}
            className={`flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] transition-colors ${
              providerPanelOpen
                ? "bg-fill font-medium text-label"
                : "text-secondary hover:bg-fill hover:text-label"
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
              <rect x="2.5" y="3" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.25" />
              <rect x="2.5" y="9" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.25" />
            </svg>
            <span className="min-w-0 flex-1 truncate">{t.sidebar.provider}</span>
          </button>

          <button
            type="button"
            aria-expanded={concurrencyDraft !== null}
            aria-controls="development-concurrency-settings"
            onClick={toggleConcurrency}
            className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
              <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              <circle cx="6" cy="4.5" r="1.2" fill="currentColor" />
              <circle cx="10.5" cy="8" r="1.2" fill="currentColor" />
              <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" />
            </svg>
            <span className="min-w-0 flex-1 truncate">{t.sidebar.concurrency}</span>
            <span className="shrink-0 font-mono text-[11px] text-tertiary">{developmentConcurrency}</span>
          </button>

          {concurrencyDraft !== null && (
            <ConcurrencyForm
              draft={concurrencyDraft}
              onChange={setConcurrencyDraft}
              onSubmit={saveConcurrency}
            />
          )}

          <button
            type="button"
            aria-expanded={dataMenuOpen}
            onClick={(): void => setDataMenuOpen(!dataMenuOpen)}
            className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
              <path d="M3 4.5C3 3.4 5.24 2.5 8 2.5s5 .9 5 2-2.24 2-5 2-5-.9-5-2Z" stroke="currentColor" strokeWidth="1.25" />
              <path d="M3 4.5v7c0 1.1 2.24 2 5 2s5-.9 5-2v-7M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.25" />
            </svg>
            <span className="min-w-0 flex-1 truncate">{t.sidebar.conversationData}</span>
            <ChevronRightIcon expanded={dataMenuOpen} className="h-3 w-3 shrink-0 text-tertiary" />
          </button>

          {dataMenuOpen && (
            <BackupMenu
              onExport={handleExportBackup}
              onImport={(): void => importInputRef.current?.click()}
            />
          )}

          <button
            type="button"
            aria-expanded={languageMenuOpen}
            onClick={(): void => setLanguageMenuOpen(!languageMenuOpen)}
            className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.25" />
              <path d="M2.75 8h10.5M8 2.5c1.7 1.5 2.5 3.4 2.5 5.5S9.7 12 8 13.5C6.3 12 5.5 10.1 5.5 8S6.3 4 8 2.5Z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span className="min-w-0 flex-1 truncate">{t.sidebar.language}</span>
            <span className="shrink-0 text-[11px] text-tertiary">{t.localeName}</span>
            <ChevronRightIcon expanded={languageMenuOpen} className="h-3 w-3 shrink-0 text-tertiary" />
          </button>

          {languageMenuOpen && (
            <LanguageMenu onSelect={(): void => setLanguageMenuOpen(false)} />
          )}

          <button
            type="button"
            onClick={cycleTheme}
            className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
              {theme === "dark" ? (
                <path d="M12.5 9.8A4.75 4.75 0 0 1 6.2 3.5a5 5 0 1 0 6.3 6.3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              ) : (
                <Fragment>
                  <circle cx="8" cy="8" r="2.75" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M8 2v1.25M8 12.75V14M2 8h1.25M12.75 8H14M3.75 3.75l.9.9M11.35 11.35l.9.9M12.25 3.75l-.9.9M4.65 11.35l-.9.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                </Fragment>
              )}
            </svg>
            <span className="min-w-0 flex-1 truncate">{t.sidebar.theme}</span>
            <span className="shrink-0 text-[11px] text-tertiary">{themeLabel}</span>
          </button>

          {dataStatus && (
            <p
              role="status"
              className={`px-2.5 py-1 text-[11px] ${dataStatus.error ? "text-danger" : "text-secondary"}`}
            >
              {dataStatus.text}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        aria-expanded={settingsOpen}
        aria-controls="sidebar-settings-menu"
        onClick={toggleSettings}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-[10px] px-2.5 text-left text-[13px] transition-colors ${
          settingsOpen
            ? "bg-fill/75 font-medium text-label"
            : "text-secondary hover:bg-fill/60 hover:text-label"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <SettingsGearIcon active={settingsOpen} />
          <span className="truncate">{t.sidebar.settings}</span>
        </span>
        <ChevronDownIcon open={settingsOpen} className="h-3.5 w-3.5 shrink-0 text-tertiary" />
      </button>

      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event: ChangeEvent<HTMLInputElement>): void => {
          void handleImportBackup(event);
        }}
      />
    </div>
  );
}
