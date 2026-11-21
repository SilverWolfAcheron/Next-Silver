import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useSilver } from "../state/SilverContext";
import { getPreset, PRESETS } from "../model/presets";
import { searchWorkspaceFiles, WORKSPACE_PATH_MIME, workspaceErrorText, type WorkspaceEntry } from "../model/workspace";
import { isConfiguredProvider } from "../provider/presets";
import { Pill } from "../ui/Pill";

const menuClass = "absolute bottom-full z-20 mb-2 flex max-h-60 min-w-40 flex-col overflow-y-auto rounded-[12px] border border-separator bg-group p-1";
const optionClass = "min-h-11 rounded-[10px] px-3 text-left text-[13px] text-label hover:bg-fill";

export function Composer() {
  const {
    currentThread, state, dispatch, sendMessage, selectModel, changePreset,
    stop, isGenerating, composerPrompt, consumeComposerPrompt,
  } = useSilver();
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<"preset" | "model" | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [matches, setMatches] = useState<WorkspaceEntry[]>([]);
  const [query, setQuery] = useState<{ text: string; from: number; to: number } | null>(null);
  const [fileError, setFileError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const id = currentThread?.id;
  const workspace = currentThread?.workspace;
  const preset = getPreset(currentThread?.presetId ?? "develop");
  const providers = state.providers.filter(isConfiguredProvider);
  const storedProvider = state.providers.find(({ id }) => id === currentThread?.modelId);
  const selectedModel = storedProvider && { ...storedProvider, model: currentThread?.modelName || storedProvider.model };
  const selected = selectedModel && isConfiguredProvider(selectedModel) ? selectedModel : undefined;
  const generating = id ? isGenerating(id) : false;

  useEffect(() => {
    setMenu(null);
    setDraft("");
    setAttachments([]);
    setQuery(null);
  }, [id, workspace?.id]);

  useEffect(() => {
    if (!composerPrompt || composerPrompt.threadId !== id) return;
    setDraft((value) => {
      const prefix = `${composerPrompt.text}\n`;
      if (value.startsWith(prefix)) return value;
      return value.trim() ? `${value.trimEnd()}\n${prefix}` : prefix;
    });
    consumeComposerPrompt(composerPrompt);
    requestAnimationFrame(() => {
      const input = textarea.current;
      input?.focus();
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [composerPrompt, id, consumeComposerPrompt]);

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
    if (!workspace || !query) return;
    const controller = new AbortController();
    void searchWorkspaceFiles(workspace, query.text, 24, controller.signal).then(
      (entries) => { if (!controller.signal.aborted) setMatches(entries); },
      (error: unknown) => { if (!controller.signal.aborted) setFileError(workspaceErrorText(error)); },
    );
    return () => controller.abort();
  }, [query, workspace]);

  function updateQuery(value: string, cursor: number) {
    const mention = value.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/u);
    setQuery(workspace && mention ? { text: mention[1], from: cursor - mention[1].length - 1, to: cursor } : null);
  }

  function attach(path: string, removeMention = false) {
    if (!attachments.includes(path) && attachments.length < 8) setAttachments([...attachments, path]);
    if (removeMention && query) setDraft(draft.slice(0, query.from) + draft.slice(query.to));
    setQuery(null);
    textarea.current?.focus();
  }

  function drop(event: DragEvent) {
    if (!workspace || !event.dataTransfer.types.includes(WORKSPACE_PATH_MIME)) return;
    event.preventDefault();
    const path = event.dataTransfer.getData(WORKSPACE_PATH_MIME);
    if (path) attach(path);
  }

  function submit() {
    if (!draft.trim()) return;
    sendMessage(id, draft, attachments);
    setDraft("");
    setAttachments([]);
    setQuery(null);
    setMenu(null);
    textarea.current?.focus();
  }

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && (menu || query)) {
      event.stopPropagation();
      setMenu(null);
      setQuery(null);
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (query && matches[0]) attach(matches[0].path, true);
      else submit();
    }
  }

  return (
    <div className="border-t border-separator bg-surface px-3 pt-2 pb-3">
      <form
        ref={composer}
        onSubmit={(event) => { event.preventDefault(); submit(); }}
        onDragOver={(event) => { if (workspace && event.dataTransfer.types.includes(WORKSPACE_PATH_MIME)) event.preventDefault(); }}
        onDrop={drop}
        className="relative mx-auto max-w-3xl rounded-[22px] border border-separator bg-group px-4 py-3"
      >
        {query && (
          <div className={`${menuClass} inset-x-2`} aria-label="工作区文件">
            {matches.map((entry) => (
              <button key={entry.path} type="button" className={`${optionClass} break-all`} onClick={() => attach(entry.path, true)}>
                {entry.path}
              </button>
            ))}
            {!matches.length && <p role="status" className="px-3 py-2 text-[13px] text-secondary">{fileError || "没有匹配的文件"}</p>}
          </div>
        )}
        {attachments.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1" aria-label="附件">
            {attachments.map((path) => (
              <li key={path}>
                <Pill type="button" className="min-h-11" aria-label={`移除附件 ${path}`}
                  onClick={() => setAttachments(attachments.filter((entry) => entry !== path))}>{path} ×</Pill>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textarea}
          value={draft}
          aria-label="发送消息"
          onChange={(event) => {
            setDraft(event.target.value);
            updateQuery(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={handleKey}
          placeholder="描述要改的地方…"
          rows={2}
          className="block max-h-40 min-h-11 w-full resize-y bg-transparent text-[17px] leading-[22px] text-label outline-none placeholder:text-secondary"
        />
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
            <button type="submit" disabled={!draft.trim()}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-4 text-[17px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40">
              发送
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
