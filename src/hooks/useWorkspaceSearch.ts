import { useEffect, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import type { WorkspaceEntry, WorkspaceSummary, WorkspaceTextMatch } from "../agent-core/types";
import {
  WORKSPACE_FILE_SEARCH_LIMIT,
  WORKSPACE_SEARCH_DEBOUNCE_MS,
  WORKSPACE_TEXT_SEARCH_LIMIT,
} from "../constants/workspace";
import {
  searchWorkspaceFiles,
  searchWorkspaceText,
  workspaceErrorText,
} from "../services/workspaceClient";
import type { WorkspaceSearchMode } from "../types/layout";
import type { WorkspaceSearchResult } from "../types/workspace";
import { parseFileSearchQuery } from "../utils/workspaceData";

export function useWorkspaceSearch(options: {
  mode: WorkspaceSearchMode;
  workspace?: WorkspaceSummary;
  listId: string;
  onClose: () => void;
  onOpen: (path: string, line?: number) => void;
  onAttach?: (path: string) => void;
}): {
  query: string;
  active: number;
  matches: WorkspaceSearchResult[];
  error: string;
  loading: boolean;
  more: boolean;
  isAttach: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  selectedRef: RefObject<boolean>;
  setActive: Dispatch<SetStateAction<number>>;
  updateQuery: (value: string) => void;
  selectResult: (result: WorkspaceSearchResult) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
} {
  const { mode, workspace, listId, onClose, onOpen, onAttach }: typeof options = options;
  const [query, setQuery]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [active, setActive]: [number, Dispatch<SetStateAction<number>>] = useState<number>(0);
  const [matches, setMatches]: [
    WorkspaceSearchResult[],
    Dispatch<SetStateAction<WorkspaceSearchResult[]>>
  ] = useState<WorkspaceSearchResult[]>([]);
  const [error, setError]: [string, Dispatch<SetStateAction<string>>] = useState<string>("");
  const [loading, setLoading]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);
  const [more, setMore]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);

  const inputRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);
  const selectedRef: RefObject<boolean> = useRef<boolean>(false);

  const isAttach: boolean = mode === "attach";
  const isFileMode: boolean = mode === "files" || isAttach;

  useEffect((): void => {
    inputRef.current?.focus();
  }, []);

  useEffect((): (() => void) | undefined => {
    setMatches([]);
    setActive(0);
    setMore(false);
    setError("");
    setLoading(Boolean(workspace && (isFileMode || query.trim())));
    if (!workspace || (mode === "text" && !query.trim())) return;

    const controller: AbortController = new AbortController();
    const timer: number = window.setTimeout(
      (): void => {
        const limit: number = isFileMode ? WORKSPACE_FILE_SEARCH_LIMIT : WORKSPACE_TEXT_SEARCH_LIMIT;
        const file: { path: string; line?: number } | undefined =
          mode === "files" ? parseFileSearchQuery(query) : undefined;
        const searchPromise: Promise<(WorkspaceEntry | WorkspaceTextMatch)[]> = isFileMode
          ? searchWorkspaceFiles(workspace, file?.path ?? query, {
            limit: limit + 1,
            signal: controller.signal,
          })
          : searchWorkspaceText(workspace, query, {
            limit: limit + 1,
            signal: controller.signal,
          });

        void searchPromise
          .then(
            (results: (WorkspaceEntry | WorkspaceTextMatch)[]): void => {
              if (controller.signal.aborted) return;
              setMore(results.length > limit);
              setMatches(
                results.slice(0, limit).map((result: WorkspaceEntry | WorkspaceTextMatch): WorkspaceSearchResult =>
                  file?.line ? { ...result, line: file.line } : result
                )
              );
            },
            (failure: unknown): void => {
              if (!controller.signal.aborted) setError(workspaceErrorText(failure));
            }
          )
          .finally((): void => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query.trim() ? WORKSPACE_SEARCH_DEBOUNCE_MS : 0
    );

    return (): void => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, isFileMode, query, workspace?.id]);

  function updateQuery(value: string): void {
    setQuery(value);
    setMatches([]);
    setActive(0);
  }

  function selectResult(result: WorkspaceSearchResult): void {
    selectedRef.current = true;
    if (isAttach && onAttach) onAttach(result.path);
    else onOpen(result.path, result.line);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || !matches.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      selectResult(matches[active]);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next: number =
        (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
    }
  }

  return {
    query,
    active,
    matches,
    error,
    loading,
    more,
    isAttach,
    inputRef,
    selectedRef,
    setActive,
    updateQuery,
    selectResult,
    handleKeyDown,
  };
}
