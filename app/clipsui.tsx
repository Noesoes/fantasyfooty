"use client";

// Highlight clips of your players: a row on Home for your whole roster, and a
// section in each player's sheet. Rechecked every couple of minutes while one
// of their games is on, since ESPN posts clips during and right after games.

import { useEffect, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { fetchPlayerClips, type PlayerClip } from "@/lib/clips";
import { Highlights } from "./gameparts";

export function usePlayerClips(a: Analysis, players: PlayerAnalysis[]) {
  const [clips, setClips] = useState<PlayerClip[] | null>(null);
  const key = players.map((p) => p.id).join(",");
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await fetchPlayerClips(a, players);
        if (!alive) return;
        setClips(r.clips);
        if (r.live) timer = setTimeout(load, 2 * 60_000);
      } catch {
        if (alive) setClips([]);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // players are identified by `key`; the array itself changes on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, key]);
  return clips;
}

const asTagged = (a: Analysis, ps: PlayerAnalysis[]) => {
  const starters = new Set(a.currentLineup.map((s) => s.player?.id));
  return ps.map((p) => ({ player: p, role: starters.has(p.id) ? ("starter" as const) : ("bench" as const) }));
};

/** Home: every clip of your players this week, newest first. */
export function YourHighlights({ a }: { a: Analysis }) {
  const clips = usePlayerClips(a, a.roster);
  if (!clips?.length) return null;
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-xl font-bold tracking-tight">Your highlights</h2>
        <span className="text-sm text-ink-400">
          {clips.length} clip{clips.length === 1 ? "" : "s"}
        </span>
      </div>
      <Highlights list={clips.map((c) => c.clip)} players={asTagged(a, a.roster)} />
    </section>
  );
}

/** Player sheet: this player's clips this week. */
export function PlayerHighlights({ a, p }: { a: Analysis; p: PlayerAnalysis }) {
  const clips = usePlayerClips(a, [p]);
  if (clips === null) return null;
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[15px] font-bold">Highlights</h3>
        <span className="text-xs text-ink-400">this week</span>
      </div>
      {clips.length ? (
        <Highlights list={clips.map((c) => c.clip)} players={asTagged(a, [p])} />
      ) : (
        <p className="rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm text-ink-400">
          {p.onBye
            ? "On bye this week."
            : "No clips yet. ESPN posts them during and right after games, and they stay up for about two days."}
        </p>
      )}
    </section>
  );
}
