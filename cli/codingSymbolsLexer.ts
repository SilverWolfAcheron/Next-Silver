import {
  CODING_SYMBOL_IDENTIFIER_AT, CODING_SYMBOL_LIMITS, CODING_SYMBOL_NUMBER_AT, JS_EXPRESSION_START,
} from "../src/constants/codingSymbols.ts";
import type { CodingSymbolLanguage, CodingSymbolToken } from "../src/types/codingSymbols";

interface LexState {
  offset: number;
  line: number;
  tokens: CodingSymbolToken[];
  templateExpressions: number[];
}

function isJavaScript(language: CodingSymbolLanguage): boolean {
  return language === "typescript" || language === "javascript";
}

function lineEnd(content: string, offset: number): number {
  const newline: number = content.indexOf("\n", offset);
  return newline < 0 ? content.length : newline;
}

function advance(state: LexState, content: string, end: number): void {
  // Only skipped spans need this; inner tokenization retains physical UTF-16 offsets.
  for (let i: number = state.offset; i < end; i++) {
    if (content[i] === "\n") state.line++;
  }
  state.offset = end;
}

function blockComment(content: string, start: number, nested: boolean): number {
  let depth: number = 1;
  for (let i: number = start + 2; i < content.length; i++) {
    if (content[i] === "*" && content[i + 1] === "/") {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    } else if (nested && content[i] === "/" && content[i + 1] === "*") {
      depth++;
      i++;
    }
  }
  return content.length;
}

function quotedEnd(content: string, start: number, quote: string): number {
  const multiline: boolean = quote.length === 3 || quote === "`";
  for (let i: number = start + quote.length; i < content.length; i++) {
    if (content.startsWith(quote, i)) return i + quote.length;
    if (!multiline && content[i] === "\n") return i;
    if (content[i] === "\\") i++;
  }
  return content.length;
}

function goRawEnd(content: string, start: number): number {
  const index: number = content.indexOf("`", start + 1);
  return index < 0 ? content.length : index + 1;
}

function rustRawEnd(content: string, start: number): number | undefined {
  let offset: number = start;
  if (content[offset] === "b" || content[offset] === "c") offset++;
  if (content[offset] !== "r") return undefined;
  offset++;
  const opening: number = offset;
  while (content[offset] === "#") offset++;
  if (content[offset] !== '"') return undefined;
  const end: string = '"' + content.slice(opening, offset);
  const close: number = content.indexOf(end, offset + 1);
  return close < 0 ? content.length : close + end.length;
}

function pythonStringOffset(content: string, start: number): number {
  const prefix: string = content.slice(start, start + 2).toLowerCase();
  if (["br", "fr", "rb", "rf"].includes(prefix) && /["']/u.test(content[start + 2] ?? "")) return start + 2;
  if (/[bfru]/iu.test(content[start]) && /["']/u.test(content[start + 1] ?? "")) return start + 1;
  return start;
}

function rustLifetimeEnd(content: string, start: number): number | undefined {
  CODING_SYMBOL_IDENTIFIER_AT.lastIndex = start + 1;
  const word: RegExpExecArray | null = CODING_SYMBOL_IDENTIFIER_AT.exec(content);
  if (word && content[CODING_SYMBOL_IDENTIFIER_AT.lastIndex] !== "'") {
    return start + 1 + word[0].length;
  }
}

function regexLiteralEnd(content: string, start: number): number | undefined {
  let characterClass: boolean = false;
  // This is speculative: on an expression-shaped slash, don't repeatedly scan
  // the rest of a pathological line searching for an absent closing delimiter.
  const limit: number = Math.min(content.length, start + CODING_SYMBOL_LIMITS.regexLookahead);
  for (let i: number = start + 1; i < limit; i++) {
    const character: string = content[i];
    if (character === "\n" || character === "\r") return undefined;
    if (character === "\\") {
      i++;
      continue;
    }
    if (character === "[") characterClass = true;
    if (character === "]") characterClass = false;
    if (character === "/" && !characterClass) {
      let end: number = i + 1;
      while (end < content.length && /[a-z]/iu.test(content[end])) end++;
      return end;
    }
  }
}

function opaqueEnd(state: LexState, content: string, language: CodingSymbolLanguage): number | undefined {
  const offset: number = state.offset;
  let quoteOffset: number = offset;
  const char: string = content[offset];
  const previous: CodingSymbolToken | undefined = state.tokens.at(-1);
  const js: boolean = isJavaScript(language);
  if (language === "rust") {
    const raw: number | undefined = rustRawEnd(content, offset);
    if (raw !== undefined) return raw;
    if ((char === "b" || char === "c") && /["']/u.test(content[offset + 1] ?? "")) quoteOffset++;
    if (char === "'") {
      const lifetime: number | undefined = rustLifetimeEnd(content, offset);
      if (lifetime !== undefined) return lifetime;
    }
  }
  if (js && char === "/" && previous?.kind !== "opaque" && JS_EXPRESSION_START.has(previous?.value ?? "")) {
    const regex: number | undefined = regexLiteralEnd(content, offset);
    if (regex !== undefined) return regex;
  }
  if (language === "python") quoteOffset = pythonStringOffset(content, offset);
  const quoteChar: string = content[quoteOffset];
  if (quoteChar === '"' || quoteChar === "'") {
    const triple: string = quoteChar.repeat(3);
    const quote: string = language === "python" && content.startsWith(triple, quoteOffset) ? triple : quoteChar;
    return quotedEnd(content, quoteOffset, quote);
  }
  if (char === "`") {
    if (language === "go") return goRawEnd(content, offset);
    if (js && state.templateExpressions.length >= CODING_SYMBOL_LIMITS.templateDepth) return quotedEnd(content, offset, char);
  }
}

function commentEnd(content: string, start: number, language: CodingSymbolLanguage): number | undefined {
  const character: string = content[start];
  if (language === "python") {
    if (character === "#") return lineEnd(content, start);
    return undefined;
  }
  if (character === "/" && content[start + 1] === "/") return lineEnd(content, start);
  if (character === "/" && content[start + 1] === "*") return blockComment(content, start, language === "rust");
  if (start === 0 && content.startsWith("#!") && !content.startsWith("#![")) return lineEnd(content, start);
}

function emit(state: LexState, kind: CodingSymbolToken["kind"], value: string): void {
  state.tokens.push({ kind, value, offset: state.offset, line: state.line });
}

function punctuation(content: string, offset: number): string {
  const two: string = content.slice(offset, offset + 2);
  return /^(?:=>|:=|::|\?\.|&&|\|\||==|!=|<=|>=|\+\+|--|\*\*|->)$/u.test(two) ? two : content[offset];
}

function templateSegment(state: LexState, content: string): void {
  emit(state, "opaque", "");
  for (let i: number = state.offset; i < content.length; i++) {
    if (content[i] === "`") {
      advance(state, content, i + 1);
      return;
    }
    if (content[i] === "\\") {
      i++;
      continue;
    }
    if (content[i] === "$" && content[i + 1] === "{") {
      advance(state, content, i + 1);
      emit(state, "punctuation", "{");
      state.offset++;
      state.templateExpressions.push(1);
      return;
    }
  }
  advance(state, content, content.length);
}

function templateBrace(state: LexState, content: string, value: string): void {
  const frame: number = state.templateExpressions.length - 1;
  if (frame < 0 || (value !== "{" && value !== "}")) return;
  state.templateExpressions[frame] += value === "{" ? 1 : -1;
  if (state.templateExpressions[frame] === 0) {
    state.templateExpressions.pop();
    templateSegment(state, content);
  }
}

/**
 * Lightweight navigation lexer, not a compiler. Comments and literal text are
 * opaque, but JavaScript template interpolations are code. Opaque tokens preserve
 * the boundary between tokens on either side of a literal.
 */
export function tokenizeCodingSource(
  content: string, language: CodingSymbolLanguage, signal?: AbortSignal
): CodingSymbolToken[] {
  const state: LexState = { offset: 0, line: 1, tokens: [], templateExpressions: [] };
  while (state.offset < content.length) {
    signal?.throwIfAborted();
    const char: string = content[state.offset];
    if (/\s/u.test(char)) {
      if (char === "\n") state.line++;
      state.offset++;
      continue;
    }
    const comment: number | undefined = commentEnd(content, state.offset, language);
    if (comment !== undefined) {
      advance(state, content, comment);
      continue;
    }
    if (char === "`" && isJavaScript(language) && state.templateExpressions.length < CODING_SYMBOL_LIMITS.templateDepth) {
      state.offset++;
      templateSegment(state, content);
      continue;
    }
    const opaque: number | undefined = opaqueEnd(state, content, language);
    if (opaque !== undefined) {
      emit(state, "opaque", "");
      advance(state, content, opaque);
      continue;
    }
    CODING_SYMBOL_IDENTIFIER_AT.lastIndex = state.offset;
    const identifier: RegExpExecArray | null = CODING_SYMBOL_IDENTIFIER_AT.exec(content);
    if (identifier) {
      emit(state, "identifier", identifier[0]);
      state.offset += identifier[0].length;
      continue;
    }
    CODING_SYMBOL_NUMBER_AT.lastIndex = state.offset;
    const number: RegExpExecArray | null = CODING_SYMBOL_NUMBER_AT.exec(content);
    if (number) {
      emit(state, "opaque", "");
      state.offset += number[0].length;
      continue;
    }
    const value: string = punctuation(content, state.offset);
    emit(state, "punctuation", value);
    state.offset += value.length;
    templateBrace(state, content, value);
  }
  return state.tokens;
}
