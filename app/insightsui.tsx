"use client";

// Screens for the competitor-style features: power rankings, trade partners
// and the streaming planner. (Ask lives in askbox.tsx.)

import { useEffect, useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { powerRankings, STREAM_POSITIONS, streamingPlan, type StreamPlan, type StreamWeek } from "@/lib/insights";
import { avatarUrl } from "@/lib/sleeper";
import { Card, Headshot, PosBadge } from "./ui";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN avatars in a static export */

// --- Power rankings ----------------------------------------------------------

const rankTone = (rank: number, teams: number) =>
  rank <= Math.ceil(teams / 4)
    ? "bg-mint-400/15 text-mint-400"
    : rank > teams - Math.ceil(teams / 4)
      ? "bg-rose-500/15 text-rose-400"
      : "bg-ink-800 text-ink-300";

/** Each team's record and playoff chance, when the season simulation has run. */
export type Standings = Map<number, { record: string; playoffPct: number }>;

const oddsText = (pct: number) => `${pct >= 99.5 ? ">99" : pct < 0.5 ? "<1" : Math.round(pct)}% playoffs`;
const oddsColor = (pct: number) => (pct >= 75 ? "text-mint-400" : pct >= 40 ? "text-amber-300" : "text-rose-400");

export function PowerRankings({ a, standings }: { a: Analysis; standings?: Standings }) {
  const teams = powerRankings(a);
  const n = teams.length;
  return (
    <Card title="Power rankings" action={<span className="text-xs text-ink-400">rest of season</span>}>
      <p className="mb-3 text-sm text-ink-400">
        Every team&apos;s best lineup for the rest of the season, plus bench depth, in points per week, with each
        team&apos;s record and playoff chance. Chips show its league rank at each position.
      </p>
      <ol className="flex flex-col gap-1.5">
        {teams.map((t) => (
          <li
            key={t.rosterId}
            className={`flex items-center gap-3 rounded-xl p-2.5 ${t.mine ? "border border-mint-400/50 bg-mint-400/5" : "bg-ink-850"}`}
          >
            <span className="w-6 shrink-0 text-center font-mono text-lg font-black text-ink-300">{t.rank}</span>
            {t.avatar ? (
              <img src={avatarUrl(t.avatar)} alt="" className="h-8 w-8 shrink-0 rounded-full" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-black">
                {t.teamName.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-extrabold">
                {t.teamName}
                {t.mine && <span className="ml-1.5 text-xs font-black text-mint-400">YOU</span>}
              </div>
              {standings?.get(t.rosterId) && (
                <div className="text-[11.5px] font-bold text-ink-400">
                  {standings.get(t.rosterId)!.record} ·{" "}
                  <span className={oddsColor(standings.get(t.rosterId)!.playoffPct)}>
                    {oddsText(standings.get(t.rosterId)!.playoffPct)}
                  </span>
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {Object.entries(t.posRank).map(([pos, r]) => (
                  <span key={pos} className={`rounded-md px-1.5 text-[10.5px] font-bold ${rankTone(r, n)}`}>
                    {pos} #{r}
                  </span>
                ))}
              </div>
            </div>
            <span className="shrink-0 font-mono text-sm font-black">{t.strength}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Teams deep where you're thin and thin where you're deep: who to call about a trade. */
export function TradePartners({ a }: { a: Analysis }) {
  const partners = powerRankings(a)
    .filter((t) => !t.mine && t.fit > 0 && t.fitWhy)
    .sort((x, y) => y.fit - x.fit)
    .slice(0, 3);
  if (!partners.length) return null;
  return (
    <Card title="Best trade partners">
      <p className="mb-3 text-sm text-ink-400">Teams deep where you&apos;re thin, and thin where you&apos;re deep.</p>
      <ul className="flex flex-col gap-2">
        {partners.map((t) => (
          <li key={t.rosterId} className="rounded-xl bg-ink-850 p-3 text-sm">
            <div className="font-extrabold">{t.teamName}</div>
            <div className="mt-0.5 text-[13px] text-ink-300">{t.fitWhy}.</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- Streaming planner -------------------------------------------------------

const GRADE_STYLE: Record<StreamWeek["grade"], string> = {
  great: "bg-mint-400/20 text-mint-400",
  good: "bg-mint-400/10 text-mint-300",
  neutral: "bg-ink-800 text-ink-300",
  tough: "bg-rose-500/10 text-rose-300",
  brutal: "bg-rose-500/20 text-rose-400",
  bye: "bg-ink-800 text-ink-500",
};

export function StreamingPlanner({ a }: { a: Analysis }) {
  const used = STREAM_POSITIONS.filter((pos) => a.waiversByPosition[pos] !== undefined);
  const [pos, setPos] = useState(used[0] ?? "QB");
  const [plan, setPlan] = useState<StreamPlan | null>(null);
  useEffect(() => {
    let alive = true;
    streamingPlan(a, pos)
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setPlan({ position: pos, weeks: [], options: [] }));
    return () => {
      alive = false;
    };
  }, [a, pos]);
  if (!used.length) return null;
  // Until this position's plan arrives, show the loading state.
  const current = plan?.position === pos ? plan : null;
  return (
    <Card
      title="Streaming planner"
      action={
        <div className="flex gap-1">
          {used.map((p) => (
            <button
              key={p}
              onClick={() => setPos(p)}
              className={`rounded-lg px-2 py-1 text-xs font-bold ${pos === p ? "bg-mint-400 text-ink-950" : "bg-ink-800 text-ink-400"}`}
            >
              {p}
            </button>
          ))}
        </div>
      }
    >
      <p className="mb-3 text-sm text-ink-400">
        Free agents ranked over the next {current?.weeks.length || 3} weeks by matchup, next to yours. Green is an easy
        defense for the position, red a tough one.
      </p>
      {!current ? (
        <div className="skeleton h-24 rounded-xl" aria-busy="true" />
      ) : !current.options.length ? (
        <p className="text-sm text-ink-400">No schedule data yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4" data-noswipe>
          <table className="w-full min-w-max text-xs">
            <thead>
              <tr className="text-[10px] tracking-wider text-ink-400 uppercase">
                <th className="pb-2 text-left font-semibold">Player</th>
                {current.weeks.map((w) => (
                  <th key={w} className="px-1 pb-2 font-semibold">
                    Wk {w}
                  </th>
                ))}
                <th className="pb-2 pl-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {current.options.map((o) => (
                <tr key={o.player.id} className={`border-t border-ink-800 ${o.mine ? "bg-mint-400/5" : ""}`}>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      <Headshot p={o.player} size={26} />
                      <div className="min-w-0">
                        <div className="max-w-32 truncate font-bold">
                          {o.player.name}
                          {o.mine && <span className="ml-1 text-[10px] font-black text-mint-400">YOURS</span>}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-ink-400">
                          <PosBadge pos={o.player.position} />
                          {o.player.team}
                        </div>
                      </div>
                    </div>
                  </td>
                  {o.weeks.map((w) => (
                    <td key={w.week} className="px-1 py-2 text-center">
                      <span
                        className={`inline-block min-w-12 rounded-md px-1.5 py-1 font-bold ${GRADE_STYLE[w.grade]}`}
                      >
                        {w.opponent ?? "BYE"}
                        <span className="block font-mono text-[10px] opacity-80">{w.pts.toFixed(1)}</span>
                      </span>
                    </td>
                  ))}
                  <td className="py-2 pl-2 text-right font-mono text-sm font-black">{o.total.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
