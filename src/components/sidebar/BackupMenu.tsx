import type { JSX } from "react";
import { useI18n } from "../../hooks/useI18n";
import type { BackupMenuProps } from "../../types/sidebar";

export function BackupMenu({ onExport, onImport }: BackupMenuProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <div className="mx-1 my-1 flex flex-col gap-0.5 rounded-[8px] border border-separator bg-surface p-1.5">
      <button
        type="button"
        onClick={onExport}
        className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] text-label transition-colors hover:bg-fill"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-secondary">
          <path d="M8 2.5v7.25M5.25 7.25 8 10l2.75-2.75M3 11.75v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{t.sidebar.exportJson}</span>
      </button>
      <button
        type="button"
        onClick={onImport}
        className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] text-label transition-colors hover:bg-fill"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-secondary">
          <path d="M8 10V2.75M5.25 5.5 8 2.75 10.75 5.5M3 11.75v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{t.sidebar.importJson}</span>
      </button>
    </div>
  );
}
