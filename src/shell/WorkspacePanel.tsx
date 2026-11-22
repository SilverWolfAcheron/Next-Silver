import { useEffect, useMemo, useState } from "react";
import {
  listWorkspace, requestWorkspaceAccess, selectWorkspace, subscribeWorkspaceChanges, workspaceErrorText, workspaceSupported,
  WORKSPACE_PATH_MIME, WorkspaceAccessError, type WorkspaceEntry, type WorkspaceSummary,
} from "../model/workspace";

interface WorkspacePanelProps {
  workspace?: WorkspaceSummary;
  selectedPath?: string;
  onBind: (workspace: WorkspaceSummary) => void;
  onPreview: (path: string) => void;
  onSearchText?: () => void;
}

const iconButtonClass =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-secondary hover:bg-fill hover:text-label disabled:opacity-40";

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function fileAccentClass(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "text-sky-600 dark:text-sky-400";
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "text-amber-600 dark:text-amber-400";
  }
  if (lower.endsWith(".go")) return "text-cyan-600 dark:text-cyan-400";
  if (lower.endsWith(".mod") || lower.endsWith(".sum")) return "text-teal-600/80 dark:text-teal-400/80";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "text-violet-600 dark:text-violet-400";
  if (lower.endsWith(".rs")) return "text-orange-600 dark:text-orange-400";
  if (lower.endsWith(".json") || lower.endsWith(".toml") || lower.endsWith(".yml") || lower.endsWith(".yaml")) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return "text-indigo-500 dark:text-indigo-400";
  if (lower.endsWith(".html") || lower.endsWith(".xml") || lower.endsWith(".svg")) return "text-rose-500 dark:text-rose-400";
  if (lower.endsWith(".py")) return "text-teal-600 dark:text-teal-400";
  if (lower.endsWith(".md")) return "text-sky-700/80 dark:text-sky-300/80";
  if (lower.startsWith(".") || lower.endsWith(".lock") || lower.endsWith(".log")) return "text-tertiary";
  return "text-secondary";
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 text-secondary transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-amber-600/85 dark:text-amber-400/80">
        <path
          d="M1.75 3.75A1.25 1.25 0 0 1 3 2.5h2.7a1.25 1.25 0 0 1 .92.4l.83.9H13a1.25 1.25 0 0 1 1.25 1.25V6H2.75l-1 6.5V3.75Z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M2.2 12.75 3.3 6.5h11.15l-1.15 5.45a1.1 1.1 0 0 1-1.08.8H2.2Z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-amber-600/80 dark:text-amber-400/75">
      <path
        d="M2 4a1.25 1.25 0 0 1 1.25-1.25h2.65a1.25 1.25 0 0 1 .93.42l.82.93H12.75A1.25 1.25 0 0 1 14 5.35v6.4A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75V4Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon({ name }: { name: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={`h-4 w-4 shrink-0 ${fileAccentClass(name)}`}>
      <path
        d="M4 2.25h5.2L12.75 5.8v7.95a.75.75 0 0 1-.75.75H4a.75.75 0 0 1-.75-.75V3a.75.75 0 0 1 .75-.75Z"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 2.5v3.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function WorkspacePanel({ workspace, selectedPath, onBind, onPreview, onSearchText }: WorkspacePanelProps) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [sectionOpen, setSectionOpen] = useState(true);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [collapseEpoch, setCollapseEpoch] = useState(0);
  const supported = workspaceSupported();

  async function bind() {
    setOpening(true);
    setOpenError("");
    try {
      onBind(await selectWorkspace());
      setSectionOpen(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setOpenError(workspaceErrorText(error));
      }
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[13px]">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-separator px-2.5 select-none">
        <button
          type="button"
          aria-expanded={sectionOpen}
          onClick={() => setSectionOpen((open) => !open)}
          title={workspace?.path ?? workspace?.name ?? "资源管理器"}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[5px] py-1 text-left text-[12px] font-semibold tracking-wider text-secondary uppercase hover:text-label"
        >
          <ChevronIcon expanded={sectionOpen} />
          <span className="min-w-0 truncate">{workspace ? workspace.name : "资源管理器"}</span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {workspace && supported && (
            <>
              {onSearchText && (
                <button
                  type="button"
                  aria-label="在工作区搜索内容"
                  title="在工作区搜索内容 (Ctrl+Shift+F)"
                  onClick={onSearchText}
                  className={iconButtonClass}
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
                    <circle cx="7.25" cy="7.25" r="4.25" stroke="currentColor" strokeWidth="1.35" />
                    <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                aria-label="刷新文件树"
                title="刷新文件树"
                onClick={() => setRefreshEpoch((n) => n + 1)}
                className={iconButtonClass}
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
                  <path d="M13 8a5 5 0 1 1-1.35-3.42M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="全部折叠"
                title="全部折叠"
                onClick={() => setCollapseEpoch((n) => n + 1)}
                className={iconButtonClass}
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
                  <path d="M3.5 5.5h9M5 8.5l3-2.5 3 2.5M5 12l3-2.5 3 2.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          <button
            type="button"
            disabled={opening || !supported}
            aria-label={workspace ? "更换文件夹" : "打开文件夹"}
            title={workspace ? "更换文件夹" : "打开文件夹"}
            onClick={() => void bind()}
            className={iconButtonClass}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
              <path d="M2 4.25A1.25 1.25 0 0 1 3.25 3h2.6l1.3 1.4h5.6A1.25 1.25 0 0 1 14 5.65v6.1A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75v-7.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {sectionOpen && (
        <div className="group/tree min-h-0 flex-1 overflow-y-auto py-1">
          {!supported && <p className="px-3 py-2 text-[12px] text-secondary">请在 Silver 桌面程序里打开本地文件夹。</p>}
          {openError && <p role="status" className="px-3 py-1.5 text-[12px] text-danger">{openError}</p>}
          {workspace && supported ? (
            <WorkspaceTree
              key={`${workspace.id}:${collapseEpoch}`}
              workspace={workspace}
              depth={0}
              refreshEpoch={refreshEpoch}
              selectedPath={selectedPath}
              onPreview={onPreview}
            />
          ) : supported && (
            <div className="flex flex-col gap-2 px-3 py-3">
              <p className="text-[12px] leading-5 text-secondary">尚未打开文件夹。</p>
              <button
                type="button"
                disabled={opening}
                onClick={() => void bind()}
                className="flex h-8 w-full items-center justify-center rounded-[6px] bg-accent px-3 text-[12px] font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                {opening ? "正在打开…" : "打开文件夹"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface WorkspaceTreeProps {
  workspace: WorkspaceSummary;
  path?: string;
  depth: number;
  refreshEpoch: number;
  selectedPath?: string;
  onPreview: (path: string) => void;
}

type Listing =
  | { state: "loading" }
  | { state: "ready"; entries: WorkspaceEntry[] }
  | { state: "error"; text: string; canReconnect: boolean };

function WorkspaceTree({ workspace, path, depth, refreshEpoch, selectedPath, onPreview }: WorkspaceTreeProps) {
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
  }, [workspace.id, workspace.name, path, refresh, refreshEpoch]);

  const sorted = useMemo(
    () => (listing.state === "ready" ? sortEntries(listing.entries) : []),
    [listing],
  );

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

  if (listing.state === "loading") {
    return (
      <p role="status" style={{ paddingLeft: `${depth * 12 + 24}px` }} className="py-1 text-[12px] text-tertiary">
        正在读取…
      </p>
    );
  }
  if (listing.state === "error") return (
    <div style={{ paddingLeft: `${depth * 12 + 12}px` }} className="pr-2 py-1 text-[12px] text-danger">
      <p role="status">{listing.text}</p>
      {listing.canReconnect && (
        <button type="button" disabled={reconnecting} className="mt-1 h-7 text-accent hover:underline" onClick={() => void reconnect()}>
          {reconnecting ? "正在连接…" : "重新授权"}
        </button>
      )}
    </div>
  );
  if (sorted.length === 0) {
    return depth === 0 ? <p className="px-3 py-1.5 text-[12px] text-tertiary">文件夹为空。</p> : null;
  }

  return (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? workspace.name : undefined} className="flex min-w-0 flex-col">
      {sorted.map((entry) => (
        <WorkspaceTreeRow
          key={entry.path}
          workspace={workspace}
          entry={entry}
          depth={depth}
          refreshEpoch={refreshEpoch}
          selectedPath={selectedPath}
          onPreview={onPreview}
        />
      ))}
    </ul>
  );
}

function WorkspaceTreeRow({ workspace, entry, depth, refreshEpoch, selectedPath, onPreview }: {
  workspace: WorkspaceSummary;
  entry: WorkspaceEntry;
  depth: number;
  refreshEpoch: number;
  selectedPath?: string;
  onPreview: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const directory = entry.kind === "directory";
  const selected = !directory && entry.path === selectedPath;

  return (
    <li role="treeitem" aria-expanded={directory ? expanded : undefined} aria-selected={selected || undefined} className="min-w-0">
      <button
        type="button"
        draggable={!directory}
        title={entry.path}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => (directory ? setExpanded((open) => !open) : onPreview(entry.path))}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(WORKSPACE_PATH_MIME, entry.path);
        }}
        className={`relative flex h-[24px] w-full min-w-0 items-center gap-1.5 pr-2 text-left text-[13px] leading-[24px] select-none transition-colors ${
          selected
            ? "bg-fill font-medium text-label before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent"
            : "text-label/90 hover:bg-fill/60 hover:text-label"
        }`}
      >
        {depth > 0 && Array.from({ length: depth }, (_, level) => (
          <span
            key={level}
            aria-hidden="true"
            style={{ left: `${level * 12 + 14}px` }}
            className="pointer-events-none absolute inset-y-0 w-px bg-separator/55 group-hover/tree:bg-separator"
          />
        ))}
        {directory ? <ChevronIcon expanded={expanded} /> : <span aria-hidden="true" className="w-3.5 shrink-0" />}
        {directory ? <FolderIcon open={expanded} /> : <FileIcon name={entry.name} />}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {directory && expanded && (
        <WorkspaceTree
          workspace={workspace}
          path={entry.path}
          depth={depth + 1}
          refreshEpoch={refreshEpoch}
          selectedPath={selectedPath}
          onPreview={onPreview}
        />
      )}
    </li>
  );
}
