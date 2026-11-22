import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSilver } from "../state/SilverContext";
import { subscribeWorkspaceChanges } from "../model/workspace";

interface EditorProps {
  onOpenSidebar: () => void;
  onOpenAgent: () => void;
  onOpenQuickFiles?: () => void;
  onAttachFile?: (path: string) => void;
  showSidebarButton: boolean;
  showAgentButton: boolean;
}

interface FileTabs {
  paths: string[];
  active: string;
}

const EMPTY_TABS: FileTabs = { paths: [], active: "" };
const LINE_HEIGHT = 20;
const controlClass = "min-h-11 shrink-0 rounded-[10px] px-2 text-[13px] text-secondary hover:bg-fill disabled:opacity-45";

export function Editor({
  onOpenSidebar, onOpenAgent, onOpenQuickFiles, onAttachFile, showSidebarButton, showAgentButton,
}: EditorProps) {
  const { currentThread, filePreview, previewFile, closeFilePreview, openFolder } = useSilver();
  const threadId = currentThread?.id;
  const workspace = currentThread?.workspace;
  const scope = threadId && workspace ? JSON.stringify([threadId, workspace.id]) : "";
  const preview = filePreview && filePreview.threadId === threadId && workspace &&
    workspace.id === filePreview.workspaceId ? filePreview : null;
  const path = preview?.path;
  const body = preview?.body;
  const line = preview?.line;
  const [sessions, setSessions] = useState<Record<string, FileTabs>>({});
  const saved = sessions[scope] ?? EMPTY_TABS;
  const paths = path && !saved.paths.includes(path) ? [...saved.paths, path] : saved.paths;
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  const previousScope = useRef("");
  const previousDocument = useRef("");
  const positions = useRef(new Map<string, { top: number; left: number }>());
  const positionKey = path ? JSON.stringify([scope, path]) : "";

  useLayoutEffect(() => {
    if (!scope || !path) return;
    setSessions((current) => {
      const previous = current[scope] ?? EMPTY_TABS;
      if (previous.active === path) return current;
      const paths = previous.paths.includes(path) ? previous.paths : [...previous.paths, path];
      return { ...current, [scope]: { paths, active: path } };
    });
  }, [scope, path]);

  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    if (threadId && scope && !path && saved.active) void previewFile(threadId, saved.active);
  }, [scope, threadId, path, saved.active, previewFile]);

  useEffect(() => {
    if (!workspace || !threadId || !path) return;
    return subscribeWorkspaceChanges(workspace, () => void previewFile(threadId, path));
  }, [workspace, threadId, path, previewFile]);

  const source = useMemo(() => body?.replace(/\r\n/gu, "\n") ?? "", [body]);
  const { gutter, lineCount } = useMemo(() => {
    const lineCount = source.split("\n").length;
    const gutter = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
    return { gutter, lineCount };
  }, [source]);
  const targetLine = line && Number.isSafeInteger(line) && line > 0 ? Math.min(line, lineCount) : undefined;
  const offsets = useMemo(() => {
    if (!findOpen || !query || !source) return [];
    const literal = query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return Array.from(source.matchAll(new RegExp(literal, "giu")), ({ index }) => index);
  }, [findOpen, query, source]);
  const selection = offsets[Math.min(matchIndex, offsets.length - 1)];

  useLayoutEffect(() => {
    if (previousDocument.current !== positionKey) {
      previousDocument.current = positionKey;
      setFindOpen(false);
      setMatchIndex(0);
    }
    if (!viewport.current || !path || body === undefined) return;
    const scroll = viewport.current;
    if (targetLine) {
      scroll.scrollTop = Math.max(0, (targetLine - 1) * LINE_HEIGHT - scroll.clientHeight / 2);
      scroll.scrollLeft = 0;
    } else {
      const previous = positions.current.get(positionKey);
      scroll.scrollTop = previous?.top ?? 0;
      scroll.scrollLeft = previous?.left ?? 0;
    }
  }, [path, body, targetLine, positionKey]);

  useLayoutEffect(() => {
    if (positionKey) {
      section.current?.querySelector('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [positionKey]);

  useLayoutEffect(() => {
    if (findOpen) mark.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [findOpen, selection, query]);

  function openFind() {
    if (body === undefined) return;
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  }

  function closeFind() {
    setFindOpen(false);
    viewport.current?.focus({ preventScroll: true });
  }

  function stepMatch(change: number) {
    if (!offsets.length) return;
    setMatchIndex((current) => (Math.min(current, offsets.length - 1) + change + offsets.length) % offsets.length);
  }

  function openTab(next: string, focus = false) {
    if (!threadId || next === path) return;
    void previewFile(threadId, next);
    if (focus) {
      tabButton(next)?.focus({ preventScroll: true });
    }
  }

  function tabButton(file: string) {
    return Array.from(section.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
      .find((tab) => tab.getAttribute("aria-label") === file);
  }

  function closeTab(closed: string) {
    const index = paths.indexOf(closed);
    if (index < 0 || !threadId || !scope) return;
    const rest = paths.filter((entry) => entry !== closed);
    const closingActive = (path ?? saved.active) === closed;
    const next = closingActive ? rest[Math.min(index, rest.length - 1)] : saved.active;
    positions.current.delete(JSON.stringify([scope, closed]));
    setSessions((current) => ({ ...current, [scope]: { paths: rest, active: next ?? "" } }));
    if (closingActive) {
      if (next) void previewFile(threadId, next);
      else closeFilePreview();
    }
    if (next && document.activeElement && section.current?.contains(document.activeElement)) {
      tabButton(next)?.focus({ preventScroll: true });
    }
  }

  function handleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return;
    const key = event.key.toLowerCase();
    if (key === "escape" && findOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeFind();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      if (key === "f" && body !== undefined) {
        event.preventDefault();
        openFind();
      } else if (key === "w" && path) {
        event.preventDefault();
        closeTab(path);
      }
      return;
    }
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab" ||
      !["arrowleft", "arrowright", "home", "end"].includes(key) || !paths.length) return;
    const index = Math.max(0, paths.indexOf(path ?? saved.active));
    const next = key === "home" ? 0 : key === "end" ? paths.length - 1
      : (index + (key === "arrowleft" ? -1 : 1) + paths.length) % paths.length;
    event.preventDefault();
    openTab(paths[next], true);
  }

  function fileLabel(value: string) {
    const name = value.split("/").at(-1) ?? value;
    return paths.filter((entry) => entry.split("/").at(-1) === name).length > 1 ? value : name;
  }

  return (
    <section ref={section} aria-label="编辑器" onKeyDown={handleKey} className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-separator px-2">
        <button
          type="button"
          aria-label="切换侧栏"
          onClick={onOpenSidebar}
          className={`${controlClass} ${showSidebarButton ? "" : "min-[960px]:hidden"}`}
        >
          文件
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-secondary" title={path}>
          {path ?? workspace?.name ?? "未打开项目"}
        </span>
        {workspace && onOpenQuickFiles && (
          <button type="button" aria-label="快速打开文件" title="快速打开文件 (Ctrl+P)" onClick={onOpenQuickFiles} className={controlClass}>
            快速打开
          </button>
        )}
        {path && (
          <>
            <button type="button" aria-label="在文件中查找" aria-expanded={findOpen} title="在文件中查找 (Ctrl+F)"
              disabled={body === undefined} onClick={openFind} className={controlClass}>查找</button>
            <button type="button" aria-label="重新读取文件" onClick={() => { if (threadId) void previewFile(threadId, path); }} className={controlClass}>刷新</button>
            {onAttachFile && (
              <button type="button" aria-label="将当前文件添加到对话" disabled={body === undefined} onClick={() => onAttachFile(path)} className={controlClass}>添加到对话</button>
            )}
          </>
        )}
        {showAgentButton && (
          <button type="button" aria-label="打开对话" onClick={onOpenAgent} className={`${controlClass} min-[960px]:hidden`}>
            对话
          </button>
        )}
      </header>
      {paths.length > 0 && (
        <div role="tablist" aria-label="打开的文件" className="flex shrink-0 overflow-x-auto border-b border-separator bg-canvas">
          {paths.map((entry, index) => {
            const selected = entry === (path ?? saved.active);
            return (
              <div key={entry} className={`flex max-w-64 shrink-0 items-center border-r border-separator ${selected ? "bg-group" : ""}`}>
                <button
                  type="button" role="tab" id={`editor-tab-${index}`}
                  tabIndex={selected ? 0 : -1} aria-selected={selected} aria-controls="editor-file"
                  aria-label={entry} title={entry} onClick={() => openTab(entry)}
                  className="min-h-11 min-w-0 truncate px-3 text-left font-mono text-[13px] text-label hover:bg-fill"
                >
                  {fileLabel(entry)}
                </button>
                <button type="button" aria-label={`关闭文件 ${entry}`} title={`关闭文件 ${entry}`}
                  onClick={() => closeTab(entry)} className={`${controlClass} min-w-11`}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {findOpen && path && (
        <div role="search" aria-label="在当前文件查找" className="flex shrink-0 items-center gap-1 border-b border-separator bg-group px-2">
          <input
            ref={findInput} type="search" value={query} aria-label="查找文字" placeholder="查找文字"
            onChange={(event) => { setQuery(event.target.value); setMatchIndex(0); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key !== "Enter") return;
              event.preventDefault();
              stepMatch(event.shiftKey ? -1 : 1);
            }}
            className="min-h-11 min-w-16 flex-1 rounded-[10px] bg-transparent px-2 text-[13px] text-label focus:outline-accent"
          />
          <span role="status" aria-live="polite" className="shrink-0 text-[13px] text-secondary">
            {query && (offsets.length ? `${Math.min(matchIndex + 1, offsets.length)} / ${offsets.length}` : "没有匹配")}
          </span>
          <button type="button" aria-label="上一个匹配" title="上一个匹配 (Shift+Enter)" disabled={!offsets.length} onClick={() => stepMatch(-1)} className={controlClass}>↑</button>
          <button type="button" aria-label="下一个匹配" title="下一个匹配 (Enter)" disabled={!offsets.length} onClick={() => stepMatch(1)} className={controlClass}>↓</button>
          <button type="button" aria-label="关闭查找" onClick={closeFind} className={controlClass}>×</button>
        </div>
      )}
      {path ? (
        <div id="editor-file" role="tabpanel" aria-labelledby={`editor-tab-${paths.indexOf(path)}`} className="flex min-h-0 flex-1">
          {preview.error ? (
            <p role="alert" className="px-4 py-3 text-[13px] text-danger">{preview.error}</p>
          ) : body === undefined ? (
            <p role="status" className="px-4 py-3 text-[13px] text-secondary">正在读取文件…</p>
          ) : (
            <div ref={viewport} tabIndex={0} aria-label={`文件内容 ${path}`}
              onScroll={(event) => positions.current.set(positionKey, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
              className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-3 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent">
              <pre className="relative flex min-w-full w-max font-mono text-[13px] leading-[20px] text-label">
                {targetLine && <span aria-hidden="true" data-editor-line={targetLine} className="pointer-events-none absolute inset-x-0 h-[20px] bg-accent/15"
                  style={{ top: (targetLine - 1) * LINE_HEIGHT }} />}
                <span aria-hidden="true" className="relative select-none pr-4 text-right text-tertiary">{gutter}</span>
                <code className="relative whitespace-pre">
                  {selection === undefined ? source : (
                    <>
                      {source.slice(0, selection)}
                      <mark ref={mark} className="rounded-sm bg-accent/35 text-label">{source.slice(selection, selection + query.length)}</mark>
                      {source.slice(selection + query.length)}
                    </>
                  )}
                </code>
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h1 className="text-[28px] font-semibold text-label">{workspace?.name ?? "打开项目"}</h1>
          <p className="mt-3 max-w-md text-[17px] text-secondary">
            {workspace ? "从文件树或快速打开定位文件。" : "选择一个本地文件夹。对话、差异和检查都发生在这个项目里。"}
          </p>
          {!workspace && (
            <button type="button" onClick={() => void openFolder()}
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-[17px] font-medium text-on-accent">
              打开文件夹
            </button>
          )}
        </div>
      )}
    </section>
  );
}
