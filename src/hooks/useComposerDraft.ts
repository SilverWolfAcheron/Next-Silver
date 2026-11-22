import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  Dispatch,
  DragEvent,
  KeyboardEvent,
  RefObject,
  SetStateAction,
} from "react";
import type { ChatDraft, Thread, WorkspaceEntry, WorkspaceSummary } from "../agent-core/types";
import {
  DRAFT_AUTOSAVE_DELAY_MS,
  MAX_COMPOSER_ATTACHMENTS,
  MAX_TEXTAREA_HEIGHT,
  MENTION_SEARCH_DEBOUNCE_MS,
  MENTION_SEARCH_LIMIT,
  MIN_TEXTAREA_HEIGHT,
} from "../constants/composer";
import { WORKSPACE_PATH_MIME } from "../constants/workspace";
import { searchWorkspaceFiles, workspaceErrorText } from "../services/workspaceClient";
import { useComposerStore } from "../stores/composerStore";
import { useRuntimeStore } from "../stores/runtimeStore";
import type {
  ComposerAttachment,
  ComposerPrompt,
  DraftEntry,
  MentionQuery,
} from "../types/composer";
import type { ComposerStore, RuntimeStore } from "../types/stores";
import { appendPromptToDraft, createEmptyDraft, extractMentionQuery } from "../utils/composerData";
import { useI18n } from "./useI18n";

const draftCache: Map<string, DraftEntry> = new Map();
const cachedScopes: Map<string, string> = new Map();

export function useComposerDraft(
  scope: string,
  thread: Thread | null,
  listId: string
): {
  formRef: RefObject<HTMLFormElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  draft: ChatDraft;
  menu: "preset" | "model" | null;
  setMenu: Dispatch<SetStateAction<"preset" | "model" | null>>;
  query: MentionQuery | null;
  setQuery: Dispatch<SetStateAction<MentionQuery | null>>;
  matches: WorkspaceEntry[];
  searching: boolean;
  fileError: string;
  draftError: string;
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  sending: boolean;
  updateText: (value: string, cursor: number) => void;
  attach: (path: string, removeMention?: boolean) => void;
  removeAttachment: (path: string) => void;
  handleDragOver: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => void;
  submit: () => Promise<void>;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
} {
  const { t }: ReturnType<typeof useI18n> = useI18n();
  const id: string | undefined = thread?.id;
  const workspace: WorkspaceSummary | undefined = thread?.workspace;
  const workspaceId: string | undefined = workspace?.id;

  const composerPrompt: ComposerPrompt | undefined = useComposerStore(
    (s: ComposerStore): ComposerPrompt | undefined => s.composerPrompt
  );
  const composerAttachment: ComposerAttachment | undefined = useComposerStore(
    (s: ComposerStore): ComposerAttachment | undefined => s.composerAttachment
  );
  const consumeComposerPrompt: (prompt: ComposerPrompt) => void = useComposerStore(
    (s: ComposerStore): ((prompt: ComposerPrompt) => void) => s.consumeComposerPrompt
  );
  const consumeComposerAttachment: (request: ComposerAttachment) => void = useComposerStore(
    (s: ComposerStore): ((request: ComposerAttachment) => void) => s.consumeComposerAttachment
  );
  const submitComposer: (threadId: string | undefined, draft: ChatDraft) => Promise<void> =
    useRuntimeStore(
      (s: RuntimeStore): ((threadId: string | undefined, draft: ChatDraft) => Promise<void>) =>
        s.submitComposer
    );
  const saveDraft: (threadId: string, draft: ChatDraft) => Promise<void> = useRuntimeStore(
    (s: RuntimeStore): ((threadId: string, draft: ChatDraft) => Promise<void>) => s.saveDraft
  );

  const [entry]: [DraftEntry, Dispatch<SetStateAction<DraftEntry>>] = useState<DraftEntry>(
    (): DraftEntry =>
      (id && cachedScopes.get(id) !== scope ? undefined : draftCache.get(scope)) ?? {
        value:
          thread?.draft?.workspaceId === workspaceId
            ? thread?.draft ?? createEmptyDraft(workspaceId)
            : createEmptyDraft(workspaceId),
      }
  );

  const [draft, showDraft]: [ChatDraft, Dispatch<SetStateAction<ChatDraft>>] = useState<ChatDraft>(
    entry.value
  );
  const [menu, setMenu]: [
    "preset" | "model" | null,
    Dispatch<SetStateAction<"preset" | "model" | null>>
  ] = useState<"preset" | "model" | null>(null);
  const [matches, setMatches]: [WorkspaceEntry[], Dispatch<SetStateAction<WorkspaceEntry[]>>] =
    useState<WorkspaceEntry[]>([]);
  const [query, setQuery]: [MentionQuery | null, Dispatch<SetStateAction<MentionQuery | null>>] =
    useState<MentionQuery | null>(null);
  const [fileError, setFileError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [draftError, setDraftError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [searching, setSearching]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [activeIndex, setActiveIndex]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const [sending, setSending]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);

  const submitting: RefObject<boolean> = useRef<boolean>(false);
  const textareaRef: RefObject<HTMLTextAreaElement | null> = useRef<HTMLTextAreaElement>(null);
  const formRef: RefObject<HTMLFormElement | null> = useRef<HTMLFormElement>(null);

  function flush(): Promise<void> | undefined {
    if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    entry.timer = undefined;
    if (!id || !entry.dirty) return entry.saving;
    const snapshot: ChatDraft = entry.value;
    entry.dirty = false;
    const pending: Promise<void> = entry.saving
      ? entry.saving.catch((): undefined => undefined).then((): Promise<void> => saveDraft(id, snapshot))
      : saveDraft(id, snapshot);
    entry.saving = pending;
    void pending
      .then(undefined, (error: unknown): void => {
        if (entry.value !== snapshot || entry.saving !== pending) return;
        entry.dirty = true;
        setDraftError(workspaceErrorText(error));
      })
      .finally((): void => {
        if (entry.saving === pending) entry.saving = undefined;
      });
    return pending;
  }

  function changeDraft(value: ChatDraft): void {
    entry.value = value;
    entry.dirty = true;
    draftCache.set(scope, entry);
    if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    entry.timer = window.setTimeout((): void => {
      void flush();
    }, DRAFT_AUTOSAVE_DELAY_MS);
    showDraft(value);
    setDraftError("");
  }

  useEffect((): (() => void) => {
    if (id) {
      const previous: string | undefined = cachedScopes.get(id);
      if (previous && previous !== scope) draftCache.delete(previous);
      cachedScopes.set(id, scope);
    }
    function saveBeforeHide(): void {
      if (!submitting.current) void flush();
    }
    window.addEventListener("pagehide", saveBeforeHide);
    return (): void => {
      window.removeEventListener("pagehide", saveBeforeHide);
      saveBeforeHide();
    };
  }, [entry, id, scope]);

  useLayoutEffect((): (() => void) | undefined => {
    const input: HTMLTextAreaElement | null = textareaRef.current;
    if (!input) return;
    function syncHeight(): void {
      const el: HTMLTextAreaElement | null = textareaRef.current;
      if (!el) return;
      el.style.height = "0px";
      const nextHeight: number = Math.min(
        MAX_TEXTAREA_HEIGHT,
        Math.max(MIN_TEXTAREA_HEIGHT, el.scrollHeight)
      );
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    }
    syncHeight();
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth: number = input.clientWidth;
    const observer: ResizeObserver = new ResizeObserver((): void => {
      if (input.clientWidth !== lastWidth) {
        lastWidth = input.clientWidth;
        syncHeight();
      }
    });
    observer.observe(input);
    return (): void => observer.disconnect();
  }, [draft.text]);

  useEffect((): void => {
    if (!composerPrompt || composerPrompt.threadId !== id) return;
    const next: ChatDraft = appendPromptToDraft(entry.value, composerPrompt.text);
    if (next !== entry.value) changeDraft(next);
    consumeComposerPrompt(composerPrompt);
    requestAnimationFrame((): void => {
      const input: HTMLTextAreaElement | null = textareaRef.current;
      input?.focus();
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [composerPrompt, id, consumeComposerPrompt]);

  function attach(path: string, removeMention: boolean = false): void {
    const current: ChatDraft = entry.value;
    const hasPath: boolean = current.attachments.includes(path);
    if (!hasPath && current.attachments.length >= MAX_COMPOSER_ATTACHMENTS) {
      const message: string = t.composer.maxAttachmentsError(MAX_COMPOSER_ATTACHMENTS);
      setFileError(message);
      setDraftError(message);
      return;
    }
    changeDraft({
      ...current,
      attachments: hasPath ? current.attachments : [...current.attachments, path],
      text:
        removeMention && query
          ? current.text.slice(0, query.from) + current.text.slice(query.to)
          : current.text,
    });
    setQuery(null);
    requestAnimationFrame((): void => textareaRef.current?.focus());
  }

  useEffect((): void => {
    if (
      composerAttachment?.threadId !== id ||
      composerAttachment?.workspaceId !== workspaceId ||
      !composerAttachment
    ) {
      return;
    }
    attach(composerAttachment.path);
    consumeComposerAttachment(composerAttachment);
  }, [composerAttachment, id, workspaceId, consumeComposerAttachment]);

  useEffect((): (() => void) | undefined => {
    if (!menu && !query) return;
    function onOutside(event: PointerEvent): void {
      if (!formRef.current?.contains(event.target as Node)) {
        setMenu(null);
        setQuery(null);
      }
    }
    document.addEventListener("pointerdown", onOutside);
    return (): void => document.removeEventListener("pointerdown", onOutside);
  }, [menu, query]);

  useEffect((): (() => void) | undefined => {
    setMatches([]);
    setFileError("");
    setActiveIndex(0);
    setSearching(Boolean(workspace && query));
    if (!workspace || !query) return;
    const controller: AbortController = new AbortController();
    const timer: number = window.setTimeout((): void => {
      void searchWorkspaceFiles(workspace, query.text, {
        limit: MENTION_SEARCH_LIMIT,
        signal: controller.signal,
      })
        .then(
          (entries: WorkspaceEntry[]): void => {
            if (!controller.signal.aborted) setMatches(entries);
          },
          (error: unknown): void => {
            if (!controller.signal.aborted) setFileError(workspaceErrorText(error));
          }
        )
        .finally((): void => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, MENTION_SEARCH_DEBOUNCE_MS);
    return (): void => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, workspaceId]);

  function updateText(value: string, cursor: number): void {
    changeDraft({ ...entry.value, text: value });
    const nextQuery: MentionQuery | null = extractMentionQuery(value, cursor, Boolean(workspace));
    setActiveIndex(0);
    setMatches([]);
    setFileError("");
    setSearching(Boolean(nextQuery));
    setQuery(nextQuery);
  }

  function removeAttachment(path: string): void {
    changeDraft({
      ...entry.value,
      attachments: entry.value.attachments.filter((item: string): boolean => item !== path),
    });
  }

  function handleDragOver(event: DragEvent): void {
    if (workspace && event.dataTransfer.types.includes(WORKSPACE_PATH_MIME)) {
      event.preventDefault();
    }
  }

  function handleDrop(event: DragEvent): void {
    if (!workspace || !event.dataTransfer.types.includes(WORKSPACE_PATH_MIME)) return;
    event.preventDefault();
    const path: string = event.dataTransfer.getData(WORKSPACE_PATH_MIME);
    if (path) attach(path);
  }

  async function submit(): Promise<void> {
    if (!entry.value.text.trim() || submitting.current) return;
    const submitted: ChatDraft = entry.value;
    submitting.current = true;
    setSending(true);
    setDraftError("");
    try {
      const save: Promise<void> | undefined = flush();
      await save?.catch((): undefined => undefined);
      await submitComposer(id, submitted);
      if (entry.value === submitted) {
        entry.value = createEmptyDraft(workspaceId);
        entry.dirty = false;
        if (!id || cachedScopes.get(id) === scope) draftCache.set(scope, entry);
        showDraft(entry.value);
      } else {
        entry.dirty = true;
        void flush();
      }
      setQuery(null);
      setMenu(null);
      textareaRef.current?.focus();
    } catch (error: unknown) {
      setDraftError(workspaceErrorText(error));
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    if (event.key === "Escape" && (menu || query)) {
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      setQuery(null);
    }
    if (query && matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const index: number =
        (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
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

  return {
    formRef,
    textareaRef,
    draft,
    menu,
    setMenu,
    query,
    setQuery,
    matches,
    searching,
    fileError,
    draftError,
    activeIndex,
    setActiveIndex,
    sending,
    updateText,
    attach,
    removeAttachment,
    handleDragOver,
    handleDrop,
    submit,
    handleKeyDown,
  };
}
