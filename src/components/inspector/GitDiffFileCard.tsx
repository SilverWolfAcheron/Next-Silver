import type { ElementContent } from "hast";
import { useMemo } from "react";
import type { JSX } from "react";
import {
  GIT_DIFF_GUTTER_STYLES,
  GIT_DIFF_LINE_STYLES,
  GIT_DIFF_SIGN_STYLES,
  GIT_STATUS_BADGES,
} from "../../constants/git";
import { useDiffHighlight } from "../../hooks/useDiffHighlight";
import { useI18n } from "../../hooks/useI18n";
import type { GitDiffFileCardProps, GitDiffLine, GitStatusBadgeStyle } from "../../types/git";
import { stripDiffPrefixChar } from "../../utils/syntax/diffHighlight";
import { FileTreeIcon } from "../common/FileIcons";
import { renderHastNodes } from "../common/HastNodes";
import { ChevronRightIcon } from "../common/Icons";

const EMPTY_DIFF_LINES: readonly GitDiffLine[] = [];

export function GitDiffFileCard({
  file,
  selected,
  collapsed,
  cardRef,
  onToggleCollapse,
  onOpenFile,
}: GitDiffFileCardProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const badge: GitStatusBadgeStyle = GIT_STATUS_BADGES[file.status];
  const fileName: string = file.path.split("/").pop() ?? file.path;
  const canOpen: boolean = Boolean(onOpenFile && file.status !== "deleted");

  const activeLines: readonly GitDiffLine[] = useMemo(
    (): readonly GitDiffLine[] => (collapsed || file.binary ? EMPTY_DIFF_LINES : file.lines),
    [collapsed, file.binary, file.lines]
  );
  const highlighted: (ElementContent[] | null)[] | null = useDiffHighlight(file.path, activeLines);

  return (
    <section
      ref={cardRef}
      data-diff-path={file.path}
      className={`min-w-0 scroll-mt-3 overflow-hidden rounded-[12px] border bg-group transition-shadow ${
        selected ? "border-accent/65 ring-1 ring-accent/45" : "border-separator"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-separator/80 bg-canvas/70 px-2.5 py-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRightIcon expanded={!collapsed} className="h-3.5 w-3.5 shrink-0 text-secondary" />
          <FileTreeIcon name={fileName} />
          <span
            title={t.gitDiff.statuses[file.status]}
            className={`shrink-0 font-mono text-[11px] font-semibold ${badge.className}`}
          >
            {badge.letter}
          </span>
          <span
            title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            className={`min-w-0 truncate font-mono text-[12.5px] ${
              file.status === "deleted" ? "text-danger/85 line-through" : "text-label"
            }`}
          >
            {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          </span>
        </button>

        <span
          className="flex shrink-0 items-center gap-1.5 font-mono text-[12px] font-medium"
          aria-label={t.diff.statsAriaLabel(file.additions, file.deletions)}
        >
          {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-danger">−{file.deletions}</span>}
        </span>

        {canOpen && onOpenFile && (
          <button
            type="button"
            onClick={(): void => onOpenFile(file.path)}
            className="shrink-0 rounded-[7px] px-2 py-1 text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
          >
            {t.gitDiff.openFile}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="min-w-0">
          {file.binary ? (
            <p className="px-3 py-3 text-[12.5px] text-secondary">{t.gitDiff.binaryFile}</p>
          ) : file.lines.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-secondary">{t.gitDiff.emptyDiff}</p>
          ) : (
            <div className="hljs overflow-x-auto bg-surface/65 py-1 font-mono text-[12.5px] leading-[19px]">
              <table className="w-max min-w-full border-collapse">
                <tbody>
                  {file.lines.map((line: GitDiffLine, index: number): JSX.Element => {
                    const { prefix, code }: { prefix: string; code: string } =
                      stripDiffPrefixChar(line);
                    const tokens: ElementContent[] | null = highlighted?.[index] ?? null;
                    const isMeta: boolean = line.kind === "meta";

                    return (
                      <tr key={index} className={GIT_DIFF_LINE_STYLES[line.kind]}>
                        <td
                          className={`w-10 border-r border-separator/45 px-2 text-right text-[11px] select-none ${GIT_DIFF_GUTTER_STYLES[line.kind]}`}
                        >
                          {line.oldLine ?? ""}
                        </td>
                        <td
                          className={`w-10 border-r border-separator/45 px-2 text-right text-[11px] select-none ${GIT_DIFF_GUTTER_STYLES[line.kind]}`}
                        >
                          {line.newLine ?? ""}
                        </td>
                        <td
                          className={`w-5 text-center select-none ${GIT_DIFF_SIGN_STYLES[line.kind]}`}
                        >
                          {isMeta ? "" : prefix}
                        </td>
                        <td className="pr-3 pl-1.5 whitespace-pre">
                          {isMeta ? (
                            code || "\u00a0"
                          ) : tokens ? (
                            tokens.length > 0 ? (
                              renderHastNodes(tokens, `l${index}`)
                            ) : (
                              "\u00a0"
                            )
                          ) : (
                            code || "\u00a0"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {file.truncated && (
            <p className="border-t border-separator/70 bg-canvas/55 px-3 py-1.5 text-[12px] text-secondary">
              {t.gitDiff.truncatedFile(file.lines.length)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
