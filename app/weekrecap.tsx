"use client";

// Last week, in one card at the top of Plan: the result, points you left on
// your bench (and who should have played), what Prime Time's lineup would have
// scored, and your best and worst performers against their projections.
// Shown until your first starter of the new week kicks off, or until dismissed.

import { useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { replayWeek, type WeekResult } from "@/lib/backtest";
import { lastName } from "@/lib/names";
import { useAsync } from "./tabs/shared";

const r1 = (n: number) => Math.round(n * 10) / 10;
const KEY = (a: Analysis) => `recap-seen:${a.league.league_id}:${a.week - 1}`;

function seen(a: Analysis) {
  try {
    return localStorage.getItem(KEY(a)) === "1";
  } catch {
    return false;
  }
}

function Row({ icon, title, sub }: { icon: string; title: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink-850 text-base" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] leading-snug font-bold">{title}</span>
        {sub && <span className="block text-[12.5px] leading-snug text-ink-400">{sub}</span>}
      </span>
    </li>
  );
}

function RecapBody({ r, onSeeRecord }: { r: WeekResult; onSeeRecord: () => void }) {
  const benchLeft = r1(r.best - r.yours);
  const advisorGain = r1(r.advisor - r.yours);
  const withProj = r.starters.filter((s) => s.projected > 0);
  const top = [...r.starters].sort((x, y) => y.points - y.projected - (x.points - x.projected))[0];
  const bust = [...withProj].sort((x, y) => x.points - x.projected - (y.points - y.projected))[0];
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {benchLeft >= 1 && (
        <Row
          icon="🪑"
          title={`You left ${benchLeft} pts on your bench`}
          sub={r.misses
            .slice(0, 2)
            .map(
              (m) =>
                `${lastName(m.benched.name)} (${m.benched.points}) sat for ${lastName(m.started.name)} (${m.started.points})`,
            )
            .join(" · ")}
        />
      )}
      {advisorGain >= 1 && (
        <Row
          icon="✨"
          title={`Prime Time's lineup: ${r.advisor} pts (+${advisorGain})`}
          sub={
            r.opponent === null
              ? undefined
              : r.advisorWon && !r.won
                ? "That would have won the week."
                : !r.advisorWon && !r.won
                  ? `Still short of ${r.opponent}, but closer.`
                  : undefined
          }
        />
      )}
      {advisorGain <= -1 && (
        <Row icon="🎯" title={`You beat Prime Time's lineup by ${-advisorGain} pts`} sub="Good calls." />
      )}
      {top && top.points - top.projected >= 3 && (
        <Row
          icon="🔥"
          title={`${top.name}: ${top.points} pts`}
          sub={`${r1(top.points - top.projected)} over his ${top.projected} projection`}
        />
      )}
      {bust && bust.projected - bust.points >= 3 && (
        <Row
          icon="🧊"
          title={`${bust.name}: ${bust.points} pts`}
          sub={`${r1(bust.projected - bust.points)} under his ${bust.projected} projection`}
        />
      )}
      <li>
        <button onClick={onSeeRecord} className="text-[12.5px] font-extrabold text-mint-400">
          Your full track record ›
        </button>
      </li>
    </ul>
  );
}

export function WeekRecap({ a, onSeeRecord }: { a: Analysis; onSeeRecord: () => void }) {
  const startWeek = Number((a.league.settings as Record<string, unknown>).start_week ?? 1);
  const lastWeek = a.week - 1;
  const [hidden, setHidden] = useState(() => seen(a));
  // Once your first starter of the new week has kicked off, last week is old news.
  const [now] = useState(() => Date.now());
  const started = a.currentLineup.some((s) => s.player?.game?.kickoffKnown && s.player.game.kickoff <= now);
  const show = !hidden && !started && !a.bestBall && lastWeek >= startWeek;
  const { data: r } = useAsync<WeekResult | null>(
    () => (show ? replayWeek(a, lastWeek) : Promise.resolve(null)),
    [a, show],
  );
  if (!show || !r) return null;
  const margin = r.opponent === null ? null : r1(r.official - r.opponent);
  const dismiss = () => {
    try {
      localStorage.setItem(KEY(a), "1");
    } catch {}
    setHidden(true);
  };
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-extrabold tracking-[0.08em] text-ink-400 uppercase">
          Week {lastWeek} recap
        </span>
        <button onClick={dismiss} className="text-xs font-bold text-ink-400">
          Got it
        </button>
      </div>
      <div
        className={`mt-1 text-xl font-black tracking-tight ${r.won === true ? "text-mint-400" : r.won === false ? "text-rose-400" : ""}`}
      >
        {r.won === null
          ? `You scored ${r.official}`
          : `${r.won ? "Won" : "Lost"} ${r.official}–${r.opponent}${r.opponentName ? ` vs ${r.opponentName}` : ""}`}
      </div>
      {margin !== null && Math.abs(margin) < 5 && (
        <div className="text-[12.5px] font-bold text-ink-400">Decided by {Math.abs(margin)} pts</div>
      )}
      <RecapBody r={r} onSeeRecord={onSeeRecord} />
    </section>
  );
}
