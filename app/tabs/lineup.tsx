"use client";

// Team -> Lineup: start/sit picker, recommended starters, bench, IR, rules and track record.

import { useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { buildTrackRecord, type TrackRecord } from "@/lib/backtest";
import { Faceoff } from "../faceoff";
import { RulesCard } from "../rules";
import { useOpenPlayer } from "../playerctx";
import { Card, Empty, MatchupChip, PlayerLine, SlotBadge } from "../ui";
import { findHoles } from "@/lib/holes";
import { BigStat, ScoreBar, useAsync } from "./shared";

/** "Start X or Y?": pick any two players (yours or free agents) and get the call with the reasons. */
function StartOrSit({ a }: { a: Analysis }) {
  const [ids, setIds] = useState<[string, string]>(["", ""]);
  const mine = [...a.roster].sort((x, y) => x.position.localeCompare(y.position) || y.weekScore - x.weekScore);
  const fas = [...a.freeAgentPool]
    .filter((p) => p.team && p.weekScore > 0)
    .sort((x, y) => y.weekScore - x.weekScore)
    .slice(0, 40);
  const lookup = new Map([...mine, ...fas].map((p) => [p.id, p]));
  const picked = ids.map((id) => lookup.get(id)).filter((p): p is PlayerAnalysis => !!p);
  const [pick, other] =
    picked.length === 2 ? [...picked].sort((x, y) => y.weekScore - x.weekScore) : [undefined, undefined];
  const select = (i: 0 | 1) => (
    <select
      value={ids[i]}
      onChange={(e) => setIds((prev) => (i === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value]))}
      className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm font-semibold"
      aria-label={i === 0 ? "First player" : "Second player"}
    >
      <option value="">{i === 0 ? "Pick a player…" : "…or this one"}</option>
      <optgroup label="Your team">
        {mine.map((p) => (
          <option key={p.id} value={p.id} disabled={ids[1 - i] === p.id}>
            {p.position} · {p.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Free agents">
        {fas.map((p) => (
          <option key={p.id} value={p.id} disabled={ids[1 - i] === p.id}>
            {p.position} · {p.name} (FA)
          </option>
        ))}
      </optgroup>
    </select>
  );
  return (
    <Card title="Start X or Y?">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {select(0)}
        <span className="text-center text-xs font-extrabold text-ink-400">or</span>
        {select(1)}
      </div>
      {pick && other && (
        <div className="mt-4">
          <Faceoff x={picked[0]} y={picked[1]} />
        </div>
      )}
      {picked.length < 2 && (
        <p className="mt-3 text-xs text-ink-400">
          Compare any two of your players, or one of yours against a free agent: defense faced, workload, Vegas, health
          and form, side by side.
        </p>
      )}
    </Card>
  );
}

export function Lineup({ a }: { a: Analysis }) {
  const optimalIds = new Set(a.optimalLineup.map((s) => s.player?.id));
  const currentIds = new Set(a.currentLineup.map((s) => s.player?.id).filter(Boolean));
  const benched = new Set(a.moves.filter((m) => m.action === "bench").map((m) => m.player.id));
  const bench = a.activeRoster.filter((p) => !optimalIds.has(p.id));
  const max = Math.max(1, ...a.roster.map((p) => p.weekScore));
  // IR, taxi and other reserve spots: not in the lineup either way.
  const reserve = a.roster.filter((p) => !a.activeRoster.includes(p));
  const openPlayer = useOpenPlayer();
  // Spots your roster can't fill, with the pickup that fills each.
  const holes = findHoles(a);
  const holeFor = (slot: string, id: string | undefined) =>
    holes.find((h) => h.slot === slot && (h.out?.id ?? undefined) === id);
  const withPickups = Math.round((a.optimalTotal + holes.reduce((n, h) => n + h.gain, 0)) * 10) / 10;
  return (
    <div className="flex flex-col gap-5">
      <StartOrSit a={a} />
      <Card
        title="Recommended starters"
        action={
          <span className="text-right font-mono text-sm font-semibold text-mint-300 tabular-nums">
            {a.optimalTotal.toFixed(1)} pts
            {holes.length > 0 && (
              <span className="block text-[11px] font-bold text-ink-400">{withPickups} with pickups</span>
            )}
          </span>
        }
      >
        <ul className="flex flex-col divide-y divide-ink-700/60">
          {a.optimalLineup.map((s, i) => {
            // Highlight only players who aren't in your lineup now; reshuffles
            // between same-position slots don't need any action.
            const changed = Boolean(s.player && !currentIds.has(s.player.id));
            const hole = holeFor(s.slot, s.player?.id);
            const fix = hole && (
              <button
                onClick={() => openPlayer?.(hole.fill)}
                className="mt-1.5 ml-[52px] flex items-center gap-1.5 rounded-full bg-mint-400/15 px-2.5 py-1 text-left text-[11.5px] font-bold text-mint-400"
              >
                {hole.why} · claim {hole.fill.name} ({hole.fill.weekScore}) ›
              </button>
            );
            return (
              <li key={i} className={`flex items-center gap-3 py-3 ${changed ? "relative" : ""}`}>
                {changed && <span className="absolute top-2 bottom-2 -left-4 w-1 rounded-r bg-mint-400 sm:-left-5" />}
                <SlotBadge slot={s.slot} />
                {s.player ? (
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <PlayerLine p={s.player} sub={<MatchupChip p={s.player} compact />} />
                      {changed && (
                        <div className="mt-1 ml-[52px] text-[11px] font-bold tracking-wide text-mint-400">
                          ▲ MOVE INTO LINEUP
                        </div>
                      )}
                      {s.player.playChance !== null && s.player.playChance < 0.85 && (
                        <div
                          className={`mt-1 ml-[52px] text-[11px] font-semibold ${s.player.playChance < 0.6 ? "text-rose-300" : "text-amber-300"}`}
                        >
                          ~{Math.round(s.player.playChance * 100)}% to play · projection scaled for injury risk
                        </div>
                      )}
                      {fix}
                    </div>
                    <ScoreBar value={s.player.weekScore} max={max} />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-ink-400 italic">Empty</span>
                    {fix}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Bench">
        {bench.length === 0 ? (
          <Empty>No bench players.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-ink-700/60">
            {bench.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <PlayerLine p={p} size={34} sub={<MatchupChip p={p} compact />} />
                  {benched.has(p.id) && (
                    <div className="mt-0.5 ml-[46px] text-[11px] font-bold tracking-wide text-amber-300">
                      ▼ MOVE TO BENCH{p.notes[0] ? ` · ${p.notes[0]}` : ""}
                    </div>
                  )}
                  {!benched.has(p.id) && p.notes[0] && (
                    <div className="mt-0.5 ml-[46px] truncate text-xs text-ink-400">{p.notes[0]}</div>
                  )}
                </div>
                <ScoreBar value={p.weekScore} max={max} muted />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {reserve.length > 0 && (
        <Card title="IR / reserve">
          <ul className="flex flex-col divide-y divide-ink-700/60">
            {reserve.map((p) => (
              <li key={p.id} className="py-2.5">
                <PlayerLine p={p} size={36} sub={<MatchupChip p={p} compact />} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <RulesCard a={a} />
      <TrackRecordSection a={a} />
    </div>
  );
}

function TrackRecordView({ a }: { a: Analysis }) {
  const { data: r, error } = useAsync<TrackRecord>(() => buildTrackRecord(a), [a]);
  if (error) return <Empty>Couldn&apos;t load past weeks: {error}</Empty>;
  if (!r) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (r.weeks.length === 0) return <Empty>No completed weeks yet — check back after your first games.</Empty>;
  const diff = Math.round((r.totals.advisor - r.totals.yours) * 10) / 10;
  const pct = (x: number) => `${Math.round((x / Math.max(1, r.totals.best)) * 100)}%`;
  const max = Math.max(1, ...r.weeks.map((w) => Math.max(w.best, w.opponent ?? 0)));
  const extraWins = r.weeks.filter((w) => w.advisorWon && w.won === false).length;
  const lostWins = r.weeks.filter((w) => w.won && w.advisorWon === false).length;
  return (
    <div className="flex flex-col gap-5">
      {r.bestBall && (
        <div className="rounded-xl border border-pos-wr/30 bg-pos-wr/10 px-4 py-3 text-sm">
          Best-ball league: Sleeper already starts your best lineup, so there are no start/sit calls to grade.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <BigStat
          label="Start/sit calls right"
          value={r.calls ? `${r.hits}/${r.calls}` : "—"}
          sub={
            r.calls
              ? `${Math.round((r.hits / r.calls) * 100)}% when the advisor disagreed with you`
              : "The advisor agreed with every lineup you set"
          }
          tone={r.calls ? (r.hits / r.calls >= 0.55 ? "good" : r.hits / r.calls >= 0.45 ? "mid" : "bad") : "mid"}
        />
        <BigStat
          label="Advisor vs. your lineups"
          value={`${diff >= 0 ? "+" : ""}${diff} pts`}
          sub={`over ${r.weeks.length} week${r.weeks.length === 1 ? "" : "s"}${extraWins ? ` · ${extraWins} more win${extraWins === 1 ? "" : "s"}` : ""}${lostWins ? ` · ${lostWins} fewer win${lostWins === 1 ? "" : "s"}` : ""}`}
          tone={diff > 0 ? "good" : diff < 0 ? "bad" : "mid"}
        />
        <BigStat
          label="Share of max possible"
          value={`${pct(r.totals.yours)} → ${pct(r.totals.advisor)}`}
          sub="your lineups vs. the advisor's, against the best lineup in hindsight"
          tone="mid"
        />
      </div>

      <Card title="Week by week">
        <ul className="flex flex-col divide-y divide-ink-700/60">
          {[...r.weeks].reverse().map((w) => (
            <li key={w.week} className="py-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Week {w.week}</span>
                {w.won !== null && (
                  <span className="flex gap-1.5 text-[11px] font-semibold">
                    <span
                      className={`rounded-full px-2 py-0.5 ${w.won ? "bg-mint-400/15 text-mint-300" : "bg-rose-500/15 text-rose-300"}`}
                    >
                      You {w.won ? "won" : "lost"} vs {w.opponent?.toFixed(1)}
                    </span>
                    {w.advisorWon !== w.won && (
                      <span className="rounded-full bg-ink-700 px-2 py-0.5 text-ink-300">
                        Advisor lineup would have {w.advisorWon ? "won" : "lost"}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {[
                  { label: "You", v: w.yours, c: "bg-ink-300" },
                  { label: "Advisor", v: w.advisor, c: "bg-mint-400" },
                  { label: "Best", v: w.best, c: "bg-ink-600" },
                ].map((b) => (
                  <div key={b.label} className="flex items-center gap-3 text-xs">
                    <span className="w-14 shrink-0 text-ink-400">{b.label}</span>
                    <div className="relative h-2 flex-1 rounded-full bg-ink-800">
                      <div className={`h-full rounded-full ${b.c}`} style={{ width: `${(b.v / max) * 100}%` }} />
                      {w.opponent !== null && (
                        <div
                          className="absolute -top-0.5 h-3 w-0.5 rounded bg-rose-400"
                          style={{ left: `${(w.opponent / max) * 100}%` }}
                          title="Opponent"
                        />
                      )}
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono tabular-nums">{b.v.toFixed(1)}</span>
                  </div>
                ))}
              </div>
              {w.calls.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1">
                  {w.calls.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span className={`font-bold ${c.hit ? "text-mint-400" : "text-rose-300"}`}>
                        {c.hit ? "✓" : "✗"}
                      </span>
                      <span className="text-ink-300">
                        Advisor: start <b className="text-ink-100">{c.advisor.name}</b> ({c.advisor.points}) over{" "}
                        <b className="text-ink-100">{c.yours.name}</b> ({c.yours.points})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-400">
          The advisor&apos;s lineup is rebuilt from Sleeper&apos;s pre-game projections for each week, using the roster
          you had then; points are what players actually scored. The red tick is your opponent&apos;s score. Excludes
          IDP slots.
        </p>
      </Card>
    </div>
  );
}

/** Track record, folded away at the bottom of Roster. It loads past weeks, so only when opened. */
function TrackRecordSection({ a }: { a: Analysis }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-2xl border border-ink-700 bg-ink-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
        <span>
          <span className="block text-[15px] font-bold">Track record</span>
          <span className="block text-xs text-ink-400">
            How Prime Time&apos;s lineups would have done in past weeks
          </span>
        </span>
        <span className="text-ink-400 transition group-open:rotate-180">⌄</span>
      </summary>
      {open && (
        <div className="px-3 pb-3 sm:px-4">
          <TrackRecordView a={a} />
        </div>
      )}
    </details>
  );
}
