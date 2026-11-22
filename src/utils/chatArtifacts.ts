import type { Artifact, ChatMessage, Run, Thread } from "../agent-core/types";
import type { ChatArtifactBuckets } from "../types/chat";
import type { DiffFile } from "../types/diff";
import { parseDiff } from "./diff";

export interface DiffArtifactSummary {
  fileCount: number;
  additions: number;
  deletions: number;
  pendingCount: number;
  hasDecidableFiles: boolean;
}

export function mapArtifactsToChat(thread: Thread): ChatArtifactBuckets {
  const byMessageId: Map<string, Artifact[]> = new Map();
  const trailing: Artifact[] = [];
  if (thread.artifacts.length === 0) {
    return { byMessageId, trailing };
  }

  const messageIds: Set<string> = new Set(
    thread.messages.map((message: ChatMessage): string => message.id)
  );
  const runToMessageId: Map<string, string> = new Map();
  for (const run of thread.runs) {
    if (run.messageId && messageIds.has(run.messageId)) {
      runToMessageId.set(run.id, run.messageId);
    }
  }

  for (const artifact of thread.artifacts) {
    const linkedMessageId: string | undefined = artifact.runId
      ? runToMessageId.get(artifact.runId)
      : undefined;
    if (linkedMessageId) {
      const existing: Artifact[] | undefined = byMessageId.get(linkedMessageId);
      if (existing) existing.push(artifact);
      else byMessageId.set(linkedMessageId, [artifact]);
    } else {
      trailing.push(artifact);
    }
  }

  return { byMessageId, trailing };
}

export function buildRunTitleMap(runs: Run[]): Map<string, string> {
  return new Map(runs.map((run: Run): [string, string] => [run.id, run.title]));
}

export function summarizeDiffArtifact(artifact: Artifact): DiffArtifactSummary {
  const parsed: DiffFile[] = parseDiff(artifact.body);
  let additions: number = 0;
  let deletions: number = 0;
  let pendingCount: number = 0;
  let hasDecidableFiles: boolean = false;

  for (const file of parsed) {
    additions += file.additions;
    deletions += file.deletions;
    if (file.change) {
      hasDecidableFiles = true;
      const decision: string | undefined = artifact.fileDecisions?.[file.change.path];
      if (!decision) pendingCount += 1;
    }
  }

  return {
    fileCount: parsed.length,
    additions,
    deletions,
    pendingCount,
    hasDecidableFiles,
  };
}
