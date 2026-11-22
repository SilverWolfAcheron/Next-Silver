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

export interface DeleteFileParams {
  workspace: WorkspaceSummary;
  path: string;
  expectedBefore?: string;
}

export interface DeleteDirectoryParams {
  workspace: WorkspaceSummary;
  path: string;
  recursive?: boolean;
}

export interface CreateFileParams {
  workspace: WorkspaceSummary;
  path: string;
  content?: string;
  overwrite?: boolean;
  createParents?: boolean;
}

export interface CreateDirectoryParams {
  workspace: WorkspaceSummary;
  path: string;
  recursive?: boolean;
}

export interface RenamePathParams {
  workspace: WorkspaceSummary;
  fromPath: string;
  toPath: string;
  overwrite?: boolean;
}

export interface ReplaceFileLinesParams {
  workspace: WorkspaceSummary;
  path: string;
  startLine: number;
  endLine: number;
  replacement: string;
  expectedBefore?: string;
}

export interface AppendFileParams {
  workspace: WorkspaceSummary;
  path: string;
  content: string;
  ensureNewline?: boolean;
  createIfMissing?: boolean;
}

export interface DeleteFileLinesParams {
  workspace: WorkspaceSummary;
  path: string;
  startLine: number;
  endLine: number;
  expectedBefore?: string;
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
