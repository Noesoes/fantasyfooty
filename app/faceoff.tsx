"use client";

// Start/sit face-off: two players side by side, the pick highlighted, and row
// by row the defense each one faces, the game, his workload, form, range and
// health. The better side of each row is marked, so the call is easy to check.

import type { PlayerAnalysis } from "@/lib/advisor";
import { compareStart } from "@/lib/explain";
import { confidenceWord, playerRange, startConfidence } from "@/lib/insights";
import { useOpenPlayer } from "./playerctx";
import { Headshot } from "./ui";

type Side = 0 | 1 | null;

interface Row {
  label: string;
  values: [string, string];
  /** Which side this row favors (null = even / not comparable). */
  better: Side;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const posWord = (pos: string) => (pos === "DEF" ? "D/STs" : pos === "K" ? "Ks" : `${pos}s`);

/** Higher (or lower) number wins, with a margin so near-ties stay even. */
function edge(a: number | null | undefined, b: number | null | undefined, margin: number, lowerWins = false): Side {
  if (a == null || b == null || Math.abs(a - b) < margin) return null;
  return (lowerWins ? a < b : a > b) ? 0 : 1;
}

function defenseText(p: PlayerAnalysis): string {
  const m = p.matchup;
  if (!m) return "—";
  const most = m.teams - m.rank + 1;
  const rank =
    m.rank === 1
      ? "fewest"
      : most === 1
        ? "most"
        : most <= m.teams / 2
          ? `${ordinal(most)}-most`
          : `${ordinal(m.rank)}-fewest`;
  return `Allows ${rank}`;
}

function buildSections(x: PlayerAnalysis, y: PlayerAnalysis): { title: string; rows: Row[] }[] {
  const pair = [x, y] as const;
  const g = pair.map((p) => p.game);
  const m = pair.map((p) => p.matchup);
  const u = pair.map((p) => p.usage);
  const r = pair.map((p) => playerRange(p));
  const chance = pair.map((p) =>
    p.onBye ? 0 : (p.playChance ?? (p.injury && ["Out", "IR", "PUP", "Sus"].includes(p.injury) ? 0 : 1)),
  );

  const defense: Row[] = [
    {
      label: "Opponent",
      values: [m[0]?.opponent ?? (x.onBye ? "BYE" : "—"), m[1]?.opponent ?? (y.onBye ? "BYE" : "—")],
      better: null,
    },
    {
      label: `vs ${x.position === y.position ? posWord(x.position) : "position"}`,
      values: [defenseText(x), defenseText(y)],
      better: edge(m[0]?.ratio, m[1]?.ratio, 0.05),
    },
    {
      // Same position: one league average for both, in the label; otherwise each side's own.
      label: x.position === y.position && m[0] ? `Pts allowed / g (avg ${m[0].average})` : "Pts allowed / g",
      values:
        x.position === y.position
          ? [m[0] ? `${m[0].allowed}` : "—", m[1] ? `${m[1].allowed}` : "—"]
          : [
              m[0] ? `${m[0].allowed} (avg ${m[0].average})` : "—",
              m[1] ? `${m[1].allowed} (avg ${m[1].average})` : "—",
            ],
      better: edge(m[0]?.ratio, m[1]?.ratio, 0.05),
    },
  ];

  const spreadText = (s: number | null | undefined) =>
    s == null ? "—" : s === 0 ? "Pick'em" : s < 0 ? `Fav by ${-s}` : `Dog by ${s}`;
  const game: Row[] = [
    {
      label: "Location",
      values: [g[0] ? (g[0].home ? "Home" : "Away") : "—", g[1] ? (g[1].home ? "Home" : "Away") : "—"],
      better: null,
    },
    {
      label: "Implied team total",
      values: [g[0]?.implied?.toFixed(1) ?? "—", g[1]?.implied?.toFixed(1) ?? "—"],
      better: edge(g[0]?.implied, g[1]?.implied, 1.5),
    },
    { label: "Line", values: [spreadText(g[0]?.spread), spreadText(g[1]?.spread)], better: null },
    {
      label: "Over/under",
      values: [g[0]?.overUnder?.toString() ?? "—", g[1]?.overUnder?.toString() ?? "—"],
      better: edge(g[0]?.overUnder, g[1]?.overUnder, 2),
    },
    {
      label: "Weather",
      values: [
        g[0] ? (g[0].indoor ? "Indoors" : (g[0].weather ?? "—")) : "—",
        g[1] ? (g[1].indoor ? "Indoors" : (g[1].weather ?? "—")) : "—",
      ],
      // Context only: weather's effect is already in expected points.
      better: null,
    },
  ];

  const workload: Row[] = (
    [
      {
        label: "Snap share",
        values: [x.snapShare != null ? pct(x.snapShare) : "—", y.snapShare != null ? pct(y.snapShare) : "—"],
        better: edge(x.snapShare, y.snapShare, 0.08),
      },
      {
        label: "Touches / g",
        values: [u[0]?.touches.toString() ?? "—", u[1]?.touches.toString() ?? "—"],
        better: edge(u[0]?.touches, u[1]?.touches, 2),
      },
      {
        label: "Carry share",
        values: [u[0] ? pct(u[0].carryShare) : "—", u[1] ? pct(u[1].carryShare) : "—"],
        better: edge(u[0]?.carryShare, u[1]?.carryShare, 0.08),
      },
      {
        label: "Target share",
        values: [u[0] ? pct(u[0].targetShare) : "—", u[1] ? pct(u[1].targetShare) : "—"],
        better: edge(u[0]?.targetShare, u[1]?.targetShare, 0.04),
      },
      {
        label: "Red-zone looks / g",
        values: [u[0]?.redZone.toString() ?? "—", u[1]?.redZone.toString() ?? "—"],
        better: edge(u[0]?.redZone, u[1]?.redZone, 0.6),
      },
    ] as Row[]
  ).filter((row) => row.values.some((v) => v !== "—"));

  const form: Row[] = [
    {
      label: "Season avg",
      values: [x.seasonAvg?.toFixed(1) ?? "—", y.seasonAvg?.toFixed(1) ?? "—"],
      better: edge(x.seasonAvg, y.seasonAvg, 1.5),
    },
    {
      label: `Last ${Math.max(x.recentGames, y.recentGames) || 3}`,
      values: [x.recentAvg?.toFixed(1) ?? "—", y.recentAvg?.toFixed(1) ?? "—"],
      better: edge(x.recentAvg, y.recentAvg, 1.5),
    },
    {
      label: "Range this week",
      values: [`${r[0].floor}–${r[0].ceiling}`, `${r[1].floor}–${r[1].ceiling}`],
      better: edge(r[0].floor, r[1].floor, 1),
    },
    {
      label: "Health",
      values: pair.map((p, i) =>
        p.onBye
          ? "On bye"
          : chance[i] === 0
            ? `Ruled ${p.injury}`
            : p.injury
              ? `~${pct(chance[i])} (${p.injury})`
              : "Healthy",
      ) as [string, string],
      better: edge(chance[0], chance[1], 0.1),
    },
  ];

  return [
    { title: "Opposing defense", rows: defense },
    { title: "Game", rows: game },
    { title: "Workload", rows: workload },
    { title: "Form & health", rows: form },
  ].filter((s) => s.rows.length);
}

function Column({ p, picked, onOpen }: { p: PlayerAnalysis; picked: boolean; onOpen: () => void }) {
  const g = p.game;
  const when = g
    ? new Date(g.kickoff).toLocaleString(
        [],
        g.kickoffKnown ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { weekday: "short" },
      )
    : null;
  return (
    <button
      onClick={onOpen}
      className={`relative flex min-w-0 flex-col items-center rounded-2xl px-2 pt-4 pb-3 text-center transition ${
        picked ? "bg-mint-400/15 ring-2 ring-mint-400" : "bg-ink-850 ring-1 ring-ink-700"
      }`}
    >
      {picked && (
        <span className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-mint-400 text-xs font-black text-ink-950">
          ✓
        </span>
      )}
      <Headshot p={p} size={64} />
      <div className="mt-2 w-full truncate text-[15px] font-black">{p.name}</div>
      <div className="text-xs font-bold text-ink-400">
        {p.team ?? "FA"} · {p.position}
      </div>
      <div className="mt-1.5 text-sm font-extrabold">
        {p.onBye ? "BYE" : g ? `${g.home ? "vs" : "@"} ${g.opponent}` : (p.matchup?.opponent ?? "—")}
      </div>
      {when && <div className="text-[11px] text-ink-400">{when}</div>}
      <div className={`mt-2 font-mono text-2xl leading-none font-black ${picked ? "text-mint-400" : ""}`}>
        {p.weekScore.toFixed(1)}
      </div>
      <div className="text-[10px] font-bold tracking-wide text-ink-400 uppercase">expected pts</div>
    </button>
  );
}

export function Faceoff({ x, y }: { x: PlayerAnalysis; y: PlayerAnalysis }) {
  const openPlayer = useOpenPlayer();
  const pickFirst = x.weekScore >= y.weekScore;
  const [pick, other] = pickFirst ? [x, y] : [y, x];
  const conf = startConfidence(pick, other);
  const word = confidenceWord(conf);
  const cmp = compareStart(pick, other);
  const sections = buildSections(x, y);
  const cell = (row: Row, i: 0 | 1) =>
    row.better === i ? "font-extrabold text-mint-400" : row.better === null ? "text-ink-100" : "text-ink-300";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Column p={x} picked={pickFirst} onOpen={() => openPlayer?.(x)} />
        <Column p={y} picked={!pickFirst} onOpen={() => openPlayer?.(y)} />
      </div>

      <div className="rounded-2xl bg-ink-850 p-3.5 text-center">
        <div className="text-lg font-black text-mint-400">
          {word === "Coin flip" ? "Coin flip — lean" : "Start"} {pick.name}
        </div>
        <div className="mt-0.5 text-xs font-bold text-ink-300">
          {pct(conf)} · {word} · +{Math.round((pick.weekScore - other.weekScore) * 10) / 10} expected pts
        </div>
        {cmp.edges.length > 0 && (
          <p className="mt-2 text-[13px] leading-snug text-ink-300">
            Why: {cmp.edges.slice(0, 2).join("; ")}.
            {cmp.against[0] && <span className="text-ink-400"> But {cmp.against[0]}.</span>}
          </p>
        )}
      </div>

      {sections.map((s) => (
        <section key={s.title} className="overflow-hidden rounded-2xl border border-ink-700">
          <h3 className="bg-ink-800 px-3 py-2 text-center text-[13px] font-extrabold">{s.title}</h3>
          <div className="divide-y divide-ink-800">
            {s.rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 text-[13px]">
                <span className={`min-w-0 text-left ${cell(row, 0)}`}>{row.values[0]}</span>
                <span className="max-w-[7rem] text-center text-[10.5px] font-bold tracking-wide text-ink-400 uppercase">
                  {row.label}
                </span>
                <span className={`min-w-0 text-right ${cell(row, 1)}`}>{row.values[1]}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="text-center text-[11px] text-ink-400">
        <span className="font-extrabold text-mint-400">Green</span> marks the better side of each row. Tap a player for
        his full breakdown.
      </p>
    </div>
  );
}
