"use client";

// Small pieces several screens use: tab types, data loading, stat tiles, score bars, team marks.

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useEffect, useState } from "react";
import { describeMatchup, type PlayerAnalysis } from "@/lib/advisor";
import { avatarUrl } from "@/lib/sleeper";
import type { PlayoffTeam } from "@/lib/playoffs";
import { MatchupChip, PlayerLine, Points } from "../ui";

export type Tab =
  | "live"
  | "plan"
  | "lineup"
  | "games"
  | "hatewatch"
  | "injurywatch"
  | "scout"
  | "injuries"
  | "waivers"
  | "trades"
  | "planner"
  | "playoffs"
  | "record"
  | "power"
  | "league"
  | "season"
  | "roster";

export type Section = "week" | "moves" | "games" | "team";

export function Widget({
  label,
  children,
  onClick,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "section";
  return (
    <Tag
      onClick={onClick}
      className={`flex min-w-0 flex-col rounded-2xl border border-ink-700 bg-ink-900 p-4 text-left ${onClick ? "transition hover:bg-ink-800" : ""} ${className}`}
    >
      <span className="text-[11px] font-extrabold tracking-[0.08em] text-ink-400 uppercase">{label}</span>
      {children}
    </Tag>
  );
}

export function ScoreBar({ value, max, muted }: { value: number; max: number; muted?: boolean }) {
  return (
    <div className="flex w-14 shrink-0 flex-col items-end gap-1 sm:w-32">
      <Points value={value} muted={muted} />
      <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className={`h-full rounded-full ${muted ? "bg-ink-400" : "bg-mint-400"}`}
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

// --- Waivers ---------------------------------------------------------------

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-900 px-2 py-1.5">
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-ink-400">{label}</div>
    </div>
  );
}

export function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

// --- Trades ----------------------------------------------------------------

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    fn()
      .then((data) => live && setState({ data, error: null }))
      .catch((err) => live && setState({ data: null, error: (err as Error).message }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies deps
  }, deps);
  return state;
}

export function TeamMark({ t, size = 28 }: { t: Pick<PlayoffTeam, "avatar" | "teamName">; size?: number }) {
  return t.avatar ? (
    <img src={avatarUrl(t.avatar)} alt="" className="shrink-0 rounded-full" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-bold"
      style={{ width: size, height: size }}
    >
      {t.teamName.charAt(0).toUpperCase()}
    </span>
  );
}

export function oddsTone(p: number) {
  return p >= 75 ? "text-mint-400" : p >= 40 ? "text-amber-300" : "text-rose-300";
}

export const record = (t: PlayoffTeam) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;

export function BigStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "good" | "mid" | "bad";
}) {
  const color = { good: "text-mint-400", mid: "text-ink-100", bad: "text-rose-300" }[tone];
  return (
    <div className="rounded-2xl border border-ink-700/70 bg-ink-900 p-4">
      <div className="text-[11px] font-semibold tracking-wider text-ink-400 uppercase">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-400">{sub}</div>
    </div>
  );
}

// --- Injury report --------------------------------------------------------

export function timeAgo(ms: number) {
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

type SortKey = "weekScore" | "seasonAvg" | "recentAvg" | "snapShare";

export function PlayerTable({
  players,
  week,
  showTrending,
  showSnaps,
  sortable,
  onSelect,
}: {
  players: PlayerAnalysis[];
  week: number;
  showTrending?: boolean;
  showSnaps?: boolean;
  sortable?: boolean;
  /** Makes rows tappable. */
  onSelect?: (p: PlayerAnalysis) => void;
}) {
  const [sort, setSort] = useState<SortKey>("weekScore");
  const rows = sortable ? [...players].sort((x, y) => (y[sort] ?? -1) - (x[sort] ?? -1)) : players;
  const th = { sort, setSort, sortable: Boolean(sortable) };
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-[11px] tracking-wider text-ink-400 uppercase">
          <tr className="border-b border-ink-700/60">
            <th className="py-2 pr-2 pl-4 text-left font-semibold sm:pl-5">Player</th>
            <th className="px-2 py-2 text-left font-semibold">Matchup</th>
            <Th {...th} k="weekScore">
              Wk {week}
            </Th>
            <Th {...th} k="seasonAvg">
              Avg
            </Th>
            <Th {...th} k="recentAvg">
              Last 3
            </Th>
            {showSnaps && (
              <Th {...th} k="snapShare">
                Snaps
              </Th>
            )}
            {showTrending && <Th {...th}>Adds</Th>}
            <th className="w-2 sm:w-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              onClick={onSelect ? () => onSelect(p) : undefined}
              className={`border-b border-ink-700/40 last:border-0 hover:bg-ink-850/60 ${onSelect ? "cursor-pointer" : ""}`}
            >
              <td className="py-2.5 pr-2 pl-4 sm:pl-5">
                <PlayerLine
                  p={p}
                  size={34}
                  sub={p.role && p.role !== "starter" ? <RoleTag role={p.role} /> : undefined}
                />
              </td>
              <td className="px-2" title={p.matchup ? describeMatchup(p.matchup, p.position) : undefined}>
                <MatchupChip p={p} compact />
              </td>
              <td className="px-2 text-right">
                <Points value={p.weekScore} />
              </td>
              <td className="px-2 text-right font-mono text-ink-300 tabular-nums">{p.seasonAvg?.toFixed(1) ?? "—"}</td>
              <td className="px-2 text-right font-mono text-ink-300 tabular-nums">
                {p.recentAvg?.toFixed(1) ?? "—"}
                {p.recentGames > 0 && p.recentGames < 3 && (
                  <span className="ml-0.5 text-[10px] text-ink-400">({p.recentGames}g)</span>
                )}
              </td>
              {showSnaps && (
                <td className="px-2 text-right">
                  {p.snapShare === null ? (
                    <span className="text-ink-400">—</span>
                  ) : (
                    <div className="ml-auto flex w-16 flex-col items-end gap-1">
                      <span className="font-mono text-xs text-ink-300 tabular-nums">
                        {Math.round(p.snapShare * 100)}%
                      </span>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700">
                        <div className="h-full bg-pos-wr" style={{ width: `${p.snapShare * 100}%` }} />
                      </div>
                    </div>
                  )}
                </td>
              )}
              {showTrending && (
                <td className="px-2 text-right font-mono text-xs text-ink-300 tabular-nums">
                  {p.trendingAdds ? compact(p.trendingAdds) : "—"}
                </td>
              )}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  k,
  sort,
  setSort,
  sortable,
  children,
}: {
  k?: SortKey;
  sort: SortKey;
  setSort: (k: SortKey) => void;
  sortable: boolean;
  children: React.ReactNode;
}) {
  return (
    <th className="px-2 py-2 text-right font-semibold">
      {sortable && k ? (
        <button onClick={() => setSort(k)} className={sort === k ? "text-mint-400" : "hover:text-ink-100"}>
          {children}
          {sort === k && " ↓"}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function RoleTag({ role }: { role: NonNullable<PlayerAnalysis["role"]> }) {
  const label = { starter: "Starter", "fill-in": "Fill-in starter", sidelined: "Not starting", backup: "Backup" }[role];
  return <span className="rounded bg-ink-700 px-1 text-[10px] font-semibold text-ink-300">{label}</span>;
}
