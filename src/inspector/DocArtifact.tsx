import { useState } from "react";
import { CopyButton } from "../ui/CopyButton";
import { exportWorkspaceDocument, workspaceErrorText, type WorkspaceSummary } from "../model/workspace";

interface DocArtifactProps {
  title: string;
  body: string;
  kind: "doc" | "findings";
  workspace?: WorkspaceSummary;
  onPatchFinding: (finding: string) => void;
}

function downloadMarkdown(filename: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function findingSections(body: string) {
  const lines = body.split(/\r?\n/u);
  const headings: number[] = [];
  const listItems: number[] = [];
  let codeFence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence) {
      if (!codeFence) codeFence = fence;
      else if (fence.startsWith(codeFence)) codeFence = undefined;
    } else if (!codeFence && /^#{2,6}\s+\S/u.test(line)) {
      headings.push(index);
    } else if (!codeFence && /^(?:[-*+]\s+|\d+[.)]\s+|\d+、\s*)\S/u.test(line)) {
      listItems.push(index);
    }
  }
  const markers = headings.length > 1 || !listItems.length ? headings : listItems;
  if (!markers.length) return body.trim() ? [{ text: body.trim(), finding: true }] : [];
  const introduction = lines.slice(0, markers[0]).join("\n").trim();
  return [
    ...(introduction ? [{ text: introduction, finding: false }] : []),
    ...markers.map((start, index) => ({
      text: lines.slice(start, markers[index + 1]).join("\n").trim(),
      finding: true,
    })),
  ];
}

export function DocArtifact({ title, body, kind, workspace, onPatchFinding }: DocArtifactProps) {
  const [saving, setSaving] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ text: string; error?: boolean }>();

  async function exportMarkdown() {
    if (saving) return;
    const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").trim();
    const base = Array.from(safeTitle.replace(/^\.+|\.+$/gu, "").replace(/\.md$/iu, "")).slice(0, 120).join("").trim();
    const filename = `${base || "Silver 文稿"}.md`;
    if (!workspace) {
      downloadMarkdown(filename, body);
      return;
    }
    setSaving(true);
    setExportFeedback(undefined);
    try {
      const path = await exportWorkspaceDocument(workspace, filename, body);
      setExportFeedback({ text: `已导出 ${path}` });
    } catch (error) {
      setExportFeedback({ text: workspaceErrorText(error), error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[17px] font-semibold wrap-anywhere text-label">{title}</h2>
      {kind === "findings" ? (
        findingSections(body).map((section, index) => (
          <div key={index} className="flex flex-col gap-1">
            <p className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">{section.text}</p>
            {section.finding && (
              <button
                type="button"
                onClick={() => onPatchFinding(section.text)}
                className="min-h-11 self-start rounded-[10px] px-2 text-[13px] text-accent hover:bg-fill"
              >
                收成小补丁
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">{body}</p>
      )}
      {body && (
        <div className="flex flex-wrap items-center gap-x-2">
          <CopyButton text={body} />
          {kind === "doc" && (
            <button
              type="button"
              onClick={() => void exportMarkdown()}
              disabled={saving}
              className="min-h-11 rounded-[10px] px-2 text-[13px] text-accent hover:bg-fill disabled:opacity-50"
            >
              {saving ? "正在导出…" : "导出 Markdown"}
            </button>
          )}
        </div>
      )}
      {exportFeedback && (
        <p role="status" className={`text-[13px] wrap-anywhere ${exportFeedback.error ? "text-danger" : "text-secondary"}`}>
          {exportFeedback.text}
        </p>
      )}
    </article>
  );
}
