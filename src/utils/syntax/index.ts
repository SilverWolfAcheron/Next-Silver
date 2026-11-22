import type { ElementContent, Root } from "hast";
import { MAX_HIGHLIGHT_CHARS } from "../../constants/editor";
import { JSX_MAX_DEPTH } from "../../constants/syntax";
import type { HighlightedDocument } from "../../types/editor";
import { detectLanguage, languageLabel } from "./detect";
import { highlightDiffLines as highlightDiffLinesWith } from "./diffHighlight";
import type { DiffHighlightInputLine } from "./diffHighlight";
import { enhanceCodeHast } from "./enhance";
import { highlightTsxSegments } from "./jsx";
import { highlightMarkdown } from "./markdown";
import { lowlight } from "./registry";

export { MAX_HIGHLIGHT_CHARS } from "../../constants/editor";
export type { HighlightedDocument } from "../../types/editor";
export { detectLanguage, languageLabel } from "./detect";
export { stripDiffPrefixChar } from "./diffHighlight";
export type { DiffHighlightInputLine } from "./diffHighlight";

function isJsxPath(path?: string): boolean {
  if (!path) return false;
  const lower: string = path.toLowerCase();
  return lower.endsWith(".tsx") || lower.endsWith(".jsx");
}

function highlightCodeLanguage(
  source: string,
  language: string,
  options?: { depth?: number; inheritedConstants?: Set<string>; jsx?: boolean }
): Root {
  const depth: number = options?.depth ?? 0;
  const isJsx: boolean = Boolean(options?.jsx) && (language === "typescript" || language === "javascript");

  if (isJsx && depth < JSX_MAX_DEPTH) {
    const scopeConstants: Set<string> = new Set(options?.inheritedConstants);
    const children: ElementContent[] = highlightTsxSegments(
      source,
      (chunk: string): ElementContent[] =>
        enhanceCodeHast(lowlight.highlight(language, chunk), language, {
          inheritedConstants: scopeConstants,
          onDeclaredConstants: (declared: Set<string>): void => {
            for (const name of declared) scopeConstants.add(name);
          },
        }).children as ElementContent[],
      (embedded: string): ElementContent[] =>
        highlightCodeLanguage(embedded, language, {
          depth: depth + 1,
          inheritedConstants: new Set(scopeConstants),
          jsx: true,
        }).children as ElementContent[]
    );
    return { type: "root", children };
  }

  const rawRoot: Root = lowlight.highlight(language, source);
  return enhanceCodeHast(rawRoot, language, {
    inheritedConstants: options?.inheritedConstants,
    highlightEmbedded:
      depth < JSX_MAX_DEPTH
        ? (code: string, constants: Set<string>): ElementContent[] =>
          highlightCodeLanguage(code, language, {
            depth: depth + 1,
            inheritedConstants: new Set(constants),
            jsx: true,
          }).children as ElementContent[]
        : undefined,
  });
}

export function highlightSource(source: string, path?: string): HighlightedDocument | null {
  if (!source || source.length > MAX_HIGHLIGHT_CHARS) return null;
  const language: string | null = detectLanguage(path, source);
  if (!language || !lowlight.registered(language)) return null;
  try {
    const root: Root =
      language === "markdown"
        ? highlightMarkdown(
          source,
          (code: string, fenceLanguage: string): ElementContent[] =>
            highlightCodeLanguage(code, fenceLanguage, {
              jsx: fenceLanguage === "typescript" || fenceLanguage === "javascript",
            }).children as ElementContent[]
        )
        : highlightCodeLanguage(source, language, { jsx: isJsxPath(path) });
    return {
      language,
      label: languageLabel(language, path) ?? language,
      root,
    };
  } catch {
    return null;
  }
}

export function highlightDiff(
  lines: readonly DiffHighlightInputLine[],
  path?: string
): (ElementContent[] | null)[] {
  return highlightDiffLinesWith(lines, path, highlightSource);
}
