import type { ElementContent } from "hast";
import { useMemo } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { CODE_ACTIVE_MARK_CLASS, CODE_INACTIVE_MARK_CLASS } from "../../constants/styles";
import type { CodeViewProps, MatchRange, WalkState } from "../../types/editor";
import { buildMatchRanges } from "../../utils/editorData";

function renderTextSlice(
  value: string,
  context: {
    matches: MatchRange[];
    state: WalkState;
    activeMarkRef: RefObject<HTMLElement | null>;
  }
): ReactNode {
  const { matches, state, activeMarkRef }: typeof context = context;
  const nodeStart: number = state.offset;
  const nodeEnd: number = nodeStart + value.length;
  state.offset = nodeEnd;

  if (!matches.length || !value) return value;

  while (state.matchCursor < matches.length && matches[state.matchCursor].end <= nodeStart) {
    state.matchCursor += 1;
  }

  if (state.matchCursor >= matches.length || matches[state.matchCursor].start >= nodeEnd) {
    return value;
  }

  const parts: ReactNode[] = [];
  let pos: number = nodeStart;
  let idx: number = state.matchCursor;

  while (idx < matches.length && matches[idx].start < nodeEnd) {
    const match: MatchRange = matches[idx];
    if (match.start > pos) {
      parts.push(value.slice(pos - nodeStart, match.start - nodeStart));
    }

    const segStart: number = Math.max(pos, match.start);
    const segEnd: number = Math.min(nodeEnd, match.end);
    const segText: string = value.slice(segStart - nodeStart, segEnd - nodeStart);

    if (match.active) {
      const ref: RefObject<HTMLElement | null> | undefined = state.attachedRef
        ? undefined
        : activeMarkRef;
      state.attachedRef = true;
      parts.push(
        <mark key={`m-${state.keySeq++}`} ref={ref} className={CODE_ACTIVE_MARK_CLASS}>
          {segText}
        </mark>
      );
    } else {
      parts.push(
        <mark key={`m-${state.keySeq++}`} className={CODE_INACTIVE_MARK_CLASS}>
          {segText}
        </mark>
      );
    }

    pos = segEnd;
    if (match.end <= nodeEnd) {
      idx += 1;
      state.matchCursor = idx;
    } else {
      break;
    }
  }

  if (pos < nodeEnd) {
    parts.push(value.slice(pos - nodeStart));
  }

  return parts;
}

function renderHastNodes(
  nodes: ElementContent[],
  context: {
    matches: MatchRange[];
    state: WalkState;
    activeMarkRef: RefObject<HTMLElement | null>;
  }
): ReactNode[] {
  return nodes.map((node: ElementContent): ReactNode => {
    if (node.type === "text") {
      return renderTextSlice(node.value, context);
    }
    if (node.type === "element") {
      const rawClass: unknown = node.properties?.className;
      const className: string | undefined = Array.isArray(rawClass)
        ? rawClass.join(" ")
        : typeof rawClass === "string"
          ? rawClass
          : undefined;
      const key: string = `e-${context.state.keySeq++}`;
      const children: ReactNode[] = renderHastNodes(node.children, context);
      return (
        <span key={key} className={className}>
          {children}
        </span>
      );
    }
    return null;
  });
}

export function CodeView({
  source,
  root,
  language,
  offsets,
  activeOffset,
  queryLength,
  activeMarkRef,
}: CodeViewProps): JSX.Element {
  const content: ReactNode = useMemo((): ReactNode => {
    const matches: MatchRange[] = buildMatchRanges(offsets, queryLength, activeOffset);
    const state: WalkState = {
      offset: 0,
      matchCursor: 0,
      attachedRef: false,
      keySeq: 0,
    };
    const context: {
      matches: MatchRange[];
      state: WalkState;
      activeMarkRef: RefObject<HTMLElement | null>;
    } = { matches, state, activeMarkRef };

    if (root) {
      return renderHastNodes(root.children as ElementContent[], context);
    }
    return renderTextSlice(source, context);
  }, [source, root, offsets, activeOffset, queryLength, activeMarkRef]);

  return (
    <code className="hljs relative whitespace-pre" data-language={language ?? undefined}>
      {content}
    </code>
  );
}
