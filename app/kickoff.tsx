"use client";

// Game-day summary for the top of Plan: when your starters play next, how many
// are done / playing / still to come, and a reminder when a move on the plan
// involves a player whose game is the next to lock.

import { useEffect, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { lastName } from "@/lib/names";
import { Headshot } from "./ui";

const GAME_LENGTH = 3.5 * 3_600_000; // a game is over ~3.5h after kickoff

function until(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.round(h / 24)} days`;
}

export function KickoffCard({ a, movePlayers }: { a: Analysis; movePlayers: PlayerAnalysis[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const starters = a.currentLineup
    .map((s) => s.player)
    .filter((p): p is PlayerAnalysis => !!p && !!p.game && p.game.kickoffKnown);
  if (!starters.length) return null;
  const done = starters.filter((p) => now >= p.game!.kickoff + GAME_LENGTH);
  const live = starters.filter((p) => now >= p.game!.kickoff && now < p.game!.kickoff + GAME_LENGTH);
  const upcoming = starters.filter((p) => now < p.game!.kickoff).sort((x, y) => x.game!.kickoff - y.game!.kickoff);
  if (!upcoming.length && !live.length) return null;

  const next = upcoming[0]?.game!.kickoff ?? null;
  const nextUp = next === null ? [] : upcoming.filter((p) => p.game!.kickoff === next);
  // A move on the plan involving someone whose game locks next: make it before kickoff.
  const lockingMoves = next === null ? [] : movePlayers.filter((p) => p.game?.kickoffKnown && p.game.kickoff === next);
  const when =
    next === null ? null : new Date(next).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-extrabold tracking-[0.08em] text-ink-400 uppercase">
          {next === null ? "Your starters" : "Next kickoff"}
        </span>
        <span className="text-[11.5px] font-bold text-ink-400">
          {done.length > 0 && `${done.length} done · `}
          {live.length > 0 && <span className="text-hot">{live.length} playing · </span>}
          {upcoming.length} to come
        </span>
      </div>
      {next !== null && (
        <>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black tracking-tight">{when}</span>
            <span className="text-sm font-bold text-mint-400">in {until(next - now)}</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex -space-x-2">
              {nextUp.slice(0, 5).map((p) => (
                <span key={p.id} className="rounded-full ring-2 ring-ink-900">
                  <Headshot p={p} size={30} />
                </span>
              ))}
            </div>
            <span className="min-w-0 truncate text-[13px] font-semibold text-ink-300">
              {nextUp.map((p) => lastName(p.name)).join(", ")}
            </span>
          </div>
        </>
      )}
      {lockingMoves.length > 0 && (
        <p className="mt-3 rounded-xl bg-amber-300/15 px-3 py-2 text-[12.5px] font-bold text-amber-300">
          Make the move for {lockingMoves.map((p) => lastName(p.name)).join(" and ")} before kickoff: that spot locks
          when the game starts.
        </p>
      )}
    </section>
  );
}
