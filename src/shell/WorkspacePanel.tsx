import { useEffect, useState } from "react";
import {
  listWorkspace, requestWorkspaceAccess, selectWorkspace, subscribeWorkspaceChanges, workspaceErrorText, workspaceSupported,
  WORKSPACE_PATH_MIME, WorkspaceAccessError, type WorkspaceEntry, type WorkspaceSummary,
} from "../model/workspace";

interface WorkspacePanelProps {
  workspace?: WorkspaceSummary;
  selectedPath?: string;
  onBind: (workspace: WorkspaceSummary) => void;
  onPreview: (path: string) => void;
}

export function WorkspacePanel({ workspace, selectedPath, onBind, onPreview }: WorkspacePanelProps) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const supported = workspaceSupported();

  async function bind() {
    setOpening(true);
    setOpenError("");
    try {
      onBind(await selectWorkspace());
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setOpenError(workspaceErrorText(error));
      }
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="text-[13px]">
      <div className="flex min-w-0 items-center gap-1 px-1">
        {workspace && <span className="min-w-0 flex-1 truncate px-2 text-label" title={workspace.path ?? workspace.name}>{workspace.name}</span>}
        <button
          type="button"
          disabled={opening || !supported}
          onClick={() => void bind()}
          className="min-h-[44px] shrink-0 rounded-[10px] px-2 text-accent hover:bg-fill disabled:opacity-50"
        >
          {opening ? "正在打开…" : workspace ? "更换文件夹" : "打开文件夹"}
        </button>
      </div>
      {!supported && <p className="px-2 pb-2 text-secondary">请在 Silver 桌面程序里打开本地文件夹。</p>}
      {openError && <p role="status" className="px-2 pb-2 text-danger">{openError}</p>}
      {workspace && supported && (
        <WorkspaceTree key={workspace.id} workspace={workspace} selectedPath={selectedPath} onPreview={onPreview} />
      )}
    </div>
  );
}

interface WorkspaceTreeProps {
  workspace: WorkspaceSummary;
  path?: string;
  selectedPath?: string;
  onPreview: (path: string) => void;
}

type Listing =
  | { state: "loading" }
  | { state: "ready"; entries: WorkspaceEntry[] }
  | { state: "error"; text: string; canReconnect: boolean };

function WorkspaceTree({ workspace, path, selectedPath, onPreview }: WorkspaceTreeProps) {
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => subscribeWorkspaceChanges(workspace, () => setRefresh((previous) => previous + 1)), [workspace.id]);

  useEffect(() => {
    let active = true;
    setListing((previous) => previous.state === "ready" ? previous : { state: "loading" });
    void listWorkspace(workspace, path).then(
      (entries) => { if (active) setListing({ state: "ready", entries }); },
      (error: unknown) => {
        if (active) setListing({
          state: "error",
          text: workspaceErrorText(error),
          canReconnect: error instanceof WorkspaceAccessError && error.reason === "permission",
        });
      },
    );
    return () => { active = false; };
  }, [workspace.id, workspace.name, path, refresh]);

  async function reconnect() {
    setReconnecting(true);
    try {
      await requestWorkspaceAccess(workspace);
      setRefresh((previous) => previous + 1);
    } catch (error) {
      setListing({ state: "error", text: workspaceErrorText(error), canReconnect: true });
    } finally {
      setReconnecting(false);
    }
  }

  if (listing.state === "loading") return <p role="status" className="px-2 pb-2 text-secondary">正在读取文件夹…</p>;
  if (listing.state === "error") return (
    <div className="px-2 pb-2 text-danger">
      <p role="status">{listing.text}</p>
      {listing.canReconnect && (
        <button type="button" disabled={reconnecting} className="min-h-[44px] text-accent hover:underline" onClick={() => void reconnect()}>
          {reconnecting ? "正在连接…" : "重新授权"}
        </button>
      )}
    </div>
  );
  if (listing.entries.length === 0) return <p className="px-2 pb-2 text-secondary">文件夹为空。</p>;

  return (
    <ul className="flex min-w-0 flex-col">
      {listing.entries.map((entry) => (
        <WorkspaceTreeRow key={entry.path} workspace={workspace} entry={entry} selectedPath={selectedPath} onPreview={onPreview} />
      ))}
    </ul>
  );
}

function WorkspaceTreeRow({ workspace, entry, selectedPath, onPreview }: {
  workspace: WorkspaceSummary;
  entry: WorkspaceEntry;
  selectedPath?: string;
  onPreview: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const directory = entry.kind === "directory";

  return (
    <li>
      <button
        type="button"
        aria-expanded={directory ? expanded : undefined}
        draggable={!directory}
        title={entry.path}
        onClick={() => directory ? setExpanded(!expanded) : onPreview(entry.path)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(WORKSPACE_PATH_MIME, entry.path);
        }}
        className={`flex min-h-[44px] w-full min-w-0 items-center gap-1.5 rounded-[10px] px-2 text-left hover:bg-fill ${entry.path === selectedPath ? "bg-fill text-label" : "text-label"}`}
      >
        {directory && <span aria-hidden="true" className="shrink-0 text-secondary">{expanded ? "▾" : "▸"}</span>}
        <span className="min-w-0 truncate">{entry.name}</span>
      </button>
      {expanded && (
        <div className="ml-2 border-l border-separator pl-1">
          <WorkspaceTree workspace={workspace} path={entry.path} selectedPath={selectedPath} onPreview={onPreview} />
        </div>
      )}
    </li>
  );
}
