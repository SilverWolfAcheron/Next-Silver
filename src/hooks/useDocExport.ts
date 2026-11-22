import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WorkspaceSummary } from "../agent-core/types";
import { exportWorkspaceDocument, workspaceErrorText } from "../services/workspaceClient";
import type { DataStatusNotice } from "../types/sidebar";
import { buildSafeMarkdownFilename, triggerMarkdownDownload } from "../utils/inspectorData";
import { useI18n } from "./useI18n";

export function useDocExport(options: {
  title: string;
  body: string;
  workspace?: WorkspaceSummary;
}): {
  saving: boolean;
  exportFeedback: DataStatusNotice | undefined;
  exportMarkdown: () => Promise<void>;
} {
  const { title, body, workspace }: typeof options = options;
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const [saving, setSaving]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [exportFeedback, setExportFeedback]: [
    DataStatusNotice | undefined,
    Dispatch<SetStateAction<DataStatusNotice | undefined>>
  ] = useState<DataStatusNotice | undefined>(undefined);

  async function exportMarkdown(): Promise<void> {
    if (saving) return;
    const filename: string = buildSafeMarkdownFilename(title, t.doc.defaultFilename);
    if (!workspace) {
      triggerMarkdownDownload(filename, body);
      return;
    }
    setSaving(true);
    setExportFeedback(undefined);
    try {
      const path: string = await exportWorkspaceDocument(workspace, filename, body);
      setExportFeedback({ text: t.doc.exportedTo(path) });
    } catch (error: unknown) {
      setExportFeedback({ text: workspaceErrorText(error), error: true });
    } finally {
      setSaving(false);
    }
  }

  return { saving, exportFeedback, exportMarkdown };
}
