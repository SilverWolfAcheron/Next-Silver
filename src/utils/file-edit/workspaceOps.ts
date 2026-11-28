import { desktopAction } from "../../services/desktopClient";
import { notifyWorkspaceChange } from "../../services/workspaceClient";
import type { FileEditResult, ReplaceFileContentParams } from "../../types/fileEdit";

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
