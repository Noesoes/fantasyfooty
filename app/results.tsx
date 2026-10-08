"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useEffect, useMemo, useState } from "react";
import { describeMatchup, type Analysis, type PlayerAnalysis } from "@/lib/advisor";
import { avatarUrl } from "@/lib/sleeper";
import { Card, Empty, Headshot, MatchupChip, PlayerLine, Points, SlotBadge } from "./ui";

type Tab = "plan" | "lineup" | "waivers" | "roster";

const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Game plan" },
  { id: "lineup", label: "Lineup" },
  { id: "waivers", label: "Waivers" },
  { id: "roster", label: "Roster" },
];

export function Results({ a }: { a: Analysis }) {
  const [tab, setTab] = useState<Tab>("plan");
  return (
    <div className="mt-6 flex flex-col gap-5">
      <Scoreboard a={a} />
      <nav className="sticky top-0 z-20 -mx-4 bg-ink-950/85 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:px-2">
        <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-ink-900 p-1 ring-1 ring-ink-700/70">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition ${
                tab === t.id ? "bg-mint-400 text-ink-950 shadow" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"
              }`}
            >
              {t.label}
              {t.id === "waivers" && a.waivers.length > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 text-[11px] ${tab === t.id ? "bg-ink-950/20" : "bg-ink-700"}`}
                >
                  {a.waivers.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
      {tab === "plan" && <GamePlan a={a} goTo={setTab} />}
      {tab === "lineup" && <Lineup a={a} />}
      {tab === "waivers" && <Waivers a={a} />}
      {tab === "roster" && <Roster a={a} />}
    </div>
  );
}

function Avatar({ id, name }: { id: string | null; name: string }) {
  return id ? (
    <img src={avatarUrl(id)} alt="" className="h-12 w-12 rounded-full ring-2 ring-ink-700" />
  ) : (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-700 text-lg font-bold text-ink-300 ring-2 ring-ink-600">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function Scoreboard({ a }: { a: Analysis }) {
  const gain = Math.round((a.optimalTotal - a.currentTotal) * 10) / 10;
  const opp = a.opponent;
  const share = opp ? a.optimalTotal / Math.max(1, a.optimalTotal + opp.projected) : 0.5;
  return (
    <section className="overflow-hidden rounded-2xl border border-ink-700/70 bg-gradient-to-br from-ink-850 to-ink-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700/60 px-5 py-3 text-xs text-ink-400">
        <span className="font-semibold tracking-wider text-mint-400 uppercase">Week {a.week}</span>
        <span>
          {a.league.name} · {a.scoringLabel}
        </span>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="flex items-center gap-3">
          <Avatar id={a.avatar} name={a.teamName} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{a.teamName}</div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold tabular-nums text-ink-100">{a.optimalTotal.toFixed(1)}</span>
              {gain > 0 && (
                <span className="rounded-md bg-mint-400/15 px-1.5 py-0.5 text-xs font-semibold text-mint-300">
                  +{gain} with moves
                </span>
              )}
            </div>
            <div className="text-xs text-ink-400">projected · current lineup {a.currentTotal.toFixed(1)}</div>
          </div>
        </div>
        {opp ? (
          <>
            <div className="hidden text-center text-sm font-bold text-ink-400 sm:block">VS</div>
            <div className="flex items-center gap-3 sm:flex-row-reverse sm:text-right">
              <Avatar id={opp.avatar} name={opp.teamName} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{opp.teamName}</div>
                <div className="font-mono text-3xl font-bold tabular-nums text-ink-300">{opp.projected.toFixed(1)}</div>
                <div className="text-xs text-ink-400">projected</div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-ink-400 sm:col-span-2 sm:text-right">No head-to-head matchup this week.</div>
        )}
      </div>
      {opp && (
        <div className="px-5 pb-5">
          <div className="flex h-2 overflow-hidden rounded-full bg-ink-700">
            <div className="bg-mint-400 transition-all" style={{ width: `${share * 100}%` }} />
            <div className="flex-1 bg-pos-qb/70" />
          </div>
          <div className="mt-1.5 text-xs text-ink-400">
            {a.optimalTotal >= opp.projected
              ? `Projected to win by ${(a.optimalTotal - opp.projected).toFixed(1)} if you make the moves below.`
              : `Projected to lose by ${(opp.projected - a.optimalTotal).toFixed(1)} — the waiver tab may help close the gap.`}
          </div>
        </div>
      )}
    </section>
  );
}

// --- Game plan -------------------------------------------------------------

interface Task {
  id: string;
  kind: "start" | "bench" | "add";
  title: React.ReactNode;
  detail: string;
  players: PlayerAnalysis[];
}

function useChecked(key: string) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage after hydration
      setChecked(JSON.parse(localStorage.getItem(key) ?? "{}"));
    } catch {
      setChecked({});
    }
  }, [key]);
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Checkmarks are a convenience; ignore storage failures.
      }
      return next;
    });
  return [checked, toggle] as const;
}

function GamePlan({ a, goTo }: { a: Analysis; goTo: (t: Tab) => void }) {
  const tasks: Task[] = useMemo(() => {
    const list: Task[] = [];
    for (const m of a.moves) {
      list.push({
        id: `${m.action}-${m.player.id}`,
        kind: m.action,
        title:
          m.action === "start" ? (
            <>
              Start <b>{m.player.name}</b> at {m.slot}
            </>
          ) : (
            <>
              Bench <b>{m.player.name}</b>
            </>
          ),
        detail: m.reason,
        players: [m.player],
      });
    }
    for (const w of a.waivers.slice(0, 3)) {
      list.push({
        id: `add-${w.player.id}`,
        kind: "add",
        title: (
          <>
            Claim <b>{w.player.name}</b>
            {w.dropFor && (
              <>
                , drop <b>{w.dropFor.name}</b>
              </>
            )}
          </>
        ),
        detail: w.reason,
        players: w.dropFor ? [w.player, w.dropFor] : [w.player],
      });
    }
    return list;
  }, [a]);
  const [checked, toggle] = useChecked(`plan:${a.league.league_id}:${a.week}`);
  const done = tasks.filter((t) => checked[t.id]).length;

  return (
    <div className="flex flex-col gap-5">
      {a.warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          {a.warnings.map((w) => (
            <div
              key={w}
              className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200"
            >
              <span aria-hidden>⚠️</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <Card
        title="This week's to-do list"
        action={
          tasks.length > 0 && (
            <span className="text-xs text-ink-400">
              {done}/{tasks.length} done
            </span>
          )
        }
      >
        {tasks.length === 0 ? (
          <Empty>Your lineup is already optimal and nothing on waivers beats your roster. Enjoy the games. 🏈</Empty>
        ) : (
          <>
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full bg-mint-400 transition-all" style={{ width: `${(done / tasks.length) * 100}%` }} />
            </div>
            <ol className="flex flex-col gap-2">
              {tasks.map((t, i) => (
                <li key={t.id}>
                  <button
                    onClick={() => toggle(t.id)}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                      checked[t.id]
                        ? "border-ink-700 bg-ink-850/40 opacity-55"
                        : "border-ink-700 bg-ink-850 hover:border-ink-600"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        checked[t.id] ? "bg-mint-400 text-ink-950" : "bg-ink-700 text-ink-300"
                      }`}
                    >
                      {checked[t.id] ? "✓" : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <KindTag kind={t.kind} />
                        <span className={`text-sm ${checked[t.id] ? "line-through" : ""}`}>{t.title}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-400">{t.detail}</p>
                    </div>
                    <div className="hidden shrink-0 -space-x-2 sm:flex">
                      {t.players.map((p) => (
                        <Headshot key={p.id} p={p} size={36} />
                      ))}
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <QuickLink label="Recommended lineup" value={`${a.optimalLineup.length} starters`} onClick={() => goTo("lineup")} />
        <QuickLink label="Waiver targets" value={`${a.waivers.length} worth a claim`} onClick={() => goTo("waivers")} />
        <QuickLink label="Your roster" value={`${a.roster.length} players`} onClick={() => goTo("roster")} />
      </div>
    </div>
  );
}

function KindTag({ kind }: { kind: Task["kind"] }) {
  const style = {
    start: "bg-mint-400/15 text-mint-300",
    bench: "bg-amber-400/15 text-amber-300",
    add: "bg-pos-wr/15 text-pos-wr",
  }[kind];
  const label = { start: "START", bench: "BENCH", add: "WAIVER" }[kind];
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${style}`}>{label}</span>;
}

function QuickLink({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between rounded-xl border border-ink-700/70 bg-ink-900 px-4 py-3 text-left transition hover:border-mint-400/50"
    >
      <div>
        <div className="text-xs text-ink-400">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
      <span className="text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-mint-400">→</span>
    </button>
  );
}

// --- Lineup ----------------------------------------------------------------

function Lineup({ a }: { a: Analysis }) {
  const optimalIds = new Set(a.optimalLineup.map((s) => s.player?.id));
  const currentIds = new Set(a.currentLineup.map((s) => s.player?.id).filter(Boolean));
  const benched = new Set(a.moves.filter((m) => m.action === "bench").map((m) => m.player.id));
  const bench = a.roster.filter((p) => !optimalIds.has(p.id));
  const max = Math.max(1, ...a.roster.map((p) => p.weekScore));
  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Recommended starters"
        action={
          <span className="font-mono text-sm font-semibold text-mint-300 tabular-nums">
            {a.optimalTotal.toFixed(1)} pts
          </span>
        }
      >
        <ul className="flex flex-col divide-y divide-ink-700/60">
          {a.optimalLineup.map((s, i) => {
            // Highlight only players who aren't in your lineup now; reshuffles
            // between same-position slots don't need any action.
            const changed = Boolean(s.player && !currentIds.has(s.player.id));
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
                    </div>
                    <ScoreBar value={s.player.weekScore} max={max} />
                  </div>
                ) : (
                  <span className="text-sm text-ink-400 italic">Empty — pick someone up on waivers</span>
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
    </div>
  );
}

function ScoreBar({ value, max, muted }: { value: number; max: number; muted?: boolean }) {
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

function Waivers({ a }: { a: Analysis }) {
  const positions = Object.keys(a.waiversByPosition).filter((p) => a.waiversByPosition[p].length);
  const [pos, setPos] = useState(positions[0] ?? "QB");
  return (
    <div className="flex flex-col gap-5">
      <Card title="Recommended claims">
        {a.waivers.length === 0 ? (
          <Empty>No free agent clearly beats what you already have. Hold your waiver priority.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {a.waivers.map((w, i) => (
              <article key={w.player.id} className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-850 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold tracking-wider text-ink-400 uppercase">Priority #{i + 1}</span>
                  {w.player.trendingAdds > 0 && (
                    <span className="rounded-full bg-pos-te/15 px-2 py-0.5 text-[11px] font-semibold text-pos-te">
                      🔥 {compact(w.player.trendingAdds)} adds
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-10 text-[11px] font-bold text-mint-400">ADD</span>
                  <PlayerLine p={w.player} sub={<MatchupChip p={w.player} compact />} />
                </div>
                {w.dropFor && (
                  <div className="flex items-center gap-2 opacity-80">
                    <span className="w-10 text-[11px] font-bold text-rose-400">DROP</span>
                    <PlayerLine p={w.dropFor} size={32} />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label={`Wk ${a.week} proj`} value={w.player.onBye ? "BYE" : w.player.weekScore.toFixed(1)} />
                  <Stat label="Season avg" value={w.player.seasonAvg?.toFixed(1) ?? "—"} />
                  <Stat
                    label={`Last ${w.player.recentGames || 3}`}
                    value={w.player.recentAvg?.toFixed(1) ?? "—"}
                  />
                </div>
                <p className="text-xs leading-relaxed text-ink-400">{w.reason}</p>
              </article>
            ))}
          </div>
        )}
      </Card>

      {a.drops.length > 0 && (
        <Card title="Drop candidates">
          <ul className="flex flex-col divide-y divide-ink-700/60">
            {a.drops.map((d) => (
              <li key={d.player.id} className="py-3">
                <PlayerLine p={d.player} size={34} />
                <p className="mt-1 ml-[46px] text-xs text-ink-400">{d.reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {positions.length > 0 && (
        <Card
          title="Best available"
          action={
            <div className="flex gap-1">
              {positions.map((p) => (
                <button
                  key={p}
                  onClick={() => setPos(p)}
                  className={`rounded-md px-2 py-1 text-xs font-bold transition ${
                    pos === p ? "bg-ink-100 text-ink-950" : "text-ink-400 hover:bg-ink-800"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          }
        >
          <PlayerTable players={a.waiversByPosition[pos] ?? []} week={a.week} showTrending />
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-900 px-2 py-1.5">
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-ink-400">{label}</div>
    </div>
  );
}

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

// --- Roster ----------------------------------------------------------------

type SortKey = "weekScore" | "seasonAvg" | "recentAvg" | "snapShare";

function Roster({ a }: { a: Analysis }) {
  return (
    <Card title="Your roster">
      <PlayerTable players={a.roster} week={a.week} showSnaps sortable />
    </Card>
  );
}

function PlayerTable({
  players,
  week,
  showTrending,
  showSnaps,
  sortable,
}: {
  players: PlayerAnalysis[];
  week: number;
  showTrending?: boolean;
  showSnaps?: boolean;
  sortable?: boolean;
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
            {showSnaps && <Th {...th} k="snapShare">
              Snaps
            </Th>}
            {showTrending && <Th {...th}>Adds</Th>}
            <th className="w-2 sm:w-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-ink-700/40 last:border-0 hover:bg-ink-850/60">
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
                      <span className="font-mono text-xs text-ink-300 tabular-nums">{Math.round(p.snapShare * 100)}%</span>
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

