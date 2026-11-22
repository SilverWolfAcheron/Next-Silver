import { useMemo, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DiffFile, FileChange, FileDecision } from "../types/diff";
import {
  diffNeedsConfirmation,
  diffPolicyError,
  parseDiff,
} from "../utils/diff";
import type { Artifact, WorkspaceSummary, WritePolicy } from "../agent-core/types";
import { DIFF_CONFIRM_FILE_THRESHOLD } from "../constants/inspector";
import { workspaceErrorText } from "../services/workspaceClient";
import type { PendingAcceptance } from "../types/inspector";
import { useI18n } from "./useI18n";

export function useDiffAcceptance(options: {
  artifact: Artifact;
  workspace?: WorkspaceSummary;
  writePolicy: WritePolicy;
  onAcceptFile: (path: string, confirmed: boolean) => Promise<void>;
}): {
  files: DiffFile[];
  workspaceError: string;
  confirmation: FileChange[] | null;
  available: FileChange[];
  writable: FileChange[];
  controlsBusy: boolean;
  busy: boolean;
  batchError: string;
  errors: Record<string, string>;
  decisionFor: (path: string) => FileDecision | undefined;
  startAcceptance: (changes: FileChange[]) => void;
  confirmStaged: () => void;
  cancelStaged: () => void;
} {
  const { artifact, workspace, writePolicy, onAcceptFile }: typeof options = options;
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const files: DiffFile[] = useMemo((): DiffFile[] => parseDiff(artifact.body), [artifact.body]);
  const [staged, setStaged]: [
    PendingAcceptance | null,
    Dispatch<SetStateAction<PendingAcceptance | null>>
  ] = useState<PendingAcceptance | null>(null);
  const pendingRef: RefObject<boolean> = useRef<boolean>(false);
  const [busy, setBusy]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [batchError, setBatchError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [errors, setErrors]: [
    Record<string, string>,
    Dispatch<SetStateAction<Record<string, string>>>
  ] = useState<Record<string, string>>({});

  const workspaceError: string = !workspace
    ? t.diff.openWorkspaceFirst
    : artifact.workspaceId && artifact.workspaceId !== workspace.id
      ? t.diff.foreignWorkspace
      : "";

  const confirmation: FileChange[] | null =
    staged &&
    staged.workspaceId === workspace?.id &&
    staged.body === artifact.body &&
    staged.policy === writePolicy
      ? staged.changes
      : null;

  function decisionFor(path: string): FileDecision | undefined {
    const decision: "accepted" | "rejected" | undefined = artifact.fileDecisions?.[path];
    return decision === "accepted" || decision === "rejected" ? decision : undefined;
  }

  const available: FileChange[] = files.flatMap(({ change }: DiffFile): FileChange[] =>
    change && !decisionFor(change.path) ? [change] : []
  );
  const writable: FileChange[] = available.filter(
    (change: FileChange): boolean => !diffPolicyError(change, writePolicy)
  );
  const controlsBusy: boolean = busy || Boolean(confirmation);

  async function accept(changes: FileChange[], confirmed: boolean = false): Promise<void> {
    if (!workspace || workspaceError || pendingRef.current || !changes.length) return;
    pendingRef.current = true;
    setBusy(true);
    setBatchError("");
    try {
      for (const change of changes) {
        if (decisionFor(change.path) || diffPolicyError(change, writePolicy)) continue;
        const { path }: FileChange = change;
        try {
          await onAcceptFile(path, confirmed);
          setErrors((current: Record<string, string>): Record<string, string> => ({
            ...current,
            [path]: "",
          }));
        } catch (error: unknown) {
          setErrors((current: Record<string, string>): Record<string, string> => ({
            ...current,
            [path]: workspaceErrorText(error),
          }));
        }
      }
    } catch (error: unknown) {
      setBatchError(workspaceErrorText(error));
    } finally {
      setBusy(false);
      pendingRef.current = false;
    }
  }

  function startAcceptance(changes: FileChange[]): void {
    if (!workspace || workspaceError || pendingRef.current || !changes.length) return;
    if (changes.length > DIFF_CONFIRM_FILE_THRESHOLD || changes.some(diffNeedsConfirmation)) {
      setStaged({ changes, workspaceId: workspace.id, body: artifact.body, policy: writePolicy });
    } else {
      void accept(changes);
    }
  }

  function confirmStaged(): void {
    if (!confirmation) return;
    setStaged(null);
    void accept(
      confirmation.filter((file: FileChange): boolean => writable.includes(file)),
      true
    );
  }

  function cancelStaged(): void {
    setStaged(null);
  }

  return {
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
  };
}
