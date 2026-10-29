"use client";

// Game center sheet: opens when you tap a game on the Games tab. Score by
// quarter, a win-probability chart you can scrub, team stat comparison,
// every drive on a mini field, the scoring summary, team leaders, and where
// your players' fantasy points came from.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Analysis } from "@/lib/advisor";
import type { GameCard, GamePlayer } from "@/lib/gamecenter";
import { fetchGameDetail, pointBreakdown, type DriveSummary, type GameDetail, type Highlight } from "@/lib/gamedetail";
import type { Game } from "@/lib/scoreboard";
import { DriveChart } from "./field";
import { useDragToClose } from "./sheetdrag";
import { BoxScore, Highlights, playersIn, snapText, StakeStrip } from "./gameparts";
import { Headshot } from "./ui";

export type SheetTab = "overview" | "box" | "stats" | "drives" | "players";

const color = (c: string | null) => (c ? `#${c}` : "var(--color-ink-500)");

function useGameDetail(game: Game) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [failed, setFailed] = useState(false);
  // The parent refreshes the scoreboard (new objects every time); refetch on our own clock instead.
  const latest = useRef(game);
  useEffect(() => {
    latest.current = game;
  });
  const live = game.state === "in";
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await fetchGameDetail(latest.current);
        if (!alive) return;
        setDetail(d);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
      if (alive && live) timer = setTimeout(load, 30_000);
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [game.id, game.state, live]);
  return { detail, failed };
}

// --- Header -------------------------------------------------------------------

interface SheetNav {
  index: number;
  count: number;
  go: (delta: number) => void;
  pinned: boolean;
  togglePin: () => void;
}

function SheetHeader({ g, d, onClose, nav }: { g: Game; d: GameDetail | null; onClose: () => void; nav: SheetNav }) {
  const status =
    g.state === "in"
      ? g.detail || "Live"
      : g.state === "post"
        ? "Final"
        : g.kickoffKnown
          ? new Date(g.kickoff).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
          : new Date(g.kickoff).toLocaleDateString([], { weekday: "short" });
  const team = (side: "away" | "home") => {
    const abbr = side === "away" ? g.away : g.home;
    const score = side === "away" ? g.awayScore : g.homeScore;
    const other = side === "away" ? g.homeScore : g.awayScore;
    const lead = g.state !== "pre" && score !== null && other !== null && score > other;
    const rec = d?.records[side];
    return (
      <div className={`flex min-w-0 flex-1 flex-col ${side === "home" ? "items-end text-right" : ""}`}>
        <div className="flex items-center gap-2">
          {side === "away" && <span className="h-7 w-1.5" style={{ backgroundColor: color(g.awayColor) }} />}
          <span className="display text-2xl font-black">{abbr}</span>
          {g.state === "in" && g.situation?.possession === abbr && (
            <span className="text-xs" aria-label="has the ball">
              🏈
            </span>
          )}
          {side === "home" && <span className="h-7 w-1.5" style={{ backgroundColor: color(g.homeColor) }} />}
        </div>
        <span className="text-[11px] text-ink-400">
          {side === "away" ? "Away" : "Home"}
          {rec ? ` · ${rec}` : ""}
        </span>
        {g.state !== "pre" && (
          <span
            className={`mt-1 font-mono text-5xl leading-none font-black tabular-nums ${lead ? "glow text-ink-100" : "text-ink-400"}`}
          >
            {score ?? "–"}
          </span>
        )}
      </div>
    );
  };
  return (
    <div data-sheet-handle className="border-b border-ink-800 px-4 pt-2 pb-4">
      <div className="mb-1 flex justify-center sm:hidden">
        <span className="h-1.5 w-10 rounded-full bg-ink-600" />
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`display flex items-center gap-1.5 text-sm font-black ${g.state === "in" ? "text-hot" : "text-ink-300"}`}
        >
          {g.state === "in" && <span className="h-2 w-2 animate-pulse rounded-full bg-hot" />}
          {status}
        </span>
        <div className="flex items-center gap-1.5">
          {nav.count > 1 && (
            <>
              <button
                onClick={() => nav.go(-1)}
                disabled={nav.index === 0}
                aria-label="Previous game"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-lg text-ink-300 hover:text-ink-100 disabled:opacity-30"
              >
                ‹
              </button>
              <span className="font-mono text-[11px] text-ink-400 tabular-nums">
                {nav.index + 1}/{nav.count}
              </span>
              <button
                onClick={() => nav.go(1)}
                disabled={nav.index === nav.count - 1}
                aria-label="Next game"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-lg text-ink-300 hover:text-ink-100 disabled:opacity-30"
              >
                ›
              </button>
            </>
          )}
          <button
            onClick={nav.togglePin}
            aria-pressed={nav.pinned}
            aria-label={nav.pinned ? "Unpin game" : "Pin game to the top"}
            className={`flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-base ${nav.pinned ? "text-[#facc15]" : "text-ink-400 hover:text-ink-100"}`}
          >
            {nav.pinned ? "★" : "☆"}
          </button>
          <button
            onClick={onClose}
            aria-label="Close game center"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-lg text-ink-300 hover:text-ink-100"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex items-start gap-3">
        {team("away")}
        <span className="display self-center text-sm font-bold text-ink-500">@</span>
        {team("home")}
      </div>
      {g.state === "in" && g.situation?.text && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs">
          {g.situation.redZone && <span className="display bg-hot px-1.5 font-black text-white">RED ZONE</span>}
          <span className="font-semibold text-ink-100">{g.situation.text}</span>
        </div>
      )}
    </div>
  );
}

// --- Overview -----------------------------------------------------------------

/** Win probability over the game; drag or hover to scrub. */
function WinProbChart({ g, probs }: { g: Game; probs: number[] }) {
  const [at, setAt] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const n = probs.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (p: number) => H - p * H; // home on top
  const path = probs.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const area = `${path} L${W} ${H / 2} L0 ${H / 2} Z`;
  const idx = at ?? n - 1;
  const p = probs[idx];
  const leader = p >= 0.5 ? g.home : g.away;
  const pct = Math.round((p >= 0.5 ? p : 1 - p) * 100);
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setAt(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-ink-400">
          {at === null ? (g.state === "post" ? "Final" : "Right now") : `Play ${idx + 1} of ${n}`}
        </span>
        <span>
          <b className="display text-base" style={{ color: color(p >= 0.5 ? g.homeColor : g.awayColor) }}>
            {leader}
          </b>{" "}
          <span className="font-mono font-black text-ink-100 tabular-nums">{pct}%</span>
          <span className="text-ink-400"> to win</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        data-noswipe
        className="block h-32 w-full cursor-crosshair touch-none bg-ink-900"
        onPointerMove={scrub}
        onPointerDown={scrub}
        onPointerLeave={() => setAt(null)}
        role="img"
        aria-label={`Win probability: ${leader} ${pct}%`}
      >
        <defs>
          <clipPath id="wp-top">
            <rect x={0} y={0} width={W} height={H / 2} />
          </clipPath>
          <clipPath id="wp-bottom">
            <rect x={0} y={H / 2} width={W} height={H / 2} />
          </clipPath>
        </defs>
        <path d={area} fill={color(g.homeColor)} opacity={0.35} clipPath="url(#wp-top)" />
        <path d={area} fill={color(g.awayColor)} opacity={0.35} clipPath="url(#wp-bottom)" />
        <line
          x1={0}
          x2={W}
          y1={H / 2}
          y2={H / 2}
          stroke="currentColor"
          className="text-ink-500"
          strokeDasharray="3 3"
        />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          className="text-ink-100"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x(idx)}
          x2={x(idx)}
          y1={0}
          y2={H}
          stroke="var(--color-mint-400)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] font-bold tracking-wider text-ink-400 uppercase">
        <span>Kickoff</span>
        <span>
          {g.home} ↑ · {g.away} ↓
        </span>
        <span>{g.state === "post" ? "Final" : "Now"}</span>
      </div>
    </div>
  );
}

function PregameOdds({ g, home }: { g: Game; home: number }) {
  const awayPct = Math.round((1 - home) * 100);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span>
          <b className="display">{g.away}</b> <span className="font-mono">{awayPct}%</span>
        </span>
        <span className="text-ink-400">ESPN matchup predictor</span>
        <span>
          <span className="font-mono">{100 - awayPct}%</span> <b className="display">{g.home}</b>
        </span>
      </div>
      <div className="flex h-3 overflow-hidden">
        <div style={{ width: `${awayPct}%`, backgroundColor: color(g.awayColor) }} />
        <div className="flex-1" style={{ backgroundColor: color(g.homeColor) }} />
      </div>
    </div>
  );
}

function Linescore({ g, d }: { g: Game; d: GameDetail }) {
  const q = Math.max(4, d.linescore.away.length, d.linescore.home.length);
  const cols = Array.from({ length: q }, (_, i) => i);
  const row = (abbr: string, list: number[], total: number | null) => (
    <tr className="border-t border-ink-800">
      <td className="display py-1.5 pr-2 text-left font-black">{abbr}</td>
      {cols.map((i) => (
        <td key={i} className="py-1.5 text-center text-ink-300">
          {list[i] ?? "–"}
        </td>
      ))}
      <td className="py-1.5 text-center font-black text-ink-100">{total ?? "–"}</td>
    </tr>
  );
  return (
    <table className="w-full font-mono text-sm tabular-nums">
      <thead>
        <tr className="text-[10px] tracking-wider text-ink-400 uppercase">
          <th />
          {cols.map((i) => (
            <th key={i} className="pb-1 font-semibold">
              {i < 4 ? `Q${i + 1}` : "OT"}
            </th>
          ))}
          <th className="pb-1 font-semibold">T</th>
        </tr>
      </thead>
      <tbody>
        {row(g.away, d.linescore.away, g.awayScore)}
        {row(g.home, d.linescore.home, g.homeScore)}
      </tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="display mb-2 text-xs font-bold tracking-wider text-ink-400 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Overview({ c, d, winNow }: { c: GameCard; d: GameDetail; winNow: number | null }) {
  const g = c.game;
  return (
    <div className="flex flex-col gap-5">
      {c.stake && (
        <div className="border-l-4 border-violet bg-ink-900 px-3 py-2.5">
          <StakeStrip s={c.stake} winNow={winNow} />
        </div>
      )}
      {d.winProb.length > 1 ? (
        <Section title="Win probability">
          <WinProbChart g={g} probs={d.winProb} />
        </Section>
      ) : (
        d.pregameHome !== null && (
          <Section title="Who's favored">
            <PregameOdds g={g} home={d.pregameHome} />
          </Section>
        )
      )}
      {d.highlights.length > 0 && (
        <Section title="Highlights">
          <Highlights list={d.highlights} players={c.players} />
        </Section>
      )}
      {g.state === "pre" && (
        <Section title="Vegas & weather">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Spread", g.spread ? `${g.spread.team} -${g.spread.points}` : "—"],
              ["Over/under", g.overUnder !== null ? String(g.overUnder) : "—"],
              [
                "Weather",
                g.indoor
                  ? "Indoors"
                  : g.weather
                    ? [g.weather.temp !== null ? `${g.weather.temp}°F` : null].filter(Boolean).join("") || "—"
                    : "—",
              ],
            ].map(([k, v]) => (
              <div key={k} className="bg-ink-800 px-2 py-2">
                <div className="text-[10px] tracking-wider text-ink-400 uppercase">{k}</div>
                <div className="font-mono text-sm font-bold">{v}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {g.state !== "pre" && (
        <Section title="Score by quarter">
          <Linescore g={g} d={d} />
        </Section>
      )}
      {d.scoring.length > 0 && (
        <Section title="Scoring">
          <ol className="flex flex-col gap-1.5">
            {d.scoring.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs">
                <span
                  className="display mt-0.5 w-10 shrink-0 py-0.5 text-center text-[10px] font-black text-white"
                  style={{ backgroundColor: color(s.team === g.home ? g.homeColor : g.awayColor) }}
                >
                  {s.type || s.team}
                </span>
                <span className="min-w-0 flex-1 leading-snug text-ink-100">
                  {s.text}
                  <span className="block text-[10px] text-ink-400">
                    Q{s.quarter} {s.clock} · {s.team}
                  </span>
                </span>
                <span className="shrink-0 font-mono font-bold text-ink-300 tabular-nums">
                  {s.away}-{s.home}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {d.leaders.length > 0 && (
        <Section title={g.state === "pre" ? "Season leaders" : "Game leaders"}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {[g.away, g.home].map((t) => (
              <div key={t} className="flex min-w-0 flex-col gap-2">
                <span
                  className="display text-sm font-black"
                  style={{ color: color(t === g.home ? g.homeColor : g.awayColor) }}
                >
                  {t}
                </span>
                {d.leaders
                  .filter((l) => l.team === t)
                  .map((l) => (
                    <div key={l.category} className="min-w-0 text-xs">
                      <div className="text-[10px] tracking-wider text-ink-400 uppercase">{l.category}</div>
                      <div className="truncate font-semibold">{l.name}</div>
                      <div className="truncate font-mono text-[11px] text-ink-300">{l.line}</div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// --- Team stats ---------------------------------------------------------------

function TeamStats({ g, d }: { g: Game; d: GameDetail }) {
  if (!d.teamStats.length) return <p className="text-sm text-ink-400">Team stats appear once the game starts.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="display flex justify-between text-sm font-black">
        <span style={{ color: color(g.awayColor) }}>{g.away}</span>
        <span style={{ color: color(g.homeColor) }}>{g.home}</span>
      </div>
      {d.teamStats.map((r) => {
        const a = r.awayN ?? 0;
        const h = r.homeN ?? 0;
        const total = a + h;
        const awayShare = total > 0 ? a / total : 0.5;
        const awayBetter = r.awayN !== null && r.homeN !== null && (r.lowerBetter ? a < h : a > h);
        const homeBetter = r.awayN !== null && r.homeN !== null && (r.lowerBetter ? h < a : h > a);
        return (
          <div key={r.label}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className={`font-mono tabular-nums ${awayBetter ? "font-black text-ink-100" : "text-ink-400"}`}>
                {r.away}
              </span>
              <span className="text-xs text-ink-400">{r.label}</span>
              <span className={`font-mono tabular-nums ${homeBetter ? "font-black text-ink-100" : "text-ink-400"}`}>
                {r.home}
              </span>
            </div>
            <div className="flex h-1.5 gap-0.5">
              <div
                style={{
                  width: `${awayShare * 100}%`,
                  backgroundColor: color(g.awayColor),
                  opacity: awayBetter ? 1 : 0.45,
                }}
              />
              <div className="flex-1" style={{ backgroundColor: color(g.homeColor), opacity: homeBetter ? 1 : 0.45 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Drives -------------------------------------------------------------------

const DRIVE_STYLE: Record<DriveSummary["kind"], { bar: string; label: string }> = {
  td: { bar: "var(--color-hot)", label: "text-hot" },
  fg: { bar: "#facc15", label: "text-[#facc15]" },
  turnover: { bar: "var(--color-rose-400)", label: "text-rose-300" },
  punt: { bar: "var(--color-ink-400)", label: "text-ink-400" },
  other: { bar: "var(--color-ink-500)", label: "text-ink-400" },
  live: { bar: "var(--color-mint-400)", label: "text-mint-400" },
};

function DriveRow({ g, dr, open, onToggle }: { g: Game; dr: DriveSummary; open: boolean; onToggle: () => void }) {
  const st = DRIVE_STYLE[dr.kind];
  const teamColor = color(dr.team === g.home ? g.homeColor : g.awayColor);
  // Field strip: away goal line on the left, like the scoreboard field.
  const xs = (yd: number) => 8 + yd * 0.84;
  const s = dr.start;
  const e = dr.end ?? dr.start;
  return (
    <li>
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 py-2 text-left" aria-expanded={open}>
        <span className="h-8 w-1 shrink-0" style={{ backgroundColor: teamColor }} />
        <div className="w-11 shrink-0">
          <div className="display text-sm leading-none font-black">{dr.team}</div>
          <div className="mt-0.5 text-[10px] text-ink-400">
            Q{dr.quarter} {dr.clock}
          </div>
        </div>
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="h-5 min-w-0 flex-1" aria-hidden>
          <rect x={0} y={0} width={100} height={12} className="fill-ink-800" />
          <rect x={0} y={0} width={8} height={12} fill={color(g.awayColor)} opacity={0.7} />
          <rect x={92} y={0} width={8} height={12} fill={color(g.homeColor)} opacity={0.7} />
          <line x1={50} x2={50} y1={0} y2={12} stroke="currentColor" className="text-ink-600" strokeWidth={0.4} />
          {s !== null && e !== null && (
            <>
              <rect
                x={Math.min(xs(s), xs(e))}
                y={4}
                width={Math.max(0.8, Math.abs(xs(e) - xs(s)))}
                height={4}
                fill={st.bar}
              />
              <circle cx={xs(e)} cy={6} r={2} fill={st.bar} />
            </>
          )}
        </svg>
        <span className={`display w-20 shrink-0 text-right text-[11px] font-black uppercase ${st.label}`}>
          {dr.result}
        </span>
      </button>
      {open && <p className="pb-2 pl-[3.75rem] text-xs text-ink-300">{dr.description || "No details yet"}</p>}
    </li>
  );
}

function Drives({ c, d }: { c: GameCard; d: GameDetail }) {
  const [open, setOpen] = useState<number | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const g = c.game;
  if (!d.drives.length) return <p className="text-sm text-ink-400">Drives show up once the game starts.</p>;
  const list = d.drives.map((dr, i) => ({ dr, i })).filter(({ dr }) => !team || dr.team === team);
  const tally = (t: string) => {
    const mine = d.drives.filter((x) => x.team === t);
    return `${mine.filter((x) => x.kind === "td").length} TD · ${mine.filter((x) => x.kind === "fg").length} FG · ${mine.filter((x) => x.kind === "punt").length} punt`;
  };
  return (
    <div className="flex flex-col gap-3">
      {c.drive && (
        <div className="-mx-4 overflow-hidden border-y border-ink-700">
          <DriveChart d={c.drive} />
        </div>
      )}
      <div className="flex gap-1.5 text-xs font-bold">
        {[null, g.away, g.home].map((t) => (
          <button
            key={t ?? "all"}
            onClick={() => setTeam(t)}
            className={`display px-2.5 py-1 transition ${team === t ? "bg-mint-400 text-ink-950" : "bg-ink-800 text-ink-400 hover:text-ink-100"}`}
          >
            {t ?? "Both"}
          </button>
        ))}
        {team && <span className="ml-auto self-center text-[11px] font-normal text-ink-400">{tally(team)}</span>}
      </div>
      <ol className="divide-y divide-ink-800">
        {list.map(({ dr, i }) => (
          <DriveRow key={i} g={g} dr={dr} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
        ))}
      </ol>
      <p className="text-[11px] text-ink-400">
        Each bar runs from where the drive started to where it ended ({g.away} end zone on the left). Tap a drive for
        plays, yards and time.
      </p>
    </div>
  );
}

// --- Players ------------------------------------------------------------------

function PlayerDetail({
  p,
  a,
  game,
  clips,
  open,
  onToggle,
}: {
  p: GamePlayer;
  a: Analysis;
  game: Game;
  clips: Highlight[];
  open: boolean;
  onToggle: () => void;
}) {
  const snaps = snapText(p);
  const pre = game.state === "pre";
  const parts = pre ? [] : pointBreakdown(p.stats, a.league.scoring_settings);
  const max = Math.max(1, ...parts.map((x) => Math.abs(x.points)));
  // Only meaningful once the game is over; mid-game everyone trails their projection.
  const vsProj = game.state === "post" ? Math.round((p.points - p.player.weekScore) * 10) / 10 : null;
  return (
    <li className="py-1">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 py-1.5 text-left" aria-expanded={open}>
        <Headshot p={p.player} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{p.player.name}</span>
            {p.role === "bench" && (
              <span className="display bg-ink-700 px-1 text-[10px] font-bold text-ink-300">BN</span>
            )}
            {p.role === "opponent" && (
              <span className="display bg-rose-500/15 px-1 text-[10px] font-bold text-rose-300">OPP</span>
            )}
          </div>
          <div className="truncate text-[11px] text-ink-400">
            {pre ? `${p.player.position} · projected ${p.player.weekScore.toFixed(1)}` : p.line || "No stats yet"}
          </div>
          {(snaps || clips.length > 0) && (
            <div className="flex items-center gap-2 text-[10px] text-ink-400">
              {snaps && <span>{snaps}</span>}
              {clips.length > 0 && (
                <span className="display bg-violet/20 px-1 font-bold text-violet">
                  ▶ {clips.length} clip{clips.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div
            className={`font-mono text-lg leading-none font-black tabular-nums ${pre ? "text-ink-500" : p.role === "opponent" ? "text-rose-300" : "text-mint-400"}`}
          >
            {(pre ? p.player.weekScore : p.points).toFixed(1)}
          </div>
          {game.state === "in" && <div className="text-[10px] text-ink-400">proj {p.player.weekScore.toFixed(1)}</div>}
          {vsProj !== null && (
            <div className={`text-[10px] font-bold ${vsProj >= 0 ? "text-mint-400" : "text-ink-400"}`}>
              {vsProj >= 0 ? "+" : ""}
              {vsProj} vs proj
            </div>
          )}
        </div>
        <span className={`text-ink-400 transition ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="mb-2 ml-11 rounded-lg bg-ink-900 p-3 text-xs">
          {pre ? (
            <p className="text-ink-300">
              Projected {p.player.weekScore.toFixed(1)} pts
              {p.player.matchup ? ` vs ${p.player.matchup.opponent}` : ""}. Points will break down here once the game
              starts.
            </p>
          ) : parts.length === 0 ? (
            <p className="text-ink-400">No scoring plays yet.</p>
          ) : (
            <>
              <div className="mb-2 text-[10px] font-bold tracking-wider text-ink-400 uppercase">
                Where the points came from
              </div>
              <ul className="flex flex-col gap-1.5">
                {parts.map((x) => (
                  <li key={x.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
                    <span className="truncate text-ink-100">
                      {x.label}
                      {x.stat ? <span className="text-ink-400"> · {x.stat}</span> : null}
                    </span>
                    <span
                      className={`font-mono font-bold tabular-nums ${x.points >= 0 ? "text-mint-400" : "text-rose-300"}`}
                    >
                      {x.points > 0 ? "+" : ""}
                      {x.points.toFixed(1)}
                    </span>
                    <div className="col-span-2 h-1 bg-ink-800">
                      <div
                        className={x.points >= 0 ? "h-full bg-mint-400" : "h-full bg-rose-400"}
                        style={{ width: `${(Math.abs(x.points) / max) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {clips.length > 0 && (
            <div className="mt-3">
              <Highlights list={clips} players={[p]} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Players({
  c,
  a,
  focus,
  highlights,
}: {
  c: GameCard;
  a: Analysis;
  focus: string | null;
  highlights: Highlight[];
}) {
  const [open, setOpen] = useState<string | null>(focus);
  if (!c.players.length)
    return <p className="text-sm text-ink-400">None of your or your opponent&apos;s players are in this game.</p>;
  const yours = c.players.filter((p) => p.role !== "opponent");
  const theirs = c.players.filter((p) => p.role === "opponent");
  const mineTotal = yours.filter((p) => p.role === "starter").reduce((s, p) => s + p.points, 0);
  const theirTotal = theirs.reduce((s, p) => s + p.points, 0);
  const list = (ps: GamePlayer[]) => (
    <ul className="divide-y divide-ink-800">
      {ps.map((p) => (
        <PlayerDetail
          key={p.player.id}
          p={p}
          a={a}
          game={c.game}
          clips={highlights.filter((h) => playersIn(h.headline, [p]).length > 0)}
          open={open === p.player.id}
          onToggle={() => setOpen(open === p.player.id ? null : p.player.id)}
        />
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-4">
      {c.game.state !== "pre" && (
        <div className={`grid gap-2 text-center ${theirs.length ? "grid-cols-2" : "grid-cols-1"}`}>
          <div className="bg-ink-800 py-2">
            <div className="text-[10px] tracking-wider text-ink-400 uppercase">Your starters here</div>
            <div className="font-mono text-xl font-black text-mint-400">{mineTotal.toFixed(1)}</div>
          </div>
          {theirs.length > 0 && (
            <div className="bg-ink-800 py-2">
              <div className="text-[10px] tracking-wider text-ink-400 uppercase">Opponent here</div>
              <div className="font-mono text-xl font-black text-rose-300">{theirTotal.toFixed(1)}</div>
            </div>
          )}
        </div>
      )}
      {yours.length > 0 && <Section title="Your players">{list(yours)}</Section>}
      {theirs.length > 0 && <Section title="Your opponent's starters">{list(theirs)}</Section>}
      <p className="text-[11px] text-ink-400">
        Tap a player to see where their points came from under your league&apos;s scoring.
      </p>
    </div>
  );
}

// --- Sheet --------------------------------------------------------------------

const TABS: { id: SheetTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "box", label: "Box" },
  { id: "stats", label: "Stats" },
  { id: "drives", label: "Drives" },
  { id: "players", label: "Players" },
];

/** One game's header, tabs and content; keyed by game so switching games starts fresh. */
function GamePanel({
  c,
  a,
  tab,
  setTab,
  focus,
  winNow,
  onClose,
  nav,
  body,
}: {
  c: GameCard;
  a: Analysis;
  tab: SheetTab;
  setTab: (t: SheetTab) => void;
  focus: string | null;
  winNow: number | null;
  onClose: () => void;
  nav: SheetNav;
  /** The scrolling content, so the sheet knows when it's at the top (for swipe-down to close). */
  body: React.RefObject<HTMLDivElement | null>;
}) {
  const { detail, failed } = useGameDetail(c.game);
  useEffect(() => body.current?.scrollTo({ top: 0 }), [tab, body]);
  const tabs = TABS.filter((t) => c.game.id || t.id === "players");
  const active = tabs.some((t) => t.id === tab) ? tab : "players";
  return (
    <>
      <SheetHeader g={c.game} d={detail} onClose={onClose} nav={nav} />
      <div className="flex border-b border-ink-700 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`display relative flex-1 px-1 py-2.5 text-xs font-bold tracking-wide uppercase transition ${
              active === t.id ? "text-ink-100" : "text-ink-400 hover:text-ink-100"
            }`}
          >
            {t.label}
            {active === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-mint-400" />}
          </button>
        ))}
      </div>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {active === "players" ? (
          <Players c={c} a={a} focus={focus} highlights={detail?.highlights ?? []} />
        ) : !detail ? (
          failed ? (
            <p className="text-sm text-ink-400">Couldn&apos;t load this game from ESPN. Retrying…</p>
          ) : (
            <div className="flex flex-col gap-3" aria-busy="true">
              <div className="skeleton h-32" />
              <div className="skeleton h-16" />
            </div>
          )
        ) : active === "overview" ? (
          <Overview c={c} d={detail} winNow={winNow} />
        ) : active === "box" ? (
          <BoxScore g={c.game} box={detail.box} players={c.players} />
        ) : active === "stats" ? (
          <TeamStats g={c.game} d={detail} />
        ) : (
          <Drives c={c} d={detail} />
        )}
      </div>
    </>
  );
}

export function GameSheet({
  cards,
  startKey,
  a,
  initialTab,
  focus,
  winNow,
  pinned,
  onTogglePin,
  onClose,
}: {
  /** The games in the order shown on the list; swipe or use the arrows to move between them. */
  cards: GameCard[];
  startKey: string;
  a: Analysis;
  initialTab: SheetTab;
  focus: string | null;
  winNow: number | null;
  pinned: Set<string>;
  onTogglePin: (key: string) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState(startKey);
  const [tab, setTab] = useState<SheetTab>(initialTab);
  const [focused, setFocused] = useState(focus);
  const index = Math.max(
    0,
    cards.findIndex((c) => c.game.home === key),
  );
  const c = cards[index];
  const go = (delta: number) => {
    const next = cards[index + delta];
    if (!next) return;
    setKey(next.game.home);
    setFocused(null);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // Close on Escape, arrow keys switch games; keep the page behind from scrolling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goRef.current(1);
      else if (e.key === "ArrowLeft") goRef.current(-1);
    };
    window.addEventListener("keydown", onKey);
    const scroller = document.getElementById("scroller");
    const prev = scroller?.style.overflow;
    if (scroller) scroller.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      if (scroller) scroller.style.overflow = prev ?? "";
    };
  }, [onClose]);

  // Horizontal swipe = next / previous game (not when swiping a chart, clip row or wide table).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useDragToClose(onClose, body);
  const onTouchStart = (e: React.TouchEvent) => {
    drag.handlers.onTouchStart(e);
    const t = e.touches[0];
    touch.current = (e.target as HTMLElement).closest("[data-noswipe]") ? null : { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    drag.handlers.onTouchEnd();
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  if (!c) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        style={{ opacity: 1 - drag.pulled * 0.7 }}
      />
      <div
        onTouchStart={onTouchStart}
        onTouchMove={drag.handlers.onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={drag.handlers.onTouchCancel}
        className="relative flex h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-ink-900 shadow-2xl sm:h-auto sm:max-h-[85dvh] sm:min-h-[60dvh] sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)", ...drag.style }}
      >
        <GamePanel
          key={c.game.home}
          c={c}
          a={a}
          tab={tab}
          setTab={setTab}
          focus={focused}
          winNow={winNow}
          onClose={onClose}
          body={body}
          nav={{
            index,
            count: cards.length,
            go,
            pinned: pinned.has(c.game.home),
            togglePin: () => onTogglePin(c.game.home),
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
