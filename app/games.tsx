"use client";

// Games tab: a live scoreboard of every game this week, with your players'
// stat lines inside each game. Rows light up when a player gains points
// since the last refresh.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { fetchGameCenter, type GameCard, type GameCenter, type GamePlayer } from "@/lib/gamecenter";
import type { Game } from "@/lib/scoreboard";
import { DriveChart } from "./field";
import { GameSheet, type SheetTab } from "./gamesheet";
import { Card, Empty, Headshot } from "./ui";

/** Live scoreboard + your players' stats, every 30s while games are on (5 min otherwise). */
function useGameCenter(a: Analysis) {
  const [gc, setGc] = useState<GameCenter | null>(null);
  const [failed, setFailed] = useState(false);
  const [gains, setGains] = useState<Map<string, number>>(new Map());
  const prev = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const starters = new Set(a.currentLineup.map((s) => s.player?.id).filter(Boolean) as string[]);
    const load = async () => {
      try {
        const next = await fetchGameCenter(a, starters);
        if (!alive) return;
        // Who scored since the last refresh (nothing flagged on the first load).
        const now = new Map(next.cards.flatMap((c) => c.players.map((p) => [p.player.id, p.points] as const)));
        const before = prev.current;
        const up = new Map<string, number>();
        if (before) {
          for (const [id, pts] of now) {
            const d = pts - (before.get(id) ?? pts);
            if (Math.abs(d) >= 0.1) up.set(id, Math.round(d * 10) / 10);
          }
        }
        prev.current = now;
        setGains(up);
        setGc(next);
        setFailed(false);
        timer = setTimeout(load, next.live > 0 ? 30_000 : 5 * 60_000);
      } catch {
        if (!alive) return;
        setFailed(true);
        timer = setTimeout(load, 60_000);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [a]);
  return { gc, failed, gains };
}

const color = (c: string | null) => (c ? `#${c}` : "var(--color-ink-600)");

function Ball({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 14" className={`inline-block h-2.5 w-4 ${className}`} aria-label="has the ball">
      <ellipse cx="12" cy="7" rx="11" ry="6" fill="#8b4513" />
      <path d="M7 7h10M10 5v4M12 5v4M14 5v4" stroke="white" strokeWidth="1.2" />
    </svg>
  );
}

/** Mini field: away end zone left, home end zone right, ball spot, line to gain. */
function GameField({ g }: { g: Game }) {
  const s = g.situation!;
  if (s.ballFromAway === null) return null;
  const x = (yd: number) => 10 + yd;
  const dir = s.possession === g.home ? -1 : 1; // the away team attacks to the right
  const ball = x(s.ballFromAway);
  const togo = s.distance !== null ? Math.max(0, Math.min(100, s.ballFromAway + dir * s.distance)) : null;
  return (
    <svg viewBox="0 0 120 14" className="mt-2 block h-auto w-full" role="img" aria-label={s.text ?? "Ball position"}>
      <rect x={0} y={0} width={120} height={14} className="fill-ink-800" />
      {s.redZone && (
        <rect x={dir > 0 ? x(80) : x(0)} y={0} width={20} height={14} fill="var(--color-hot)" opacity={0.15} />
      )}
      <rect x={0} y={0} width={10} height={14} fill={color(g.awayColor)} />
      <rect x={110} y={0} width={10} height={14} fill={color(g.homeColor)} />
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => (
        <line
          key={yd}
          x1={x(yd)}
          x2={x(yd)}
          y1={0}
          y2={14}
          stroke="currentColor"
          className="text-ink-100"
          strokeOpacity={yd === 50 ? 0.3 : 0.12}
          strokeWidth={0.5}
        />
      ))}
      {togo !== null && togo > 0 && togo < 100 && (
        <line x1={x(togo)} x2={x(togo)} y1={0} y2={14} stroke="#facc15" strokeWidth={0.9} />
      )}
      <line x1={ball} x2={ball} y1={0} y2={14} stroke="var(--color-mint-400)" strokeWidth={0.8} />
      <ellipse cx={ball} cy={7} rx={3.2} ry={2} fill="#8b4513" stroke="white" strokeWidth={0.4} />
      <path
        d={
          dir > 0
            ? `M${ball + 4.5} 5 L${ball + 7} 7 L${ball + 4.5} 9 z`
            : `M${ball - 4.5} 5 L${ball - 7} 7 L${ball - 4.5} 9 z`
        }
        fill="var(--color-mint-400)"
      />
    </svg>
  );
}

function TeamRow({ g, side }: { g: Game; side: "away" | "home" }) {
  const abbr = side === "home" ? g.home : g.away;
  const score = side === "home" ? g.homeScore : g.awayScore;
  const other = side === "home" ? g.awayScore : g.homeScore;
  const leading = g.state !== "pre" && score !== null && other !== null && score > other;
  const hasBall = g.state === "in" && g.situation?.possession === abbr;
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="h-6 w-1.5 shrink-0"
        style={{ backgroundColor: color(side === "home" ? g.homeColor : g.awayColor) }}
      />
      <span className={`display text-xl font-black ${leading || g.state === "pre" ? "text-ink-100" : "text-ink-300"}`}>
        {abbr}
      </span>
      {hasBall && <Ball />}
      <span
        className={`ml-auto font-mono text-2xl leading-none font-black tabular-nums ${leading ? "text-ink-100" : "text-ink-400"}`}
      >
        {g.state === "pre" ? "" : (score ?? "–")}
      </span>
    </div>
  );
}

function StatusChip({ g }: { g: Game }) {
  if (g.state === "in") {
    return (
      <span className="display flex items-center gap-1.5 text-sm font-black text-hot">
        <span className="h-2 w-2 animate-pulse rounded-full bg-hot" />
        {g.detail || "Live"}
      </span>
    );
  }
  if (g.state === "post") return <span className="display text-sm font-black text-ink-400">FINAL</span>;
  const when = g.kickoffKnown
    ? new Date(g.kickoff).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
    : new Date(g.kickoff).toLocaleDateString([], { weekday: "short" });
  return <span className="display text-sm font-bold text-ink-300">{when}</span>;
}

function PlayerRow({
  p,
  game,
  gain,
  onOpen,
}: {
  p: GamePlayer;
  game: Game;
  gain: number | undefined;
  onOpen: () => void;
}) {
  const pre = game.state === "pre";
  return (
    <li>
      <button
        onClick={onOpen}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-700 hover:bg-ink-800 ${
          gain && gain > 0 ? "bg-mint-400/10" : gain && gain < 0 ? "bg-rose-500/10" : ""
        }`}
      >
        <Headshot p={p.player} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{p.player.name}</span>
            {p.role === "bench" && (
              <span className="display bg-ink-700 px-1 text-[10px] font-bold text-ink-300">BN</span>
            )}
            {p.role === "opponent" && (
              <span className="display bg-rose-500/15 px-1 text-[10px] font-bold text-rose-300">OPP</span>
            )}
            {gain !== undefined && gain !== 0 && (
              <span
                className={`display animate-pulse px-1 text-[11px] font-black ${gain > 0 ? "bg-mint-400 text-ink-950" : "bg-rose-400 text-white"}`}
              >
                {gain > 0 ? "+" : ""}
                {gain.toFixed(1)}
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-ink-400">
            {pre
              ? `${p.player.position} · projected ${p.player.weekScore.toFixed(1)}`
              : p.line || (game.state === "in" ? "No stats yet" : "No stats")}
          </div>
        </div>
        <div
          className={`shrink-0 text-right font-mono text-lg leading-none font-black tabular-nums ${
            pre ? "text-ink-500" : p.role === "opponent" ? "text-rose-300" : "text-mint-400"
          }`}
        >
          {(pre ? p.player.weekScore : p.points).toFixed(1)}
        </div>
      </button>
    </li>
  );
}

function GameTile({
  c,
  gains,
  onOpen,
}: {
  c: GameCard;
  gains: Map<string, number>;
  onOpen: (tab: SheetTab, focus?: string) => void;
}) {
  const g = c.game;
  const s = g.state === "in" ? g.situation : null;
  const line =
    g.state === "pre" && (g.spread || g.overUnder !== null)
      ? [g.spread ? `${g.spread.team} -${g.spread.points}` : "PK", g.overUnder !== null ? `O/U ${g.overUnder}` : null]
          .filter(Boolean)
          .join(" · ")
      : null;
  return (
    <div
      className={`flex min-w-0 flex-col border bg-ink-850 ${
        g.state === "in" ? "border-hot/40 shadow-[0_0_24px_rgb(255_46_136/0.12)] sm:col-span-2" : "border-ink-700"
      }`}
    >
      <button
        onClick={() => onOpen(c.game.id ? "overview" : "players")}
        className="group flex items-center justify-between gap-2 border-b border-ink-700/70 px-3 py-1.5 text-left hover:bg-ink-800"
      >
        <StatusChip g={g} />
        <span className="flex items-center gap-2 text-[11px] text-ink-400">
          {s?.redZone && <span className="display bg-hot px-1.5 font-black text-white">RED ZONE</span>}
          {line}
          <span className="display font-bold text-mint-400 transition group-hover:translate-x-0.5">Game center ›</span>
        </span>
      </button>
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-2">
        <button
          onClick={() => onOpen(c.game.id ? "overview" : "players")}
          className="flex flex-col gap-1 text-left"
          aria-label={`Open ${g.away} at ${g.home}`}
        >
          <TeamRow g={g} side="away" />
          <TeamRow g={g} side="home" />
        </button>
        {s && (
          <>
            {c.drive ? (
              <button
                onClick={() => onOpen("drives")}
                aria-label="See all drives"
                className="-mx-3 mt-2 block overflow-hidden border-y border-ink-700 text-left"
              >
                <DriveChart d={c.drive} />
              </button>
            ) : (
              <GameField g={g} />
            )}
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-ink-100">{s.text}</span>
            </div>
            {s.lastPlay && <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-400">{s.lastPlay}</p>}
          </>
        )}
      </div>
      {c.players.length > 0 && (
        <ul className="mt-auto divide-y divide-ink-700/50 border-t border-ink-700/70">
          {c.players.map((p) => (
            <PlayerRow
              key={p.player.id}
              p={p}
              game={g}
              gain={gains.get(p.player.id)}
              onOpen={() => onOpen("players", p.player.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function GamesTab({ a }: { a: Analysis }) {
  const { gc, failed, gains } = useGameCenter(a);
  const [filter, setFilter] = useState<"mine" | "all">("mine");
  const [state, setState] = useState<"any" | Game["state"]>("any");
  const [open, setOpen] = useState<{ key: string; tab: SheetTab; focus: string | null } | null>(null);
  const close = useCallback(() => setOpen(null), []);
  if (!gc) {
    return failed ? (
      <Empty>Couldn&apos;t load this week&apos;s games. Retrying…</Empty>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-48" />
        ))}
      </div>
    );
  }
  const cards = (filter === "mine" ? gc.cards.filter((c) => c.players.length > 0) : gc.cards).filter(
    (c) => state === "any" || c.game.state === state,
  );
  const sheetCard = open ? gc.cards.find((c) => c.game.home === open.key) : undefined;
  const yardsLeaders = gc.cards
    .flatMap((c) => (c.game.state === "in" ? c.players.filter((p) => p.role !== "opponent" && p.yards > 0) : []))
    .sort((x, y) => y.yards - x.yards)
    .slice(0, 4);
  return (
    <div className="flex flex-col gap-4">
      <Card
        title={`Week ${a.week} games`}
        action={
          <div className="flex text-xs font-bold">
            {(
              [
                ["mine", "Your games"],
                ["all", "All games"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`display px-2.5 py-1 transition ${filter === id ? "bg-mint-400 text-ink-950" : "bg-ink-800 text-ink-400 hover:text-ink-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
          {(
            [
              ["any", "All", gc.cards.length],
              ["in", "Live", gc.live],
              ["pre", "Upcoming", gc.upcoming],
              ["post", "Final", gc.final],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setState(id)}
              disabled={id !== "any" && count === 0}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold transition disabled:opacity-40 ${
                state === id
                  ? id === "in"
                    ? "bg-hot text-white"
                    : "bg-ink-100 text-ink-950"
                  : "bg-ink-800 text-ink-300 hover:text-ink-100"
              }`}
            >
              {id === "in" && count > 0 && (
                <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${state === id ? "bg-white" : "bg-hot"}`} />
              )}
              {label}
              <span className="font-mono opacity-70">{count}</span>
            </button>
          ))}
          <span className="ml-auto text-xs text-ink-400">
            {gc.live > 0 ? "Updates every 30 seconds" : "Updates every 5 minutes"} ·{" "}
            {new Date(gc.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
        {yardsLeaders.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="display self-center text-xs font-bold tracking-wider text-ink-400 uppercase">
              Your yards leaders
            </span>
            {yardsLeaders.map((p) => (
              <button
                key={p.player.id}
                onClick={() => {
                  const card = gc.cards.find((c) => c.players.includes(p));
                  if (card) setOpen({ key: card.game.home, tab: "players", focus: p.player.id });
                }}
                className="flex items-center gap-1.5 bg-ink-800 py-0.5 pr-2 pl-0.5 text-xs transition hover:bg-ink-700"
              >
                <Headshot p={p.player} size={22} />
                <b>{p.player.name.split(" ").slice(-1)[0]}</b>
                <span className="font-mono text-mint-400 tabular-nums">{p.yards} yds</span>
              </button>
            ))}
          </div>
        )}
        {gc.cards.some((c) => c.drive) && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-700/60 pt-3 text-[11px] text-ink-400">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-1 bg-mint-400" /> Line of scrimmage
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-1 bg-[#facc15]" /> Line to gain
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 bg-mint-400" /> Gain
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 bg-hot" /> Touchdown
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 bg-rose-300" /> Loss / turnover
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-4 bg-[#fbbf24]" /> Penalty
            </span>
            <span className="font-bold text-mint-300">Bold = your player</span>
          </div>
        )}
      </Card>
      {cards.length === 0 ? (
        <Empty>
          {state !== "any"
            ? "No games match this filter."
            : filter === "mine"
              ? "None of your players are in this week's games."
              : "No games this week."}
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <GameTile
              key={c.game.home}
              c={c}
              gains={gains}
              onOpen={(tab, focus) => setOpen({ key: c.game.home, tab, focus: focus ?? null })}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-ink-400">
        Scores, clocks and down &amp; distance from ESPN; stat lines from Sleeper&apos;s live stats, with points under
        your league&apos;s scoring. A highlighted row means that player scored since the last refresh. Your bench
        players are marked BN, your opponent&apos;s starters OPP. Tap any game for its game center, or a player to see
        where their points came from.
      </p>
      {open && sheetCard && (
        <GameSheet key={open.key} c={sheetCard} a={a} initialTab={open.tab} focus={open.focus} onClose={close} />
      )}
    </div>
  );
}
