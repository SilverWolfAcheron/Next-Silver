export type CodingSymbolLanguage = "typescript" | "javascript" | "python" | "go" | "rust";
export type CodingSymbolMode = "definitions" | "references" | "all";
export type CodingSymbolKind = "definition" | "reference";

export interface CodingSymbolOptions {
  /** Workspace-relative directory. Omit or use an empty string for workspace root. */
  directory?: string;
  mode?: CodingSymbolMode;
  signal?: AbortSignal;
}

export interface CodingSymbolMatch {
  path: string;
  /** One-based physical line number. */
  line: number;
  /** One-based UTF-16 column, as in the text editor. */
  column: number;
  kind: CodingSymbolKind;
  language: CodingSymbolLanguage;
  text: string;
}

export interface CodingSymbolResult {
  query: string;
  directory: string;
  mode: CodingSymbolMode;
  matches: CodingSymbolMatch[];
  scannedFiles: number;
  /** Supported files omitted for size, read errors or limits make a result incomplete. */
  truncated: boolean;
}

export interface CodingSymbolToken {
  kind: "identifier" | "punctuation" | "opaque";
  value: string;
  offset: number;
  line: number;
}

export interface CodingSymbolSource {
  path: string;
  text: string;
  language: CodingSymbolLanguage;
}
