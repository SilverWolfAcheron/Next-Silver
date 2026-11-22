import type { Element, ElementContent } from "hast";
import type { DiffLineKind } from "../../agent-core/diff";
import type { HighlightedDocument } from "../../types/editor";

export interface DiffHighlightInputLine {
  kind: DiffLineKind;
  text: string;
}

export function stripDiffPrefixChar(line: DiffHighlightInputLine): {
  prefix: string;
  code: string;
} {
  if (line.kind === "meta") {
    return { prefix: "", code: line.text };
  }
  const first: string = line.text[0] ?? "";
  if (
    (line.kind === "added" && first === "+") ||
    (line.kind === "removed" && first === "-") ||
    (line.kind === "context" && first === " ")
  ) {
    return { prefix: first, code: line.text.slice(1) };
  }
  return {
    prefix: line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ",
    code: line.text,
  };
}

function appendNodesByLine(
  nodes: ElementContent[],
  lines: ElementContent[][],
  wrapElement?: (children: ElementContent[]) => Element
): void {
  for (const node of nodes) {
    if (node.type === "text") {
      const parts: string[] = node.value.split("\n");
      for (let index: number = 0; index < parts.length; index += 1) {
        if (index > 0) {
          lines.push([]);
        }
        const segment: string = parts[index];
        if (!segment) continue;
        const leaf: ElementContent = { type: "text", value: segment };
        lines[lines.length - 1].push(wrapElement ? wrapElement([leaf]) : leaf);
      }
      continue;
    }

    if (node.type === "element") {
      const subLines: ElementContent[][] = [[]];
      appendNodesByLine(node.children, subLines);
      for (let index: number = 0; index < subLines.length; index += 1) {
        if (index > 0) {
          lines.push([]);
        }
        const children: ElementContent[] = subLines[index];
        if (children.length === 0) continue;
        const cloned: Element = {
          type: "element",
          tagName: node.tagName,
          properties: node.properties,
          children,
        };
        lines[lines.length - 1].push(wrapElement ? wrapElement([cloned]) : cloned);
      }
    }
  }
}

export function splitHastLines(nodes: ElementContent[]): ElementContent[][] {
  const lines: ElementContent[][] = [[]];
  appendNodesByLine(nodes, lines);
  return lines;
}

function applyStreamHighlight(params: {
  indices: number[];
  codes: string[];
  path: string | undefined;
  highlightFn: (source: string, path?: string) => HighlightedDocument | null;
  target: (ElementContent[] | null)[];
}): void {
  const { indices, codes, path, highlightFn, target }: typeof params = params;
  if (indices.length === 0) return;

  const joined: string = codes.join("\n");
  if (!joined.trim()) return;

  const doc: HighlightedDocument | null = highlightFn(joined, path);
  if (!doc) return;

  const perLine: ElementContent[][] = splitHastLines(doc.root.children as ElementContent[]);
  for (let i: number = 0; i < indices.length; i += 1) {
    target[indices[i]] = perLine[i] ?? [];
  }
}

export function highlightDiffLines(
  lines: readonly DiffHighlightInputLine[],
  path: string | undefined,
  highlightFn: (source: string, path?: string) => HighlightedDocument | null
): (ElementContent[] | null)[] {
  const result: (ElementContent[] | null)[] = Array.from(
    { length: lines.length },
    (): ElementContent[] | null => null
  );
  if (lines.length === 0) return result;

  const hunks: number[][] = [];
  let currentHunk: number[] = [];

  for (let index: number = 0; index < lines.length; index += 1) {
    const line: DiffHighlightInputLine = lines[index];
    if (line.kind === "meta") {
      if (line.text.startsWith("@@ ") && currentHunk.length > 0) {
        hunks.push(currentHunk);
        currentHunk = [];
      }
      continue;
    }
    currentHunk.push(index);
  }
  if (currentHunk.length > 0) {
    hunks.push(currentHunk);
  }

  for (const hunk of hunks) {
    const newIndices: number[] = [];
    const newCodes: string[] = [];
    const oldIndices: number[] = [];
    const oldCodes: string[] = [];
    let hasRemoved: boolean = false;

    for (const lineIndex of hunk) {
      const line: DiffHighlightInputLine = lines[lineIndex];
      const { code }: { prefix: string; code: string } = stripDiffPrefixChar(line);
      if (line.kind === "added") {
        newIndices.push(lineIndex);
        newCodes.push(code);
      } else if (line.kind === "removed") {
        hasRemoved = true;
        oldIndices.push(lineIndex);
        oldCodes.push(code);
      } else {
        newIndices.push(lineIndex);
        newCodes.push(code);
        oldIndices.push(lineIndex);
        oldCodes.push(code);
      }
    }

    if (hasRemoved) {
      const oldTarget: (ElementContent[] | null)[] = Array.from(
        { length: lines.length },
        (): ElementContent[] | null => null
      );
      applyStreamHighlight({
        indices: oldIndices,
        codes: oldCodes,
        path,
        highlightFn,
        target: oldTarget,
      });
      for (const lineIndex of oldIndices) {
        if (lines[lineIndex].kind === "removed") {
          result[lineIndex] = oldTarget[lineIndex];
        }
      }
    }

    applyStreamHighlight({
      indices: newIndices,
      codes: newCodes,
      path,
      highlightFn,
      target: result,
    });
  }

  return result;
}
