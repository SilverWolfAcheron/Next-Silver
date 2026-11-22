import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useSilver } from "../state/SilverContext";
import { getPreset, PRESETS } from "../model/presets";
import { searchWorkspaceFiles, WORKSPACE_PATH_MIME, workspaceErrorText, type WorkspaceEntry } from "../model/workspace";
import { isConfiguredProvider } from "../provider/presets";
import { Pill } from "../ui/Pill";
import type { ChatDraft, Thread } from "../model/types";

const menuClass = "absolute bottom-full z-20 mb-2 flex max-h-60 min-w-40 flex-col overflow-y-auto rounded-[12px] border border-separator bg-group p-1";
const optionClass = "min-h-11 rounded-[10px] px-3 text-left text-[13px] text-label hover:bg-fill";

interface DraftEntry {
  value: ChatDraft;
  timer?: number;
  saving?: Promise<void>;
  dirty?: boolean;
}

const draftCache = new Map<string, DraftEntry>();
const cachedScopes = new Map<string, string>();

export function Composer() {
  const { currentThread } = useSilver();
  const scope = JSON.stringify([currentThread?.id, currentThread?.workspace?.id]);
  return <ScopedComposer key={scope} scope={scope} thread={currentThread} />;
}

function ScopedComposer({ scope, thread }: { scope: string; thread: Thread | null }) {
  const {
    state, dispatch, submitComposer, saveDraft, selectModel, changePreset,
    stop, isGenerating, composerPrompt, consumeComposerPrompt, composerAttachment, consumeComposerAttachment,
  } = useSilver();
  const id = thread?.id;
  const workspace = thread?.workspace;
  const workspaceId = workspace?.id;
  const empty = (): ChatDraft => ({ text: "", attachments: [], workspaceId });
  const [entry] = useState<DraftEntry>(() => (id && cachedScopes.get(id) !== scope ? undefined : draftCache.get(scope)) ?? {
    value: thread?.draft?.workspaceId === workspaceId ? thread?.draft ?? empty() : empty(),
  });
  const [draft, showDraft] = useState(entry.value);
  const [menu, setMenu] = useState<"preset" | "model" | null>(null);
  const [matches, setMatches] = useState<WorkspaceEntry[]>([]);
  const [query, setQuery] = useState<{ text: string; from: number; to: number } | null>(null);
  const [fileError, setFileError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const submitting = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const listId = useId();
  const preset = getPreset(thread?.presetId ?? "develop");
  const providers = state.providers.filter(isConfiguredProvider);
  const storedProvider = state.providers.find(({ id }) => id === thread?.modelId);
  const selectedModel = storedProvider && { ...storedProvider, model: thread?.modelName || storedProvider.model };
  const selected = selectedModel && isConfiguredProvider(selectedModel) ? selectedModel : undefined;
  const generating = id ? isGenerating(id) : false;

  function flush() {
    if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    entry.timer = undefined;
    if (!id || !entry.dirty) return entry.saving;
    const snapshot = entry.value;
    entry.dirty = false;
    const pending = entry.saving
      ? entry.saving.catch(() => {}).then(() => saveDraft(id, snapshot))
      : saveDraft(id, snapshot);
    entry.saving = pending;
    void pending.then(undefined, (error: unknown) => {
      if (entry.value !== snapshot || entry.saving !== pending) return;
      entry.dirty = true;
      setDraftError(workspaceErrorText(error));
    }).finally(() => { if (entry.saving === pending) entry.saving = undefined; });
    return pending;
  }

  function changeDraft(value: ChatDraft) {
    entry.value = value;
    entry.dirty = true;
    draftCache.set(scope, entry);
    if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout(flush, 250);
    showDraft(value);
    setDraftError("");
  }

  useEffect(() => {
    if (id) {
      const previous = cachedScopes.get(id);
      if (previous && previous !== scope) draftCache.delete(previous);
      cachedScopes.set(id, scope);
    }
    function saveBeforeHide() { if (!submitting.current) void flush(); }
    window.addEventListener("pagehide", saveBeforeHide);
    return () => {
      window.removeEventListener("pagehide", saveBeforeHide);
      saveBeforeHide();
    };
  }, [entry, id]);

  useEffect(() => {
    if (!composerPrompt || composerPrompt.threadId !== id) return;
    const prefix = `${composerPrompt.text}\n`;
    const value = entry.value.text;
    if (!value.startsWith(prefix)) changeDraft({
      ...entry.value, text: value.trim() ? `${value.trimEnd()}\n${prefix}` : prefix,
    });
    consumeComposerPrompt(composerPrompt);
    requestAnimationFrame(() => {
      const input = textarea.current;
      input?.focus();
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [composerPrompt, id, consumeComposerPrompt]);

  useEffect(() => {
    if (composerAttachment?.threadId !== id || composerAttachment?.workspaceId !== workspaceId || !composerAttachment) return;
    attach(composerAttachment.path);
    consumeComposerAttachment(composerAttachment);
  }, [composerAttachment, id, workspaceId, consumeComposerAttachment]);

  useEffect(() => {
    if (!menu && !query) return;
    function outside(event: PointerEvent) {
      if (!composer.current?.contains(event.target as Node)) {
        setMenu(null);
        setQuery(null);
      }
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu, query]);

  useEffect(() => {
    setMatches([]);
    setFileError("");
    setActiveIndex(0);
    setSearching(Boolean(workspace && query));
    if (!workspace || !query) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchWorkspaceFiles(workspace, query.text, 24, controller.signal).then(
        (entries) => { if (!controller.signal.aborted) setMatches(entries); },
        (error: unknown) => { if (!controller.signal.aborted) setFileError(workspaceErrorText(error)); },
      ).finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 100);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, workspaceId]);

  function updateQuery(value: string, cursor: number) {
    const mention = value.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/u);
    setActiveIndex(0);
    setMatches([]);
    setFileError("");
    setSearching(Boolean(workspace && mention));
    setQuery(workspace && mention ? { text: mention[1], from: cursor - mention[1].length - 1, to: cursor } : null);
  }

  function attach(path: string, removeMention = false) {
    const current = entry.value;
    const hasPath = current.attachments.includes(path);
    if (!hasPath && current.attachments.length >= 8) {
      setFileError("每条消息最多附加 8 个文件。");
      setDraftError("每条消息最多附加 8 个文件。");
      return;
    }
    changeDraft({
      ...current,
      attachments: hasPath ? current.attachments : [...current.attachments, path],
      text: removeMention && query ? current.text.slice(0, query.from) + current.text.slice(query.to) : current.text,
    });
    setQuery(null);
    textarea.current?.focus();
  }

  function drop(event: DragEvent) {
    if (!workspace || !event.dataTransfer.types.includes(WORKSPACE_PATH_MIME)) return;
    event.preventDefault();
    const path = event.dataTransfer.getData(WORKSPACE_PATH_MIME);
    if (path) attach(path);
  }

  async function submit() {
    if (!entry.value.text.trim() || submitting.current) return;
    const submitted = entry.value;
    submitting.current = true;
    setSending(true);
    setDraftError("");
    try {
      const save = flush();
      await save?.catch(() => undefined);
      await submitComposer(id, submitted);
      if (entry.value === submitted) {
        entry.value = empty();
        entry.dirty = false;
        if (!id || cachedScopes.get(id) === scope) draftCache.set(scope, entry);
        showDraft(entry.value);
      } else {
        entry.dirty = true;
        void flush();
      }
      setQuery(null);
      setMenu(null);
      textarea.current?.focus();
    } catch (error) {
      setDraftError(workspaceErrorText(error));
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && (menu || query)) {
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      setQuery(null);
    }
    if (query && matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const index = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      setActiveIndex(index);
      document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (query) {
        if (matches[activeIndex]) attach(matches[activeIndex].path, true);
        return;
      }
      void submit();
    }
  }

  return (
    <div className="border-t border-separator bg-surface px-3 pt-2 pb-3">
      <form
        ref={composer}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
        onDragOver={(event) => { if (workspace && event.dataTransfer.types.includes(WORKSPACE_PATH_MIME)) event.preventDefault(); }}
        onDrop={drop}
        className="relative mx-auto max-w-3xl rounded-[22px] border border-separator bg-group px-4 py-3"
      >
        {query && (
          <div className={`${menuClass} inset-x-2`} id={listId} role="listbox" aria-label="工作区文件">
            {matches.map((entry, index) => (
              <div key={entry.path} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
                className={`${optionClass} flex items-center break-all ${index === activeIndex ? "bg-fill" : ""}`}
                onPointerMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => attach(entry.path, true)}>
                {entry.path}
              </div>
            ))}
            {!matches.length && <p role="status" className="px-3 py-2 text-[13px] text-secondary">{searching ? "正在搜索文件…" : fileError || "没有匹配的文件"}</p>}
          </div>
        )}
        {draft.attachments.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1" aria-label="附件">
            {draft.attachments.map((path) => (
              <li key={path}>
                <Pill type="button" className="min-h-11" aria-label={`移除附件 ${path}`}
                  onClick={() => changeDraft({ ...entry.value, attachments: entry.value.attachments.filter((item) => item !== path) })}>{path} ×</Pill>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textarea}
          value={draft.text}
          aria-label="发送消息"
          aria-autocomplete="list"
          aria-controls={query ? listId : undefined}
          aria-activedescendant={query && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          maxLength={100_000}
          onChange={(event) => {
            changeDraft({ ...entry.value, text: event.target.value });
            updateQuery(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={handleKey}
          placeholder="描述要改的地方…"
          rows={2}
          className="block max-h-40 min-h-11 w-full resize-y bg-transparent text-[17px] leading-[22px] text-label outline-none placeholder:text-secondary"
        />
        {draftError && <p role="alert" className="mt-1 text-[13px] text-danger">{draftError}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-separator pt-2">
          <div className="relative">
            <Pill type="button" className="min-h-11" aria-expanded={menu === "preset"} aria-label={`预设 ${preset.label}`}
              onClick={() => { setQuery(null); setMenu(menu === "preset" ? null : "preset"); }}>
              {preset.label}
            </Pill>
            {menu === "preset" && (
              <div className={`${menuClass} left-0`} aria-label="预设">
                {PRESETS.map((entry) => (
                  <button type="button" key={entry.id} className={optionClass} aria-pressed={entry.id === preset.id}
                    onClick={() => { changePreset(id, entry.id); setMenu(null); }}>
                    {entry.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative min-w-0">
            <Pill type="button" selected={Boolean(selected)} className="min-h-11 max-w-full" aria-expanded={menu === "model"}
              onClick={() => {
                setQuery(null);
                if (providers.length) setMenu(menu === "model" ? null : "model");
                else dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true });
              }}>
              <span className="truncate">{selected ? `${selected.label} · ${selected.model}` : "未选模型"}</span>
            </Pill>
            {menu === "model" && (
              <div className={`${menuClass} left-0 w-max max-w-[min(18rem,60vw)]`} aria-label="模型">
                {providers.map((provider) => (
                  <button type="button" key={provider.id} className={`${optionClass} break-all`}
                    aria-pressed={provider.id === selected?.id && provider.model === selected.model}
                    onClick={() => { selectModel(id, provider.id, provider.model); setMenu(null); }}>
                    {provider.label} · {provider.model}
                  </button>
                ))}
                <button type="button" className={optionClass}
                  onClick={() => { dispatch({ type: "SET_PROVIDER_PANEL_OPEN", open: true }); setMenu(null); }}>
                  供应商设置
                </button>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {generating && id && (
              <Pill type="button" className="min-h-11" onClick={() => stop(id)}>停止</Pill>
            )}
            <button type="submit" disabled={!draft.text.trim() || sending}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-[17px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
              发送
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
