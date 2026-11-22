import { Fragment } from "react";
import type { JSX } from "react";
import { diffNeedsConfirmation, diffPolicyError } from "../../agent-core/diff";
import type { DiffFile, DiffLineKind, FileChange, FileDecision } from "../../agent-core/diff";
import { DIFF_CONFIRM_FILE_THRESHOLD } from "../../constants/inspector";
import { DIFF_ACTION_CLASS, DIFF_LINE_STYLES } from "../../constants/styles";
import { useDiffAcceptance } from "../../hooks/useDiffAcceptance";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { DiffArtifactProps } from "../../types/inspector";

export function DiffArtifact({
  artifact,
  workspace,
  writePolicy,
  onDecision,
  onAcceptFile,
}: DiffArtifactProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const {
    files,
    workspaceError,
    confirmation,
    available,
    writable,
    controlsBusy,
    busy,
    batchError,
    errors,
    decisionFor,
    startAcceptance,
    confirmStaged,
    cancelStaged,
  }: ReturnType<typeof useDiffAcceptance> = useDiffAcceptance({
    artifact,
    workspace,
    writePolicy,
    onAcceptFile,
  });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {writePolicy !== "none" && writable.length > 0 && workspaceError && (
        <p className="px-1 text-[13px] text-secondary">{workspaceError}</p>
      )}

      {available.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {writePolicy !== "none" && (
            <button
              type="button"
              className={`${DIFF_ACTION_CLASS} text-accent`}
              disabled={controlsBusy || Boolean(workspaceError) || writable.length !== available.length}
              onClick={(): void => startAcceptance(writable)}
            >
              {t.diff.acceptAll}
            </button>
          )}
          <button
            type="button"
            className={`${DIFF_ACTION_CLASS} text-secondary`}
            disabled={controlsBusy}
            onClick={(): void =>
              available.forEach(({ path }: FileChange): void => onDecision(path, "rejected"))
            }
          >
            {t.diff.rejectAll}
          </button>
        </div>
      )}

      {confirmation && (
        <div className="rounded-[10px] border border-separator bg-canvas px-2 py-2">
          <p className="text-[13px] text-label">
            {confirmation.length > DIFF_CONFIRM_FILE_THRESHOLD
              ? t.diff.confirmLargeWrite(confirmation.length)
              : ""}
            {confirmation.some(({ operation }: FileChange): boolean => operation === "delete")
              ? t.diff.confirmHasDelete
              : ""}
            {confirmation.some(
              (change: FileChange): boolean =>
                change.operation !== "delete" && diffNeedsConfirmation(change)
            )
              ? t.diff.confirmHasLockfile
              : ""}
            {t.diff.confirmWritePrompt(workspace?.name ?? "")}
          </p>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={`${DIFF_ACTION_CLASS} text-accent`}
              onClick={confirmStaged}
            >
              {t.diff.confirmWriteButton}
            </button>
            <button
              type="button"
              className={`${DIFF_ACTION_CLASS} text-secondary`}
              onClick={cancelStaged}
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {busy && (
        <p role="status" className="px-1 text-[13px] text-secondary">
          {t.diff.writingWorkspace}
        </p>
      )}
      {batchError && (
        <p role="alert" className="px-1 text-[13px] text-danger">
          {formatError(batchError, t)}
        </p>
      )}

      {files.map((file: DiffFile, fileIndex: number): JSX.Element => {
        const { change }: DiffFile = file;
        const decision: FileDecision | undefined = change ? decisionFor(change.path) : undefined;
        const policyError: string | undefined = change
          ? diffPolicyError(change, writePolicy)
          : undefined;
        const fileError: string =
          change && Object.hasOwn(errors, change.path) ? errors[change.path] : "";

        return (
          <section key={fileIndex} className="min-w-0 overflow-hidden rounded-[10px] border border-separator">
            {(file.path || file.additions > 0 || file.deletions > 0) && (
              <div className="flex items-start justify-between gap-2 border-b border-separator bg-canvas px-2 py-2">
                <span className="text-[13px] wrap-anywhere text-label">{file.path}</span>
                <span
                  className="flex shrink-0 gap-2 font-mono text-[13px]"
                  aria-label={t.diff.statsAriaLabel(file.additions, file.deletions)}
                >
                  <span className="text-secondary">+{file.additions}</span>
                  <span className="text-danger">−{file.deletions}</span>
                </span>
              </div>
            )}

            <pre className="overflow-x-auto py-1 font-mono text-[13px] leading-[18px]">
              {file.lines.map(
                (line: { text: string; kind: DiffLineKind }, index: number): JSX.Element => (
                  <span
                    key={index}
                    className={`block w-max min-w-full px-2 ${DIFF_LINE_STYLES[line.kind]}`}
                  >
                    {line.text || "\u00a0"}
                  </span>
                )
              )}
            </pre>

            <div className="border-t border-separator px-2 py-1">
              {file.error && <p className="py-1 text-[13px] text-danger">{formatError(file.error, t)}</p>}
              {fileError && (
                <p role="alert" className="py-1 text-[13px] text-danger">
                  {formatError(fileError, t)}
                </p>
              )}
              {decision ? (
                <p
                  className={`py-1 text-[13px] ${
                    decision === "accepted" ? "text-success" : "text-secondary"
                  }`}
                >
                  {decision === "accepted" ? t.diff.accepted : t.diff.rejected}
                </p>
              ) : (
                change && (
                  <Fragment>
                    {policyError && writePolicy !== "none" && (
                      <p className="py-1 text-[13px] text-secondary">{formatError(policyError, t)}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {writePolicy !== "none" && (
                        <button
                          type="button"
                          className={`${DIFF_ACTION_CLASS} text-accent`}
                          disabled={controlsBusy || Boolean(workspaceError) || Boolean(policyError)}
                          aria-label={t.diff.acceptFileLabel(change.path)}
                          onClick={(): void => startAcceptance([change])}
                        >
                          {t.diff.accept}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${DIFF_ACTION_CLASS} text-secondary`}
                        disabled={controlsBusy}
                        aria-label={t.diff.rejectFileLabel(change.path)}
                        onClick={(): void => onDecision(change.path, "rejected")}
                      >
                        {t.diff.reject}
                      </button>
                    </div>
                  </Fragment>
                )
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
