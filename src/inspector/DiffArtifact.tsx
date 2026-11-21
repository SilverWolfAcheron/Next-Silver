import { useMemo, useRef, useState } from "react";
import {
  diffNeedsConfirmation, diffPolicyError, parseDiff,
  type DiffLineKind, type FileChange, type FileDecision,
} from "../model/diff";
import type { Artifact, WritePolicy } from "../model/types";
import { workspaceErrorText, type WorkspaceSummary } from "../model/workspace";

interface DiffArtifactProps {
  artifact: Artifact;
  workspace?: WorkspaceSummary;
  writePolicy: WritePolicy;
  onDecision: (path: string, decision: FileDecision) => void;
  onAcceptFile: (path: string, confirmed: boolean) => Promise<void>;
}

const lineStyles: Record<DiffLineKind, string> = {
  added: "bg-success/10 text-label",
  removed: "bg-danger/10 text-danger",
  meta: "text-secondary",
  context: "text-label",
};

const actionClass = "min-h-[44px] rounded-[10px] px-2 text-[13px] hover:bg-fill disabled:opacity-40";

interface PendingAcceptance {
  changes: FileChange[];
  workspaceId: string;
  body: string;
  policy: WritePolicy;
}

export function DiffArtifact({ artifact, workspace, writePolicy, onDecision, onAcceptFile }: DiffArtifactProps) {
  const files = useMemo(() => parseDiff(artifact.body), [artifact.body]);
  const [staged, setStaged] = useState<PendingAcceptance | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const workspaceError = !workspace
    ? "接受差异前，请打开一个工作区文件夹。"
    : artifact.workspaceId && artifact.workspaceId !== workspace.id
      ? "这份差异属于其他工作区。"
      : "";
  const confirmation = staged && staged.workspaceId === workspace?.id &&
    staged.body === artifact.body && staged.policy === writePolicy ? staged.changes : null;
  const available = files.flatMap(({ change }) =>
    change && !decisionFor(change.path) ? [change] : [],
  );
  const writable = available.filter((change) => !diffPolicyError(change, writePolicy));
  const controlsBusy = busy || !!confirmation;

  function decisionFor(path: string): FileDecision | undefined {
    const decision = artifact.fileDecisions?.[path];
    return decision === "accepted" || decision === "rejected" ? decision : undefined;
  }

  async function accept(changes: FileChange[], confirmed = false) {
    if (!workspace || workspaceError || pending.current || !changes.length) return;
    pending.current = true;
    setBusy(true);
    setBatchError("");
    try {
      for (const change of changes) {
        if (decisionFor(change.path) || diffPolicyError(change, writePolicy)) continue;
        const { path } = change;
        try {
          await onAcceptFile(path, confirmed);
          setErrors((current) => ({ ...current, [path]: "" }));
        } catch (error) {
          setErrors((current) => ({ ...current, [path]: workspaceErrorText(error) }));
        }
      }
    } catch (error) {
      setBatchError(workspaceErrorText(error));
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }

  function startAcceptance(changes: FileChange[]) {
    if (!workspace || workspaceError || pending.current || !changes.length) return;
    if (changes.length > 20 || changes.some(diffNeedsConfirmation)) {
      setStaged({ changes, workspaceId: workspace.id, body: artifact.body, policy: writePolicy });
    } else {
      void accept(changes);
    }
  }

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
              className={`${actionClass} text-accent`}
              disabled={controlsBusy || !!workspaceError || writable.length !== available.length}
              onClick={() => startAcceptance(writable)}
            >
              全部接受
            </button>
          )}
          <button
            type="button"
            className={`${actionClass} text-secondary`}
            disabled={controlsBusy}
            onClick={() => available.forEach(({ path }) => onDecision(path, "rejected"))}
          >
            全部拒绝
          </button>
        </div>
      )}
      {confirmation && (
        <div className="rounded-[10px] border border-separator bg-canvas px-2 py-2">
          <p className="text-[13px] text-label">
            {confirmation.length > 20 ? `本次将写入 ${confirmation.length} 个文件。` : ""}
            {confirmation.some(({ operation }) => operation === "delete") ? "含删除文件。" : ""}
            {confirmation.some((change) => change.operation !== "delete" && diffNeedsConfirmation(change)) ? "含锁文件变更。" : ""}
            确认接受并写入「{workspace?.name}」？
          </p>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={`${actionClass} text-accent`}
              onClick={() => {
                setStaged(null);
                void accept(confirmation.filter((file) => writable.includes(file)), true);
              }}
            >
              确认写入
            </button>
            <button type="button" className={`${actionClass} text-secondary`} onClick={() => setStaged(null)}>
              取消
            </button>
          </div>
        </div>
      )}
      {busy && <p role="status" className="px-1 text-[13px] text-secondary">正在写入工作区…</p>}
      {batchError && <p role="alert" className="px-1 text-[13px] text-danger">{batchError}</p>}
      {files.map((file, fileIndex) => {
        const { change } = file;
        const decision = change && decisionFor(change.path);
        const policyError = change && diffPolicyError(change, writePolicy);
        const fileError = change && Object.hasOwn(errors, change.path) ? errors[change.path] : "";
        return (
          <section key={fileIndex} className="min-w-0 overflow-hidden rounded-[10px] border border-separator">
            {(file.path || file.additions > 0 || file.deletions > 0) && (
              <div className="flex items-start justify-between gap-2 border-b border-separator bg-canvas px-2 py-2">
                <span className="text-[13px] wrap-anywhere text-label">{file.path}</span>
                <span
                  className="flex shrink-0 gap-2 font-mono text-[13px]"
                  aria-label={`新增 ${file.additions} 行，删除 ${file.deletions} 行`}
                >
                  <span className="text-secondary">+{file.additions}</span>
                  <span className="text-danger">−{file.deletions}</span>
                </span>
              </div>
            )}
            <pre className="overflow-x-auto py-1 font-mono text-[13px] leading-[18px]">
              {file.lines.map((line, index) => (
                <span key={index} className={`block w-max min-w-full px-2 ${lineStyles[line.kind]}`}>
                  {line.text || "\u00a0"}
                </span>
              ))}
            </pre>
            <div className="border-t border-separator px-2 py-1">
              {file.error && <p className="py-1 text-[13px] text-danger">{file.error}</p>}
              {fileError && <p role="alert" className="py-1 text-[13px] text-danger">{fileError}</p>}
              {decision ? (
                <p className={`py-1 text-[13px] ${decision === "accepted" ? "text-success" : "text-secondary"}`}>
                  {decision === "accepted" ? "已接受" : "已拒绝"}
                </p>
              ) : change && (
                <>
                  {policyError && writePolicy !== "none" && <p className="py-1 text-[13px] text-secondary">{policyError}</p>}
                  <div className="flex flex-wrap gap-1">
                    {writePolicy !== "none" && (
                      <button
                        type="button"
                        className={`${actionClass} text-accent`}
                        disabled={controlsBusy || !!workspaceError || !!policyError}
                        aria-label={`接受 ${change.path}`}
                        onClick={() => startAcceptance([change])}
                      >
                        接受
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${actionClass} text-secondary`}
                      disabled={controlsBusy}
                      aria-label={`拒绝 ${change.path}`}
                      onClick={() => onDecision(change.path, "rejected")}
                    >
                      拒绝
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
