import type { Element, ElementContent, Root } from "hast";
import {
  EXTENSION_MAP,
  MARKDOWN_FENCE_ALIASES,
  MARKDOWN_FENCE_INFO_RE,
  MARKDOWN_FENCE_OPEN_RE,
  MARKDOWN_MAX_DEPTH,
} from "../../constants/syntax";
import { lowlight } from "./registry";

function makeSpan(className: string[], value: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { className },
    children: [{ type: "text", value }],
  };
}

function splitLinesPreservingEndings(source: string): string[] {
  const lines: string[] = [];
  let cursor: number = 0;
  while (cursor < source.length) {
    const lf: number = source.indexOf("\n", cursor);
    if (lf === -1) {
      lines.push(source.slice(cursor));
      break;
    }
    lines.push(source.slice(cursor, lf + 1));
    cursor = lf + 1;
  }
  return lines;
}

export function resolveMarkdownFenceLanguage(rawInfo: string): string | null {
  const trimmed: string = rawInfo.trim();
  if (!trimmed) return null;
  const infoMatch: RegExpExecArray | null = MARKDOWN_FENCE_INFO_RE.exec(trimmed);
  if (!infoMatch) return null;
  const rawToken: string = infoMatch[2].replace(/^\./u, "").toLowerCase();
  if (!rawToken) return null;
  const aliased: string | undefined = MARKDOWN_FENCE_ALIASES[rawToken] ?? EXTENSION_MAP[rawToken];
  if (aliased && lowlight.registered(aliased)) return aliased;
  if (lowlight.registered(rawToken)) return rawToken;
  return null;
}

function emitFenceOpenLine(parts: {
  indent: string;
  ticks: string;
  rawInfo: string;
  ending: string;
}): ElementContent[] {
  const { indent, ticks, rawInfo, ending }: typeof parts = parts;
  const out: ElementContent[] = [];
  if (indent) out.push({ type: "text", value: indent });
  out.push(makeSpan(["hljs-meta"], ticks));

  if (rawInfo) {
    const infoMatch: RegExpExecArray | null = MARKDOWN_FENCE_INFO_RE.exec(rawInfo);
    if (infoMatch) {
      const [, leadingSpaces, langToken, rest]: RegExpExecArray = infoMatch;
      if (leadingSpaces) out.push({ type: "text", value: leadingSpaces });
      out.push(makeSpan(["hljs-title"], langToken));
      if (rest) out.push(makeSpan(["hljs-meta"], rest));
    } else {
      out.push({ type: "text", value: rawInfo });
    }
  }
  if (ending) out.push({ type: "text", value: ending });
  return out;
}

function isMatchingCloseFence(
  line: string,
  fenceChar: string,
  fenceLength: number
): { indent: string; ticks: string; trailing: string } | null {
  let cursor: number = 0;
  while (cursor < line.length && (line[cursor] === " " || line[cursor] === "\t")) {
    cursor += 1;
  }
  const indent: string = line.slice(0, cursor);
  const tickStart: number = cursor;
  while (cursor < line.length && line[cursor] === fenceChar) {
    cursor += 1;
  }
  const ticks: string = line.slice(tickStart, cursor);
  if (ticks.length < fenceLength) return null;
  const trailing: string = line.slice(cursor);
  if (!/^[ \t]*(?:\r?\n)?$/u.test(trailing)) return null;
  return { indent, ticks, trailing };
}

export function highlightMarkdown(
  source: string,
  highlightCode: (code: string, language: string) => ElementContent[],
  depth: number = 0
): Root {
  if (!source) {
    return { type: "root", children: [] };
  }

  const lines: string[] = splitLinesPreservingEndings(source);
  const out: ElementContent[] = [];
  const proseBuffer: string[] = [];

  function flushProse(): void {
    if (!proseBuffer.length) return;
    const chunk: string = proseBuffer.join("");
    proseBuffer.length = 0;
    const highlighted: Root = lowlight.highlight("markdown", chunk);
    out.push(...(highlighted.children as ElementContent[]));
  }

  let index: number = 0;
  while (index < lines.length) {
    const line: string = lines[index];
    const openMatch: RegExpExecArray | null = MARKDOWN_FENCE_OPEN_RE.exec(line);
    if (!openMatch) {
      proseBuffer.push(line);
      index += 1;
      continue;
    }

    const [, indent, ticks, rawInfo, ending]: RegExpExecArray = openMatch;
    const fenceChar: string = ticks[0];
    // Per CommonMark, backtick fence info strings cannot contain backticks (prevents matching inline ```code```).
    if (fenceChar === "`" && rawInfo.includes("`")) {
      proseBuffer.push(line);
      index += 1;
      continue;
    }

    flushProse();
    out.push(...emitFenceOpenLine({ indent, ticks, rawInfo, ending }));
    index += 1;

    const codeLines: string[] = [];
    let closeFence: { indent: string; ticks: string; trailing: string } | null = null;
    while (index < lines.length) {
      const candidate: string = lines[index];
      const matchedClose: { indent: string; ticks: string; trailing: string } | null = isMatchingCloseFence(
        candidate,
        fenceChar,
        ticks.length
      );
      if (matchedClose) {
        closeFence = matchedClose;
        index += 1;
        break;
      }
      codeLines.push(candidate);
      index += 1;
    }

    const codeBody: string = codeLines.join("");
    if (codeBody) {
      const resolvedLanguage: string | null = resolveMarkdownFenceLanguage(rawInfo);
      if (resolvedLanguage === "markdown" && depth < MARKDOWN_MAX_DEPTH) {
        const nested: Root = highlightMarkdown(codeBody, highlightCode, depth + 1);
        out.push(...(nested.children as ElementContent[]));
      } else if (resolvedLanguage && lowlight.registered(resolvedLanguage)) {
        out.push(...highlightCode(codeBody, resolvedLanguage));
      } else {
        out.push(makeSpan(["hljs-code"], codeBody));
      }
    }

    if (closeFence) {
      if (closeFence.indent) out.push({ type: "text", value: closeFence.indent });
      out.push(makeSpan(["hljs-meta"], closeFence.ticks));
      if (closeFence.trailing) out.push({ type: "text", value: closeFence.trailing });
    }
  }

  flushProse();
  return { type: "root", children: out };
}
