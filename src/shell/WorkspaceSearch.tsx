import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { searchWorkspaceFiles, searchWorkspaceText, workspaceErrorText, type WorkspaceSummary } from "../model/workspace";

export type WorkspaceSearchMode = "files" | "text" | "attach";

interface SearchResult {
  path: string;
  line?: number;
  text?: string;
}

interface WorkspaceSearchProps {
  mode: WorkspaceSearchMode;
  workspace?: WorkspaceSummary;
  onMode: (mode: WorkspaceSearchMode) => void;
  onClose: () => void;
  onOpenFolder: () => void;
  onOpen: (path: string, line?: number) => void;
  onAttach?: (path: string) => void;
}

const FILE_LIMIT = 32;
const TEXT_LIMIT = 50;

function fileQuery(query: string): { path: string; line?: number } {
  const location = /^(.+):([1-9]\d*)$/u.exec(query.trim());
  const line = Number(location?.[2]);
  return location && Number.isSafeInteger(line)
    ? { path: location[1].trim(), line }
    : { path: query };
}

export function WorkspaceSearch({ mode, workspace, onMode, onClose, onOpenFolder, onOpen, onAttach }: WorkspaceSearchProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selected = useRef(false);
  const titleId = useId();
  const listId = useId();
  const isAttach = mode === "attach";
  const isFileMode = mode === "files" || isAttach;

  useEffect(() => {
    const previous = document.activeElement;
    const panel = dialog.current;
    panel?.showModal();
    input.current?.focus();
    return () => {
      panel?.close();
      if (!selected.current && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    setMatches([]);
    setActive(0);
    setMore(false);
    setError("");
    setLoading(Boolean(workspace && (isFileMode || query.trim())));
    if (!workspace || (mode === "text" && !query.trim())) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const limit = isFileMode ? FILE_LIMIT : TEXT_LIMIT;
      const search = isFileMode ? searchWorkspaceFiles : searchWorkspaceText;
      const file = mode === "files" ? fileQuery(query) : undefined;
      void search(workspace, file?.path ?? query, limit + 1, controller.signal).then((results) => {
        if (controller.signal.aborted) return;
        setMore(results.length > limit);
        setMatches(results.slice(0, limit).map((result) => file?.line ? { ...result, line: file.line } : result));
      }, (failure: unknown) => {
        if (!controller.signal.aborted) setError(workspaceErrorText(failure));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query.trim() ? 160 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [mode, isFileMode, query, workspace?.id]);

  function select(result: SearchResult) {
    selected.current = true;
    if (isAttach && onAttach) onAttach(result.path);
    else onOpen(result.path, result.line);
    onClose();
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !matches.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      select(matches[active]);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
    }
  }

  let status = "";
  if (loading) status = "正在搜索…";
  else if (mode === "text" && !query.trim()) status = "输入要查找的文字。";
  else if (!matches.length) status = "没有匹配结果。";
  else if (more) status = `显示前 ${matches.length} 条，输入更多文字可缩小范围。`;

  return (
    <dialog ref={dialog} aria-labelledby={titleId}
      className="fixed inset-x-0 top-[14vh] mx-auto my-0 w-[min(42rem,calc(100%-1.5rem))] max-h-[74vh] overflow-hidden rounded-[12px] border border-separator bg-group text-label shadow-[0_18px_48px_rgba(44,36,27,0.20)] dark:shadow-[0_22px_56px_rgba(0,0,0,0.48)]"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex max-h-[74vh] min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-separator px-3">
          {isAttach ? (
            <h2 id={titleId} className="flex min-h-11 items-center px-1 text-[13px] font-semibold text-label">
              添加到对话参考
            </h2>
          ) : (
            <>
              <h2 id={titleId} className="sr-only">工作区搜索</h2>
              <button type="button" aria-pressed={mode === "files"} onClick={() => { onMode("files"); input.current?.focus(); }}
                className="min-h-11 rounded-[10px] px-3 text-[13px] hover:bg-fill aria-pressed:font-semibold aria-pressed:text-accent">打开文件</button>
              <button type="button" aria-pressed={mode === "text"} onClick={() => { onMode("text"); input.current?.focus(); }}
                className="min-h-11 rounded-[10px] px-3 text-[13px] hover:bg-fill aria-pressed:font-semibold aria-pressed:text-accent">搜索内容</button>
            </>
          )}
          <button type="button" onClick={onClose} className="ml-auto min-h-11 px-2 text-[13px] text-secondary hover:text-label">关闭</button>
        </div>
        {workspace ? (
          <>
            <input ref={input} type="text" role="combobox" aria-expanded={matches.length > 0} aria-autocomplete="list"
              aria-controls={listId} aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
              aria-label={isAttach ? "选择要添加到对话参考的文件" : mode === "files" ? "按名称查找文件" : "在工作区搜索内容"}
              placeholder={isAttach ? "输入文件名或路径，添加到对话参考" : mode === "files" ? "输入文件名、路径或路径:行号" : "输入文字"}
              value={query} maxLength={200} onKeyDown={navigate}
              onChange={(event) => { setQuery(event.target.value); setMatches([]); setActive(0); }}
              className="mx-3 my-3 min-h-11 rounded-[10px] border border-separator bg-surface px-3 outline-none focus:border-accent" />
            <div id={listId} role="listbox" aria-label="搜索结果" className="min-h-0 overflow-y-auto px-2">
              {matches.map((result, index) => (
                <div key={`${result.path}:${result.line ?? ""}`} id={`${listId}-${index}`}
                  role="option" aria-selected={active === index}
                  onPointerMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(result)}
                  className={`flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-[10px] px-3 py-1.5 text-[13px] ${active === index ? "bg-fill" : ""}`}>
                  <span className="truncate font-mono text-label" title={result.path}>
                    {result.path}{result.line !== undefined && <span className="text-tertiary">:{result.line}</span>}
                  </span>
                  {result.text !== undefined && <span className="truncate text-secondary">{result.text.trim()}</span>}
                </div>
              ))}
            </div>
            {(status || error) && <p role={error ? "alert" : "status"} className={`p-3 text-[13px] ${error ? "text-danger" : "text-secondary"}`}>{error || status}</p>}
            {!status && !error && <div className="h-2 shrink-0" />}
          </>
        ) : (
          <div className="flex items-center gap-3 p-3 text-[13px]">
            <p className="text-secondary">先打开项目文件夹。</p>
            <button type="button" onClick={() => { onClose(); onOpenFolder(); }}
              className="min-h-11 rounded-[10px] px-2 text-accent hover:bg-fill">打开文件夹</button>
          </div>
        )}
      </section>
    </dialog>
  );

}
