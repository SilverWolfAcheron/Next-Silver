import type { JSX } from "react";
import { useDocExport } from "../../hooks/useDocExport";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { DocArtifactProps, FindingSection } from "../../types/inspector";
import { splitFindingSections } from "../../utils/inspectorData";
import { CopyButton } from "../common/CopyButton";

export function DocArtifact({
  title,
  body,
  kind,
  workspace,
  onPatchFinding,
}: DocArtifactProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const { saving, exportFeedback, exportMarkdown }: ReturnType<typeof useDocExport> = useDocExport({
    title,
    body,
    workspace,
  });

  return (
    <article className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[17px] font-semibold wrap-anywhere text-label">{title}</h2>

      {kind === "findings" ? (
        splitFindingSections(body).map((section: FindingSection, index: number): JSX.Element => (
          <div key={index} className="flex flex-col gap-1">
            <p className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">
              {section.text}
            </p>
            {section.finding && (
              <button
                type="button"
                onClick={(): void => onPatchFinding(section.text)}
                className="min-h-11 self-start rounded-[10px] px-2 text-[13px] text-accent hover:bg-fill"
              >
                {t.doc.patchFinding}
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="text-[17px] leading-[22px] wrap-anywhere whitespace-pre-wrap text-label">
          {body}
        </p>
      )}

      {body && (
        <div className="flex flex-wrap items-center gap-x-2">
          <CopyButton text={body} />
          {kind === "doc" && (
            <button
              type="button"
              onClick={(): void => {
                void exportMarkdown();
              }}
              disabled={saving}
              className="min-h-11 rounded-[10px] px-2 text-[13px] text-accent hover:bg-fill disabled:opacity-50"
            >
              {saving ? t.doc.exporting : t.doc.exportMarkdown}
            </button>
          )}
        </div>
      )}

      {exportFeedback && (
        <p
          role="status"
          className={`text-[13px] wrap-anywhere ${
            exportFeedback.error ? "text-danger" : "text-secondary"
          }`}
        >
          {exportFeedback.error ? formatError(exportFeedback.text, t) : exportFeedback.text}
        </p>
      )}
    </article>
  );
}
