import type { Thread } from "../agent-core/types";
import { CONCURRENCY_BOUNDS } from "../constants/provider";
import type { GroupedThreads } from "../types/sidebar";

export function filterAndGroupThreads(threads: Thread[], rawQuery: string): GroupedThreads {
  const search: string = rawQuery.trim().toLowerCase();
  const filtered: Thread[] = threads.filter(
    (thread: Thread): boolean =>
      !search ||
      thread.title.toLowerCase().includes(search) ||
      (thread.workspace?.name.toLowerCase().includes(search) ?? false)
  );
  return {
    filtered,
    pinned: filtered.filter((thread: Thread): boolean => Boolean(thread.pinned)),
    regular: filtered.filter((thread: Thread): boolean => !thread.pinned),
  };
}

export function stepConcurrencyDraft(draft: string, delta: number): string {
  const current: number = Number(draft);
  const base: number = Number.isFinite(current) ? Math.trunc(current) : CONCURRENCY_BOUNDS.defaultValue;
  const clamped: number = Math.min(
    CONCURRENCY_BOUNDS.max,
    Math.max(CONCURRENCY_BOUNDS.min, base + delta)
  );
  return String(clamped);
}

export function triggerBackupDownload(content: string): void {
  const blob: Blob = new Blob([content], { type: "application/json" });
  const url: string = URL.createObjectURL(blob);
  const link: HTMLAnchorElement = document.createElement("a");
  link.href = url;
  link.download = `silver-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
