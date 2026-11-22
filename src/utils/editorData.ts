import { MAX_VISIBLE_SEARCH_MATCHES } from "../constants/editor";
import type { MatchRange } from "../types/editor";

export function makeEditorScope(threadId?: string, workspaceId?: string): string {
  return threadId && workspaceId ? JSON.stringify([threadId, workspaceId]) : "";
}

export function makeEditorPositionKey(scope: string, path?: string): string {
  return path ? JSON.stringify([scope, path]) : "";
}

export function normalizeSource(body?: string): string {
  return body?.replace(/\r\n/gu, "\n") ?? "";
}

export function buildLineGutter(source: string): { gutter: string; lineCount: number } {
  const lineCount: number = source.split("\n").length;
  const gutter: string = Array.from(
    { length: lineCount },
    (_: unknown, index: number): number => index + 1
  ).join("\n");
  return { gutter, lineCount };
}

export function findMatchOffsets(source: string, query: string, enabled: boolean): number[] {
  if (!enabled || !query || !source) return [];
  const literal: string = query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return Array.from(
    source.matchAll(new RegExp(literal, "giu")),
    ({ index }: RegExpExecArray): number => index
  );
}

export function resolveFileTabLabel(paths: string[], value: string): string {
  const name: string = value.split("/").at(-1) ?? value;
  const duplicates: string[] = paths.filter(
    (entry: string): boolean => entry.split("/").at(-1) === name
  );
  return duplicates.length > 1 ? value : name;
}

export function buildMatchRanges(
  offsets: number[],
  queryLength: number,
  activeOffset?: number
): MatchRange[] {
  if (!queryLength || !offsets.length) return [];

  let slice: number[] = offsets;
  if (offsets.length > MAX_VISIBLE_SEARCH_MATCHES) {
    const activeIndex: number =
      activeOffset === undefined ? 0 : Math.max(0, offsets.indexOf(activeOffset));
    const half: number = Math.floor(MAX_VISIBLE_SEARCH_MATCHES / 2);
    const start: number = Math.max(
      0,
      Math.min(activeIndex - half, offsets.length - MAX_VISIBLE_SEARCH_MATCHES)
    );
    slice = offsets.slice(start, start + MAX_VISIBLE_SEARCH_MATCHES);
  }

  const ranges: MatchRange[] = [];
  let prevEnd: number = -1;
  for (const start of slice) {
    if (start < prevEnd) continue;
    const end: number = start + queryLength;
    ranges.push({ start, end, active: start === activeOffset });
    prevEnd = end;
  }
  return ranges;
}
