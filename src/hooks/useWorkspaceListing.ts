import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AppError, ERROR_CODES } from "../agent-core/errors";
import type { WorkspaceEntry, WorkspaceSummary } from "../agent-core/types";
import { logError } from "../i18n/errors";
import {
  listWorkspace,
  requestWorkspaceAccess,
  subscribeWorkspaceChanges,
  WorkspaceAccessError,
  workspaceErrorText,
} from "../services/workspaceClient";
import type { WorkspaceListing } from "../types/workspace";
import { sortWorkspaceEntries } from "../utils/workspaceData";

export function useWorkspaceListing(options: {
  workspace: WorkspaceSummary;
  path?: string;
  refreshEpoch: number;
}): {
  listing: WorkspaceListing;
  sorted: WorkspaceEntry[];
  reconnecting: boolean;
  reconnect: () => Promise<void>;
} {
  const { workspace, path, refreshEpoch }: typeof options = options;
  const [listing, setListing]: [WorkspaceListing, Dispatch<SetStateAction<WorkspaceListing>>] =
    useState<WorkspaceListing>({ state: "loading" });
  const [refresh, setRefresh]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const [reconnecting, setReconnecting]: [boolean, Dispatch<SetStateAction<boolean>>] =
    useState<boolean>(false);

  useEffect(
    (): (() => void) =>
      subscribeWorkspaceChanges(workspace, (): void =>
        setRefresh((previous: number): number => previous + 1)
      ),
    [workspace.id]
  );

  useEffect((): (() => void) => {
    let active: boolean = true;
    setListing((previous: WorkspaceListing): WorkspaceListing =>
      previous.state === "ready" ? previous : { state: "loading" }
    );
    void listWorkspace(workspace, path).then(
      (entries: WorkspaceEntry[]): void => {
        if (active) setListing({ state: "ready", entries });
      },
      (error: unknown): void => {
        if (active) {
          logError(error, undefined, ERROR_CODES.WORKSPACE_ACCESS_FAILED);
          setListing({
            state: "error",
            text: workspaceErrorText(error),
            canReconnect:
              (error instanceof WorkspaceAccessError && error.reason === "permission") ||
              (error instanceof AppError && error.code === ERROR_CODES.WORKSPACE_PERMISSION_DENIED),
          });
        }
      }
    );
    return (): void => {
      active = false;
    };
  }, [workspace.id, workspace.name, path, refresh, refreshEpoch]);

  const sorted: WorkspaceEntry[] = useMemo(
    (): WorkspaceEntry[] => (listing.state === "ready" ? sortWorkspaceEntries(listing.entries) : []),
    [listing]
  );

  async function reconnect(): Promise<void> {
    setReconnecting(true);
    try {
      await requestWorkspaceAccess(workspace);
      setRefresh((previous: number): number => previous + 1);
    } catch (error: unknown) {
      setListing({ state: "error", text: workspaceErrorText(error), canReconnect: true });
    } finally {
      setReconnecting(false);
    }
  }

  return { listing, sorted, reconnecting, reconnect };
}
