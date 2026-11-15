"use client";

// The matchup card at the top of Home before games start.

import type { Analysis } from "@/lib/advisor";
import { projectedWin } from "@/lib/insights";
import { Ring } from "../ui";

/** T1 matchup card: win ring on the left, both teams' points, one line underneath. */
export function MatchupCard({
  win,
  ringLabel,
  me,
  opp,
  note,
}: {
  win: number | null;
  ringLabel: string;
  me: { name: string; pts: number };
  opp: { name: string; pts: number } | null;
  note: React.ReactNode;
}) {
  const line = (t: { name: string; pts: number }, lead: boolean) => (
    <div className={`flex items-baseline justify-between gap-3 ${lead ? "" : "opacity-75"}`}>
      <span className="truncate text-[15px] font-extrabold">{t.name}</span>
      <span className="shrink-0 font-mono text-[26px] leading-tight font-black tracking-tight">{t.pts.toFixed(1)}</span>
    </div>
  );
  return (
    <section className="flex items-center gap-4 rounded-2xl border border-ink-700 bg-ink-900 p-4">
      {win !== null && (
        <Ring value={win} size={84}>
          <span className="text-[21px] leading-none font-black">{Math.round(win * 100)}%</span>
          <span className="mt-0.5 text-[9.5px] font-extrabold tracking-wide text-ink-300 uppercase">{ringLabel}</span>
        </Ring>
      )}
      <div className="min-w-0 flex-1">
        {line(me, !opp || me.pts >= opp.pts)}
        {opp ? (
          line(opp, opp.pts > me.pts)
        ) : (
          <div className="text-sm text-ink-400">No head-to-head matchup this week</div>
        )}
        <div className="mt-1 text-[12.5px] font-extrabold">{note}</div>
      </div>
    </section>
  );
}

export function Scoreboard({ a }: { a: Analysis }) {
  const gain = Math.round((a.optimalTotal - a.currentTotal) * 10) / 10;
  const opp = a.opponent;
  const theirs = opp?.starters ?? [];
  const winBest = opp
    ? projectedWin(
        a.optimalLineup.map((s) => s.player),
        theirs,
      )
    : null;
  const winNow = opp
    ? projectedWin(
        a.currentLineup.map((s) => s.player),
        theirs,
      )
    : null;
  return (
    <MatchupCard
      win={gain > 0 ? winNow : winBest}
      ringLabel="to win"
      me={{ name: "You", pts: gain > 0 ? a.currentTotal : a.optimalTotal }}
      opp={opp ? { name: opp.teamName, pts: opp.projected } : null}
      note={
        gain > 0 ? (
          <span className="text-mint-400">
            Make your moves: +{gain}
            {winBest !== null && <> → {Math.round(winBest * 100)}%</>}
          </span>
        ) : (
          <span className="text-ink-300">Your lineup is set · projected</span>
        )
      }
    />
  );
}

// --- Live -----------------------------------------------------------------
