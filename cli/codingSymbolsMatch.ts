import {
  CODING_SYMBOL_LIMITS, GO_DECLARATIONS, JS_DECLARATIONS, JS_MODIFIERS, JS_NON_METHODS, RUST_DECLARATIONS,
} from "../src/constants/codingSymbols.ts";
import type {
  CodingSymbolKind, CodingSymbolLanguage, CodingSymbolMatch, CodingSymbolMode, CodingSymbolSource, CodingSymbolToken,
} from "../src/types/codingSymbols";
import { tokenizeCodingSource } from "./codingSymbolsLexer.ts";

interface Delimiters {
  closers: Map<number, number>;
  parents: number[];
}

interface SymbolCursor {
  tokens: CodingSymbolToken[];
  index: number;
  delimiters: Delimiters;
}

interface SourceMatches {
  definitions: CodingSymbolMatch[];
  references: CodingSymbolMatch[];
  truncated: boolean;
}

interface MatchQuery {
  name: string;
  mode: CodingSymbolMode;
  signal?: AbortSignal;
}

function pairDelimiters(tokens: CodingSymbolToken[]): Delimiters {
  const closers: Map<number, number> = new Map();
  const parents: number[] = [];
  const stack: number[] = [];
  const opens: ReadonlyMap<string, string> = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
  for (const [index, { value }] of tokens.entries()) {
    const parent: number = stack.at(-1) ?? -1;
    parents.push(parent);
    if (opens.has(value)) {
      stack.push(index);
    } else if (parent >= 0 && opens.get(tokens[parent].value) === value) {
      closers.set(parent, index);
      stack.pop();
    }
  }
  return { closers, parents };
}

function previous({ index, tokens }: SymbolCursor, count: number = 1): string {
  return tokens[index - count]?.value ?? "";
}

function next({ index, tokens }: SymbolCursor, count: number = 1): string {
  return tokens[index + count]?.value ?? "";
}

function memberAccess(operator: string): boolean {
  return operator === "." || operator === "?." || operator === "::";
}

function sameLineAsPrevious({ index, tokens }: SymbolCursor): boolean {
  return tokens[index - 1]?.line === tokens[index].line;
}

function jsParameterEnd({ index, tokens, delimiters }: SymbolCursor): number | undefined {
  let opening: number = index + 1;
  if (tokens[opening]?.value === "?") opening++;
  if (tokens[opening]?.value === "<") {
    // Skip a bounded TypeScript method type parameter list, not a full type parser.
    let depth: number = 1;
    const stop: number = opening + 40;
    while (++opening < stop && opening < tokens.length) {
      if (tokens[opening].value === "<") depth++;
      if (tokens[opening].value === ">" && --depth === 0) break;
    }
    opening++;
  }
  if (tokens[opening]?.value !== "(") return undefined;
  return delimiters.closers.get(opening);
}

function jsMemberDefinition(cursor: SymbolCursor): boolean {
  const { tokens, index, delimiters }: SymbolCursor = cursor;
  const before: string = previous(cursor) === "#" ? previous(cursor, 2) : previous(cursor);
  if (JS_NON_METHODS.has(tokens[index].value) || memberAccess(before)) return false;
  if (!JS_MODIFIERS.has(before) && !["", "{", "}", ";", ","].includes(before)) return false;
  const end: number | undefined = jsParameterEnd(cursor);
  if (end === undefined) return false;
  const after: CodingSymbolToken | undefined = tokens[end + 1];
  if (after?.value === "{" && after.line === tokens[end].line) return true;
  if (after?.value !== ":") return false;
  // Return annotations imply a signature, but only in a class/interface/object body.
  const parent: number = delimiters.parents[index] ?? -1;
  if (parent < 0 || tokens[parent].value !== "{") return false;
  // Restrict to plausible signature terminators and ignore other token lines.
  const limit: number = Math.min(tokens.length, end + 42);
  for (let i: number = end + 2; i < limit; i++) {
    const token: CodingSymbolToken = tokens[i];
    if (token.line !== after.line || token.value === "=") return false;
    if (["{", ";", ",", "}"].includes(token.value)) return true;
  }
  return false;
}

function jsDeclaration(cursor: SymbolCursor): boolean {
  const before: string = previous(cursor);
  const prior: string = previous(cursor, 2);
  if (JS_DECLARATIONS.has(before) && !memberAccess(prior)) {
    if (before === "type") return prior !== "import" && next(cursor) !== "}";
    if (before === "const" || before === "let" || before === "var") {
      return ["", "=", ":", ";", ",", "in", "of", ")"].includes(next(cursor));
    }
    return true;
  }
  if (before === "*" && prior === "function" && !memberAccess(previous(cursor, 3))) return true;
  return jsMemberDefinition(cursor);
}

function pythonDeclaration(cursor: SymbolCursor): boolean {
  const { index, tokens, delimiters }: SymbolCursor = cursor;
  const before: string = previous(cursor);
  if (before === "class" || before === "def") return !memberAccess(previous(cursor, 2));
  const parent: number = delimiters.parents[index] ?? -1;
  if (parent >= 0 || (sameLineAsPrevious(cursor) && before !== ";")) return false;
  return next(cursor) === "=" || (next(cursor) === ":" && tokens[index + 1]?.line === tokens[index].line);
}

function goAssignment(cursor: SymbolCursor): boolean {
  const { tokens, index }: SymbolCursor = cursor;
  const line: number = tokens[index].line;
  if (memberAccess(previous(cursor))) return false;
  if (next(cursor) === ":=") return true;
  // Multiple names in one short declaration: x, y := pair().
  for (let i: number = index + 1; i < index + 32 && tokens[i]?.line === line; i += 2) {
    if (tokens[i].value === ":=") return true;
    if (tokens[i].value !== "," || tokens[i + 1]?.line !== line || tokens[i + 1]?.kind !== "identifier") break;
  }
  return false;
}

function goDeclaration(cursor: SymbolCursor): boolean {
  const { tokens, index, delimiters }: SymbolCursor = cursor;
  const before: string = previous(cursor);
  if (GO_DECLARATIONS.has(before) && !memberAccess(previous(cursor, 2))) return true;
  if (before === ")") {
    const parent: number = delimiters.parents[index - 1] ?? -1;
    if (parent > 0 && tokens[parent - 1].value === "func" && next(cursor) === "(") return true;
  }
  const parent: number = delimiters.parents[index] ?? -1;
  if (parent > 0 && tokens[parent].value === "(" && GO_DECLARATIONS.has(tokens[parent - 1].value) &&
      (index === parent + 1 || !sameLineAsPrevious(cursor))) return true;
  return goAssignment(cursor);
}

function rustDeclaration(cursor: SymbolCursor): boolean {
  // Rust raw identifiers use r#name in references and declarations.
  const skip: number = previous(cursor) === "#" && previous(cursor, 2) === "r" ? 2 : 0;
  let before: string = previous(cursor, skip + 1);
  let prior: string = previous(cursor, skip + 2);
  if (before === "mut" || before === "ref") {
    before = prior;
    prior = previous(cursor, skip + 3);
  }
  if (before === "mut" || before === "ref") {
    before = prior;
    prior = previous(cursor, skip + 4);
  }
  return RUST_DECLARATIONS.has(before) && !memberAccess(prior);
}

function symbolKind(cursor: SymbolCursor, language: CodingSymbolLanguage): CodingSymbolKind {
  switch (language) {
    case "typescript":
    case "javascript": return jsDeclaration(cursor) ? "definition" : "reference";
    case "python": return pythonDeclaration(cursor) ? "definition" : "reference";
    case "go": return goDeclaration(cursor) ? "definition" : "reference";
    case "rust": return rustDeclaration(cursor) ? "definition" : "reference";
  }
}

function lineStarts(content: string): number[] {
  const starts: number[] = [0];
  let newline: number = content.indexOf("\n");
  while (newline >= 0) {
    starts.push(newline + 1);
    newline = content.indexOf("\n", newline + 1);
  }
  return starts;
}

function snippet(source: CodingSymbolSource, token: CodingSymbolToken, starts: number[]): CodingSymbolMatch["text"] {
  const first: number = starts[token.line - 1];
  const last: number = (starts[token.line] ?? source.text.length + 1) - 1;
  const budget: number = CODING_SYMBOL_LIMITS.snippetLength - 2;
  const context: number = Math.max(0, budget - token.value.length);
  const start: number = Math.max(first, token.offset - Math.floor(context / 2));
  const end: number = Math.min(last, start + budget);
  // Replace terminal escapes and bidi controls, but keep layout and token offsets intact.
  const clean: string = source.text.slice(start, end)
    .replace(/[^\P{Cc}\t]|[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .trim();
  return (start > first ? "…" : "") + clean + (end < last ? "…" : "");
}

/** Heuristic declarations and lexical references, not type-resolution or a rename engine. */
export function matchCodingSource(source: CodingSymbolSource, query: MatchQuery): SourceMatches {
  const result: SourceMatches = { definitions: [], references: [], truncated: false };
  if (!source.text.includes(query.name)) return result;
  const tokens: CodingSymbolToken[] = tokenizeCodingSource(source.text, source.language, query.signal);
  const delimiters: Delimiters = pairDelimiters(tokens);
  const starts: number[] = lineStarts(source.text);
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "identifier" || token.value !== query.name) continue;
    query.signal?.throwIfAborted();
    const kind: CodingSymbolKind = symbolKind({ tokens, index, delimiters }, source.language);
    if ((kind === "definition" && query.mode === "references") ||
        (kind === "reference" && query.mode === "definitions")) continue;
    const matches: CodingSymbolMatch[] = kind === "definition" ? result.definitions : result.references;
    if (matches.length >= CODING_SYMBOL_LIMITS.perFileMatches) {
      result.truncated = true;
    } else {
      matches.push({
        path: source.path, line: token.line, column: token.offset - starts[token.line - 1] + 1,
        kind, language: source.language, text: snippet(source, token, starts),
      });
    }
  }
  return result;
}
