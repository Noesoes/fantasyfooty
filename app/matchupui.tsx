"use client";

// Weekly matchup analyzer: the win chance and both teams' range of outcomes,
// then where the matchup is won and lost (positions), when (kickoff windows)
// and which players move together (stacks and head-to-head games).

import { useMemo, useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { density, outcome, positionEdges, stacks, summary, timeWindows, type Outcome } from "@/lib/matchup";
import { lastName } from "@/lib/names";
import { useOpenPlayer } from "./playerctx";
import { Card, Ring } from "./ui";

type View = "outcome" | "positions" | "time" | "stacks";
const VIEWS: { id: View; label: string }[] = [
  { id: "outcome", label: "Outcome" },
  { id: "positions", label: "Positions" },
  { id: "time", label: "Time" },
  { id: "stacks", label: "Stacks" },
];

const MINE = "var(--color-mint-400)";
const THEIRS = "#fb7185";
const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function Curves({ o }: { o: Outcome }) {
  const W = 320;
  const H = 110;
  const lo = Math.max(0, Math.min(o.me.mean - 2.6 * o.me.sd, o.opp.mean - 2.6 * o.opp.sd));
  const hi = Math.max(o.me.mean + 2.6 * o.me.sd, o.opp.mean + 2.6 * o.opp.sd, lo + 10);
  const peak = Math.max(density(o.me.mean, o.me.mean, o.me.sd), density(o.opp.mean, o.opp.mean, o.opp.sd));
  const x = (v: number) => ((v - lo) / (hi - lo)) * W;
  const y = (d: number) => H - 14 - (d / peak) * (H - 22);
  const path = (mean: number, sd: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 64; i++) {
      const v = lo + ((hi - lo) * i) / 64;
      pts.push(`${x(v).toFixed(1)},${y(density(v, mean, sd)).toFixed(1)}`);
    }
    return `M${x(lo)},${H - 14} L${pts.join(" L")} L${x(hi)},${H - 14} Z`;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(lo + (hi - lo) * t));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score ranges for both teams">
      {[
        { s: o.opp, c: THEIRS },
        { s: o.me, c: MINE },
      ].map(({ s, c }) => (
        <g key={s.name}>
          <path d={path(s.mean, s.sd)} fill={c} fillOpacity={0.18} stroke={c} strokeWidth={2} />
          <line x1={x(s.mean)} x2={x(s.mean)} y1={8} y2={H - 14} stroke={c} strokeDasharray="3 3" strokeWidth={1.5} />
        </g>
      ))}
      <line x1={0} x2={W} y1={H - 14} y2={H - 14} stroke="var(--color-ink-700)" />
      {ticks.map((t, i) => (
        <text
          key={i}
          x={x(t)}
          y={H - 2}
          fontSize={9}
          textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
          fill="var(--color-ink-400)"
        >
          {t}
        </text>
      ))}
    </svg>
  );
}

function OutcomeView({ a, o }: { a: Analysis; o: Outcome }) {
  const lines = summary(a, o);
  const rows = [
    { s: o.me, c: MINE },
    { s: o.opp, c: THEIRS },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Ring value={o.me.win} size={92}>
          <span className="text-[22px] leading-none font-black">{pct(o.me.win)}</span>
          <span className="mt-0.5 text-[9.5px] font-extrabold tracking-wide text-ink-300 uppercase">projected</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <Curves o={o} />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-ink-700 text-[13px]">
        <div className="grid grid-cols-[1fr_repeat(4,3.2rem)] bg-ink-800 px-3 py-1.5 text-[10.5px] font-bold tracking-wide text-ink-400 uppercase">
          <span>Team</span>
          <span className="text-right">Floor</span>
          <span className="text-right">Pts</span>
          <span className="text-right">Upside</span>
          <span className="text-right">Win</span>
        </div>
        {rows.map(({ s, c }) => (
          <div
            key={s.name}
            className="grid grid-cols-[1fr_repeat(4,3.2rem)] items-center border-t border-ink-800 px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2 font-bold">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="text-right font-mono text-ink-300">{s.floor}</span>
            <span className="text-right font-mono font-extrabold">{s.mean}</span>
            <span className="text-right font-mono text-ink-300">{s.upside}</span>
            <span className="text-right font-mono font-extrabold">{pct(s.win)}</span>
          </div>
        ))}
        {o.withMoves && o.withMoves.win > o.me.win + 0.005 && (
          <div className="grid grid-cols-[1fr_repeat(4,3.2rem)] items-center border-t border-ink-800 bg-mint-400/10 px-3 py-2">
            <span className="truncate font-bold text-mint-400">With your moves</span>
            <span />
            <span className="text-right font-mono font-extrabold text-mint-400">{o.withMoves.mean}</span>
            <span />
            <span className="text-right font-mono font-extrabold text-mint-400">{pct(o.withMoves.win)}</span>
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 text-[13.5px] leading-snug text-ink-200">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="text-[11px] text-ink-400">
        Floor and upside are a bad (1 in 10) and a great (1 in 10) week for each lineup as set now.
      </p>
    </div>
  );
}

function PositionsView({ a }: { a: Analysis }) {
  const edges = positionEdges(a);
  const max = Math.max(1, ...edges.map((e) => Math.abs(e.edge)));
  const cols = "grid grid-cols-[2.6rem_2.8rem_1fr_2.8rem_3rem] items-center";
  return (
    <div className="flex flex-col gap-1">
      <div className={`${cols} px-1 pb-1 text-[10.5px] font-bold tracking-wide text-ink-400 uppercase`}>
        <span>Slot</span>
        <span className="text-right">You</span>
        <span />
        <span className="text-right">Them</span>
        <span className="text-right">Edge</span>
      </div>
      {edges.map((e) => {
        const w = (Math.abs(e.edge) / max) * 50;
        return (
          <div key={e.group} className={`${cols} px-1 py-1.5`}>
            <span className="text-xs font-extrabold">{e.group}</span>
            <span className="text-right font-mono text-[13px]">{e.mine}</span>
            <div className="relative mx-2 h-4">
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-ink-600" />
              <div
                className="absolute top-0.5 bottom-0.5 rounded"
                style={{
                  background: e.edge >= 0 ? MINE : THEIRS,
                  left: e.edge >= 0 ? "50%" : `${50 - w}%`,
                  width: `${w}%`,
                }}
              />
            </div>
            <span className="text-right font-mono text-[13px]">{e.theirs}</span>
            <span
              className={`text-right font-mono text-[13px] font-extrabold ${e.edge > 0 ? "text-mint-400" : e.edge < 0 ? "text-rose-400" : "text-ink-400"}`}
            >
              {signed(e.edge)}
            </span>
          </div>
        );
      })}
      <p className="mt-2 text-[11px] text-ink-400">
        Expected points by lineup slot. Their extra RBs, WRs and TEs beyond your dedicated slots count as FLEX.
      </p>
    </div>
  );
}

function TimeView({ a }: { a: Analysis }) {
  const rows = timeWindows(a);
  if (!rows.length) return <p className="text-sm text-ink-400">No game times yet for this week.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => [r.mine, r.theirs]));
  // Running margin after each window.
  const leads = rows.map((_, i) => rows.slice(0, i + 1).reduce((sum, r) => sum + r.mine - r.theirs, 0));
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => {
        const lead = Math.round(leads[i] * 10) / 10;
        return (
          <div key={r.label} className="rounded-xl bg-ink-850 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-extrabold">{r.label}</span>
              <span className={`text-[11px] font-bold ${lead >= 0 ? "text-mint-400" : "text-rose-400"}`}>
                {lead === 0 ? "Even after this window" : `${lead > 0 ? "You" : "They"} lead by ${Math.abs(lead)} after`}
              </span>
            </div>
            {[
              { pts: r.mine, names: r.minePlayers, c: MINE },
              { pts: r.theirs, names: r.theirPlayers, c: THEIRS },
            ].map((s, i) => (
              <div key={i} className="mt-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-ink-800">
                    <div className="h-2 rounded-full" style={{ width: `${(s.pts / max) * 100}%`, background: s.c }} />
                  </div>
                  <span className="w-9 text-right font-mono text-xs font-bold">{s.pts}</span>
                </div>
                <div className="truncate text-[11px] text-ink-400">
                  {s.names.length ? s.names.map(lastName).join(", ") : "—"}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      <p className="text-[11px] text-ink-400">
        Kickoff windows in US Eastern time. <span style={{ color: MINE }}>You</span> on top,{" "}
        <span style={{ color: THEIRS }}>them</span> below.
      </p>
    </div>
  );
}

function StacksView({ a }: { a: Analysis }) {
  const openPlayer = useOpenPlayer();
  const s = stacks(a);
  const name = (p: { name: string }) => lastName(p.name);
  if (!s.stacks.length && !s.clashes.length)
    return <p className="text-sm text-ink-400">No stacks or head-to-head games in this matchup.</p>;
  return (
    <div className="flex flex-col gap-4">
      {s.stacks.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[11px] font-extrabold tracking-wide text-ink-400 uppercase">Your stacks</h3>
          <div className="flex flex-col gap-2">
            {s.stacks.map((st) => (
              <div key={st.team} className="rounded-xl bg-ink-850 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-extrabold">
                    {st.team} {st.kind === "qb-stack" ? "QB stack" : "teammates"}
                  </span>
                  <span className="font-mono text-xs font-bold">{st.pts} pts</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {st.players.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openPlayer?.(p)}
                      className="rounded-full bg-ink-800 px-2.5 py-1 text-xs font-bold"
                    >
                      {p.position} {name(p)}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11.5px] text-ink-400">
                  {st.kind === "qb-stack"
                    ? "A big passing day lifts both; a dud sinks both. Raises your upside and lowers your floor."
                    : "Same offense: their weeks tend to rise and fall together."}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      {s.clashes.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[11px] font-extrabold tracking-wide text-ink-400 uppercase">
            Games you share with them
          </h3>
          <div className="flex flex-col gap-2">
            {s.clashes.map((c) => (
              <div key={c.game} className="rounded-xl bg-ink-850 p-3 text-[13px]">
                <div className="text-sm font-extrabold">{c.game}</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <span style={{ color: MINE }} className="font-bold">
                    {c.mine.map(name).join(", ")}
                  </span>
                  <span style={{ color: THEIRS }} className="text-right font-bold">
                    {c.theirs.map(name).join(", ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-400">
            Players from the same game partly cancel out: a shootout helps both sides.
          </p>
        </div>
      )}
    </div>
  );
}

export function MatchupAnalyzer({ a }: { a: Analysis }) {
  const [view, setView] = useState<View>("outcome");
  const o = useMemo(() => outcome(a), [a]);
  if (!o) return null;
  return (
    <Card title={`Week ${a.week} matchup`}>
      <div className="mb-4 grid grid-cols-4 gap-1 rounded-xl bg-ink-850 p-1" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`rounded-lg py-1.5 text-xs font-extrabold transition ${
              view === v.id ? "bg-ink-700 text-ink-100" : "text-ink-400"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "outcome" && <OutcomeView a={a} o={o} />}
      {view === "positions" && <PositionsView a={a} />}
      {view === "time" && <TimeView a={a} />}
      {view === "stacks" && <StacksView a={a} />}
    </Card>
  );
}
