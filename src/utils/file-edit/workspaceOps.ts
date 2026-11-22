import { desktopAction } from "../../services/desktopClient";
import { notifyWorkspaceChange } from "../../services/workspaceClient";
import type {
  AppendFileParams,
  CreateDirectoryParams,
  CreateFileParams,
  DeleteDirectoryParams,
  DeleteFileLinesParams,
  DeleteFileParams,
  FileEditResult,
  FilePathResult,
  RenamePathParams,
  RenamePathResult,
  ReplaceFileContentParams,
  ReplaceFileLinesParams,
} from "../../types/fileEdit";

export async function deleteFile(params: DeleteFileParams): Promise<FilePathResult> {
  const result: FilePathResult = await desktopAction<FilePathResult>(
    "workspace.deleteFile",
    params.workspace.id,
    {
      path: params.path,
      ...(params.expectedBefore !== undefined ? { expectedBefore: params.expectedBefore } : {}),
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function deleteDirectory(params: DeleteDirectoryParams): Promise<FilePathResult> {
  const result: FilePathResult = await desktopAction<FilePathResult>(
    "workspace.deleteDirectory",
    params.workspace.id,
    {
      path: params.path,
      recursive: params.recursive ?? true,
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function createFile(params: CreateFileParams): Promise<FileEditResult> {
  const result: FileEditResult = await desktopAction<FileEditResult>(
    "workspace.createFile",
    params.workspace.id,
    {
      path: params.path,
      content: params.content ?? "",
      overwrite: params.overwrite ?? false,
      createParents: params.createParents ?? true,
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function createDirectory(params: CreateDirectoryParams): Promise<FilePathResult> {
  const result: FilePathResult = await desktopAction<FilePathResult>(
    "workspace.createDirectory",
    params.workspace.id,
    {
      path: params.path,
      recursive: params.recursive ?? true,
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function renameFile(params: RenamePathParams): Promise<RenamePathResult> {
  const result: RenamePathResult = await desktopAction<RenamePathResult>(
    "workspace.renameFile",
    params.workspace.id,
    {
      fromPath: params.fromPath,
      toPath: params.toPath,
      overwrite: params.overwrite ?? false,
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function renameDirectory(params: RenamePathParams): Promise<RenamePathResult> {
  const result: RenamePathResult = await desktopAction<RenamePathResult>(
    "workspace.renameDirectory",
    params.workspace.id,
    {
      fromPath: params.fromPath,
      toPath: params.toPath,
      overwrite: params.overwrite ?? false,
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function replaceFileLines(params: ReplaceFileLinesParams): Promise<FileEditResult> {
  const result: FileEditResult = await desktopAction<FileEditResult>(
    "workspace.replaceLines",
    params.workspace.id,
    {
      path: params.path,
      startLine: params.startLine,
      endLine: params.endLine,
      replacement: params.replacement,
      ...(params.expectedBefore !== undefined ? { expectedBefore: params.expectedBefore } : {}),
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function appendToFile(params: AppendFileParams): Promise<FileEditResult> {
  const result: FileEditResult = await desktopAction<FileEditResult>(
    "workspace.appendFile",
    params.workspace.id,
    {
      path: params.path,
      content: params.content,
      ensureNewline: params.ensureNewline ?? true,
      createIfMissing: params.createIfMissing ?? false,
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function deleteFileLines(params: DeleteFileLinesParams): Promise<FileEditResult> {
  const result: FileEditResult = await desktopAction<FileEditResult>(
    "workspace.deleteLines",
    params.workspace.id,
    {
      path: params.path,
      startLine: params.startLine,
      endLine: params.endLine,
      ...(params.expectedBefore !== undefined ? { expectedBefore: params.expectedBefore } : {}),
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}

export async function replaceFileContent(
  params: ReplaceFileContentParams
): Promise<FileEditResult> {
  const result: FileEditResult = await desktopAction<FileEditResult>(
    "workspace.replaceContent",
    params.workspace.id,
    {
      path: params.path,
      content: params.content,
      ...(params.expectedBefore !== undefined ? { expectedBefore: params.expectedBefore } : {}),
      createIfMissing: params.createIfMissing ?? false,
    }
  );
  notifyWorkspaceChange(params.workspace.id);
  return result;
}
