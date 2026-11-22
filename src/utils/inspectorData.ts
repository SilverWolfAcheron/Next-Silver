import type { Artifact, Run } from "../agent-core/types";
import type { FindingSection, ParallelRunEntry } from "../types/inspector";

export function groupRunsByParallel(runs: Run[]): ParallelRunEntry[] {
  const entries: ParallelRunEntry[] = [];
  const groups: Map<string, Run[]> = new Map();

  for (const run of runs) {
    if (!run.parallelGroup) {
      entries.push({ key: `run:${run.id}`, parallel: false, runs: [run] });
      continue;
    }
    const existing: Run[] | undefined = groups.get(run.parallelGroup);
    if (existing) {
      existing.push(run);
      continue;
    }
    const group: Run[] = [run];
    groups.set(run.parallelGroup, group);
    entries.push({ key: `group:${run.parallelGroup}`, parallel: true, runs: group });
  }

  return entries;
}

export function groupArtifactsByRun(artifacts: Artifact[]): Map<string | undefined, Artifact[]> {
  const groups: Map<string | undefined, Artifact[]> = new Map();
  for (const artifact of artifacts) {
    const group: Artifact[] | undefined = groups.get(artifact.runId);
    if (group) group.push(artifact);
    else groups.set(artifact.runId, [artifact]);
  }
  return groups;
}

export function splitFindingSections(body: string): FindingSection[] {
  const lines: string[] = body.split(/\r?\n/u);
  const headings: number[] = [];
  const listItems: number[] = [];
  let codeFence: string | undefined = undefined;

  for (const [index, line] of lines.entries()) {
    const fence: string | undefined = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence) {
      if (!codeFence) codeFence = fence;
      else if (fence.startsWith(codeFence)) codeFence = undefined;
    } else if (!codeFence && /^#{2,6}\s+\S/u.test(line)) {
      headings.push(index);
    } else if (!codeFence && /^(?:[-*+]\s+|\d+[.)]\s+|\d+、\s*)\S/u.test(line)) {
      listItems.push(index);
    }
  }

  const markers: number[] = headings.length > 1 || !listItems.length ? headings : listItems;
  if (!markers.length) return body.trim() ? [{ text: body.trim(), finding: true }] : [];

  const introduction: string = lines.slice(0, markers[0]).join("\n").trim();
  return [
    ...(introduction ? [{ text: introduction, finding: false }] : []),
    ...markers.map(
      (start: number, index: number): FindingSection => ({
        text: lines.slice(start, markers[index + 1]).join("\n").trim(),
        finding: true,
      })
    ),
  ];
}

export function buildSafeMarkdownFilename(title: string, fallbackBase: string): string {
  const safeTitle: string = title.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").trim();
  const base: string = Array.from(safeTitle.replace(/^\.+|\.+$/gu, "").replace(/\.md$/iu, ""))
    .slice(0, 120)
    .join("")
    .trim();
  return `${base || fallbackBase}.md`;
}

export function triggerMarkdownDownload(filename: string, body: string): void {
  const url: string = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
  const link: HTMLAnchorElement = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout((): void => URL.revokeObjectURL(url), 1000);
}
