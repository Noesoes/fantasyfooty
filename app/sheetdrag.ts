"use client";

// Swipe down to close a bottom sheet, like iOS: drag from the top of the
// sheet, or anywhere while its content is scrolled to the top. Let go past
// a short distance (or with a quick flick) and it closes; otherwise it
// springs back.

import { useRef, useState } from "react";

export function useDragToClose(onClose: () => void, scrollRef: React.RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; t: number; active: boolean } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    // Charts, clip rows and wide tables handle their own gestures.
    if (target.closest("[data-noswipe]")) {
      drag.current = null;
      return;
    }
    const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0;
    const onHandle = !!target.closest("[data-sheet-handle]");
    drag.current = { y: e.touches[0].clientY, t: Date.now(), active: atTop || onHandle };
    setDragging(atTop || onHandle);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d?.active) return;
    const dy = e.touches[0].clientY - d.y;
    // Only downward pulls move the sheet; scrolling up inside it works as usual.
    if (dy > 0) setOffset(dy);
    else if (offset) setOffset(0);
  };
  const onTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d?.active || offset <= 0) return;
    const fast = offset / Math.max(1, Date.now() - d.t) > 0.6;
    if (offset > 110 || (fast && offset > 40)) {
      onClose();
    } else {
      setOffset(0);
    }
  };

  return {
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: () => {
        setDragging(false);
        setOffset(0);
      },
    },
    style: {
      transform: offset ? `translateY(${offset}px)` : undefined,
      transition: dragging ? "none" : "transform 200ms ease-out",
    } as React.CSSProperties,
    /** 0–1: how far the sheet has been pulled, for fading the backdrop. */
    pulled: Math.min(1, offset / 300),
  };
}
