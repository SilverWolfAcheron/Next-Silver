import type { WorkspaceTextMatch } from "../agent-core/types.ts";

export interface CodingReadWindow {
  startLine: number;
  endLine: number;
  totalLines: number;
  body: string;
  truncated: boolean;
}

export interface CodingToolBase {
  name: string;
  path: string;
}

export interface CodingSearchOptions {
  directory?: string;
  signal?: AbortSignal;
}

export interface CodingSearchResult {
  query: string;
  directory: string;
  matches: WorkspaceTextMatch[];
  scannedFiles: number;
  truncated: boolean;
}
