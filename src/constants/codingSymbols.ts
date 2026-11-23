import type { CodingSymbolLanguage } from "../types/codingSymbols";

export const CODING_SYMBOL_LIMITS: {
  readonly queryLength: number;
  readonly files: number;
  readonly directories: number;
  readonly depth: number;
  readonly entries: number;
  readonly entriesPerDirectory: number;
  readonly fileBytes: number;
  readonly searchBytes: number;
  readonly perFileMatches: number;
  readonly matches: number;
  readonly snippetLength: number;
  readonly templateDepth: number;
  readonly regexLookahead: number;
} = {
  queryLength: 128,
  files: 700,
  directories: 350,
  depth: 16,
  entries: 5_000,
  entriesPerDirectory: 1_500,
  fileBytes: 192 * 1024,
  searchBytes: 8 * 1024 * 1024,
  perFileMatches: 20,
  matches: 32,
  snippetLength: 180,
  templateDepth: 32,
  regexLookahead: 1_024,
};

export const CODING_SYMBOL_LANGUAGES: ReadonlyMap<string, CodingSymbolLanguage> = new Map([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".py", "python"],
  [".pyi", "python"],
  [".go", "go"],
  [".rs", "rust"],
]);

export const CODING_SYMBOL_IGNORED_DIRS: ReadonlySet<string> = new Set([
  "build", "coverage", "dist", "dist-cli", "node_modules", "out", "target", "vendor", "venv", "__pycache__",
]);

export const CODING_SYMBOL_MODES: ReadonlySet<string> = new Set(["definitions", "references", "all"]);

export const CODING_SYMBOL_IDENTIFIER: RegExp = /^[$_\p{ID_Start}][$_\p{ID_Continue}\u200c\u200d]*$/u;
export const CODING_SYMBOL_IDENTIFIER_AT: RegExp = /[$_\p{ID_Start}][$_\p{ID_Continue}\u200c\u200d]*/uy;
export const CODING_SYMBOL_NUMBER_AT: RegExp = /[0-9][0-9a-fA-F_xXoObBnN]*/y;

export const JS_DECLARATIONS: ReadonlySet<string> = new Set([
  "class", "const", "enum", "function", "interface", "let", "namespace", "type", "var",
]);
export const JS_MODIFIERS: ReadonlySet<string> = new Set([
  "abstract", "async", "declare", "default", "export", "get", "override", "private", "protected",
  "public", "readonly", "set", "static",
]);
export const JS_EXPRESSION_START: ReadonlySet<string> = new Set([
  "", "(", "[", "{", "=", ",", ";", ":", "!", "?", "&&", "||", "=>", "return", "yield", "case", "throw",
]);
export const JS_NON_METHODS: ReadonlySet<string> = new Set([
  "catch", "for", "if", "return", "switch", "while", "with",
]);
export const GO_DECLARATIONS: ReadonlySet<string> = new Set(["const", "func", "type", "var"]);
export const RUST_DECLARATIONS: ReadonlySet<string> = new Set([
  "const", "enum", "fn", "let", "mod", "static", "struct", "trait", "type", "union",
]);
