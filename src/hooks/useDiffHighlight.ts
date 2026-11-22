import type { ElementContent } from "hast";
import { useMemo } from "react";
import { highlightDiff } from "../utils/syntax";
import type { DiffHighlightInputLine } from "../utils/syntax";

export function useDiffHighlight(
  path: string | undefined,
  lines: readonly DiffHighlightInputLine[]
): (ElementContent[] | null)[] | null {
  return useMemo((): (ElementContent[] | null)[] | null => {
    if (lines.length === 0) return null;
    return highlightDiff(lines, path);
  }, [lines, path]);
}
