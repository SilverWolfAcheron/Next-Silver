import type { Element, ElementContent, Root } from "hast";
import {
  CODE_LANGUAGES,
  CODE_TOKEN_RE,
  CONST_DECLARATION_KEYWORDS,
  CONTROL_KEYWORDS,
  PRINTF_LANGUAGES,
  RUST_FORMAT_RE,
  STRING_ESCAPE_RE,
  SUBST_DELIMITERS,
  TS_PRIMITIVE_TYPES,
  WALKABLE_WRAPPERS,
} from "../../constants/syntax";
import { highlightJsxBlock } from "./jsx";

interface EnhanceCodeOptions {
  inheritedConstants?: Set<string>;
  onDeclaredConstants?: (declared: Set<string>) => void;
  highlightEmbedded?: (code: string, constants: Set<string>) => ElementContent[];
}

function getClasses(node: Element): string[] {
  const raw: unknown = node.properties?.className;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(/\s+/u).filter(Boolean);
  return [];
}

function getPlainText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(getPlainText).join("");
  return "";
}

function isAllCapsConstant(ident: string): boolean {
  return ident.length >= 2 && /^[A-Z][A-Z0-9_]+$/u.test(ident) && /[A-Z].*[A-Z_]/u.test(ident);
}

function isPascalType(ident: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/u.test(ident) && /[a-z]/u.test(ident);
}

function isWalkableElement(node: Element): boolean {
  const classes: string[] = getClasses(node);
  return classes.length > 0 && classes.every((cls: string): boolean => WALKABLE_WRAPPERS.has(cls));
}

function collectDeclaredConstants(nodes: ElementContent[], language: string): Set<string> {
  const constants: Set<string> = new Set();
  const flat: { kind: "keyword" | "ident" | "symbol" | "other"; value: string; inParams: boolean }[] = [];

  function collectFlat(list: ElementContent[], inParams: boolean): void {
    for (const node of list) {
      if (node.type === "text") {
        CODE_TOKEN_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = CODE_TOKEN_RE.exec(node.value)) !== null) {
          const [raw, ident, num, arrowOrScope, punct, op]: RegExpExecArray = match;
          if (ident) flat.push({ kind: "ident", value: ident, inParams });
          else if (num) flat.push({ kind: "other", value: num, inParams });
          else if (arrowOrScope || punct || op) flat.push({ kind: "symbol", value: raw, inParams });
          else if (raw.includes("\n")) flat.push({ kind: "other", value: "\n", inParams });
        }
      } else if (node.type === "element") {
        const classes: string[] = getClasses(node);
        const text: string = getPlainText(node).trim();
        if (classes.includes("hljs-keyword") || (classes.includes("hljs-type") && CONST_DECLARATION_KEYWORDS.has(text))) {
          flat.push({ kind: "keyword", value: text, inParams });
        } else if (classes.includes("hljs-variable")) {
          if (classes.includes("constant_") && text) constants.add(text);
          else if (text) flat.push({ kind: "ident", value: text, inParams });
        } else if (classes.includes("hljs-attr") && text && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(text)) {
          flat.push({ kind: "ident", value: text, inParams });
        } else if (isWalkableElement(node)) {
          collectFlat(node.children, inParams || classes.includes("hljs-params"));
        } else {
          flat.push({ kind: "other", value: text, inParams });
        }
      }
    }
  }

  collectFlat(nodes, false);

  for (let i: number = 0; i < flat.length; i += 1) {
    const tok: { kind: "keyword" | "ident" | "symbol" | "other"; value: string; inParams: boolean; } = flat[i];
    if (tok.inParams || tok.kind !== "keyword" || !CONST_DECLARATION_KEYWORDS.has(tok.value)) continue;
    if (tok.value === "static" && (language === "java" || language === "csharp" || language === "cpp" || language === "c")) {
      continue;
    }

    const next: { kind: "keyword" | "ident" | "symbol" | "other"; value: string; inParams: boolean; } = flat[i + 1];
    if (!next) continue;

    if (language === "go" && tok.value === "const" && next.kind === "symbol" && next.value.startsWith("(")) {
      let depth: number = 0;
      let expectLineIdent: boolean = true;
      for (let j: number = i + 1; j < flat.length; j += 1) {
        const cur: { kind: "keyword" | "ident" | "symbol" | "other"; value: string; inParams: boolean; } = flat[j];
        if (cur.kind === "symbol") {
          for (const ch of cur.value) {
            if (ch === "(") depth += 1;
            else if (ch === ")") depth -= 1;
          }
          if (depth <= 0) {
            i = j;
            break;
          }
        } else if (cur.kind === "other" && cur.value === "\n") {
          expectLineIdent = true;
        } else if (expectLineIdent && cur.kind === "ident") {
          constants.add(cur.value);
          expectLineIdent = false;
        }
      }
      continue;
    }

    if (
      (language === "typescript" || language === "javascript") &&
      tok.value === "const" &&
      next.kind === "symbol" &&
      (next.value.startsWith("{") || next.value.startsWith("["))
    ) {
      const openCh: string = next.value[0];
      const closeCh: string = openCh === "{" ? "}" : "]";
      let depth: number = 0;
      let skipDefault: boolean = false;
      let pendingName: string | null = null;
      let afterColon: boolean = false;
      for (let j: number = i + 1; j < flat.length; j += 1) {
        const cur: { kind: "keyword" | "ident" | "symbol" | "other"; value: string; inParams: boolean; } = flat[j];
        if (cur.kind === "symbol") {
          for (const ch of cur.value) {
            if (ch === openCh) depth += 1;
            else if (ch === closeCh) depth -= 1;
            else if (depth === 1 && ch === ",") {
              if (pendingName) constants.add(pendingName);
              pendingName = null;
              skipDefault = false;
              afterColon = false;
            } else if (depth === 1 && ch === "=") {
              if (pendingName) constants.add(pendingName);
              pendingName = null;
              skipDefault = true;
            } else if (depth === 1 && ch === ":" && openCh === "{") {
              pendingName = null;
              afterColon = true;
            }
          }
          if (depth <= 0) {
            if (pendingName) constants.add(pendingName);
            i = j;
            break;
          }
        } else if (depth === 1 && !skipDefault && cur.kind === "ident") {
          if (openCh === "[" || afterColon || pendingName === null) {
            pendingName = cur.value;
            afterColon = false;
          }
        }
      }
      continue;
    }

    let candidate: string | null = null;
    for (let j: number = i + 1; j < Math.min(flat.length, i + 10); j += 1) {
      const cur: { kind: "keyword" | "ident" | "symbol" | "other"; value: string; inParams: boolean; } = flat[j];
      if (cur.kind === "other" && cur.value === "\n") break;
      if (cur.kind === "symbol" && (cur.value.includes(";") || cur.value.includes("{") || cur.value.includes(")"))) break;
      if (cur.kind === "symbol" && cur.value === "=") {
        if (candidate) constants.add(candidate);
        break;
      }
      if (cur.kind === "symbol" && cur.value === ":" && (language === "rust" || language === "typescript")) {
        if (candidate) constants.add(candidate);
        break;
      }
      if (cur.kind === "ident") {
        if (language === "go" || language === "rust" || language === "typescript" || language === "javascript") {
          candidate = candidate ?? cur.value;
        } else {
          candidate = cur.value;
        }
      }
    }
  }

  return constants;
}

function firstNonSpaceChar(nodes: ElementContent[], startIndex: number): string {
  for (let i: number = startIndex; i < nodes.length; i += 1) {
    const text: string = getPlainText(nodes[i]);
    const trimmed: string = text.trimStart();
    if (trimmed) return trimmed[0];
  }
  return "";
}

export function enhanceCodeHast(root: Root, language: string, options?: EnhanceCodeOptions): Root {
  if (!CODE_LANGUAGES.has(language)) return root;

  const children: ElementContent[] = root.children as ElementContent[];
  const constants: Set<string> = collectDeclaredConstants(children, language);
  options?.onDeclaredConstants?.(constants);
  if (options?.inheritedConstants) {
    for (const name of options.inheritedConstants) constants.add(name);
  }
  let prevToken: string = "";

  function makeSpan(className: string[], value: string): Element {
    return {
      type: "element",
      tagName: "span",
      properties: { className },
      children: [{ type: "text", value }],
    };
  }

  function tokenizeText(value: string, followingChar: string): ElementContent[] {
    const out: ElementContent[] = [];
    const tokens: { raw: string; kind: "ident" | "num" | "scope" | "punct" | "op" | "other" }[] = [];
    CODE_TOKEN_RE.lastIndex = 0;
    let cursor: number = 0;
    let match: RegExpExecArray | null;
    while ((match = CODE_TOKEN_RE.exec(value)) !== null) {
      if (match.index > cursor) {
        tokens.push({ raw: value.slice(cursor, match.index), kind: "other" });
      }
      const [raw, ident, num, scope, punct, op]: RegExpExecArray = match;
      if (ident) tokens.push({ raw, kind: "ident" });
      else if (num) tokens.push({ raw, kind: "num" });
      else if (scope) tokens.push({ raw, kind: "scope" });
      else if (punct) tokens.push({ raw, kind: "punct" });
      else if (op) tokens.push({ raw, kind: "op" });
      else tokens.push({ raw, kind: "other" });
      cursor = match.index + raw.length;
    }
    if (cursor < value.length) {
      tokens.push({ raw: value.slice(cursor), kind: "other" });
    }

    function nextNonSpaceToken(from: number): string {
      for (let i: number = from; i < tokens.length; i += 1) {
        const trimmed: string = tokens[i].raw.trim();
        if (trimmed) return trimmed;
      }
      return followingChar;
    }

    for (let i: number = 0; i < tokens.length; i += 1) {
      const tok: { raw: string; kind: "ident" | "num" | "scope" | "punct" | "op" | "other"; } = tokens[i];
      if (tok.kind === "other") {
        out.push({ type: "text", value: tok.raw });
        const trimmed: string = tok.raw.trim();
        if (trimmed) prevToken = trimmed;
        continue;
      }
      if (tok.kind === "num") {
        out.push(makeSpan(["hljs-number"], tok.raw));
        prevToken = tok.raw;
        continue;
      }
      if (tok.kind === "punct") {
        out.push(makeSpan(["hljs-punctuation"], tok.raw));
        prevToken = tok.raw[tok.raw.length - 1];
        continue;
      }
      if (tok.kind === "scope") {
        out.push(makeSpan(["hljs-punctuation"], tok.raw));
        prevToken = tok.raw;
        continue;
      }
      if (tok.kind === "op") {
        out.push(makeSpan(["hljs-operator"], tok.raw));
        prevToken = tok.raw;
        continue;
      }

      const ident: string = tok.raw;
      const next: string = nextNonSpaceToken(i + 1);
      const isCall: boolean = next.startsWith("(");
      const isNamespace: boolean = next === "::";
      const isMember: boolean = prevToken === "." || prevToken === "->";

      if (isCall) {
        out.push(makeSpan(["hljs-title", "function_", "invoke__"], ident));
      } else if (isNamespace) {
        out.push(makeSpan(["hljs-type"], ident));
      } else if (!isMember && (constants.has(ident) || isAllCapsConstant(ident))) {
        out.push(makeSpan(["hljs-variable", "constant_"], ident));
      } else if (isMember) {
        out.push(makeSpan(isAllCapsConstant(ident) ? ["hljs-variable", "constant_"] : ["hljs-property"], ident));
      } else if (isPascalType(ident)) {
        out.push(makeSpan(["hljs-type"], ident));
      } else if (
        language === "typescript" &&
        !isMember &&
        TS_PRIMITIVE_TYPES.has(ident) &&
        (prevToken === ":" || prevToken === "|" || prevToken === "&" || prevToken === "<" || prevToken === ",")
      ) {
        out.push(makeSpan(["hljs-type"], ident));
      } else if (/^[A-Z]$/u.test(ident) && (prevToken === "<" || prevToken === ":" || prevToken === "->" || prevToken === "&" || prevToken === ",")) {
        out.push(makeSpan(["hljs-type"], ident));
      } else {
        out.push(makeSpan(["hljs-variable"], ident));
      }
      prevToken = ident;
    }

    return out;
  }

  function tokenizeStringEscapes(value: string): ElementContent[] {
    if (!value || (!value.includes("\\") && !(PRINTF_LANGUAGES.has(language) && value.includes("%")))) {
      return [{ type: "text", value }];
    }
    const allowPrintf: boolean = PRINTF_LANGUAGES.has(language);
    const out: ElementContent[] = [];
    let lastIndex: number = 0;
    STRING_ESCAPE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STRING_ESCAPE_RE.exec(value)) !== null) {
      const [full, esc, verb]: RegExpExecArray = match;
      if (verb && !allowPrintf) continue;
      if (match.index > lastIndex) {
        out.push({ type: "text", value: value.slice(lastIndex, match.index) });
      }
      out.push(makeSpan(["hljs-char", "escape_"], esc ?? full));
      lastIndex = match.index + full.length;
    }
    if (lastIndex === 0) return [{ type: "text", value }];
    if (lastIndex < value.length) {
      out.push({ type: "text", value: value.slice(lastIndex) });
    }
    return out;
  }

  function tokenizeStringText(value: string): ElementContent[] {
    if (!value) return [];

    if (language === "rust" && value.includes("{")) {
      const out: ElementContent[] = [];
      let lastIndex: number = 0;
      RUST_FORMAT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RUST_FORMAT_RE.exec(value)) !== null) {
        if (match.index > lastIndex) {
          out.push(...tokenizeStringEscapes(value.slice(lastIndex, match.index)));
        }
        const [full, escapedBrace, ident, spec]: RegExpExecArray = match;
        if (escapedBrace) {
          out.push(makeSpan(["hljs-char", "escape_"], escapedBrace));
        } else {
          out.push(makeSpan(["hljs-template-tag"], "{"));
          if (ident) {
            if (/^[0-9]+$/u.test(ident)) {
              out.push(makeSpan(["hljs-number"], ident));
            } else if (constants.has(ident) || isAllCapsConstant(ident)) {
              out.push(makeSpan(["hljs-variable", "constant_"], ident));
            } else {
              out.push(makeSpan(["hljs-variable"], ident));
            }
          }
          if (spec) {
            out.push(makeSpan(["hljs-meta"], spec));
          }
          out.push(makeSpan(["hljs-template-tag"], "}"));
        }
        lastIndex = match.index + full.length;
      }
      if (lastIndex === 0) return tokenizeStringEscapes(value);
      if (lastIndex < value.length) {
        out.push(...tokenizeStringEscapes(value.slice(lastIndex)));
      }
      return out;
    }

    return tokenizeStringEscapes(value);
  }

  function splitFormatSpec(nodes: ElementContent[]): { expr: ElementContent[]; spec: string } {
    if (language !== "python" && language !== "csharp") {
      return { expr: nodes, spec: "" };
    }
    const fullText: string = nodes.map(getPlainText).join("");
    let depth: number = 0;
    let splitAt: number = -1;
    let sawQuestion: boolean = false;
    for (let i: number = 0; i < fullText.length; i += 1) {
      const ch: string = fullText[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0 && ch === "?") sawQuestion = true;
      else if (depth === 0 && ch === ":" && fullText[i + 1] !== "=" && !sawQuestion) {
        splitAt = i;
        break;
      }
    }
    if (splitAt < 0) return { expr: nodes, spec: "" };

    const expr: ElementContent[] = [];
    let remaining: number = splitAt;
    for (const child of nodes) {
      if (remaining <= 0) break;
      const len: number = getPlainText(child).length;
      if (len <= remaining) {
        expr.push(child);
        remaining -= len;
      } else if (child.type === "text") {
        expr.push({ type: "text", value: child.value.slice(0, remaining) });
        remaining = 0;
      } else {
        expr.push({ type: "text", value: getPlainText(child).slice(0, remaining) });
        remaining = 0;
      }
    }
    return { expr, spec: fullText.slice(splitAt) };
  }

  function transformSubst(node: Element): Element {
    const savedPrev: string = prevToken;
    prevToken = "";
    const inner: ElementContent[] = [...node.children];
    let openDelim: string = "";
    let closeDelim: string = "";

    const first: ElementContent = inner[0];
    const last: ElementContent = inner[inner.length - 1];
    if (first?.type === "text" && last?.type === "text") {
      for (const [open, close] of SUBST_DELIMITERS) {
        const canSplitSingle: boolean = inner.length === 1
          ? first.value.length >= open.length + close.length && first.value.startsWith(open) && first.value.endsWith(close)
          : first.value.startsWith(open) && last.value.endsWith(close);
        if (canSplitSingle) {
          openDelim = open;
          closeDelim = close;
          if (inner.length === 1) {
            const middle: string = first.value.slice(open.length, first.value.length - close.length);
            inner.splice(0, 1, ...(middle ? [{ type: "text" as const, value: middle }] : []));
          } else {
            const trimmedFirst: string = first.value.slice(open.length);
            const trimmedLast: string = last.value.slice(0, last.value.length - close.length);
            inner[0] = { type: "text", value: trimmedFirst };
            inner[inner.length - 1] = { type: "text", value: trimmedLast };
            if (!trimmedLast) inner.pop();
            if (!trimmedFirst) inner.shift();
          }
          break;
        }
      }
    }

    const { expr, spec }: { expr: ElementContent[]; spec: string; } = splitFormatSpec(inner);
    const transformed: ElementContent[] = [];
    if (openDelim) transformed.push(makeSpan(["hljs-template-tag"], openDelim));
    transformed.push(...transform(expr));
    if (spec) transformed.push(makeSpan(["hljs-meta"], spec));
    if (closeDelim) transformed.push(makeSpan(["hljs-template-tag"], closeDelim));

    prevToken = savedPrev;
    return { ...node, children: transformed };
  }

  function transformString(node: Element): Element {
    const childrenOut: ElementContent[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        childrenOut.push(...tokenizeStringText(child.value));
      } else if (child.type === "element") {
        const classes: string[] = getClasses(child);
        if (classes.includes("hljs-subst")) {
          childrenOut.push(transformSubst(child));
        } else if (classes.includes("hljs-variable") && !classes.includes("constant_")) {
          const bare: string = getPlainText(child).replace(/^\$\{?|\}$/gu, "");
          if (constants.has(bare) || isAllCapsConstant(bare)) {
            childrenOut.push({
              ...child,
              properties: { ...child.properties, className: [...classes, "constant_"] },
            });
          } else {
            childrenOut.push(child);
          }
        } else {
          childrenOut.push(child);
        }
      } else {
        childrenOut.push(child);
      }
    }
    return { ...node, children: childrenOut };
  }

  function transformJsxXml(node: Element): Element {
    const rawJsx: string = getPlainText(node);
    const highlightEmbedded: (code: string) => ElementContent[] = (code: string): ElementContent[] => {
      if (options?.highlightEmbedded) {
        return options.highlightEmbedded(code, constants);
      }
      const savedPrev: string = prevToken;
      prevToken = "";
      const fallback: ElementContent[] = tokenizeText(code, "}");
      prevToken = savedPrev;
      return fallback;
    };
    return {
      ...node,
      children: highlightJsxBlock(rawJsx, highlightEmbedded),
    };
  }

  function transform(list: ElementContent[]): ElementContent[] {
    const result: ElementContent[] = [];
    for (let i: number = 0; i < list.length; i += 1) {
      const node: ElementContent = list[i];
      if (node.type === "text") {
        const following: string = firstNonSpaceChar(list, i + 1);
        result.push(...tokenizeText(node.value, following));
      } else if (node.type === "element") {
        const classes: string[] = getClasses(node);
        const text: string = getPlainText(node).trim();

        if (classes.includes("hljs-keyword") && CONTROL_KEYWORDS.has(text) && !classes.includes("control_")) {
          result.push({
            ...node,
            properties: { ...node.properties, className: [...classes, "control_"] },
          });
          prevToken = text;
        } else if (
          (language === "typescript" || language === "javascript") &&
          classes.includes("hljs-attr") &&
          (prevToken === "const" || prevToken === "let" || prevToken === "var")
        ) {
          result.push({
            ...node,
            properties: {
              ...node.properties,
              className: prevToken === "const" ? ["hljs-variable", "constant_"] : ["hljs-variable"],
            },
          });
          prevToken = text;
        } else if (
          classes.includes("hljs-variable") &&
          !classes.includes("language_") &&
          !classes.includes("constant_") &&
          (constants.has(text) || isAllCapsConstant(text))
        ) {
          result.push({
            ...node,
            properties: { ...node.properties, className: [...classes, "constant_"] },
          });
          prevToken = text;
        } else if (classes.includes("hljs-string")) {
          result.push(transformString(node));
          prevToken = text;
        } else if (classes.includes("hljs-subst")) {
          result.push(transformSubst(node));
          prevToken = text;
        } else if ((language === "typescript" || language === "javascript") && classes.includes("xml")) {
          result.push(transformJsxXml(node));
          prevToken = text;
        } else if (isWalkableElement(node)) {
          result.push({
            ...node,
            children: transform(node.children),
          });
        } else {
          result.push(node);
          if (text && !classes.includes("hljs-comment")) {
            prevToken = text;
          }
        }
      } else {
        result.push(node);
      }
    }
    return result;
  }

  return {
    ...root,
    children: transform(children),
  };
}
