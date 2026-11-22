import type { Element, ElementContent } from "hast";
import { JSX_ATTR_NAME_RE, JSX_TAG_NAME_RE } from "../../constants/syntax";

const JSX_PRECEDING_KEYWORDS: Set<string> = new Set([
  "await",
  "case",
  "default",
  "else",
  "export",
  "in",
  "of",
  "return",
  "throw",
  "yield",
]);

const JSX_PRECEDING_CHARS: Set<string> = new Set([
  "(",
  "[",
  "{",
  ",",
  ";",
  ":",
  "=",
  "?",
  "&",
  "|",
  "!",
  ">",
]);

function makeSpan(className: string[], value: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { className },
    children: [{ type: "text", value }],
  };
}

function isComponentTagName(name: string): boolean {
  return /^[A-Z]/u.test(name) || name.includes(".");
}

function scanQuotedString(source: string, start: number, quote: string): number {
  let cursor: number = start + 1;
  while (cursor < source.length) {
    const ch: string = source[cursor];
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (ch === quote) {
      return cursor + 1;
    }
    cursor += 1;
  }
  return source.length;
}

function scanTemplateLiteral(source: string, start: number): number {
  let cursor: number = start + 1;
  while (cursor < source.length) {
    const ch: string = source[cursor];
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (ch === "`") {
      return cursor + 1;
    }
    if (ch === "$" && source[cursor + 1] === "{") {
      cursor = scanBalancedBrace(source, cursor + 1);
      continue;
    }
    cursor += 1;
  }
  return source.length;
}

function scanLineComment(source: string, start: number): number {
  let cursor: number = start + 2;
  while (cursor < source.length && source[cursor] !== "\n") {
    cursor += 1;
  }
  return cursor;
}

function scanBlockComment(source: string, start: number): number {
  const end: number = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

function scanRegexLiteral(source: string, start: number): number {
  let cursor: number = start + 1;
  let inClass: boolean = false;
  while (cursor < source.length) {
    const ch: string = source[cursor];
    if (ch === "\n" || ch === "\r") return start;
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (ch === "[") {
      inClass = true;
    } else if (ch === "]") {
      inClass = false;
    } else if (ch === "/" && !inClass) {
      cursor += 1;
      while (cursor < source.length && /[a-z]/iu.test(source[cursor])) cursor += 1;
      return cursor;
    }
    cursor += 1;
  }
  return start;
}

/**
 * Scans from an opening `{` at `start` to the index right after its matching `}`.
 * Respects strings, nested template literals, comments, and nested braces.
 */
function scanBalancedBrace(source: string, start: number): number {
  let depth: number = 1;
  let cursor: number = start + 1;
  while (cursor < source.length && depth > 0) {
    const ch: string = source[cursor];
    if (ch === "'" || ch === "\"") {
      cursor = scanQuotedString(source, cursor, ch);
      continue;
    }
    if (ch === "`") {
      cursor = scanTemplateLiteral(source, cursor);
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "/") {
      cursor = scanLineComment(source, cursor);
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "*") {
      cursor = scanBlockComment(source, cursor);
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    }
    cursor += 1;
  }
  return cursor;
}

function scanBalancedAngle(source: string, start: number): number {
  let depth: number = 1;
  let cursor: number = start + 1;
  while (cursor < source.length && depth > 0) {
    const ch: string = source[cursor];
    if (ch === "'" || ch === "\"") {
      cursor = scanQuotedString(source, cursor, ch);
      continue;
    }
    if (ch === "`") {
      cursor = scanTemplateLiteral(source, cursor);
      continue;
    }
    if (ch === "<") {
      depth += 1;
    } else if (ch === ">") {
      if (cursor > start + 1 && source[cursor - 1] === "=") {
        cursor += 1;
        continue;
      }
      depth -= 1;
    }
    cursor += 1;
  }
  return depth === 0 ? cursor : start;
}

function skipWs(source: string, start: number): number {
  let cursor: number = start;
  while (cursor < source.length && /\s/u.test(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function canStartJsxAt(source: string, pos: number): boolean {
  let cursor: number = pos - 1;
  while (cursor >= 0 && /\s/u.test(source[cursor])) {
    cursor -= 1;
  }
  if (cursor < 0) return true;
  const ch: string = source[cursor];
  if (JSX_PRECEDING_CHARS.has(ch)) {
    // Reject `>` unless it is `=>`
    if (ch === ">") return cursor > 0 && source[cursor - 1] === "=";
    return true;
  }
  if (/[A-Za-z0-9_$]/u.test(ch)) {
    let wordStart: number = cursor;
    while (wordStart > 0 && /[A-Za-z0-9_$]/u.test(source[wordStart - 1])) {
      wordStart -= 1;
    }
    const word: string = source.slice(wordStart, cursor + 1);
    return JSX_PRECEDING_KEYWORDS.has(word);
  }
  return false;
}

function canStartRegexAt(source: string, pos: number): boolean {
  let cursor: number = pos - 1;
  while (cursor >= 0 && /\s/u.test(source[cursor])) {
    cursor -= 1;
  }
  if (cursor < 0) return true;
  const ch: string = source[cursor];
  if ("([,{=:;!?&|^~+-*%<>".includes(ch)) return true;
  if (/[A-Za-z0-9_$]/u.test(ch)) {
    let wordStart: number = cursor;
    while (wordStart > 0 && /[A-Za-z0-9_$]/u.test(source[wordStart - 1])) {
      wordStart -= 1;
    }
    const word: string = source.slice(wordStart, cursor + 1);
    return JSX_PRECEDING_KEYWORDS.has(word) || word === "typeof" || word === "void" || word === "delete";
  }
  return false;
}

interface ScannedOpeningTag {
  tagName: string;
  selfClosing: boolean;
  next: number;
}

function scanOpeningTag(source: string, start: number): ScannedOpeningTag | null {
  if (source[start] !== "<") return null;

  // Fragment <>
  if (source[start + 1] === ">") {
    return { tagName: "", selfClosing: false, next: start + 2 };
  }

  const nameMatch: RegExpExecArray | null = JSX_TAG_NAME_RE.exec(source.slice(start + 1));
  if (!nameMatch) return null;

  const tagName: string = nameMatch[0];
  let cursor: number = start + 1 + tagName.length;

  // Reject TS generic arrow parameters like `<T,>` or `<T extends Foo>` or `<T = Foo>`
  const afterNameWs: number = skipWs(source, cursor);
  const nextChar: string | undefined = source[afterNameWs];
  if (nextChar === "," || nextChar === "=") return null;
  if (source.slice(afterNameWs).startsWith("extends") && /[\s<]/u.test(source[afterNameWs + 7] ?? "")) {
    return null;
  }

  // Optional TSX generic type arguments on component tag: <Select<Option> ...>
  if (source[cursor] === "<") {
    const genericEnd: number = scanBalancedAngle(source, cursor);
    if (genericEnd <= cursor) return null;
    cursor = genericEnd;
  }

  // Must see whitespace, `>`, or `/>` after tag name / generic args
  if (source[cursor] !== ">" && !(source[cursor] === "/" && source[cursor + 1] === ">") && !/\s/u.test(source[cursor] ?? "")) {
    return null;
  }

  let hasAttr: boolean = false;
  while (cursor < source.length) {
    cursor = skipWs(source, cursor);
    if (cursor >= source.length) return null;
    const ch: string = source[cursor];
    if (ch === ">") {
      // Reject `<T>(x: T) => ...` generic arrow function when tag has no attributes
      if (!hasAttr && source[skipWs(source, cursor + 1)] === "(") {
        return null;
      }
      return { tagName, selfClosing: false, next: cursor + 1 };
    }
    if (ch === "/" && source[cursor + 1] === ">") {
      return { tagName, selfClosing: true, next: cursor + 2 };
    }
    if (ch === "{") {
      hasAttr = true;
      const braceEnd: number = scanBalancedBrace(source, cursor);
      if (braceEnd <= cursor + 1 || source[braceEnd - 1] !== "}") return null;
      cursor = braceEnd;
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "/") {
      cursor = scanLineComment(source, cursor);
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "*") {
      cursor = scanBlockComment(source, cursor);
      continue;
    }

    const attrMatch: RegExpExecArray | null = JSX_ATTR_NAME_RE.exec(source.slice(cursor));
    if (!attrMatch) return null;
    hasAttr = true;
    cursor += attrMatch[0].length;
    const eqPos: number = skipWs(source, cursor);
    if (source[eqPos] === "=") {
      cursor = skipWs(source, eqPos + 1);
      const valChar: string | undefined = source[cursor];
      if (valChar === "\"" || valChar === "'") {
        cursor = scanQuotedString(source, cursor, valChar);
      } else if (valChar === "{") {
        const braceEnd: number = scanBalancedBrace(source, cursor);
        if (braceEnd <= cursor + 1 || source[braceEnd - 1] !== "}") return null;
        cursor = braceEnd;
      } else {
        return null;
      }
    }
  }
  return null;
}

function scanClosingTag(source: string, start: number): { tagName: string; next: number } | null {
  if (source[start] !== "<" || source[start + 1] !== "/") return null;
  let cursor: number = start + 2;
  let tagName: string = "";
  const closeMatch: RegExpExecArray | null = JSX_TAG_NAME_RE.exec(source.slice(cursor));
  if (closeMatch) {
    tagName = closeMatch[0];
    cursor += tagName.length;
  }
  cursor = skipWs(source, cursor);
  if (source[cursor] !== ">") return null;
  return { tagName, next: cursor + 1 };
}

/**
 * Scans a full balanced JSX element `<Tag ...>...</Tag>` or `<Tag ... />` starting at `start`.
 * Returns the end offset right after the closing tag, or `-1` if it is not a balanced JSX element.
 */
function scanJsxElementEnd(source: string, start: number): number {
  const open: ScannedOpeningTag | null = scanOpeningTag(source, start);
  if (!open) return -1;
  if (open.selfClosing) return open.next;

  const stack: string[] = [open.tagName];
  let cursor: number = open.next;

  while (cursor < source.length && stack.length > 0) {
    const ch: string = source[cursor];
    if (ch === "{") {
      const braceEnd: number = scanBalancedBrace(source, cursor);
      if (braceEnd <= cursor + 1 || source[braceEnd - 1] !== "}") return -1;
      cursor = braceEnd;
      continue;
    }
    if (ch === "<") {
      if (source[cursor + 1] === "/") {
        const close: { tagName: string; next: number } | null = scanClosingTag(source, cursor);
        if (!close) return -1;
        if (stack[stack.length - 1] !== close.tagName) return -1;
        stack.pop();
        cursor = close.next;
        continue;
      }
      const nested: ScannedOpeningTag | null = scanOpeningTag(source, cursor);
      if (nested) {
        if (!nested.selfClosing) stack.push(nested.tagName);
        cursor = nested.next;
        continue;
      }
    }
    cursor += 1;
  }

  return stack.length === 0 ? cursor : -1;
}

function emitBraceExpression(
  source: string,
  start: number,
  highlightCode: (code: string) => ElementContent[]
): { nodes: ElementContent[]; next: number } {
  const end: number = scanBalancedBrace(source, start);
  const closed: boolean = end > start + 1 && source[end - 1] === "}";
  const inner: string = closed ? source.slice(start + 1, end - 1) : source.slice(start + 1, end);
  const nodes: ElementContent[] = [makeSpan(["hljs-template-tag"], "{")];

  if (inner) {
    const trimmed: string = inner.trim();
    if (trimmed.startsWith("/*") && trimmed.endsWith("*/") && inner.indexOf("*/") === inner.lastIndexOf("*/")) {
      nodes.push(makeSpan(["hljs-comment"], inner));
    } else {
      nodes.push(...highlightCode(inner));
    }
  }
  if (closed) {
    nodes.push(makeSpan(["hljs-template-tag"], "}"));
  }
  return { nodes, next: end };
}

function emitTagName(name: string): ElementContent[] {
  if (!isComponentTagName(name)) {
    return [makeSpan(["hljs-name"], name)];
  }
  const parts: string[] = name.split(".");
  const out: ElementContent[] = [];
  for (let i: number = 0; i < parts.length; i += 1) {
    if (i > 0) out.push(makeSpan(["hljs-punctuation"], "."));
    out.push(makeSpan(["hljs-type"], parts[i]));
  }
  return out;
}

function emitOpeningOrClosingTag(
  source: string,
  start: number,
  highlightCode: (code: string) => ElementContent[]
): { nodes: ElementContent[]; next: number } {
  const nodes: ElementContent[] = [];
  let cursor: number = start;

  // Closing tag: </TagName> or </>
  if (source[cursor + 1] === "/") {
    nodes.push(makeSpan(["hljs-punctuation"], "</"));
    cursor += 2;
    const closeMatch: RegExpExecArray | null = JSX_TAG_NAME_RE.exec(source.slice(cursor));
    if (closeMatch) {
      nodes.push(...emitTagName(closeMatch[0]));
      cursor += closeMatch[0].length;
    }
    const wsStart: number = cursor;
    while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
    if (cursor > wsStart) nodes.push({ type: "text", value: source.slice(wsStart, cursor) });
    if (source[cursor] === ">") {
      nodes.push(makeSpan(["hljs-punctuation"], ">"));
      cursor += 1;
    }
    return { nodes, next: cursor };
  }

  // Opening tag or shorthand fragment <>
  if (source[cursor + 1] === ">") {
    nodes.push(makeSpan(["hljs-punctuation"], "<>"));
    return { nodes, next: cursor + 2 };
  }

  const nameMatch: RegExpExecArray | null = JSX_TAG_NAME_RE.exec(source.slice(cursor + 1));
  if (!nameMatch) {
    return { nodes: [{ type: "text", value: "<" }], next: cursor + 1 };
  }

  nodes.push(makeSpan(["hljs-punctuation"], "<"));
  cursor += 1;
  nodes.push(...emitTagName(nameMatch[0]));
  cursor += nameMatch[0].length;

  // Optional TSX generic type arguments on a component tag: <Select<Option> ...>
  if (source[cursor] === "<") {
    const genericEnd: number = scanBalancedAngle(source, cursor);
    if (genericEnd > cursor) {
      const innerType: string = source.slice(cursor + 1, genericEnd - 1);
      nodes.push(makeSpan(["hljs-punctuation"], "<"));
      if (innerType) nodes.push(...highlightCode(innerType));
      nodes.push(makeSpan(["hljs-punctuation"], ">"));
      cursor = genericEnd;
    }
  }

  // Scan attributes until > or />
  while (cursor < source.length) {
    const ch: string = source[cursor];
    if (ch === ">") {
      nodes.push(makeSpan(["hljs-punctuation"], ">"));
      cursor += 1;
      break;
    }
    if (ch === "/" && source[cursor + 1] === ">") {
      nodes.push(makeSpan(["hljs-punctuation"], "/>"));
      cursor += 2;
      break;
    }
    if (/\s/u.test(ch)) {
      const wsStart: number = cursor;
      while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
      nodes.push({ type: "text", value: source.slice(wsStart, cursor) });
      continue;
    }
    if (ch === "{") {
      const expr: { nodes: ElementContent[]; next: number } = emitBraceExpression(source, cursor, highlightCode);
      nodes.push(...expr.nodes);
      cursor = expr.next;
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "/") {
      const end: number = scanLineComment(source, cursor);
      nodes.push(makeSpan(["hljs-comment"], source.slice(cursor, end)));
      cursor = end;
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "*") {
      const end: number = scanBlockComment(source, cursor);
      nodes.push(makeSpan(["hljs-comment"], source.slice(cursor, end)));
      cursor = end;
      continue;
    }

    const attrMatch: RegExpExecArray | null = JSX_ATTR_NAME_RE.exec(source.slice(cursor));
    if (attrMatch) {
      nodes.push(makeSpan(["hljs-attr"], attrMatch[0]));
      cursor += attrMatch[0].length;

      const eqWsStart: number = cursor;
      while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
      if (source[cursor] === "=") {
        if (cursor > eqWsStart) nodes.push({ type: "text", value: source.slice(eqWsStart, cursor) });
        nodes.push(makeSpan(["hljs-operator"], "="));
        cursor += 1;

        const valWsStart: number = cursor;
        while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
        if (cursor > valWsStart) nodes.push({ type: "text", value: source.slice(valWsStart, cursor) });

        const valStartChar: string | undefined = source[cursor];
        if (valStartChar === "\"" || valStartChar === "'") {
          const strEnd: number = scanQuotedString(source, cursor, valStartChar);
          nodes.push(makeSpan(["hljs-string"], source.slice(cursor, strEnd)));
          cursor = strEnd;
        } else if (valStartChar === "{") {
          const expr: { nodes: ElementContent[]; next: number } = emitBraceExpression(source, cursor, highlightCode);
          nodes.push(...expr.nodes);
          cursor = expr.next;
        }
      } else if (cursor > eqWsStart) {
        nodes.push({ type: "text", value: source.slice(eqWsStart, cursor) });
      }
      continue;
    }

    nodes.push({ type: "text", value: ch });
    cursor += 1;
  }

  return { nodes, next: cursor };
}

/**
 * Recursively tokenizes a JSX/TSX subtree while preserving exact 1-to-1 plain text offsets.
 */
export function highlightJsxBlock(
  rawJsx: string,
  highlightCode: (code: string) => ElementContent[]
): ElementContent[] {
  const out: ElementContent[] = [];
  let cursor: number = 0;

  while (cursor < rawJsx.length) {
    const ch: string = rawJsx[cursor];
    if (ch === "<") {
      const tag: { nodes: ElementContent[]; next: number } = emitOpeningOrClosingTag(rawJsx, cursor, highlightCode);
      out.push(...tag.nodes);
      cursor = tag.next;
      continue;
    }
    if (ch === "{") {
      const expr: { nodes: ElementContent[]; next: number } = emitBraceExpression(rawJsx, cursor, highlightCode);
      out.push(...expr.nodes);
      cursor = expr.next;
      continue;
    }
    const textStart: number = cursor;
    while (cursor < rawJsx.length && rawJsx[cursor] !== "<" && rawJsx[cursor] !== "{") {
      cursor += 1;
    }
    out.push({ type: "text", value: rawJsx.slice(textStart, cursor) });
  }

  return out;
}

/**
 * Splits a TSX/JSX source string into TypeScript/JavaScript code chunks and balanced JSX
 * element slices, bypassing highlight.js's fragile JSX regex.
 */
export function highlightTsxSegments(
  source: string,
  highlightCodeChunk: (code: string) => ElementContent[],
  highlightEmbeddedTsx: (code: string) => ElementContent[]
): ElementContent[] {
  const out: ElementContent[] = [];
  let chunkStart: number = 0;
  let cursor: number = 0;

  while (cursor < source.length) {
    const ch: string = source[cursor];
    if (ch === "'" || ch === "\"") {
      cursor = scanQuotedString(source, cursor, ch);
      continue;
    }
    if (ch === "`") {
      cursor = scanTemplateLiteral(source, cursor);
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "/") {
      cursor = scanLineComment(source, cursor);
      continue;
    }
    if (ch === "/" && source[cursor + 1] === "*") {
      cursor = scanBlockComment(source, cursor);
      continue;
    }
    if (ch === "/" && canStartRegexAt(source, cursor)) {
      const regexEnd: number = scanRegexLiteral(source, cursor);
      if (regexEnd > cursor) {
        cursor = regexEnd;
        continue;
      }
    }
    if (ch === "<" && canStartJsxAt(source, cursor)) {
      const jsxEnd: number = scanJsxElementEnd(source, cursor);
      if (jsxEnd > cursor) {
        if (cursor > chunkStart) {
          out.push(...highlightCodeChunk(source.slice(chunkStart, cursor)));
        }
        out.push(...highlightJsxBlock(source.slice(cursor, jsxEnd), highlightEmbeddedTsx));
        cursor = jsxEnd;
        chunkStart = jsxEnd;
        continue;
      }
    }
    cursor += 1;
  }

  if (chunkStart < source.length) {
    out.push(...highlightCodeChunk(source.slice(chunkStart)));
  }
  return out;
}
