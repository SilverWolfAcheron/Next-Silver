import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useSilverStore } from "../state/silverStore";
import { exportThreads, importThreads, sortThreads } from "../model/localData";
import type { Thread } from "../model/types";

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const threads = useSilverStore((s) => s.state.threads);
  const lastPresetId = useSilverStore((s) => s.state.lastPresetId);
  const providerPanelOpen = useSilverStore((s) => s.state.providerPanelOpen);
  const developmentConcurrency = useSilverStore((s) => s.state.developmentConcurrency);
  const theme = useSilverStore((s) => s.state.appearance.theme);
  const currentThread = useSilverStore((s) => s.currentThread);
  const busyThreads = useSilverStore((s) => s.busyThreads);
  const dispatch = useSilverStore((s) => s.dispatch);
  const newThread = useSilverStore((s) => s.newThread);

  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState<{ text: string; error?: boolean }>();
  const [concurrencyDraft, setConcurrencyDraft] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const search = query.trim().toLocaleLowerCase();
  const filtered = sortThreads(threads).filter((thread) =>
    thread.title.toLocaleLowerCase().includes(search),
  );
  const pinnedThreads = filtered.filter((thread) => thread.pinned);
  const regularThreads = filtered.filter((thread) => !thread.pinned);

  function startThread() {
    setQuery("");
    setMenuThreadId(null);
    setRenaming(null);
    newThread(lastPresetId || "develop");
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
    const url = URL.createObjectURL(new Blob([exportThreads(threads)], { type: "application/json" }));
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
      const imported = importThreads(await file.text());
      dispatch({ type: "IMPORT_THREADS", threads: imported });
      setQuery("");
      setMenuThreadId(null);
      setRenaming(null);
      setDataMenuOpen(false);
      setDataStatus({ text: `已导入 ${imported.length} 条对话。` });
    } catch (error) {
      const text = error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof DOMException)
        ? error.message
        : "无法读取 Silver 对话备份。";
      setDataStatus({ text, error: true });
    }
  }

  function renderThreadItem(thread: Thread) {
    const selected = thread.id === currentThread?.id;
    const running = busyThreads.includes(thread.id);
    const pending = Boolean(thread.pendingConfirmation);
    const workspaceName = thread.workspace?.name;

    if (renaming?.id === thread.id) {
      return (
        <form key={thread.id} onSubmit={renameThread} className="my-1 flex flex-col gap-1.5 rounded-[10px] border border-separator bg-group p-2">
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
            className="h-8 w-full rounded-[7px] border border-accent bg-surface px-2.5 text-[13px] text-label outline-none"
          />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setRenaming(null)} className="h-7 rounded-[6px] px-2.5 text-[12px] text-secondary hover:bg-fill">
              取消
            </button>
            <button type="submit" disabled={!renaming.title.trim()} className="h-7 rounded-[6px] bg-fill px-2.5 text-[12px] font-medium text-accent hover:opacity-90 disabled:opacity-45">
              保存
            </button>
          </div>
        </form>
      );
    }

    return (
      <div key={thread.id} className="group/item">
        <div
          className={`relative flex items-center rounded-[9px] transition-colors ${
            selected
              ? "bg-fill text-label"
              : "text-label/90 hover:bg-fill/55"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setMenuThreadId(null);
              dispatch({ type: "SELECT_THREAD", id: thread.id });
              onNavigate?.();
            }}
            className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pr-1 pl-3 text-left select-none"
          >
            <span className={`truncate text-[13px] leading-[18px] ${selected ? "font-medium text-label" : "text-label/90"}`}>
              {thread.title}
            </span>
            {(workspaceName || pending || running) && (
              <span className="flex items-center gap-1.5 text-[11px] leading-[15px] text-tertiary">
                {workspaceName && <span className="truncate font-mono">{workspaceName}</span>}
                {pending && <span className="shrink-0 font-medium text-accent">待确认</span>}
                {!pending && running && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-secondary">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                    运行中
                  </span>
                )}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label={`${thread.title}的对话操作`}
            aria-expanded={menuThreadId === thread.id}
            onClick={() => setMenuThreadId(menuThreadId === thread.id ? null : thread.id)}
            className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-secondary transition-opacity hover:bg-group hover:text-label ${
              menuThreadId === thread.id ? "opacity-100" : "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </div>

        {menuThreadId === thread.id && (
          <div className="mt-1 mb-1.5 grid grid-cols-3 gap-0.5 rounded-[8px] border border-separator bg-group p-0.5">
            <button
              type="button"
              className="h-7 rounded-[6px] text-[12px] text-label hover:bg-fill"
              onClick={() => {
                setRenaming({ id: thread.id, title: thread.title });
                setMenuThreadId(null);
              }}
            >
              重命名
            </button>
            <button
              type="button"
              className="h-7 rounded-[6px] text-[12px] text-label hover:bg-fill"
              onClick={() => {
                dispatch({ type: "TOGGLE_THREAD_PIN", threadId: thread.id });
                setMenuThreadId(null);
              }}
            >
              {thread.pinned ? "取消置顶" : "置顶"}
            </button>
            <button
              type="button"
              className="h-7 rounded-[6px] text-[12px] text-danger hover:bg-fill"
              onClick={() => {
                dispatch({ type: "DELETE_THREAD", threadId: thread.id });
                setMenuThreadId(null);
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <aside aria-label="会话侧栏" className="flex h-full w-full min-w-0 flex-col border-r border-separator bg-canvas">
      <div className="flex h-12 shrink-0 items-center border-b border-separator px-2.5">
        <div className="relative w-full">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-tertiary"
          >
            <circle cx="7.25" cy="7.25" r="4.25" stroke="currentColor" strokeWidth="1.35" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          </svg>
          <input
            id="thread-search"
            type="search"
            aria-label="搜索对话标题"
            placeholder="搜索会话 (Ctrl+K)"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setRenaming(null);
              setMenuThreadId(null);
            }}
            className="h-8 w-full rounded-[8px] border border-separator/80 bg-surface pr-7 pl-8 text-[12px] text-label outline-none placeholder:text-tertiary focus:border-accent"
          />
          {query && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-tertiary hover:bg-fill hover:text-label"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 px-2.5 pt-2.5 pb-2">
        <button
          type="button"
          onClick={startThread}
          title="新对话 (Ctrl+N)"
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-separator bg-group px-3 text-[13px] font-medium text-label shadow-[0_1px_2px_rgba(44,36,27,0.06)] transition-colors hover:bg-fill"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-accent">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>新对话</span>
        </button>
      </div>

      <nav aria-label="会话列表" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[12px] text-tertiary">
            {search ? "未找到匹配的会话" : "还没有会话，点上方开始"}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {pinnedThreads.length > 0 && (
              <section aria-label="置顶会话" className="flex flex-col gap-0.5">
                <h2 className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-tertiary">置顶</h2>
                {pinnedThreads.map(renderThreadItem)}
              </section>
            )}
            {regularThreads.length > 0 && (
              <section aria-label="最近会话" className="flex flex-col gap-0.5">
                {pinnedThreads.length > 0 && (
                  <h2 className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-tertiary">最近</h2>
                )}
                {regularThreads.map(renderThreadItem)}
              </section>
            )}
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-separator px-2 py-2">
        {settingsOpen && (
          <div id="sidebar-settings-menu" className="mb-1.5 flex flex-col gap-0.5 rounded-[10px] border border-separator bg-group p-1">
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
                onNavigate?.();
              }}
              className={`flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] transition-colors ${
                providerPanelOpen ? "bg-fill font-medium text-label" : "text-secondary hover:bg-fill hover:text-label"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
                <rect x="2.5" y="3" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.25" />
                <rect x="2.5" y="9" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.25" />
              </svg>
              <span className="min-w-0 flex-1 truncate">供应商</span>
            </button>

            <button
              type="button"
              aria-expanded={concurrencyDraft !== null}
              aria-controls="development-concurrency-settings"
              onClick={() => setConcurrencyDraft(concurrencyDraft === null ? String(developmentConcurrency) : null)}
              className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
                <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                <circle cx="6" cy="4.5" r="1.2" fill="currentColor" />
                <circle cx="10.5" cy="8" r="1.2" fill="currentColor" />
                <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" />
              </svg>
              <span className="min-w-0 flex-1 truncate">并发设置</span>
              <span className="shrink-0 font-mono text-[11px] text-tertiary">{developmentConcurrency}</span>
            </button>

            {concurrencyDraft !== null && (
              <form
                id="development-concurrency-settings"
                noValidate
                className="mx-1 my-1 flex flex-col gap-2 rounded-[8px] border border-separator bg-surface p-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  dispatch({ type: "SET_DEVELOPMENT_CONCURRENCY", value: Number(concurrencyDraft) });
                  setConcurrencyDraft(null);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="development-concurrency" className="text-[12px] font-medium text-label">
                    开发席位并发数
                  </label>
                  <span className="rounded-[4px] bg-fill/75 px-1.5 py-0.5 font-mono text-[10px] leading-none text-secondary">
                    9–32
                  </span>
                </div>
                <div className="flex h-8 items-center overflow-hidden rounded-[7px] border border-separator bg-group focus-within:border-accent">
                  <button
                    type="button"
                    aria-label="减少并发数"
                    onClick={() => {
                      const current = Number(concurrencyDraft);
                      const next = Number.isFinite(current) ? Math.max(9, Math.trunc(current) - 1) : 16;
                      setConcurrencyDraft(String(next));
                    }}
                    className="flex h-full w-8 shrink-0 items-center justify-center border-r border-separator/70 text-secondary transition-colors hover:bg-fill hover:text-label"
                  >
                    −
                  </button>
                  <input
                    id="development-concurrency"
                    aria-describedby="development-concurrency-range"
                    type="number"
                    min={9}
                    max={32}
                    inputMode="numeric"
                    value={concurrencyDraft}
                    onChange={(event) => setConcurrencyDraft(event.target.value)}
                    className="h-full min-w-0 flex-1 bg-transparent px-2 text-center font-mono text-[13px] text-label outline-none"
                  />
                  <button
                    type="button"
                    aria-label="增加并发数"
                    onClick={() => {
                      const current = Number(concurrencyDraft);
                      const next = Number.isFinite(current) ? Math.min(32, Math.max(9, Math.trunc(current) + 1)) : 16;
                      setConcurrencyDraft(String(next));
                    }}
                    className="flex h-full w-8 shrink-0 items-center justify-center border-l border-separator/70 text-secondary transition-colors hover:bg-fill hover:text-label"
                  >
                    +
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <p id="development-concurrency-range" className="min-w-0 text-[11px] leading-4 text-tertiary">
                    小于 9 恢复默认 16
                  </p>
                  <button
                    type="submit"
                    className="h-7 shrink-0 rounded-[7px] bg-accent px-3 text-[12px] font-medium text-on-accent transition-opacity hover:opacity-90"
                  >
                    保存
                  </button>
                </div>
              </form>
            )}

            <button
              type="button"
              aria-expanded={dataMenuOpen}
              onClick={() => setDataMenuOpen(!dataMenuOpen)}
              className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
                <path d="M3 4.5C3 3.4 5.24 2.5 8 2.5s5 .9 5 2-2.24 2-5 2-5-.9-5-2Z" stroke="currentColor" strokeWidth="1.25" />
                <path d="M3 4.5v7c0 1.1 2.24 2 5 2s5-.9 5-2v-7M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.25" />
              </svg>
              <span className="min-w-0 flex-1 truncate">对话数据</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                className={`h-3 w-3 shrink-0 text-tertiary transition-transform duration-100 ${dataMenuOpen ? "rotate-90" : ""}`}
              >
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {dataMenuOpen && (
              <div className="mx-1 my-1 flex flex-col gap-0.5 rounded-[8px] border border-separator bg-surface p-1.5">
                <button
                  type="button"
                  onClick={downloadBackup}
                  className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] text-label transition-colors hover:bg-fill"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-secondary">
                    <path d="M8 2.5v7.25M5.25 7.25 8 10l2.75-2.75M3 11.75v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>导出 JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => importInput.current?.click()}
                  className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] text-label transition-colors hover:bg-fill"
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-secondary">
                    <path d="M8 10V2.75M5.25 5.5 8 2.75 10.75 5.5M3 11.75v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>导入 JSON</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: "SET_APPEARANCE",
                  appearance: {
                    theme:
                      theme === "dark"
                        ? "light"
                        : theme === "light"
                        ? "system"
                        : "dark",
                  },
                })
              }
              className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] text-secondary transition-colors hover:bg-fill hover:text-label"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
                {theme === "dark" ? (
                  <path d="M12.5 9.8A4.75 4.75 0 0 1 6.2 3.5a5 5 0 1 0 6.3 6.3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                ) : (
                  <>
                    <circle cx="8" cy="8" r="2.75" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M8 2v1.25M8 12.75V14M2 8h1.25M12.75 8H14M3.75 3.75l.9.9M11.35 11.35l.9.9M12.25 3.75l-.9.9M4.65 11.35l-.9.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                  </>
                )}
              </svg>
              <span className="min-w-0 flex-1 truncate">外观主题</span>
              <span className="shrink-0 text-[11px] text-tertiary">
                {theme === "dark" ? "暗色" : theme === "light" ? "亮色" : "跟随系统"}
              </span>
            </button>

            {dataStatus && <p role="status" className={`px-2.5 py-1 text-[11px] ${dataStatus.error ? "text-danger" : "text-secondary"}`}>{dataStatus.text}</p>}
          </div>
        )}

        <button
          type="button"
          aria-expanded={settingsOpen}
          aria-controls="sidebar-settings-menu"
          onClick={() => {
            setSettingsOpen((open) => {
              if (open) {
                setDataMenuOpen(false);
                setConcurrencyDraft(null);
              }
              return !open;
            });
          }}
          className={`flex h-9 w-full items-center justify-between gap-2 rounded-[8px] px-2.5 text-left text-[13px] transition-colors ${
            settingsOpen ? "bg-fill/75 font-medium text-label" : "text-secondary hover:bg-fill/60 hover:text-label"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${settingsOpen ? "rotate-45" : ""}`}
            >
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
            </svg>
            <span className="truncate">设置</span>
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className={`h-3.5 w-3.5 shrink-0 text-tertiary transition-transform duration-150 ${settingsOpen ? "rotate-180" : ""}`}
          >
            <path d="M4.25 6.25 8 10l3.75-3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => void uploadBackup(event)} />
      </div>
    </aside>
  );
}
