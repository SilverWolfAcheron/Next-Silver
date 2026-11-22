import { lstat, mkdir, readdir, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { AppError, ERROR_CODES } from "../src/agent-core/errors.ts";
import type { WorkspaceSummary } from "../src/agent-core/types.ts";
import { FILE_EDIT_MAX_TEXT_BYTES } from "../src/constants/fileEdit.ts";
import type {
  FileEditResult,
  FilePathResult,
  RenamePathResult,
  TextAppendResult,
  TextLineDeleteResult,
  TextLineReplaceResult,
} from "../src/types/fileEdit.ts";
import {
  appendTextToContent,
  countTextLines,
  deleteLinesInText,
  replaceLinesInText,
} from "../src/utils/file-edit/textOps.ts";
import { appDataDir } from "./host.ts";
import {
  emitWorkspaceChange,
  forbidWorkspaceEscape,
  readWorkspaceTarget,
  replaceWorkspaceTarget,
  resolveWorkspaceDirectory,
  resolveWorkspaceFile,
  serializeWorkspaceWrite,
  splitWorkspacePath,
  workspaceRoot,
} from "./workspace.ts";

export interface DeleteFileOpInput {
  path: string;
  expectedBefore?: string;
}

export interface DeleteDirectoryOpInput {
  path: string;
  recursive?: boolean;
}

export interface CreateFileOpInput {
  path: string;
  content?: string;
  overwrite?: boolean;
  createParents?: boolean;
}

export interface CreateDirectoryOpInput {
  path: string;
  recursive?: boolean;
}

export interface RenameOpInput {
  fromPath: string;
  toPath: string;
  overwrite?: boolean;
}

export interface ReplaceLinesOpInput {
  path: string;
  startLine: number;
  endLine: number;
  replacement: string;
  expectedBefore?: string;
}

export interface AppendFileOpInput {
  path: string;
  content: string;
  ensureNewline?: boolean;
  createIfMissing?: boolean;
}

export interface DeleteLinesOpInput {
  path: string;
  startLine: number;
  endLine: number;
  expectedBefore?: string;
}

export interface ReplaceContentOpInput {
  path: string;
  content: string;
  expectedBefore?: string | null;
  createIfMissing?: boolean;
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function pathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function assertTextContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new AppError(ERROR_CODES.WORKSPACE_TEXT_CONTENT_REQUIRED);
  }
  if (content.includes("\0") || Buffer.byteLength(content) > FILE_EDIT_MAX_TEXT_BYTES) {
    throw new AppError(ERROR_CODES.WORKSPACE_WRITE_INVALID);
  }
  return content;
}

async function safeLstat(target: string): Promise<Stats | null> {
  return lstat(target).catch((error: unknown): null => {
    if (errno(error) === "ENOENT") return null;
    throw error;
  });
}

async function ensureDirectoryChain(root: string, parts: string[], recursive: boolean): Promise<string> {
  if (parts.length === 0) throw new AppError(ERROR_CODES.WORKSPACE_INVALID_PATH);
  let current: string = root;
  for (let index: number = 0; index < parts.length; index += 1) {
    const part: string = parts[index];
    const next: string = join(current, part);
    forbidWorkspaceEscape(root, next);
    const inspected: Stats | null = await safeLstat(next);
    const isLast: boolean = index === parts.length - 1;

    if (!inspected) {
      if (!recursive && !isLast) {
        throw new AppError(ERROR_CODES.WORKSPACE_DIR_NOT_FOUND);
      }
      await mkdir(next).catch((error: unknown): void => {
        if (errno(error) !== "EEXIST") throw error;
      });
    } else if (inspected.isSymbolicLink()) {
      throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
    } else if (!inspected.isDirectory()) {
      throw new AppError(ERROR_CODES.WORKSPACE_TARGET_EXISTS);
    } else if (isLast && !recursive) {
      throw new AppError(ERROR_CODES.WORKSPACE_TARGET_EXISTS);
    }

    const resolved: string = await realpath(next);
    forbidWorkspaceEscape(root, resolved);
    if (pathKey(resolved) !== pathKey(next)) {
      throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
    }
    current = resolved;
  }
  return current;
}

export async function deleteWorkspaceFile(
  workspace: WorkspaceSummary,
  input: DeleteFileOpInput,
  dataDir: string = appDataDir()
): Promise<FilePathResult> {
  const root: string = await workspaceRoot(workspace, dataDir);
  await serializeWorkspaceWrite(root, async (): Promise<void> => {
    const target: string = await resolveWorkspaceFile(root, input.path, false);
    const info: Stats | null = await safeLstat(target);
    if (!info) throw new AppError(ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new AppError(ERROR_CODES.WORKSPACE_NOT_REGULAR_FILE);
    }
    if (pathKey(await realpath(target)) !== pathKey(target)) {
      throw new AppError(ERROR_CODES.WORKSPACE_CASE_MISMATCH);
    }
    if (input.expectedBefore !== undefined) {
      const current: string | null = await readWorkspaceTarget(target);
      if (current !== input.expectedBefore) {
        throw new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
      }
    }
    await unlink(target);
  });
  emitWorkspaceChange(workspace.id);
  return { path: input.path };
}

export async function deleteWorkspaceDirectory(
  workspace: WorkspaceSummary,
  input: DeleteDirectoryOpInput,
  dataDir: string = appDataDir()
): Promise<FilePathResult> {
  const parts: string[] = splitWorkspacePath(input.path);
  const recursive: boolean = input.recursive ?? true;
  const root: string = await workspaceRoot(workspace, dataDir);

  await serializeWorkspaceWrite(root, async (): Promise<void> => {
    const parent: string = await resolveWorkspaceDirectory(root, parts.slice(0, -1), false).catch(
      (error: unknown): never => {
        if (error instanceof AppError && error.code === ERROR_CODES.WORKSPACE_FILE_NOT_FOUND) {
          throw new AppError(ERROR_CODES.WORKSPACE_DIR_NOT_FOUND, { cause: error });
        }
        throw error;
      }
    );
    const target: string = join(parent, parts[parts.length - 1]);
    forbidWorkspaceEscape(root, target);
    const info: Stats | null = await safeLstat(target);
    if (!info) throw new AppError(ERROR_CODES.WORKSPACE_DIR_NOT_FOUND);
    if (info.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
    if (!info.isDirectory()) throw new AppError(ERROR_CODES.WORKSPACE_NOT_DIRECTORY);
    if (pathKey(await realpath(target)) !== pathKey(target)) {
      throw new AppError(ERROR_CODES.WORKSPACE_CASE_MISMATCH);
    }
    if (!recursive) {
      const entries: string[] = await readdir(target);
      if (entries.length > 0) throw new AppError(ERROR_CODES.WORKSPACE_DIR_NOT_EMPTY);
      await rmdir(target);
      return;
    }
    await rm(target, { recursive: true, force: false });
  });

  emitWorkspaceChange(workspace.id);
  return { path: input.path };
}

export async function createWorkspaceFile(
  workspace: WorkspaceSummary,
  input: CreateFileOpInput,
  dataDir: string = appDataDir()
): Promise<FileEditResult> {
  const content: string = assertTextContent(input.content ?? "");
  const overwrite: boolean = input.overwrite ?? false;
  const createParents: boolean = input.createParents ?? true;
  const root: string = await workspaceRoot(workspace, dataDir);

  await serializeWorkspaceWrite(root, async (): Promise<void> => {
    const target: string = await resolveWorkspaceFile(root, input.path, createParents);
    const existing: Stats | null = await safeLstat(target);
    if (existing) {
      if (existing.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
      if (!existing.isFile() || !overwrite) {
        throw new AppError(ERROR_CODES.WORKSPACE_TARGET_EXISTS);
      }
    }
    const current: string | null = existing ? await readWorkspaceTarget(target) : null;
    await replaceWorkspaceTarget({
      root,
      path: input.path,
      after: content,
      expectedBefore: current,
    });
  });

  emitWorkspaceChange(workspace.id);
  return {
    path: input.path,
    content,
    lineCount: countTextLines(content),
  };
}

export async function createWorkspaceDirectory(
  workspace: WorkspaceSummary,
  input: CreateDirectoryOpInput,
  dataDir: string = appDataDir()
): Promise<FilePathResult> {
  const parts: string[] = splitWorkspacePath(input.path);
  const recursive: boolean = input.recursive ?? true;
  const root: string = await workspaceRoot(workspace, dataDir);

  await serializeWorkspaceWrite(root, async (): Promise<void> => {
    await ensureDirectoryChain(root, parts, recursive);
  });

  emitWorkspaceChange(workspace.id);
  return { path: input.path };
}

export async function renameWorkspaceFile(
  workspace: WorkspaceSummary,
  input: RenameOpInput,
  dataDir: string = appDataDir()
): Promise<RenamePathResult> {
  splitWorkspacePath(input.fromPath);
  splitWorkspacePath(input.toPath);
  if (input.fromPath === input.toPath) {
    throw new AppError(ERROR_CODES.FILE_EDIT_SAME_PATH);
  }
  const overwrite: boolean = input.overwrite ?? false;
  const root: string = await workspaceRoot(workspace, dataDir);

  await serializeWorkspaceWrite(root, async (): Promise<void> => {
    const fromTarget: string = await resolveWorkspaceFile(root, input.fromPath, false);
    const fromInfo: Stats | null = await safeLstat(fromTarget);
    if (!fromInfo) throw new AppError(ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
    if (fromInfo.isSymbolicLink() || !fromInfo.isFile()) {
      throw new AppError(ERROR_CODES.WORKSPACE_NOT_REGULAR_FILE);
    }

    const toTarget: string = await resolveWorkspaceFile(root, input.toPath, true);
    const sameCaseInsensitive: boolean = pathKey(fromTarget) === pathKey(toTarget);
    if (!sameCaseInsensitive) {
      const toInfo: Stats | null = await safeLstat(toTarget);
      if (toInfo) {
        if (toInfo.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
        if (!toInfo.isFile() || !overwrite) {
          throw new AppError(ERROR_CODES.WORKSPACE_TARGET_EXISTS);
        }
      }
    }
    await rename(fromTarget, toTarget);
  });

  emitWorkspaceChange(workspace.id);
  return { fromPath: input.fromPath, toPath: input.toPath };
}

export async function renameWorkspaceDirectory(
  workspace: WorkspaceSummary,
  input: RenameOpInput,
  dataDir: string = appDataDir()
): Promise<RenamePathResult> {
  const fromParts: string[] = splitWorkspacePath(input.fromPath);
  const toParts: string[] = splitWorkspacePath(input.toPath);
  if (input.fromPath === input.toPath) {
    throw new AppError(ERROR_CODES.FILE_EDIT_SAME_PATH);
  }
  if (pathKey(input.toPath).startsWith(`${pathKey(input.fromPath)}/`)) {
    throw new AppError(ERROR_CODES.FILE_EDIT_RENAME_INTO_SELF);
  }
  const overwrite: boolean = input.overwrite ?? false;
  const root: string = await workspaceRoot(workspace, dataDir);

  await serializeWorkspaceWrite(root, async (): Promise<void> => {
    const fromParent: string = await resolveWorkspaceDirectory(root, fromParts.slice(0, -1), false).catch(
      (error: unknown): never => {
        if (error instanceof AppError && error.code === ERROR_CODES.WORKSPACE_FILE_NOT_FOUND) {
          throw new AppError(ERROR_CODES.WORKSPACE_DIR_NOT_FOUND, { cause: error });
        }
        throw error;
      }
    );
    const fromTarget: string = join(fromParent, fromParts[fromParts.length - 1]);
    forbidWorkspaceEscape(root, fromTarget);
    const fromInfo: Stats | null = await safeLstat(fromTarget);
    if (!fromInfo) throw new AppError(ERROR_CODES.WORKSPACE_DIR_NOT_FOUND);
    if (fromInfo.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
    if (!fromInfo.isDirectory()) throw new AppError(ERROR_CODES.WORKSPACE_NOT_DIRECTORY);

    const toParent: string = await resolveWorkspaceDirectory(root, toParts.slice(0, -1), true);
    const toTarget: string = join(toParent, toParts[toParts.length - 1]);
    forbidWorkspaceEscape(root, toTarget);

    const sameCaseInsensitive: boolean = pathKey(fromTarget) === pathKey(toTarget);
    if (!sameCaseInsensitive) {
      const toInfo: Stats | null = await safeLstat(toTarget);
      if (toInfo) {
        if (toInfo.isSymbolicLink()) throw new AppError(ERROR_CODES.WORKSPACE_SYMLINK_FORBIDDEN);
        if (!toInfo.isDirectory() || !overwrite) {
          throw new AppError(ERROR_CODES.WORKSPACE_TARGET_EXISTS);
        }
        await rm(toTarget, { recursive: true, force: false });
      }
    }
    await rename(fromTarget, toTarget);
  });

  emitWorkspaceChange(workspace.id);
  return { fromPath: input.fromPath, toPath: input.toPath };
}

export async function replaceWorkspaceFileLines(
  workspace: WorkspaceSummary,
  input: ReplaceLinesOpInput,
  dataDir: string = appDataDir()
): Promise<FileEditResult> {
  assertTextContent(input.replacement);
  const root: string = await workspaceRoot(workspace, dataDir);

  const updated: TextLineReplaceResult = await serializeWorkspaceWrite(
    root,
    async (): Promise<TextLineReplaceResult> => {
      const target: string = await resolveWorkspaceFile(root, input.path, false);
      const current: string | null = await readWorkspaceTarget(target);
      if (current === null) throw new AppError(ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
      if (input.expectedBefore !== undefined && current !== input.expectedBefore) {
        throw new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
      }
      const next: TextLineReplaceResult = replaceLinesInText({
        content: current,
        startLine: input.startLine,
        endLine: input.endLine,
        replacement: input.replacement,
      });
      assertTextContent(next.content);
      await replaceWorkspaceTarget({
        root,
        path: input.path,
        after: next.content,
        expectedBefore: current,
      });
      return next;
    }
  );

  emitWorkspaceChange(workspace.id);
  return {
    path: input.path,
    content: updated.content,
    lineCount: updated.lineCount,
  };
}

export async function appendWorkspaceFile(
  workspace: WorkspaceSummary,
  input: AppendFileOpInput,
  dataDir: string = appDataDir()
): Promise<FileEditResult> {
  assertTextContent(input.content);
  const ensureNewline: boolean = input.ensureNewline ?? true;
  const createIfMissing: boolean = input.createIfMissing ?? false;
  const root: string = await workspaceRoot(workspace, dataDir);

  const updated: TextAppendResult = await serializeWorkspaceWrite(
    root,
    async (): Promise<TextAppendResult> => {
      const target: string = await resolveWorkspaceFile(root, input.path, createIfMissing);
      const current: string | null = await readWorkspaceTarget(target);
      if (current === null && !createIfMissing) {
        throw new AppError(ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
      }
      const next: TextAppendResult = appendTextToContent({
        content: current ?? "",
        addition: input.content,
        ensureNewline,
      });
      assertTextContent(next.content);
      await replaceWorkspaceTarget({
        root,
        path: input.path,
        after: next.content,
        expectedBefore: current,
      });
      return next;
    }
  );

  emitWorkspaceChange(workspace.id);
  return {
    path: input.path,
    content: updated.content,
    lineCount: updated.lineCount,
  };
}

export async function deleteWorkspaceFileLines(
  workspace: WorkspaceSummary,
  input: DeleteLinesOpInput,
  dataDir: string = appDataDir()
): Promise<FileEditResult> {
  const root: string = await workspaceRoot(workspace, dataDir);

  const updated: TextLineDeleteResult = await serializeWorkspaceWrite(
    root,
    async (): Promise<TextLineDeleteResult> => {
      const target: string = await resolveWorkspaceFile(root, input.path, false);
      const current: string | null = await readWorkspaceTarget(target);
      if (current === null) throw new AppError(ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
      if (input.expectedBefore !== undefined && current !== input.expectedBefore) {
        throw new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
      }
      const next: TextLineDeleteResult = deleteLinesInText({
        content: current,
        startLine: input.startLine,
        endLine: input.endLine,
      });
      await replaceWorkspaceTarget({
        root,
        path: input.path,
        after: next.content,
        expectedBefore: current,
      });
      return next;
    }
  );

  emitWorkspaceChange(workspace.id);
  return {
    path: input.path,
    content: updated.content,
    lineCount: updated.lineCount,
  };
}

export async function replaceWorkspaceFileContent(
  workspace: WorkspaceSummary,
  input: ReplaceContentOpInput,
  dataDir: string = appDataDir()
): Promise<FileEditResult> {
  const content: string = assertTextContent(input.content);
  const createIfMissing: boolean = input.createIfMissing ?? false;
  const root: string = await workspaceRoot(workspace, dataDir);

  await serializeWorkspaceWrite(root, async (): Promise<void> => {
    const target: string = await resolveWorkspaceFile(root, input.path, createIfMissing);
    const current: string | null = await readWorkspaceTarget(target);
    if (current === null && !createIfMissing) {
      throw new AppError(ERROR_CODES.WORKSPACE_FILE_NOT_FOUND);
    }
    if (input.expectedBefore !== undefined && current !== input.expectedBefore) {
      throw new AppError(ERROR_CODES.WORKSPACE_FILE_CHANGED);
    }
    await replaceWorkspaceTarget({
      root,
      path: input.path,
      after: content,
      expectedBefore: current,
    });
  });

  emitWorkspaceChange(workspace.id);
  return {
    path: input.path,
    content,
    lineCount: countTextLines(content),
  };
}
