import type { WorkspaceSummary } from "../agent-core/types";

export type LineEnding = "\n" | "\r\n";

export interface TextLineReplaceParams {
  content: string;
  startLine: number;
  endLine: number;
  replacement: string;
}

export interface TextLineReplaceResult {
  content: string;
  lineCount: number;
  replacedCount: number;
}

export interface TextAppendParams {
  content: string;
  addition: string;
  ensureNewline?: boolean;
}

export interface TextAppendResult {
  content: string;
  lineCount: number;
}

export interface TextLineDeleteParams {
  content: string;
  startLine: number;
  endLine: number;
}

export interface TextLineDeleteResult {
  content: string;
  lineCount: number;
  deletedCount: number;
}

export interface ReplaceFileContentParams {
  workspace: WorkspaceSummary;
  path: string;
  content: string;
  expectedBefore?: string | null;
  createIfMissing?: boolean;
}

export interface FileEditResult {
  path: string;
  content: string;
  lineCount: number;
}

export interface FilePathResult {
  path: string;
}

export interface RenamePathResult {
  fromPath: string;
  toPath: string;
}
