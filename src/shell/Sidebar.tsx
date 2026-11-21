import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useSilver } from "../state/SilverContext";
import { exportThreads, importThreads, sortThreads } from "../model/localData";
import { SideRow } from "../ui/SideRow";
import { WorkspacePanel } from "./WorkspacePanel";

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { state, currentThread, dispatch, newThread, previewFile, filePreview, closeFilePreview, attachWorkspace } = useSilver();
  const [query, setQuery] = useState("");
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState<{ text: string; error?: boolean }>();
  const [concurrencyDraft, setConcurrencyDraft] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toLocaleLowerCase();
  const recent = sortThreads(state.threads).filter((thread) => thread.title.toLocaleLowerCase().includes(search));

  function startThread(presetId: string) {
    setQuery("");
    setMenuThreadId(null);
    setRenaming(null);
    newThread(presetId);
    onNavigate?.();
  }

  function renameThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = renaming?.title.trim();
    if (!renaming || !title) return;
    dispatch({ type: "RENAME_THREAD", threadId: renaming.id, title });
    setRenaming(null);
  }

  function downloadBackup() {
    const url = URL.createObjectURL(new Blob([exportThreads(state.threads)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "silver-conversations.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDataMenuOpen(false);
    setDataStatus({ text: "已导出对话。" });
  }

  async function uploadBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const threads = importThreads(await file.text());
      dispatch({ type: "IMPORT_THREADS", threads });
      setQuery("");
      setMenuThreadId(null);
      setRenaming(null);
      setDataMenuOpen(false);
      setDataStatus({ text: `已导入 ${threads.length} 条对话。` });
    } catch (error) {
      const text = error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof DOMException)
        ? error.message
        : "无法读取 Silver 对话备份。";
      setDataStatus({ text, error: true });
    }
  }

  return (
      <aside aria-label="项目侧栏" className="flex h-full w-[240px] max-w-full shrink-0 flex-col border-r border-separator bg-canvas">
      <div className="px-3 pt-4 pb-2 shrink-0">
        <input
          id="thread-search"
          type="search"
          aria-label="搜索对话标题"
          placeholder="搜索对话"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setRenaming(null);
            setMenuThreadId(null);
          }}
          className="w-full min-h-[44px] rounded-[10px] border border-separator bg-group px-3 text-[13px] text-label outline-none placeholder:text-secondary focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <section aria-labelledby="workspace-heading" className="pb-2">
          <h2 id="workspace-heading" className="px-1 pt-3 pb-2 text-[12px] font-semibold text-tertiary">项目</h2>
          <WorkspacePanel
            workspace={currentThread?.workspace}
            selectedPath={filePreview && filePreview.threadId === currentThread?.id ? filePreview.path : undefined}
            onBind={(workspace) => {
              if (currentThread && filePreview?.threadId === currentThread.id) closeFilePreview();
              void attachWorkspace(workspace);
            }}
            onPreview={(path) => {
              if (!currentThread) return;
              void previewFile(currentThread.id, path);
              onNavigate?.();
            }}
          />
        </section>

        <section aria-labelledby="recent-thread-heading" className="flex flex-col gap-0.5 pb-3">
          <div className="flex items-center justify-between px-1 pt-3">
            <h2 id="recent-thread-heading" className="text-[12px] font-semibold text-tertiary">会话</h2>
            <button type="button" className="min-h-11 rounded-[10px] px-2 text-[13px] text-accent hover:bg-fill" onClick={() => startThread("develop")}>
              新对话
            </button>
          </div>
          {recent.length === 0 && <p className="px-3 py-2 text-[13px] text-secondary">{search ? "未找到匹配的对话。" : "还没有会话。"}</p>}
            {recent.map((thread) => (
              <div key={thread.id}>
                {renaming?.id === thread.id ? (
                  <form onSubmit={renameThread} className="flex flex-col gap-1 px-1">
                    <input
                      autoFocus
                      aria-label="对话标题"
                      value={renaming.title}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => setRenaming({ id: thread.id, title: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="w-full min-h-[44px] rounded-[10px] border border-accent bg-group px-2 text-[13px] text-label outline-none"
                    />
                    <div className="flex gap-1">
                      <button type="submit" disabled={!renaming.title.trim()} className="flex-1 min-h-[44px] rounded-[10px] text-[13px] text-accent hover:bg-fill disabled:opacity-50">保存</button>
                      <button type="button" onClick={() => setRenaming(null)} className="flex-1 min-h-[44px] rounded-[10px] text-[13px] text-secondary hover:bg-fill">取消</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <SideRow
                        label={thread.title}
                        meta={thread.pinned ? "置顶" : undefined}
                        selected={thread.id === currentThread?.id}
                        onClick={() => {
                          setMenuThreadId(null);
                          dispatch({ type: "SELECT_THREAD", id: thread.id });
                          onNavigate?.();
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`${thread.title}的对话操作`}
                      aria-expanded={menuThreadId === thread.id}
                      onClick={() => setMenuThreadId(menuThreadId === thread.id ? null : thread.id)}
                      className="min-h-[44px] min-w-[44px] rounded-[10px] text-secondary hover:bg-fill hover:text-label"
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
                  </div>
                )}
                {menuThreadId === thread.id && (
                  <div className="grid grid-cols-3 gap-0.5 rounded-[10px] border border-separator bg-group px-1">
                    <button type="button" className="min-h-[44px] rounded-[10px] text-[13px] text-label hover:bg-fill" onClick={() => {
                      setRenaming({ id: thread.id, title: thread.title });
                      setMenuThreadId(null);
                    }}>重命名</button>
                    <button type="button" className="min-h-[44px] rounded-[10px] text-[13px] text-label hover:bg-fill" onClick={() => {
                      dispatch({ type: "TOGGLE_THREAD_PIN", threadId: thread.id });
                      setMenuThreadId(null);
                    }}>{thread.pinned ? "取消置顶" : "置顶"}</button>
                    <button type="button" className="min-h-[44px] rounded-[10px] text-[13px] text-danger hover:bg-fill" onClick={() => {
                      dispatch({ type: "DELETE_THREAD", threadId: thread.id });
                      setMenuThreadId(null);
                    }}>删除</button>
                  </div>
                )}
              </div>
            ))}
        </section>
      </div>

      <div className="mt-auto px-2 py-3 border-t border-separator flex flex-col gap-0.5 shrink-0">
        <button
          type="button"
          aria-expanded={dataMenuOpen}
          className="w-full px-3 min-h-[44px] rounded-[10px] text-left text-[17px] text-label hover:bg-fill"
          onClick={() => setDataMenuOpen(!dataMenuOpen)}
        >
          对话数据
        </button>
        {dataMenuOpen && (
          <div className="grid grid-cols-2 gap-0.5 rounded-[10px] border border-separator bg-group px-1">
            <button type="button" className="min-h-[44px] rounded-[10px] text-[13px] text-label hover:bg-fill" onClick={downloadBackup}>导出 JSON</button>
            <button type="button" className="min-h-[44px] rounded-[10px] text-[13px] text-label hover:bg-fill" onClick={() => importInput.current?.click()}>导入 JSON</button>
          </div>
        )}
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => void uploadBackup(event)} />
        {dataStatus && <p role="status" className={`px-3 text-[13px] ${dataStatus.error ? "text-danger" : "text-secondary"}`}>{dataStatus.text}</p>}
        <SideRow
          label="供应商"
          onClick={() => {
            dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: !state.providerPanelOpen });
            onNavigate?.();
          }}
          selected={state.providerPanelOpen}
        />
        <button
          type="button"
          aria-expanded={concurrencyDraft !== null}
          aria-controls="development-concurrency-settings"
          className="flex min-h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[17px] text-label hover:bg-fill"
          onClick={() => setConcurrencyDraft(concurrencyDraft === null ? String(state.developmentConcurrency) : null)}
        >
          <span className="flex-1">并发设置</span>
          <span className="text-[13px] text-tertiary">{state.developmentConcurrency}</span>
        </button>
        {concurrencyDraft !== null && (
          <form
            id="development-concurrency-settings"
            noValidate
            className="flex flex-col gap-1 rounded-[10px] border border-separator bg-group px-2 py-1"
            onSubmit={(event) => {
              event.preventDefault();
              dispatch({ type: "SET_DEVELOPMENT_CONCURRENCY", value: Number(concurrencyDraft) });
              setConcurrencyDraft(null);
            }}
          >
            <label htmlFor="development-concurrency" className="text-[13px] font-medium text-label">开发席位并发数</label>
            <input
              id="development-concurrency"
              aria-describedby="development-concurrency-range"
              type="number"
              min={9}
              max={32}
              inputMode="numeric"
              value={concurrencyDraft}
              onChange={(event) => setConcurrencyDraft(event.target.value)}
              className="min-h-11 w-full rounded-[10px] border border-separator bg-group px-2 text-[13px] text-label outline-none focus:border-accent"
            />
            <p id="development-concurrency-range" className="text-[13px] text-secondary">可设为 9–32。小于 9 时恢复默认值 16。</p>
            <button type="submit" className="min-h-11 self-start rounded-[10px] px-2 text-[13px] text-accent hover:bg-fill">保存并发设置</button>
          </form>
        )}
        <button
          className="px-3 min-h-[44px] text-left text-[13px] text-secondary hover:text-accent cursor-default select-none rounded-[10px] hover:bg-fill"
          onClick={() =>
            dispatch({
              type: "SET_APPEARANCE",
              appearance: {
                theme:
                  state.appearance.theme === "dark"
                    ? "light"
                    : state.appearance.theme === "light"
                    ? "system"
                    : "dark",
              },
            })
          }
        >
          {state.appearance.theme === "dark"
            ? "暗色"
            : state.appearance.theme === "light"
            ? "亮色"
            : "跟随系统"}
        </button>
      </div>
    </aside>
  );
}
