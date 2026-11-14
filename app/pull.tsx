"use client";

// Pull to refresh on phones. Only the middle of the screen scrolls there
// (#scroller), so the gesture is read from that element: pulling down while
// it's at the very top reveals a spinner, and letting go past the threshold
// reloads your league without dimming the page.

import { useEffect, useRef, useState } from "react";

const THRESHOLD = 64; // px of (damped) pull needed to refresh
const MAX = 96;

export function PullToRefresh({ onRefresh, busy }: { onRefresh: () => void; busy: boolean }) {
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = document.getElementById("scroller");
    if (!el) return;
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      // Only from the very top, and not while a reload is already running.
      start.current = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || el.scrollTop > 0) {
        if (pullRef.current) set(0);
        return;
      }
      // Damped, like the native gesture: the further you pull, the slower it moves.
      set(Math.min(MAX, dy * 0.5));
    };
    const onEnd = () => {
      if (start.current === null) return;
      start.current = null;
      if (pullRef.current >= THRESHOLD) refresh.current();
      set(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const height = busy ? 44 : pull;
  if (!height) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div
      className="flex shrink-0 items-end justify-center overflow-hidden sm:hidden"
      style={{ height, transition: pull ? "none" : "height 200ms ease" }}
      role="status"
      aria-live="polite"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-ink-400">
        <span
          className={`inline-block h-5 w-5 rounded-full border-2 border-ink-600 border-t-mint-400 ${busy ? "animate-spin" : ""}`}
          style={busy ? undefined : { transform: `rotate(${Math.round((pull / THRESHOLD) * 300)}deg)` }}
        />
        {busy ? "Updating…" : ready ? "Release to update" : "Pull to update"}
      </div>
    </div>
  );
}
