import type { WorkspaceEntry } from "../agent-core/types";
import { FILE_ICON_ACCENTS } from "../constants/workspace";

export function sortWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a: WorkspaceEntry, b: WorkspaceEntry): number => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function getFileIconTone(name: string): string {
  const lower: string = name.toLowerCase();
  const ext: string = lower.includes(".") ? (lower.split(".").at(-1) ?? "") : "";
  if (ext && FILE_ICON_ACCENTS[ext]) return FILE_ICON_ACCENTS[ext];
  if (lower.startsWith(".") || lower.endsWith(".lock") || lower.endsWith(".log")) {
    return "text-tertiary";
  }
  return "text-secondary";
}

export function parseFileSearchQuery(query: string): { path: string; line?: number } {
  const location: RegExpExecArray | null = /^(.+):([1-9]\d*)$/u.exec(query.trim());
  const line: number = Number(location?.[2]);
  return location && Number.isSafeInteger(line)
    ? { path: location[1].trim(), line }
    : { path: query };
}
