import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import type { Thread, WorkspaceSummary } from "../agent-core/types";
import { EDITOR_LINE_HEIGHT, EMPTY_EDITOR_TABS } from "../constants/editor";
import { subscribeWorkspaceChanges } from "../services/workspaceClient";
import { useEditorStore } from "../stores/editorStore";
import { useRuntimeStore } from "../stores/runtimeStore";
import type {
  EditorTabState,
  FilePreview,
  HighlightedDocument,
  ScrollPosition,
} from "../types/editor";
import type { EditorStore, FilePreviewRequest, RuntimeStore } from "../types/stores";
import {
  buildLineGutter,
  findMatchOffsets,
  makeEditorPositionKey,
  makeEditorScope,
  normalizeSource,
} from "../utils/editorData";
import { detectLanguage, highlightSource, languageLabel } from "../utils/syntax";

export function useEditorController(onAllTabsClosed?: () => void): {
  workspace: WorkspaceSummary | undefined;
  preview: FilePreview | null;
  path: string | undefined;
  body: string | undefined;
  paths: string[];
  activePath: string;
  findOpen: boolean;
  query: string;
  matchIndex: number;
  source: string;
  highlighted: HighlightedDocument | null;
  detectedLabel: string | null;
  gutter: string;
  targetLine: number | undefined;
  offsets: number[];
  selection: number | undefined;
  findInputRef: RefObject<HTMLInputElement | null>;
  sectionRef: RefObject<HTMLElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  activeMarkRef: RefObject<HTMLElement | null>;
  openFolder: () => Promise<void>;
  openFind: () => void;
  closeFind: () => void;
  stepMatch: (delta: number) => void;
  updateQuery: (value: string) => void;
  openTab: (next: string, focus?: boolean) => void;
  closeTab: (closed: string) => void;
  reloadCurrent: () => void;
  saveScrollPosition: (top: number, left: number) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const currentThread: Thread | null = useRuntimeStore(
    (s: RuntimeStore): Thread | null => s.currentThread
  );
  const openFolder: () => Promise<void> = useRuntimeStore(
    (s: RuntimeStore): (() => Promise<void>) => s.openFolder
  );

  const filePreview: FilePreview | null = useEditorStore(
    (s: EditorStore): FilePreview | null => s.filePreview
  );
  const editorTabs: Record<string, EditorTabState> = useEditorStore(
    (s: EditorStore): Record<string, EditorTabState> => s.editorTabs
  );
  const previewFile: (request: FilePreviewRequest) => Promise<void> = useEditorStore(
    (s: EditorStore): ((request: FilePreviewRequest) => Promise<void>) => s.previewFile
  );
  const closeFilePreview: () => void = useEditorStore(
    (s: EditorStore): (() => void) => s.closeFilePreview
  );
  const ensureEditorTab: (scope: string, path: string) => void = useEditorStore(
    (s: EditorStore): ((scope: string, path: string) => void) => s.ensureEditorTab
  );
  const closeEditorTab: (
    scope: string,
    path: string
  ) => { next?: string; closingActive: boolean } = useEditorStore(
    (s: EditorStore): ((scope: string, path: string) => { next?: string; closingActive: boolean }) =>
      s.closeEditorTab
  );

  const threadId: string | undefined = currentThread?.id;
  const workspace: WorkspaceSummary | undefined = currentThread?.workspace;
  const scope: string = makeEditorScope(threadId, workspace?.id);
  const preview: FilePreview | null =
    filePreview?.threadId === threadId && workspace?.id === filePreview?.workspaceId
      ? filePreview
      : null;

  const path: string | undefined = preview?.path;
  const body: string | undefined = preview?.body;
  const line: number | undefined = preview?.line;
  const saved: EditorTabState = editorTabs[scope] ?? EMPTY_EDITOR_TABS;
  const paths: string[] = path && !saved.paths.includes(path) ? [...saved.paths, path] : saved.paths;
  const positionKey: string = makeEditorPositionKey(scope, path);

  const [findOpen, setFindOpen]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [query, setQuery]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [matchIndex, setMatchIndex]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);

  const findInputRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);
  const sectionRef: RefObject<HTMLElement | null> = useRef<HTMLElement>(null);
  const viewportRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const activeMarkRef: RefObject<HTMLElement | null> = useRef<HTMLElement>(null);
  const previousScope: RefObject<string> = useRef<string>("");
  const previousDocument: RefObject<string> = useRef<string>("");
  const positions: RefObject<Map<string, ScrollPosition>> = useRef<Map<string, ScrollPosition>>(
    new Map()
  );

  useLayoutEffect((): void => {
    if (!scope || !path) return;
    ensureEditorTab(scope, path);
  }, [scope, path, ensureEditorTab]);

  useEffect((): void => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    if (threadId && workspace && scope && !path && saved.active) {
      void previewFile({ threadId, workspace, path: saved.active });
    }
  }, [scope, threadId, workspace, path, saved.active, previewFile]);

  useEffect((): (() => void) | undefined => {
    if (!workspace || !threadId || !path) return;
    return subscribeWorkspaceChanges(workspace, (): void => {
      void previewFile({ threadId, workspace, path });
    });
  }, [workspace, threadId, path, previewFile]);

  const source: string = useMemo((): string => normalizeSource(body), [body]);
  const highlighted: HighlightedDocument | null = useMemo(
    (): HighlightedDocument | null => highlightSource(source, path),
    [source, path]
  );
  const detectedLabel: string | null = useMemo(
    (): string | null =>
      highlighted?.label ?? (path ? languageLabel(detectLanguage(path, source), path) : null),
    [highlighted, path, source]
  );
  const { gutter, lineCount }: { gutter: string; lineCount: number } = useMemo(
    (): { gutter: string; lineCount: number } => buildLineGutter(source),
    [source]
  );
  const targetLine: number | undefined =
    line && Number.isSafeInteger(line) && line > 0 ? Math.min(line, lineCount) : undefined;
  const offsets: number[] = useMemo(
    (): number[] => findMatchOffsets(source, query, findOpen),
    [source, query, findOpen]
  );
  const selection: number | undefined = offsets[Math.min(matchIndex, offsets.length - 1)];

  useLayoutEffect((): void => {
    if (previousDocument.current !== positionKey) {
      previousDocument.current = positionKey;
      setFindOpen(false);
      setMatchIndex(0);
    }
    if (!viewportRef.current || !path || body === undefined) return;
    const scroll: HTMLDivElement = viewportRef.current;
    if (targetLine) {
      scroll.scrollTop = Math.max(0, (targetLine - 1) * EDITOR_LINE_HEIGHT - scroll.clientHeight / 2);
      scroll.scrollLeft = 0;
    } else {
      const previous: ScrollPosition | undefined = positions.current.get(positionKey);
      scroll.scrollTop = previous?.top ?? 0;
      scroll.scrollLeft = previous?.left ?? 0;
    }
  }, [path, body, targetLine, positionKey]);

  useLayoutEffect((): void => {
    if (positionKey) {
      sectionRef.current
        ?.querySelector('[role="tab"][aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [positionKey]);

  useLayoutEffect((): void => {
    if (findOpen) activeMarkRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [findOpen, selection, query]);

  function openFind(): void {
    if (body === undefined) return;
    setFindOpen(true);
    requestAnimationFrame((): void => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }

  function closeFind(): void {
    setFindOpen(false);
    viewportRef.current?.focus({ preventScroll: true });
  }

  function stepMatch(delta: number): void {
    if (!offsets.length) return;
    setMatchIndex(
      (current: number): number =>
        (Math.min(current, offsets.length - 1) + delta + offsets.length) % offsets.length
    );
  }

  function updateQuery(value: string): void {
    setQuery(value);
    setMatchIndex(0);
  }

  function tabButton(file: string): HTMLButtonElement | undefined {
    const buttons: HTMLButtonElement[] = Array.from(
      sectionRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []
    );
    return buttons.find((tab: HTMLButtonElement): boolean => tab.getAttribute("aria-label") === file);
  }

  function openTab(next: string, focus: boolean = false): void {
    if (!threadId || !workspace || next === path) return;
    void previewFile({ threadId, workspace, path: next });
    if (focus) tabButton(next)?.focus({ preventScroll: true });
  }

  function closeTab(closed: string): void {
    if (!threadId || !workspace || !scope) return;
    positions.current.delete(makeEditorPositionKey(scope, closed));
    const { next, closingActive }: { next?: string; closingActive: boolean } = closeEditorTab(
      scope,
      closed
    );
    if (closingActive) {
      if (next) void previewFile({ threadId, workspace, path: next });
      else {
        closeFilePreview();
        onAllTabsClosed?.();
      }
    }
    if (next && document.activeElement && sectionRef.current?.contains(document.activeElement)) {
      tabButton(next)?.focus({ preventScroll: true });
    }
  }

  function reloadCurrent(): void {
    if (threadId && workspace && path) {
      void previewFile({ threadId, workspace, path });
    }
  }

  function saveScrollPosition(top: number, left: number): void {
    positions.current.set(positionKey, { top, left });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return;
    const key: string = event.key.toLowerCase();
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
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.getAttribute("role") !== "tab" ||
      !["arrowleft", "arrowright", "home", "end"].includes(key) ||
      !paths.length
    ) {
      return;
    }
    const index: number = Math.max(0, paths.indexOf(path ?? saved.active));
    const next: number =
      key === "home"
        ? 0
        : key === "end"
          ? paths.length - 1
          : (index + (key === "arrowleft" ? -1 : 1) + paths.length) % paths.length;
    event.preventDefault();
    openTab(paths[next], true);
  }

  return {
    workspace,
    preview,
    path,
    body,
    paths,
    activePath: path ?? saved.active,
    findOpen,
    query,
    matchIndex,
    source,
    highlighted,
    detectedLabel,
    gutter,
    targetLine,
    offsets,
    selection,
    findInputRef,
    sectionRef,
    viewportRef,
    activeMarkRef,
    openFolder,
    openFind,
    closeFind,
    stepMatch,
    updateQuery,
    openTab,
    closeTab,
    reloadCurrent,
    saveScrollPosition,
    handleKeyDown,
  };
}
