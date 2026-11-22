import type { ElementContent, Root } from "hast";
import { useMemo, type ReactNode, type RefObject } from "react";

interface CodeViewProps {
  source: string;
  root?: Root | null;
  language?: string | null;
  offsets: number[];
  activeOffset?: number;
  queryLength: number;
  activeMarkRef: RefObject<HTMLElement | null>;
}

interface MatchRange {
  start: number;
  end: number;
  active: boolean;
}

interface WalkState {
  offset: number;
  matchCursor: number;
  attachedRef: boolean;
  keySeq: number;
}

const MAX_VISIBLE_MATCHES = 1000;
const ACTIVE_MARK_CLASS = "rounded-[2px] bg-accent/35 text-label ring-1 ring-accent/55";
const INACTIVE_MARK_CLASS = "rounded-[2px] bg-accent/18 text-inherit";

function buildMatchRanges(offsets: number[], queryLength: number, activeOffset?: number): MatchRange[] {
  if (!queryLength || !offsets.length) return [];

  let slice = offsets;
  if (offsets.length > MAX_VISIBLE_MATCHES) {
    const activeIndex = activeOffset === undefined ? 0 : Math.max(0, offsets.indexOf(activeOffset));
    const half = Math.floor(MAX_VISIBLE_MATCHES / 2);
    const start = Math.max(0, Math.min(activeIndex - half, offsets.length - MAX_VISIBLE_MATCHES));
    slice = offsets.slice(start, start + MAX_VISIBLE_MATCHES);
  }

  const ranges: MatchRange[] = [];
  let prevEnd = -1;
  for (const start of slice) {
    if (start < prevEnd) continue;
    const end = start + queryLength;
    ranges.push({ start, end, active: start === activeOffset });
    prevEnd = end;
  }
  return ranges;
}

function renderTextSlice(
  value: string,
  matches: MatchRange[],
  state: WalkState,
  activeMarkRef: RefObject<HTMLElement | null>,
): ReactNode {
  const nodeStart = state.offset;
  const nodeEnd = nodeStart + value.length;
  state.offset = nodeEnd;

  if (!matches.length || !value) return value;

  while (state.matchCursor < matches.length && matches[state.matchCursor].end <= nodeStart) {
    state.matchCursor += 1;
  }

  if (state.matchCursor >= matches.length || matches[state.matchCursor].start >= nodeEnd) {
    return value;
  }

  const parts: ReactNode[] = [];
  let pos = nodeStart;
  let idx = state.matchCursor;

  while (idx < matches.length && matches[idx].start < nodeEnd) {
    const match = matches[idx];
    if (match.start > pos) {
      parts.push(value.slice(pos - nodeStart, match.start - nodeStart));
    }

    const segStart = Math.max(pos, match.start);
    const segEnd = Math.min(nodeEnd, match.end);
    const segText = value.slice(segStart - nodeStart, segEnd - nodeStart);

    if (match.active) {
      const ref = state.attachedRef ? undefined : activeMarkRef;
      state.attachedRef = true;
      parts.push(
        <mark key={`m-${state.keySeq++}`} ref={ref} className={ACTIVE_MARK_CLASS}>
          {segText}
        </mark>,
      );
    } else {
      parts.push(
        <mark key={`m-${state.keySeq++}`} className={INACTIVE_MARK_CLASS}>
          {segText}
        </mark>,
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
  matches: MatchRange[],
  state: WalkState,
  activeMarkRef: RefObject<HTMLElement | null>,
): ReactNode[] {
  return nodes.map((node) => {
    if (node.type === "text") {
      return renderTextSlice(node.value, matches, state, activeMarkRef);
    }
    if (node.type === "element") {
      const rawClass = node.properties?.className;
      const className = Array.isArray(rawClass)
        ? rawClass.join(" ")
        : typeof rawClass === "string"
          ? rawClass
          : undefined;
      const key = `e-${state.keySeq++}`;
      const children = renderHastNodes(node.children, matches, state, activeMarkRef);
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
}: CodeViewProps) {
  const content = useMemo(() => {
    const matches = buildMatchRanges(offsets, queryLength, activeOffset);
    const state: WalkState = {
      offset: 0,
      matchCursor: 0,
      attachedRef: false,
      keySeq: 0,
    };

    if (root) {
      return renderHastNodes(root.children as ElementContent[], matches, state, activeMarkRef);
    }
    return renderTextSlice(source, matches, state, activeMarkRef);
  }, [source, root, offsets, activeOffset, queryLength, activeMarkRef]);

  return (
    <code
      className="hljs relative whitespace-pre"
      data-language={language ?? undefined}
    >
      {content}
    </code>
  );
}
