import type { EditorTabState } from "../types/editor";

export const EMPTY_EDITOR_TABS: EditorTabState = { paths: [], active: "" };
export const EDITOR_LINE_HEIGHT: number = 20;
export const MAX_HIGHLIGHT_CHARS: number = 250_000;
export const MAX_VISIBLE_SEARCH_MATCHES: number = 1000;
