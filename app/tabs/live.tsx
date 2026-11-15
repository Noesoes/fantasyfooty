"use client";

// Game day: live scores, win probability and late-swap alerts.

import { useEffect, useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { fetchLive, type LivePlayer, type LiveSide, type LiveState } from "@/lib/live";
import { Card, PlayerLine, SlotBadge } from "../ui";
import { MatchupCard } from "./scoreboard";

/** Live scores for this week, refreshed every minute while games are on. */
export function useLive(a: Analysis) {
  const [live, setLive] = useState<LiveState | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fetchLive(a);
        if (!alive) return;
        setLive(next);
        // Keep polling while anything is still to be played today.
        if (next.started && !next.allDone) timer = setTimeout(load, next.inProgress ? 60_000 : 5 * 60_000);
      } catch {
        if (alive) timer = setTimeout(load, 2 * 60_000);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [a]);
  return live;
}

export function LiveScoreboard({ live }: { a: Analysis; live: LiveState }) {
  const me = live.me;
  const opp = live.opponent;
  return (
    <MatchupCard
      win={live.winProbability}
      ringLabel={live.allDone ? "final" : "live"}
      me={{ name: "You", pts: me.score }}
      opp={opp ? { name: opp.teamName, pts: opp.score } : null}
      note={
        <span className="inline-flex items-center gap-1.5 text-ink-300">
          {!live.allDone && <span className="h-2 w-2 animate-pulse rounded-full bg-hot" />}
          {live.allDone
            ? "Final"
            : `${me.remaining > 0 ? `+${me.remaining} to come` : "All done"}${opp ? ` · them +${opp.remaining}` : ""}`}
        </span>
      }
    />
  );
}

export function LiveTab({ live }: { live: LiveState }) {
  return (
    <div className="flex flex-col gap-5">
      {live.lateSwaps.length > 0 && (
        <div className="flex flex-col gap-2">
          {live.lateSwaps.map((s) => (
            <div
              key={s.out.id + s.in.id}
              className="flex flex-col gap-1.5 rounded-2xl border border-hot/40 bg-hot/10 px-4 py-3 text-sm"
            >
              <span className="self-start rounded-full bg-hot px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide text-ink-950 uppercase">
                Late swap
              </span>
              <span className="leading-snug">
                {s.freeAgent ? "Add free agent " : "Start "}
                <b>{s.in.name}</b> ({s.in.position}, {s.in.team}) {s.freeAgent ? "and start them " : ""}over{" "}
                <b>{s.out.name}</b> at {s.slot} — +{s.gain} projected. {s.reason}.
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <LiveRoster title="Your lineup" side={live.me} accent="mint" />
        {live.opponent && <LiveRoster title={live.opponent.teamName} side={live.opponent} accent="hot" />}
      </div>
      <p className="text-xs text-ink-400">
        Points are Sleeper&apos;s live scoring. &quot;Still to come&quot; is each player&apos;s projection times the
        share of their game left; win probability assumes a typical player&apos;s score swings about ±60% of projection.
        Game clocks from{" "}
        {live.games.source === "espn"
          ? "ESPN"
          : live.games.source === "snapshot"
            ? "ESPN (saved copy)"
            : "Sleeper's schedule"}
        .
      </p>
    </div>
  );
}

function gameLabel(p: LivePlayer) {
  if (p.status === "bye") return "BYE";
  const g = p.game;
  if (!g) return "—";
  const opp = p.player?.team === g.home ? g.away : g.home;
  if (g.state === "pre") {
    const when = new Date(g.kickoff).toLocaleString(
      [],
      g.kickoffKnown ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { weekday: "short" },
    );
    return `${when} vs ${opp}`;
  }
  const mine = p.player?.team === g.home ? g.homeScore : g.awayScore;
  const theirs = p.player?.team === g.home ? g.awayScore : g.homeScore;
  const score = mine !== null && theirs !== null ? ` · ${mine}-${theirs}` : "";
  return `${g.state === "post" ? "Final" : g.detail}${score} vs ${opp}`;
}

function LiveRoster({ title, side, accent }: { title: string; side: LiveSide; accent: "mint" | "hot" }) {
  const max = Math.max(1, ...side.players.map((p) => p.points + p.remaining));
  return (
    <Card
      title={title}
      action={
        <span
          className={`font-mono text-xl font-black tabular-nums ${accent === "mint" ? "text-mint-400" : "text-rose-300"}`}
        >
          {side.score.toFixed(1)}
        </span>
      }
    >
      <ul className="flex flex-col divide-y divide-ink-700/60">
        {side.players.map((p, i) => (
          <li key={p.id + i} className="flex items-center gap-3 py-2.5">
            <SlotBadge slot={p.slot === "Superflex" ? "SUPER_FLEX" : p.slot === "Flex" ? "FLEX" : p.slot} />
            {p.player ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <PlayerLine p={p.player} size={34} />
                <div
                  className={`mt-1 ml-[46px] flex items-center gap-1.5 truncate text-[11px] font-semibold ${
                    p.status === "in" ? "text-hot" : "text-ink-400"
                  }`}
                >
                  {p.status === "in" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hot" />}
                  {gameLabel(p)}
                </div>
              </div>
            ) : (
              <span className="flex-1 text-sm text-ink-400 italic">{p.name}</span>
            )}
            <div className="w-20 shrink-0 text-right">
              <div className="font-mono text-2xl leading-none font-black tabular-nums">{p.points.toFixed(1)}</div>
              {p.remaining > 0 && (
                <div className="font-mono text-[11px] text-ink-400 tabular-nums">+{p.remaining.toFixed(1)} to come</div>
              )}
              <div className="mt-1 flex h-1 bg-ink-700">
                <div
                  className={accent === "mint" ? "bg-mint-400" : "bg-hot"}
                  style={{ width: `${(p.points / max) * 100}%` }}
                />
                <div className="bg-ink-400/40" style={{ width: `${(p.remaining / max) * 100}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- Game plan -------------------------------------------------------------
