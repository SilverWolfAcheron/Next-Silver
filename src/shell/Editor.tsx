import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSilverStore, type EditorTabState } from "../state/silverStore";
import { detectLanguage, highlightSource, languageLabel } from "../model/highlight";
import { subscribeWorkspaceChanges } from "../model/workspace";
import { CodeView } from "./CodeView";

interface EditorProps {
  onOpenSidebar?: () => void;
  onOpenAgent?: () => void;
  onOpenQuickFiles?: () => void;
  onAttachFile?: (path: string) => void;
  onAllTabsClosed?: () => void;
  showSidebarButton?: boolean;
  showAgentButton?: boolean;
  embedded?: boolean;
}

const EMPTY_TABS: EditorTabState = { paths: [], active: "" };
const LINE_HEIGHT = 20;
const controlClass = "h-8 shrink-0 rounded-[7px] px-2 text-[12px] text-secondary hover:bg-fill hover:text-label disabled:opacity-45";

export function Editor({
  onOpenSidebar,
  onOpenAgent,
  onOpenQuickFiles,
  onAttachFile,
  onAllTabsClosed,
  showSidebarButton = false,
  showAgentButton = false,
  embedded = false,
}: EditorProps) {
  const currentThread = useSilverStore((s) => s.currentThread);
  const filePreview = useSilverStore((s) => s.filePreview);
  const editorTabs = useSilverStore((s) => s.editorTabs);
  const previewFile = useSilverStore((s) => s.previewFile);
  const closeFilePreview = useSilverStore((s) => s.closeFilePreview);
  const openFolder = useSilverStore((s) => s.openFolder);
  const ensureEditorTab = useSilverStore((s) => s.ensureEditorTab);
  const closeEditorTab = useSilverStore((s) => s.closeEditorTab);

  const threadId = currentThread?.id;
  const workspace = currentThread?.workspace;
  const scope = threadId && workspace ? JSON.stringify([threadId, workspace.id]) : "";
  const preview = filePreview && filePreview.threadId === threadId && workspace &&
    workspace.id === filePreview.workspaceId ? filePreview : null;
  const path = preview?.path;
  const body = preview?.body;
  const line = preview?.line;
  const saved = editorTabs[scope] ?? EMPTY_TABS;
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
    ensureEditorTab(scope, path);
  }, [scope, path, ensureEditorTab]);

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
  const highlighted = useMemo(() => highlightSource(source, path), [source, path]);
  const detectedLabel = useMemo(
    () => highlighted?.label ?? (path ? languageLabel(detectLanguage(path, source), path) : null),
    [highlighted, path, source],
  );
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
    if (!threadId || !scope) return;
    positions.current.delete(JSON.stringify([scope, closed]));
    const { next, closingActive } = closeEditorTab(scope, closed);
    if (closingActive) {
      if (next) void previewFile(threadId, next);
      else {
        closeFilePreview();
        onAllTabsClosed?.();
      }
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
    <section ref={section} aria-label="编辑器" onKeyDown={handleKey} className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {paths.length > 0 && (
        <div role="tablist" aria-label="打开的文件" className="flex shrink-0 overflow-x-auto border-b border-separator bg-canvas">
          {paths.map((entry, index) => {
            const selected = entry === (path ?? saved.active);
            return (
              <div
                key={entry}
                className={`relative flex h-9 max-w-64 shrink-0 items-center border-r border-separator pr-1.5 transition-colors ${
                  selected ? "bg-surface text-label" : "bg-canvas text-secondary hover:bg-fill/45 hover:text-label"
                }`}
              >
                {selected && (
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-accent" />
                )}
                <button
                  type="button" role="tab" id={`editor-tab-${index}`}
                  tabIndex={selected ? 0 : -1} aria-selected={selected} aria-controls="editor-file"
                  aria-label={entry} title={entry} onClick={() => openTab(entry)}
                  className="h-full min-w-0 truncate pl-3 pr-1.5 text-left font-mono text-[12px] text-inherit outline-none focus-visible:underline"
                >
                  {fileLabel(entry)}
                </button>
                <button
                  type="button"
                  aria-label={`关闭文件 ${entry}`}
                  title={`关闭文件 ${entry}`}
                  onClick={() => closeTab(entry)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-tertiary transition-colors hover:bg-fill hover:text-label"
                >
                  <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className="h-3 w-3">
                    <path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-separator px-3">
        {!embedded && onOpenSidebar && (
          <button
            type="button"
            aria-label="切换侧栏"
            onClick={onOpenSidebar}
            className={`${controlClass} ${showSidebarButton ? "" : "min-[960px]:hidden"}`}
          >
            文件
          </button>
        )}
        <span className="min-w-0 truncate font-mono text-[12px] text-secondary" title={path}>
          {path ?? workspace?.name ?? "未打开项目"}
        </span>
        {path && (
          <div className="flex shrink-0 items-center gap-0.5 pl-1">
            <button type="button" aria-label="在文件中查找" aria-expanded={findOpen} title="在文件中查找 (Ctrl+F)"
              disabled={body === undefined} onClick={openFind} className={controlClass}>查找</button>
            <button type="button" aria-label="重新读取文件" onClick={() => { if (threadId) void previewFile(threadId, path); }} className={controlClass}>刷新</button>
            {onAttachFile && (
              <button type="button" aria-label="将当前文件添加到对话" disabled={body === undefined} onClick={() => onAttachFile(path)} className={controlClass}>添加到对话</button>
            )}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {path && detectedLabel && (
            <span
              aria-label={`语法高亮 ${detectedLabel}`}
              className="hidden shrink-0 rounded-[5px] bg-fill/75 px-1.5 py-0.5 font-mono text-[11px] text-secondary sm:inline"
            >
              {detectedLabel}
            </span>
          )}
          {!embedded && showAgentButton && onOpenAgent && (
            <button type="button" aria-label="打开对话" onClick={onOpenAgent} className={`${controlClass} min-[960px]:hidden`}>
              对话
            </button>
          )}
        </div>
      </header>
      {findOpen && path && (
        <div role="search" aria-label="在当前文件查找" className="flex shrink-0 items-center gap-1 border-b border-separator bg-group px-2 py-1">
          <input
            ref={findInput} type="search" value={query} aria-label="查找文字" placeholder="查找文字"
            onChange={(event) => { setQuery(event.target.value); setMatchIndex(0); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key !== "Enter") return;
              event.preventDefault();
              stepMatch(event.shiftKey ? -1 : 1);
            }}
            className="h-8 min-w-16 flex-1 rounded-[6px] bg-transparent px-2 text-[13px] text-label focus:outline-accent"
          />
          <span role="status" aria-live="polite" className="shrink-0 text-[12px] text-secondary">
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
                <CodeView
                  source={source}
                  root={highlighted?.root}
                  language={highlighted?.language}
                  offsets={offsets}
                  activeOffset={selection}
                  queryLength={findOpen ? query.length : 0}
                  activeMarkRef={mark}
                />
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h1 className="text-[24px] font-semibold text-label">{workspace?.name ?? "打开项目"}</h1>
          <p className="mt-2 max-w-sm text-[14px] leading-6 text-secondary">
            {workspace ? "从左侧文件树或快速打开定位文件。" : "选择一个本地文件夹。对话、差异和检查都发生在这个项目里。"}
          </p>
          {workspace ? (
            onOpenQuickFiles && (
              <button
                type="button"
                onClick={onOpenQuickFiles}
                className="mt-5 inline-flex min-h-10 items-center rounded-full border border-separator bg-group px-4 text-[13px] font-medium text-label hover:bg-fill"
              >
                选择文件 (Ctrl+P)
              </button>
            )
          ) : (
            <button type="button" onClick={() => void openFolder()}
              className="mt-5 inline-flex min-h-10 items-center rounded-full bg-accent px-5 text-[14px] font-medium text-on-accent hover:opacity-90">
              打开文件夹
            </button>
          )}
        </div>
      )}
    </section>
  );
}
