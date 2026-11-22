import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useSilverStore } from "../state/silverStore";
import { getPreset } from "../model/presets";
import { searchWorkspaceFiles, WORKSPACE_PATH_MIME, workspaceErrorText, type WorkspaceEntry } from "../model/workspace";
import { isConfiguredProvider } from "../provider/presets";
import { Pill } from "../ui/Pill";
import type { ChatDraft, Thread } from "../model/types";

const menuClass =
  "absolute bottom-full z-20 mb-2 flex max-h-64 min-w-44 flex-col overflow-y-auto rounded-[12px] border border-separator bg-group p-1 shadow-[0_8px_24px_rgba(44,36,27,0.14)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.45)]";
const optionClass = "min-h-8 rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-label hover:bg-fill";
const LINE_HEIGHT = 22;
const MIN_TEXTAREA_HEIGHT = LINE_HEIGHT * 2;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * 5;

interface ComposerModeItem {
  id: string;
  label: string;
  hint: string;
}

const COMPOSER_MODES: ComposerModeItem[] = [
  { id: "develop", label: "Agent", hint: "自主开发与修改代码" },
  { id: "review", label: "Plan", hint: "只读分析与方案规划" },
  { id: "explain", label: "Explain", hint: "代码解读与说明文档" },
  { id: "academic", label: "Discussion", hint: "深入讨论与方案推敲" },
];

interface ModelOption {
  providerId: string;
  providerLabel: string;
  model: string;
  displayName: string;
  tag?: string;
}

const MOCK_MODELS: ModelOption[] = [
  { providerId: "anthropic", providerLabel: "Anthropic", model: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", tag: "推荐" },
  { providerId: "anthropic", providerLabel: "Anthropic", model: "claude-opus-4-6", displayName: "Claude Opus 4.6", tag: "深度推理" },
  { providerId: "openai", providerLabel: "OpenAI", model: "gpt-5.2", displayName: "GPT-5.2", tag: "通用" },
  { providerId: "openai", providerLabel: "OpenAI", model: "o3-mini", displayName: "o3-mini", tag: "快推" },
  { providerId: "gemini", providerLabel: "Gemini", model: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", tag: "长上下文" },
  { providerId: "gemini", providerLabel: "Gemini", model: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", tag: "极速" },
];

function ModeIcon({ id, className = "h-3.5 w-3.5 shrink-0" }: { id: string; className?: string }) {
  switch (id) {
    case "review":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <rect x="2.5" y="2.25" width="11" height="11.5" rx="1.75" stroke="currentColor" strokeWidth="1.35" />
          <path d="M5.25 5.75h5.5M5.25 8.5h5.5M5.25 11.25h3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case "explain":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M2.25 3.5A1.25 1.25 0 0 1 3.5 2.25h3A2.5 2.5 0 0 1 8 2.8a2.5 2.5 0 0 1 1.5-.55h3a1.25 1.25 0 0 1 1.25 1.25v8.25A1.25 1.25 0 0 1 12.5 13H9.25A1.75 1.75 0 0 0 8 13.55 1.75 1.75 0 0 0 6.75 13H3.5a1.25 1.25 0 0 1-1.25-1.25V3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M8 3v10.25" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case "academic":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M2.5 4.25A1.75 1.75 0 0 1 4.25 2.5h5.5A1.75 1.75 0 0 1 11.5 4.25v3.5A1.75 1.75 0 0 1 9.75 9.5H6l-2.5 2v-2h-.25A.75.75 0 0 1 2.5 8.75v-4.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M11.5 6.25h.75A1.75 1.75 0 0 1 14 8v3.25a.75.75 0 0 1-.75.75H13v1.75l-2.1-1.75H7.75A1.5 1.5 0 0 1 6.3 10.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={className}>
          <path d="M8 1.75 9.55 6.45 14.25 8 9.55 9.55 8 14.25 6.45 9.55 1.75 8 6.45 6.45 8 1.75Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
  }
}

function ToggleChevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={`h-3 w-3 shrink-0 opacity-70 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path d="M4.25 6.25 8 10l3.75-3.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface DraftEntry {
  value: ChatDraft;
  timer?: number;
  saving?: Promise<void>;
  dirty?: boolean;
}

const draftCache = new Map<string, DraftEntry>();
const cachedScopes = new Map<string, string>();

export function Composer() {
  const currentThread = useSilverStore((s) => s.currentThread);
  const scope = JSON.stringify([currentThread?.id, currentThread?.workspace?.id]);
  return <ScopedComposer key={scope} scope={scope} thread={currentThread} />;
}

function ScopedComposer({ scope, thread }: { scope: string; thread: Thread | null }) {
  const id = thread?.id;
  const allProviders = useSilverStore((s) => s.state.providers);
  const composerPrompt = useSilverStore((s) => s.composerPrompt);
  const composerAttachment = useSilverStore((s) => s.composerAttachment);
  const generating = useSilverStore((s) => (id ? s.busyThreads.includes(id) : false));
  const submitComposer = useSilverStore((s) => s.submitComposer);
  const saveDraft = useSilverStore((s) => s.saveDraft);
  const selectModel = useSilverStore((s) => s.selectModel);
  const changePreset = useSilverStore((s) => s.changePreset);
  const stop = useSilverStore((s) => s.stop);
  const consumeComposerPrompt = useSilverStore((s) => s.consumeComposerPrompt);
  const consumeComposerAttachment = useSilverStore((s) => s.consumeComposerAttachment);
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
  const providers = allProviders.filter(isConfiguredProvider);
  const usingMockModels = providers.length === 0;
  const modelOptions: ModelOption[] = usingMockModels
    ? MOCK_MODELS
    : providers.map((provider) => ({
        providerId: provider.id,
        providerLabel: provider.label,
        model: provider.model,
        displayName: provider.model,
      }));
  const groupedModels = Array.from(
    modelOptions.reduce((groups, option) => {
      const list = groups.get(option.providerLabel) ?? [];
      list.push(option);
      groups.set(option.providerLabel, list);
      return groups;
    }, new Map<string, ModelOption[]>()),
  );
  const storedProvider = allProviders.find(({ id }) => id === thread?.modelId);
  const selectedModel = storedProvider && { ...storedProvider, model: thread?.modelName || storedProvider.model };
  const selectedReal = selectedModel && isConfiguredProvider(selectedModel) ? selectedModel : undefined;
  const activeOption = selectedReal
    ? modelOptions.find((option) => option.providerId === selectedReal.id && option.model === selectedReal.model) ?? {
        providerId: selectedReal.id,
        providerLabel: selectedReal.label,
        model: selectedReal.model,
        displayName: selectedReal.model,
      }
    : modelOptions.find((option) => option.providerId === thread?.modelId && option.model === thread?.modelName);

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

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    function syncHeight() {
      const el = textarea.current;
      if (!el) return;
      el.style.height = "0px";
      const nextHeight = Math.min(MAX_TEXTAREA_HEIGHT, Math.max(MIN_TEXTAREA_HEIGHT, el.scrollHeight));
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    }
    syncHeight();
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== lastWidth) {
        lastWidth = input.clientWidth;
        syncHeight();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [draft.text]);

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
    requestAnimationFrame(() => textarea.current?.focus());
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
    <div className="bg-surface px-4 pt-2 pb-4">
      <form
        ref={composer}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
        onDragOver={(event) => { if (workspace && event.dataTransfer.types.includes(WORKSPACE_PATH_MIME)) event.preventDefault(); }}
        onDrop={drop}
        className="relative mx-auto max-w-4xl rounded-[22px] border border-separator bg-group px-5 py-3.5 shadow-[0_2px_12px_rgba(44,36,27,0.06)] dark:shadow-[0_2px_14px_rgba(0,0,0,0.22)]"
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
                <Pill type="button" className="h-7 px-2.5 text-[12px]" aria-label={`移除附件 ${path}`}
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
          className="block w-full resize-none bg-transparent py-0 text-[15px] leading-[22px] text-label outline-none placeholder:text-secondary"
          style={{ height: MIN_TEXTAREA_HEIGHT, overflowY: "hidden" }}
        />
        {draftError && <p role="alert" className="mt-1 text-[12px] text-danger">{draftError}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1">
          <div className="relative">
            <Pill
              type="button"
              className="h-[30px] gap-1.5 px-2.5 text-[12px] text-label"
              aria-expanded={menu === "preset"}
              aria-label={`模式 ${preset.label}`}
              onClick={() => { setQuery(null); setMenu(menu === "preset" ? null : "preset"); }}
            >
              <ModeIcon id={preset.id} className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span>{preset.label}</span>
              <ToggleChevron open={menu === "preset"} />
            </Pill>
            {menu === "preset" && (
              <div className={`${menuClass} left-0 w-56`} aria-label="模式">
                {COMPOSER_MODES.map((entry) => {
                  const active = entry.id === preset.id;
                  return (
                    <button
                      type="button"
                      key={entry.id}
                      aria-pressed={active}
                      onClick={() => { changePreset(id, entry.id); setMenu(null); }}
                      className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors ${
                        active ? "bg-fill text-label" : "text-label hover:bg-fill/70"
                      }`}
                    >
                      <ModeIcon
                        id={entry.id}
                        className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-secondary"}`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[13px] font-medium leading-4">{entry.label}</span>
                        <span className="mt-0.5 text-[11px] leading-3.5 text-tertiary">{entry.hint}</span>
                      </span>
                      {active && (
                        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-accent">
                          <path d="M3.5 8.25 6.5 11.25 12.5 5.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="relative min-w-0">
            <Pill
              type="button"
              selected={Boolean(activeOption)}
              className="h-[28px] min-w-[144px] max-w-[260px] justify-between gap-2 px-3.5 text-[12px]"
              aria-expanded={menu === "model"}
              aria-label={activeOption ? `模型 ${activeOption.displayName}` : "选择模型"}
              onClick={() => {
                setQuery(null);
                setMenu(menu === "model" ? null : "model");
              }}
            >
              <span className="truncate">
                {activeOption
                  ? (usingMockModels ? activeOption.displayName : `${activeOption.providerLabel} · ${activeOption.displayName}`)
                  : "选择模型"}
              </span>
              <ToggleChevron open={menu === "model"} />
            </Pill>
            {menu === "model" && (
              <div className={`${menuClass} left-0 w-64`} aria-label="模型">
                {usingMockModels && (
                  <p className="border-b border-separator/70 px-2.5 pt-1 pb-1.5 text-[11px] text-tertiary">
                    示例模型（Mock 预览）
                  </p>
                )}
                <div className="flex flex-col gap-1.5 pt-1">
                  {groupedModels.map(([groupLabel, options]) => (
                    <div key={groupLabel} className="flex flex-col gap-0.5">
                      <span className="px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-tertiary uppercase">
                        {groupLabel}
                      </span>
                      {options.map((option) => {
                        const active =
                          option.providerId === activeOption?.providerId &&
                          option.model === activeOption?.model;
                        return (
                          <button
                            type="button"
                            key={`${option.providerId}:${option.model}`}
                            aria-pressed={active}
                            onClick={() => {
                              selectModel(id, option.providerId, option.model);
                              setMenu(null);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors ${
                              active ? "bg-fill text-label" : "text-label hover:bg-fill/70"
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium">{option.displayName}</span>
                              {option.tag && (
                                <span className="shrink-0 rounded-[4px] border border-separator/80 bg-surface px-1.5 py-0.5 text-[10px] leading-none text-secondary">
                                  {option.tag}
                                </span>
                              )}
                            </span>
                            {active && (
                              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-accent">
                                <path d="M3.5 8.25 6.5 11.25 12.5 5.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {generating && id && (
              <Pill type="button" className="h-8 px-3 text-[12px]" onClick={() => stop(id)}>停止</Pill>
            )}
            <button
              type="submit"
              disabled={!draft.text.trim() || sending}
              className="inline-flex h-8 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_80%,#1f1712)] bg-gradient-to-b from-[color-mix(in_srgb,var(--color-accent)_96%,#f6efe2)] to-[color-mix(in_srgb,var(--color-accent)_90%,#1f1712)] px-4 text-[13px] font-medium text-on-accent shadow-[inset_0_1px_0_rgba(255,245,230,0.1),inset_0_-1.5px_0_rgba(31,20,13,0.18),0_1px_3px_rgba(24,16,10,0.28),0_3px_8px_rgba(24,16,10,0.14)] transition-[transform,filter,box-shadow,opacity] duration-150 hover:brightness-[1.03] active:translate-y-[0.5px] active:brightness-95 active:shadow-[inset_0_1px_2px_rgba(31,20,13,0.24),0_1px_1px_rgba(24,16,10,0.18)] disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100"
            >
              发送
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
