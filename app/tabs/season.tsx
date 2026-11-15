"use client";

// Team -> Season: playoff odds, power rankings and the rest-of-season planner.

import type { Analysis } from "@/lib/advisor";
import { buildPlan, type Plan } from "@/lib/planner";
import { buildPlayoffOdds, type PlayoffOdds } from "@/lib/playoffs";
import { PowerRankings } from "../insightsui";
import { Card, Empty, PlayerLine, PosBadge } from "../ui";
import { oddsTone, record, useAsync } from "./shared";

function cellStyle(v: number, max: number) {
  const t = Math.max(0, Math.min(1, v / max));
  return { backgroundColor: `color-mix(in srgb, var(--color-mint-400) ${Math.round(8 + t * 47)}%, transparent)` };
}

/** Byes at the positions a planner alert is about. */
function ByeNote({ w }: { w: Plan["weeks"][number] }) {
  const affected = [...w.holes, ...w.thin];
  const relevant = w.byes.filter((p) => affected.includes(p.position));
  const shown = relevant.length
    ? relevant
    : affected.some((h) => !["QB", "RB", "WR", "TE", "K", "DEF"].includes(h))
      ? w.byes
      : [];
  if (!shown.length) return null;
  return <span className="text-ink-400"> ({shown.map((p) => p.name).join(", ")} on bye)</span>;
}

function Planner({ a }: { a: Analysis }) {
  const { data: plan, error } = useAsync<Plan>(() => buildPlan(a), [a]);
  if (error) return <Empty>Couldn&apos;t load future projections: {error}</Empty>;
  if (!plan) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-72 rounded-2xl" />
      </div>
    );
  }
  const alerts = plan.weeks.filter((w) => w.holes.length || w.thin.length);
  const best = Math.max(1, ...plan.weeks.map((w) => w.total));
  const cellMax = Math.max(1, ...plan.rows.flatMap((r) => r.cells.filter((c): c is number => typeof c === "number")));
  const stashes = [...plan.rows]
    .filter((r) => r.playoffPoints > 0)
    .sort((x, y) => y.playoffPoints - x.playoffPoints)
    .slice(0, 3);
  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Projected points by week"
        action={
          plan.playoffStart && <span className="text-xs text-ink-400">playoffs start week {plan.playoffStart}</span>
        }
      >
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {plan.weeks.map((w) => (
            <div
              key={w.week}
              className={`flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl border px-2 py-2.5 ${
                w.playoff ? "border-mint-400/50 bg-mint-400/10" : "border-ink-700 bg-ink-850"
              }`}
            >
              <span className="text-[10px] font-bold tracking-wider text-ink-400 uppercase">
                {w.playoff ? "Playoff" : "Week"} {w.week}
              </span>
              <span className="font-mono text-lg font-bold tabular-nums">{w.total.toFixed(0)}</span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700">
                <div className="h-full bg-mint-400" style={{ width: `${(w.total / best) * 100}%` }} />
              </div>
              <span
                className={`text-[10px] font-semibold ${
                  w.holes.length ? "text-rose-300" : w.thin.length ? "text-amber-300" : "text-ink-400"
                }`}
              >
                {w.holes.length
                  ? `hole: ${w.holes.join(", ")}`
                  : w.thin.length
                    ? `thin: ${w.thin.join(", ")}`
                    : `${w.byes.length} on bye`}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Heads up">
        {alerts.length === 0 ? (
          <Empty>No bye-week holes coming up — your depth covers every week.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((w) => (
              <li
                key={w.week}
                className={`rounded-xl border px-4 py-3 text-sm ${
                  w.holes.length ? "border-rose-500/30 bg-rose-500/10" : "border-amber-400/30 bg-amber-400/10"
                }`}
              >
                <b>Week {w.week}:</b>{" "}
                {w.holes.length
                  ? `no one to start at ${w.holes.join(", ")}`
                  : `no backup at ${w.thin.join(", ")} — one more injury and you're stuck`}
                <ByeNote w={w} />.{" "}
                {w.holes.length > 0 && (
                  <span className="text-ink-300">
                    {w.week - 1 > a.week
                      ? `Pick someone up on week ${w.week - 1} waivers.`
                      : "Pick someone up this week."}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {plan.playoffWeeks.length > 0 && stashes.length > 0 && (
        <Card title="Playoff MVPs">
          <div className="grid gap-2 sm:grid-cols-3">
            {stashes.map((r) => (
              <div
                key={r.player.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-ink-850 px-3 py-2.5"
              >
                <PlayerLine p={r.player} size={32} />
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold tabular-nums">{r.playoffPoints.toFixed(1)}</div>
                  <div className="text-[10px] text-ink-400">
                    wks {plan.playoffWeeks[0]}–{plan.playoffWeeks.at(-1)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Projected points across the fantasy playoffs — protect these players.
          </p>
        </Card>
      )}

      <Card title="Week-by-week projections">
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] tracking-wider text-ink-400 uppercase">
                <th className="sticky left-0 z-10 bg-ink-900 py-2 pr-2 pl-4 text-left font-semibold sm:pl-5">Player</th>
                {plan.weeks.map((w) => (
                  <th
                    key={w.week}
                    className={`px-1 py-2 text-center font-semibold ${w.playoff ? "text-mint-400" : ""}`}
                  >
                    {w.week}
                  </th>
                ))}
                {plan.playoffWeeks.length > 0 && (
                  <th className="px-2 py-2 text-right font-semibold text-mint-400">Playoffs</th>
                )}
                <th className="w-3" />
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => (
                <tr key={r.player.id} className="border-t border-ink-700/40">
                  <td className="sticky left-0 z-10 bg-ink-900 py-1.5 pr-2 pl-4 sm:pl-5">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <PosBadge pos={r.player.position} />
                      <span className="max-w-[120px] truncate font-medium">{r.player.name}</span>
                    </span>
                  </td>
                  {r.cells.map((c, j) => (
                    <td key={j} className="px-0.5 py-1">
                      {c === "BYE" ? (
                        <span className="block rounded bg-ink-700 px-1 py-1 text-center text-[9px] font-bold text-ink-400">
                          BYE
                        </span>
                      ) : c === null ? (
                        <span className="block py-1 text-center text-ink-600">·</span>
                      ) : (
                        <span
                          className={`block rounded px-1 py-1 text-center font-mono tabular-nums ${
                            plan.weeks[j].starters.includes(r.player.id) ? "font-semibold text-ink-100" : "text-ink-400"
                          }`}
                          style={cellStyle(c, cellMax)}
                        >
                          {c.toFixed(0)}
                        </span>
                      )}
                    </td>
                  ))}
                  {plan.playoffWeeks.length > 0 && (
                    <td className="px-2 text-right font-mono font-semibold tabular-nums">
                      {r.playoffPoints.toFixed(0)}
                    </td>
                  )}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Bold = in your best lineup that week. Darker green = more points. Future weeks use Sleeper&apos;s projections,
          which update as the season goes.
        </p>
      </Card>
    </div>
  );
}

// --- Playoff odds ---------------------------------------------------------

/**
 * The rest of your season on one page: playoff odds and the games that swing
 * them, the league's power rankings (with each team's record and odds), then
 * your week-by-week outlook and bye-week holes.
 */
export function Season({ a }: { a: Analysis }) {
  const { data: odds, error } = useAsync<PlayoffOdds>(() => buildPlayoffOdds(a), [a]);
  const standings = odds
    ? new Map(odds.teams.map((t) => [t.rosterId, { record: record(t), playoffPct: t.playoffPct }]))
    : undefined;
  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Empty>Couldn&apos;t simulate the season: {error}</Empty>
      ) : odds ? (
        <Playoffs odds={odds} />
      ) : (
        <div className="flex flex-col gap-3" aria-busy="true">
          <div className="skeleton h-40 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      )}
      <PowerRankings a={a} standings={standings} />
      <Planner a={a} />
    </div>
  );
}

function Playoffs({ odds }: { odds: PlayoffOdds }) {
  const me = odds.me;
  const likelySeed = me.seedPct.indexOf(Math.max(...me.seedPct)) + 1;
  const leverage = [...odds.mustWin].sort((x, y) => y.ifWin - y.ifLose - (x.ifWin - x.ifLose));
  const topSwing = new Set(leverage.slice(0, 3).map((w) => w.week));
  const safe = odds.winsOutlook.find((w) => w.playoffPct >= 80 && w.chance > 0);
  const over = odds.remainingWeeks.length === 0;
  return (
    <div className="flex flex-col gap-5">
      <Card title="Your playoff odds">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-end gap-2">
            <span className={`glow font-mono text-7xl leading-none font-black tabular-nums ${oddsTone(me.playoffPct)}`}>
              {me.playoffPct >= 99.95
                ? "100"
                : me.playoffPct < 0.05
                  ? "0"
                  : me.playoffPct.toFixed(me.playoffPct < 10 ? 1 : 0)}
            </span>
            <span className="display pb-1 text-2xl font-bold text-ink-400">%</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Record", value: record(me) },
              { label: "Proj. wins", value: me.projectedWins.toFixed(1) },
              { label: "Likely seed", value: `#${likelySeed}` },
              odds.byes > 0
                ? { label: `Bye (top ${odds.byes})`, value: `${me.byePct.toFixed(0)}%` }
                : { label: "Points for", value: me.pointsFor.toFixed(0) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-ink-850 px-3 py-2">
                <div className="text-[10px] font-bold tracking-wider text-ink-400 uppercase">{s.label}</div>
                <div className="font-mono text-xl font-bold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-400">
          {over
            ? "The regular season is over — these are the final standings."
            : `${(10000).toLocaleString()} simulations of weeks ${odds.remainingWeeks[0]}–${odds.remainingWeeks.at(-1)} using the real schedule, each team's projected lineup strength and actual points so far. Top ${odds.playoffTeams} make it; ties broken on points for${odds.divisions ? ", division winners seeded first" : ""}${odds.medianGames ? "; includes the weekly game vs. the league median" : ""}.`}
          {safe && !over && (
            <>
              {" "}
              <b className="text-ink-200">
                {safe.wins} wins gets you in {safe.playoffPct.toFixed(0)}% of the time.
              </b>
            </>
          )}
        </p>
      </Card>

      {!over && odds.mustWin.length > 0 && (
        <Card
          title="Biggest games left"
          action={<span className="text-xs text-ink-400">playoff odds if you win / lose</span>}
        >
          <ul className="flex flex-col gap-2">
            {odds.mustWin.map((w) => {
              const swing = w.ifWin - w.ifLose;
              const hot = topSwing.has(w.week) && swing >= 5;
              return (
                <li
                  key={w.week}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 border px-3 py-2.5 text-sm ${
                    hot ? "border-hot/40 border-l-4 border-l-hot bg-hot/10" : "border-ink-700 bg-ink-850"
                  }`}
                >
                  <span className="display w-16 shrink-0 font-bold text-ink-300">Wk {w.week}</span>
                  <span className="min-w-0 flex-1 basis-[calc(100%-5rem)] truncate sm:basis-auto">
                    vs <b>{w.opponent ?? "TBD"}</b>
                    <span className="ml-2 text-xs text-ink-400">{w.winProbability.toFixed(0)}% to win</span>
                  </span>
                  <span className="ml-20 font-mono text-xs tabular-nums sm:ml-0">
                    <span className="text-mint-400">{w.ifWin.toFixed(0)}%</span>
                    <span className="text-ink-500"> / </span>
                    <span className="text-rose-300">{w.ifLose.toFixed(0)}%</span>
                  </span>
                  <span
                    className={`ml-auto w-20 shrink-0 text-right font-mono text-xs font-bold tabular-nums sm:ml-0 ${hot ? "text-hot" : "text-ink-400"}`}
                  >
                    {hot ? "MUST WIN" : `${swing.toFixed(0)}% swing`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!over && odds.winsOutlook.length > 1 && (
        <Card title="Wins you need">
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
            {odds.winsOutlook
              .filter((w) => w.chance >= 0.5)
              .map((w) => (
                <div key={w.wins} className="flex w-12 shrink-0 flex-col items-center gap-1">
                  <span className={`font-mono text-xs font-bold tabular-nums ${oddsTone(w.playoffPct)}`}>
                    {w.playoffPct.toFixed(0)}%
                  </span>
                  <div className="flex h-24 w-full items-end bg-ink-850">
                    <div
                      className={`w-full ${w.playoffPct >= 75 ? "bg-mint-400" : w.playoffPct >= 40 ? "bg-amber-300" : "bg-rose-400/70"}`}
                      style={{ height: `${Math.max(3, w.playoffPct)}%` }}
                    />
                  </div>
                  <span className="display text-sm font-bold">{w.wins}W</span>
                  <span className="text-[10px] text-ink-400">{w.chance.toFixed(0)}% likely</span>
                </div>
              ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Bar height = your playoff chance if you finish with that many wins. Below: how likely each finish is.
          </p>
        </Card>
      )}
    </div>
  );
}

// --- Track record ---------------------------------------------------------
