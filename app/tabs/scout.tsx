"use client";

// Home -> Matchup: the matchup analyzer and the opponent scouting report.

import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { buildScouting, ordinal, type Scouting } from "@/lib/scouting";
import { MatchupAnalyzer } from "../matchupui";
import { Card, Empty, Headshot, PlayerLine, SlotBadge } from "../ui";
import { TeamMark, useAsync } from "./shared";

function ScoutPlayer({ p, align }: { p: PlayerAnalysis | null; align: "left" | "right" }) {
  if (!p) return <span className={`text-xs text-ink-500 ${align === "right" ? "text-right" : ""}`}>Empty</span>;
  const flag = p.onBye ? "BYE" : p.injury ? p.injury.slice(0, 1) : null;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <span className="hidden sm:block">
        <Headshot p={p} size={30} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">
          {p.name}
          {flag && <span className="ml-1 rounded bg-rose-500/15 px-1 text-[10px] font-bold text-rose-300">{flag}</span>}
        </div>
        <div className="font-mono text-xs text-ink-400 tabular-nums">{p.weekScore.toFixed(1)}</div>
      </div>
    </div>
  );
}

export function Scout({ a }: { a: Analysis }) {
  const { data: s, error } = useAsync<Scouting | null>(() => buildScouting(a), [a]);
  if (!a.opponent) return <Empty>No opponent this week (bye or playoffs).</Empty>;
  if (error)
    return (
      <div className="flex flex-col gap-5">
        <MatchupAnalyzer a={a} />
        <Empty>Couldn&apos;t load the scouting report: {error}</Empty>
      </div>
    );
  if (!s) {
    return (
      <div className="flex flex-col gap-5" aria-busy="true">
        <MatchupAnalyzer a={a} />
        <div className="skeleton h-96 rounded-2xl" />
      </div>
    );
  }
  const t = s.tendencies;
  const maxEdge = Math.max(1, ...s.edges.map((e) => Math.abs(e.edge)));
  const asleep = s.theirBest - s.theirProjected;
  const rec = `${s.record.wins}-${s.record.losses}${s.record.ties ? `-${s.record.ties}` : ""}`;
  return (
    <div className="flex flex-col gap-5">
      <MatchupAnalyzer a={a} />
      <Card title="Scouting report">
        <div className="flex flex-wrap items-center gap-4">
          <TeamMark t={s} size={56} />
          <div className="min-w-0 flex-1">
            <div className="display truncate text-3xl leading-tight font-extrabold">{s.teamName}</div>
            <div className="text-xs text-ink-400">
              {rec} · {ordinal(s.standing)} in the standings · {ordinal(s.pointsForRank)} in points (
              {s.pointsFor.toFixed(0)})
            </div>
          </div>
        </div>
        {s.talk.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {s.talk.map((line) => (
              <li key={line} className="flex items-start gap-3 bg-hot/10 px-3 py-2 text-sm">
                <span className="display shrink-0 rounded-lg bg-hot px-2 py-0.5 text-xs font-black text-ink-950">
                  <span className="inline-block ">INTEL</span>
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Tale of the tape"
        action={
          <span className="font-mono text-sm font-semibold tabular-nums">
            <span className="text-mint-400">{s.yourProjected.toFixed(1)}</span>
            <span className="text-ink-500"> – </span>
            <span className="text-rose-300">{s.theirProjected.toFixed(1)}</span>
          </span>
        }
      >
        <div className="mb-2 grid grid-cols-[1fr_auto_1fr] gap-2 text-[10px] font-bold tracking-wider text-ink-400 uppercase">
          <span>You (best lineup)</span>
          <span />
          <span className="text-right">Them (as set)</span>
        </div>
        <ul className="flex flex-col divide-y divide-ink-700/60">
          {s.edges.map((e, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2">
              <ScoutPlayer p={e.mine} align="left" />
              <div className="flex w-16 flex-col items-center gap-1">
                <SlotBadge slot={e.slot} />
                <div className="flex h-1 w-full bg-ink-700">
                  <div className="flex w-1/2 justify-end">
                    {e.edge > 0 && (
                      <div className="h-full bg-mint-400" style={{ width: `${(e.edge / maxEdge) * 100}%` }} />
                    )}
                  </div>
                  <div className="w-1/2">
                    {e.edge < 0 && <div className="h-full bg-hot" style={{ width: `${(-e.edge / maxEdge) * 100}%` }} />}
                  </div>
                </div>
                <span
                  className={`font-mono text-[10px] font-bold tabular-nums ${e.edge > 0.5 ? "text-mint-400" : e.edge < -0.5 ? "text-hot" : "text-ink-500"}`}
                >
                  {e.edge > 0 ? `+${e.edge.toFixed(1)}` : e.edge.toFixed(1)}
                </span>
              </div>
              <ScoutPlayer p={e.theirs} align="right" />
            </li>
          ))}
        </ul>
        {asleep >= 3 && (
          <p className="mt-3 text-xs text-ink-400">
            Their lineup isn&apos;t set yet: their best possible lineup projects{" "}
            <b className="text-ink-200">{s.theirBest.toFixed(1)}</b>,{" "}
            {`${asleep.toFixed(1)} more than what's in there now. Plan for the better version.`}
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Weak spots">
          {s.weakSpots.length === 0 ? (
            <Empty>No holes — every starter is healthy and projected to play.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {s.weakSpots.map((w, i) => (
                <li key={i} className="flex items-center justify-between gap-3 rounded-xl bg-ink-850 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <SlotBadge slot={w.slot} />
                    {w.player ? <PlayerLine p={w.player} size={28} /> : <span className="text-sm">Nobody</span>}
                  </div>
                  <span className="shrink-0 text-xs font-bold text-rose-300">{w.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Moves to expect">
          {s.moves.length === 0 ? (
            <Empty>Their lineup is already as good as it gets.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {s.moves.map((m) => (
                <li key={m.in.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-850 px-3 py-2">
                  <div className="min-w-0">
                    <PlayerLine p={m.in} size={28} />
                    <div className="mt-0.5 ml-10 text-[11px] text-ink-400">
                      {m.kind === "pickup" ? "Free agent pickup" : "From their bench"}
                      {m.out ? ` · replaces ${m.out.name}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-bold text-hot tabular-nums">
                    +{m.gain.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Manager tendencies" action={<span className="text-xs text-ink-400">this season</span>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: "Bench pts left / wk",
              value: t.benchLeftPerWeek === null ? "—" : t.benchLeftPerWeek.toFixed(1),
            },
            { label: "Zero-point starts", value: String(t.zeroStarts) },
            {
              label: "Pickups · trades",
              value: `${t.waiverAdds + t.freeAgentAdds} · ${t.trades}`,
            },
            t.faabSpent !== null
              ? { label: "FAAB spent", value: `$${t.faabSpent}` }
              : {
                  label: "Last 3 wks avg",
                  value: t.recentAvg === null ? "—" : `${t.recentAvg.toFixed(1)}`,
                },
          ].map((x) => (
            <div key={x.label} className="rounded-xl bg-ink-850 px-3 py-2">
              <div className="text-[10px] font-bold tracking-wider text-ink-400 uppercase">{x.label}</div>
              <div className="font-mono text-xl font-bold tabular-nums">{x.value}</div>
            </div>
          ))}
        </div>
        {s.meetings.length > 0 && (
          <div className="mt-4 text-sm">
            <span className="text-xs font-bold tracking-wider text-ink-400 uppercase">Earlier this season · </span>
            {s.meetings.map((m) => (
              <span key={m.week} className="mr-3">
                Wk {m.week}:{" "}
                <b className={m.you > m.them ? "text-mint-400" : "text-rose-300"}>
                  {m.you > m.them ? "W" : "L"} {m.you.toFixed(1)}–{m.them.toFixed(1)}
                </b>
              </span>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-400">
          Bench points left = their best possible lineup in hindsight minus what they started, from Sleeper&apos;s
          weekly results{t.weeks ? ` (${t.weeks} weeks)` : ""}.
        </p>
      </Card>
    </div>
  );
}

// --- Season planner -------------------------------------------------------
