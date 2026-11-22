import { useMemo, useState } from "react";
import type { ChangeEvent, Dispatch, JSX, SetStateAction, SyntheticEvent } from "react";
import { sortThreads } from "../../agent-core/localData";
import type { Thread } from "../../agent-core/types";
import { useI18n } from "../../hooks/useI18n";
import { useRuntimeStore } from "../../stores/runtimeStore";
import type { UIAction } from "../../types/runtime";
import type { GroupedThreads, RenameDraft, SessionSidebarProps } from "../../types/sidebar";
import type { RuntimeStore } from "../../types/stores";
import { filterAndGroupThreads } from "../../utils/sidebarData";
import { SearchIcon } from "../common/Icons";
import { SessionItem } from "./SessionItem";
import { SettingsDrawer } from "./SettingsDrawer";

export function SessionSidebar({ onNavigate }: SessionSidebarProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const threads: Thread[] = useRuntimeStore((s: RuntimeStore): Thread[] => s.state.threads);
  const lastPresetId: string = useRuntimeStore((s: RuntimeStore): string => s.state.lastPresetId);
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  const busyThreads: string[] = useRuntimeStore((s: RuntimeStore): string[] => s.busyThreads);
  const dispatch: (action: UIAction) => void = useRuntimeStore(
    (s: RuntimeStore): ((action: UIAction) => void) => s.dispatch
  );
  const newThread: (presetId: string) => void = useRuntimeStore(
    (s: RuntimeStore): ((presetId: string) => void) => s.newThread
  );

  const [query, setQuery]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [menuThreadId, setMenuThreadId]: [
    string | null,
    Dispatch<SetStateAction<string | null>>
  ] = useState<string | null>(null);
  const [renaming, setRenaming]: [
    RenameDraft | null,
    Dispatch<SetStateAction<RenameDraft | null>>
  ] = useState<RenameDraft | null>(null);

  const { filtered, pinned, regular }: GroupedThreads = useMemo(
    (): GroupedThreads => filterAndGroupThreads(sortThreads(threads), query),
    [threads, query]
  );

  function startThread(): void {
    setQuery("");
    setMenuThreadId(null);
    setRenaming(null);
    newThread(lastPresetId || "develop");
    onNavigate?.();
  }

  function submitRename(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const title: string | undefined = renaming?.title.trim();
    if (!renaming || !title) return;
    dispatch({ type: "RENAME_THREAD", threadId: renaming.id, title });
    setRenaming(null);
  }

  function renderItem(thread: Thread): JSX.Element {
    return (
      <SessionItem
        key={thread.id}
        thread={thread}
        selected={thread.id === currentThread?.id}
        running={busyThreads.includes(thread.id)}
        menuOpen={menuThreadId === thread.id}
        renamingTitle={renaming?.id === thread.id ? renaming.title : null}
        onSelect={(): void => {
          setMenuThreadId(null);
          dispatch({ type: "SELECT_THREAD", id: thread.id });
          onNavigate?.();
        }}
        onToggleMenu={(): void => setMenuThreadId(menuThreadId === thread.id ? null : thread.id)}
        onStartRename={(): void => {
          setRenaming({ id: thread.id, title: thread.title });
          setMenuThreadId(null);
        }}
        onChangeRename={(title: string): void => setRenaming({ id: thread.id, title })}
        onCancelRename={(): void => setRenaming(null)}
        onSubmitRename={submitRename}
        onTogglePin={(): void => {
          dispatch({ type: "TOGGLE_THREAD_PIN", threadId: thread.id });
          setMenuThreadId(null);
        }}
        onDelete={(): void => {
          dispatch({ type: "DELETE_THREAD", threadId: thread.id });
          setMenuThreadId(null);
        }}
      />
    );
  }

  return (
    <aside aria-label={t.sidebar.asideLabel} className="flex h-full w-full min-w-0 flex-col bg-canvas">
      <div className="flex h-12 shrink-0 items-center px-2">
        <div className="relative w-full">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-tertiary" />
          <input
            id="thread-search"
            type="search"
            aria-label={t.sidebar.searchLabel}
            placeholder={t.sidebar.searchPlaceholder}
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              setQuery(event.target.value);
              setRenaming(null);
              setMenuThreadId(null);
            }}
            className="h-8 w-full rounded-[10px] border border-separator/80 bg-surface pr-7 pl-8 text-[12px] text-label outline-none placeholder:text-tertiary focus:border-accent"
          />
          {query && (
            <button
              type="button"
              aria-label={t.sidebar.clearSearch}
              onClick={(): void => setQuery("")}
              className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-tertiary hover:bg-fill hover:text-label"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 px-2 pt-1 pb-2.5">
        <button
          type="button"
          onClick={startThread}
          title={t.sidebar.newChatShortcut}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border border-separator/85 bg-group px-3 text-[13px] font-medium text-label shadow-[0_1px_2px_rgba(44,36,27,0.06)] transition-colors hover:bg-fill"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-accent">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>{t.sidebar.newChat}</span>
        </button>
      </div>

      <nav aria-label={t.sidebar.threadListLabel} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[12px] text-tertiary">
            {query.trim() ? t.sidebar.noMatches : t.sidebar.emptyThreads}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {pinned.length > 0 && (
              <section aria-label={t.sidebar.pinnedSection} className="flex flex-col gap-0.5">
                <h2 className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-tertiary">
                  {t.sidebar.pinnedSection}
                </h2>
                {pinned.map(renderItem)}
              </section>
            )}
            {regular.length > 0 && (
              <section aria-label={t.sidebar.recentSection} className="flex flex-col gap-0.5">
                {pinned.length > 0 && (
                  <h2 className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-tertiary">
                    {t.sidebar.recentSection}
                  </h2>
                )}
                {regular.map(renderItem)}
              </section>
            )}
          </div>
        )}
      </nav>

      <SettingsDrawer
        onNavigate={onNavigate}
        onAfterImport={(): void => {
          setQuery("");
          setMenuThreadId(null);
          setRenaming(null);
        }}
      />
    </aside>
  );
}
