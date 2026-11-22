export type FileDecision = "accepted" | "rejected";
export type DiffLineKind = "added" | "removed" | "context" | "meta";

export interface DiffRow {
  marker: " " | "+" | "-";
  text: string;
  noNewline?: boolean;
}

export interface DiffRange {
  start: number;
  count: number;
}

export interface DiffHunk {
  before: DiffRange;
  after: DiffRange;
  rows: DiffRow[];
}

export interface FileChange {
  path: string;
  operation: "create" | "update" | "delete";
  hunks: DiffHunk[];
}

export interface DiffFile {
  path?: string;
  change?: FileChange;
  error?: string;
  lines: { text: string; kind: DiffLineKind }[];
  additions: number;
  deletions: number;
}

export interface DecideDiffFileOptions<TArtifact> {
  snapshot: TArtifact;
  path: string;
  decision: FileDecision;
}
