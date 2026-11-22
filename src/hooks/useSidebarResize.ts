import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import {
  CENTER_MIN_WIDTH,
  LEFT_SIDEBAR_BOUNDS,
  NARROW_BREAKPOINT_WIDTH,
  RESIZE_KEYBOARD_STEP,
  RIGHT_SIDEBAR_BOUNDS,
  SHELL_HORIZONTAL_CHROME,
} from "../constants/layout";
import { clampSidebarWidth, useLayoutStore } from "../stores/layoutStore";
import type { ResizeSide } from "../types/layout";
import type { LayoutStore } from "../types/stores";

function resolveEffectiveWidths(options: {
  viewportWidth: number;
  leftWidth: number;
  rightWidth: number;
  leftVisible: boolean;
  rightVisible: boolean;
}): { left: number; right: number } {
  const { viewportWidth, leftWidth, rightWidth, leftVisible, rightVisible }: typeof options = options;
  const budget: number = Math.max(0, viewportWidth - CENTER_MIN_WIDTH - SHELL_HORIZONTAL_CHROME);

  if (leftVisible && rightVisible) {
    const total: number = leftWidth + rightWidth;
    if (total <= budget) {
      return { left: leftWidth, right: rightWidth };
    }
    const minTotal: number = LEFT_SIDEBAR_BOUNDS.minWidth + RIGHT_SIDEBAR_BOUNDS.minWidth;
    if (budget <= minTotal) {
      return { left: LEFT_SIDEBAR_BOUNDS.minWidth, right: RIGHT_SIDEBAR_BOUNDS.minWidth };
    }
    const extraBudget: number = budget - minTotal;
    const leftExtra: number = Math.max(0, leftWidth - LEFT_SIDEBAR_BOUNDS.minWidth);
    const rightExtra: number = Math.max(0, rightWidth - RIGHT_SIDEBAR_BOUNDS.minWidth);
    const extraTotal: number = leftExtra + rightExtra || 1;
    const nextLeft: number = Math.round(
      LEFT_SIDEBAR_BOUNDS.minWidth + (extraBudget * leftExtra) / extraTotal
    );
    const nextRight: number = Math.max(RIGHT_SIDEBAR_BOUNDS.minWidth, budget - nextLeft);
    return { left: nextLeft, right: nextRight };
  }

  if (leftVisible) {
    return {
      left: Math.round(
        Math.min(leftWidth, Math.max(LEFT_SIDEBAR_BOUNDS.minWidth, budget))
      ),
      right: rightWidth,
    };
  }

  if (rightVisible) {
    return {
      left: leftWidth,
      right: Math.round(
        Math.min(rightWidth, Math.max(RIGHT_SIDEBAR_BOUNDS.minWidth, budget))
      ),
    };
  }

  return { left: leftWidth, right: rightWidth };
}

export function useSidebarResize(): {
  leftWidth: number;
  rightWidth: number;
  isNarrowViewport: boolean;
  resizing: ResizeSide | null;
  startResize: (side: ResizeSide, event: ReactPointerEvent<HTMLDivElement>) => void;
  handleResizeKey: (side: ResizeSide, event: ReactKeyboardEvent<HTMLDivElement>) => void;
  resetWidth: (side: ResizeSide) => void;
} {
  const storedLeftWidth: number = useLayoutStore((s: LayoutStore): number => s.leftWidth);
  const storedRightWidth: number = useLayoutStore((s: LayoutStore): number => s.rightWidth);
  const sidebarCollapsed: boolean = useLayoutStore((s: LayoutStore): boolean => s.sidebarCollapsed);
  const filesOpen: boolean = useLayoutStore((s: LayoutStore): boolean => s.filesOpen);
  const resizing: ResizeSide | null = useLayoutStore(
    (s: LayoutStore): ResizeSide | null => s.resizing
  );
  const setLeftWidth: (width: number) => void = useLayoutStore(
    (s: LayoutStore): ((width: number) => void) => s.setLeftWidth
  );
  const setRightWidth: (width: number) => void = useLayoutStore(
    (s: LayoutStore): ((width: number) => void) => s.setRightWidth
  );
  const setFilesOpen: (open: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((open: boolean) => void) => s.setFilesOpen
  );
  const setSidebarOverlay: (open: boolean) => void = useLayoutStore(
    (s: LayoutStore): ((open: boolean) => void) => s.setSidebarOverlay
  );
  const resetWidth: (side: ResizeSide) => void = useLayoutStore(
    (s: LayoutStore): ((side: ResizeSide) => void) => s.resetWidth
  );
  const setResizing: (side: ResizeSide | null) => void = useLayoutStore(
    (s: LayoutStore): ((side: ResizeSide | null) => void) => s.setResizing
  );

  const [viewportWidth, setViewportWidth]: [number, (value: number) => void] = useState<number>(
    (): number => (typeof window !== "undefined" ? window.innerWidth : 1440)
  );
  const wasNarrowRef: RefObject<boolean> = useRef<boolean>(viewportWidth < NARROW_BREAKPOINT_WIDTH);
  const filesAutoCollapsedRef: RefObject<boolean> = useRef<boolean>(false);

  useEffect((): (() => void) => {
    function onWindowResize(): void {
      const nextWidth: number = window.innerWidth;
      const nowNarrow: boolean = nextWidth < NARROW_BREAKPOINT_WIDTH;
      setViewportWidth(nextWidth);
      if (nowNarrow && !wasNarrowRef.current) {
        // Collapse both Session overlay and Files panel together when shrinking into narrow mode.
        if (useLayoutStore.getState().filesOpen) {
          filesAutoCollapsedRef.current = true;
          setFilesOpen(false);
        }
        setSidebarOverlay(false);
      } else if (!nowNarrow && wasNarrowRef.current) {
        setSidebarOverlay(false);
        if (filesAutoCollapsedRef.current) {
          filesAutoCollapsedRef.current = false;
          setFilesOpen(true);
        }
      }
      wasNarrowRef.current = nowNarrow;
    }

    window.addEventListener("resize", onWindowResize);
    return (): void => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, [setFilesOpen, setSidebarOverlay]);

  useEffect((): void => {
    if (viewportWidth < NARROW_BREAKPOINT_WIDTH && filesOpen) {
      filesAutoCollapsedRef.current = false;
    }
  }, [viewportWidth, filesOpen]);

  const isNarrowViewport: boolean = viewportWidth < NARROW_BREAKPOINT_WIDTH;

  const effectiveWidths: { left: number; right: number } = useMemo(
    (): { left: number; right: number } =>
      resolveEffectiveWidths({
        viewportWidth,
        leftWidth: storedLeftWidth,
        rightWidth: storedRightWidth,
        leftVisible: !isNarrowViewport && !sidebarCollapsed,
        rightVisible: !isNarrowViewport && filesOpen,
      }),
    [viewportWidth, storedLeftWidth, storedRightWidth, isNarrowViewport, sidebarCollapsed, filesOpen]
  );

  function clamp(side: ResizeSide, rawWidth: number): number {
    const otherWidth: number =
      side === "left"
        ? filesOpen
          ? effectiveWidths.right
          : 0
        : !sidebarCollapsed
          ? effectiveWidths.left
          : 0;
    return clampSidebarWidth({
      side,
      rawWidth,
      viewportWidth: window.innerWidth,
      otherWidth,
    });
  }

  function startResize(side: ResizeSide, event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || isNarrowViewport) return;
    event.preventDefault();
    const startX: number = event.clientX;
    const initial: number = side === "left" ? effectiveWidths.left : effectiveWidths.right;
    setResizing(side);

    const prevCursor: string = document.body.style.cursor;
    const prevSelect: string = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(moveEvent: PointerEvent): void {
      const delta: number = moveEvent.clientX - startX;
      if (side === "left") {
        setLeftWidth(clamp("left", initial + delta));
      } else {
        setRightWidth(clamp("right", initial - delta));
      }
    }

    function onUp(): void {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      setResizing(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function handleResizeKey(side: ResizeSide, event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (isNarrowViewport) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (side === "left") {
      const delta: number = event.key === "ArrowRight" ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP;
      setLeftWidth(clamp("left", effectiveWidths.left + delta));
    } else {
      const delta: number = event.key === "ArrowLeft" ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP;
      setRightWidth(clamp("right", effectiveWidths.right + delta));
    }
  }

  return {
    leftWidth: effectiveWidths.left,
    rightWidth: effectiveWidths.right,
    isNarrowViewport,
    resizing,
    startResize,
    handleResizeKey,
    resetWidth,
  };
}
