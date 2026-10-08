"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useEffect, useMemo, useState } from "react";
import { describeMatchup, type Analysis, type PlayerAnalysis } from "@/lib/advisor";
import { avatarUrl } from "@/lib/sleeper";
import { findTrades } from "@/lib/trades";
import { buildPlan, type Plan } from "@/lib/planner";
import { Card, Empty, Headshot, MatchupChip, PlayerLine, Points, PosBadge, SlotBadge } from "./ui";

type Tab = "plan" | "lineup" | "waivers" | "trades" | "planner" | "roster";

const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Game plan" },
  { id: "lineup", label: "Lineup" },
  { id: "waivers", label: "Waivers" },
  { id: "trades", label: "Trades" },
  { id: "planner", label: "Season" },
  { id: "roster", label: "Roster" },
];

export function Results({
  a,
  onRefresh,
  refreshing,
}: {
  a: Analysis;
  onRefresh: () => void;
  refreshing: boolean;
}) {
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
      {tab === "waivers" && <Waivers a={a} onRefresh={onRefresh} refreshing={refreshing} />}
      {tab === "trades" && <Trades a={a} />}
      {tab === "planner" && <Planner a={a} />}
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
        <span className="flex items-center gap-2">
          <span className="font-semibold tracking-wider text-mint-400 uppercase">Week {a.week}</span>
          <span className="rounded-md bg-ink-700/70 px-1.5 py-0.5 font-semibold text-ink-300">{waiverChip(a)}</span>
        </span>
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
            {w.bid && <> for <b>${w.bid.suggested}</b></>}
            {w.dropFor && (
              <>
                , drop <b>{w.dropFor.name}</b>
              </>
            )}
          </>
        ),
        detail: w.bid
          ? `${bidSummary(w.bid)} ${w.reason}`
          : w.likelyClaimedBy
            ? `Heads up: ${w.likelyClaimedBy} is ahead of you and likely to claim this player first. ${w.reason}`
            : w.reason,
        players: w.dropFor ? [w.player, w.dropFor] : [w.player],
      });
    }
    return list;
  }, [a]);
  const [checked, toggle] = useChecked(`plan:${a.league.league_id}:${a.week}`);
  const done = tasks.filter((t) => checked[t.id]).length;

  return (
    <div className="flex flex-col gap-5">
      {a.bestBall && (
        <div className="rounded-xl border border-pos-wr/30 bg-pos-wr/10 px-4 py-3 text-sm text-ink-100">
          <b>Best-ball league:</b> Sleeper picks your highest-scoring lineup automatically each week, so there are no
          start/sit calls here. Waivers, trades and depth are what matter.
        </div>
      )}
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

function Waivers({ a, onRefresh, refreshing }: { a: Analysis; onRefresh: () => void; refreshing: boolean }) {
  const positions = Object.keys(a.waiversByPosition).filter((p) => a.waiversByPosition[p].length);
  const [pos, setPos] = useState(positions[0] ?? "QB");
  return (
    <div className="flex flex-col gap-5">
      <WaiverStatus a={a} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-700/70 bg-ink-900 px-4 py-2.5 text-xs text-ink-400">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-mint-400" />
          Only players on no roster in this league · checked{" "}
          {new Date(a.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-ink-700 px-2.5 py-1 font-semibold text-ink-300 hover:border-mint-400/50 hover:text-ink-100 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      <Card title="Recommended claims">
        {a.waivers.length === 0 ? (
          <Empty>No free agent clearly beats what you already have. Hold your waiver priority.</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {a.waivers.map((w, i) => (
              <article key={w.player.id} className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-850 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold tracking-wider text-ink-400 uppercase">Priority #{i + 1}</span>
                  <ClaimStatus w={w} />
                </div>
                {w.player.trendingAdds > 0 && (
                  <div className="-mt-1">
                    <span className="rounded-full bg-pos-te/15 px-2 py-0.5 text-[11px] font-semibold text-pos-te">
                      🔥 {compact(w.player.trendingAdds)} adds on Sleeper
                    </span>
                  </div>
                )}
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
                {w.bid && <BidBox bid={w.bid} />}
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

      {a.backupTargets.length > 0 && (
        <Card title="Backup targets">
          <p className="mb-3 text-sm text-ink-400">
            Your top claims will probably be gone before your turn. These are good fits for your team that teams ahead of
            you are less likely to take — put in claims for them too.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {a.backupTargets.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5">
                <PlayerLine p={p} size={34} sub={<MatchupChip p={p} compact />} />
                <Points value={p.weekScore} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Rivals a={a} />

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

function bidSummary(b: NonNullable<Analysis["waivers"][number]["bid"]>) {
  const top = b.competitors[0];
  if (!top) return "Little competition expected.";
  if (b.toWin !== null && b.toWin > b.ceiling) return `${top.teamName} may outbid you (~$${top.estimate}).`;
  return `Should beat ${top.teamName}'s likely ~$${top.estimate}.`;
}

function waiverChip(a: Analysis) {
  const w = a.waiver;
  if (w.type === "faab") return `FAAB $${w.budgetLeft ?? "?"}`;
  return `Waiver #${w.position ?? "?"}/${w.teams}`;
}

function WaiverStatus({ a }: { a: Analysis }) {
  const w = a.waiver;
  const ahead = a.rivals.length;
  const faab = w.type === "faab";
  const pct = faab
    ? (w.budgetLeft ?? 0) / Math.max(1, w.budget ?? 1)
    : 1 - ((w.position ?? w.teams) - 1) / Math.max(1, w.teams - 1);
  const level = pct > 0.66 ? "good" : pct > 0.33 ? "mid" : "low";
  const tone = { good: "text-mint-400", mid: "text-amber-300", low: "text-rose-300" }[level];
  const bar = { good: "bg-mint-400", mid: "bg-amber-400", low: "bg-rose-500" }[level];
  return (
    <section className="grid gap-4 rounded-2xl border border-ink-700/70 bg-ink-900/80 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="flex items-baseline gap-2">
        {faab ? (
          <>
            <span className={`font-mono text-4xl font-bold tabular-nums ${tone}`}>${w.budgetLeft}</span>
            <span className="text-sm text-ink-400">of ${w.budget} FAAB left</span>
          </>
        ) : (
          <>
            <span className={`font-mono text-4xl font-bold tabular-nums ${tone}`}>#{w.position ?? "?"}</span>
            <span className="text-sm text-ink-400">of {w.teams} on waivers</span>
          </>
        )}
      </div>
      <div className="sm:border-l sm:border-ink-700/60 sm:pl-5">
        <div className="text-sm font-semibold">
          {faab
            ? ahead === 0
              ? "Nobody can outbid you this week."
              : `${ahead} team${ahead === 1 ? "" : "s"} have more FAAB to spend than you.`
            : ahead === 0
              ? "You get first pick on waivers."
              : `${ahead} team${ahead === 1 ? "" : "s"} get${ahead === 1 ? "s" : ""} to claim before you.`}
        </div>
        <p className="mt-0.5 text-xs text-ink-400">
          {faab
            ? `Blind bidding — highest bid wins${w.position ? `, ties go to waiver order (you're #${w.position})` : ""}.`
            : w.type === "reverse"
              ? "Reverse standings: worse records claim first."
              : "Rolling: making a successful claim sends you to the back of the line."}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(4, pct * 100)}%` }} />
        </div>
      </div>
    </section>
  );
}

function BidBox({ bid }: { bid: NonNullable<Analysis["waivers"][number]["bid"]> }) {
  const top = bid.competitors[0];
  return (
    <div className="flex items-center gap-4 rounded-xl border border-mint-400/30 bg-mint-400/10 px-4 py-3">
      <div>
        <div className="font-mono text-2xl font-bold text-mint-300 tabular-nums">${bid.suggested}</div>
        <div className="text-[10px] font-semibold tracking-wider text-ink-400 uppercase">Suggested bid</div>
      </div>
      <div className="min-w-0 flex-1 text-xs text-ink-300">
        <div>
          Worth ~${bid.value} to you · max <b>${bid.ceiling}</b>
        </div>
        {top ? (
          <div className="mt-0.5 truncate text-ink-400">
            {bid.competitors.map((c) => `${c.teamName} ~$${c.estimate}`).join(" · ")}
          </div>
        ) : (
          <div className="mt-0.5 text-ink-400">No one else is likely to bid much.</div>
        )}
      </div>
    </div>
  );
}

function ClaimStatus({ w }: { w: Analysis["waivers"][number] }) {
  if (w.bid) {
    const top = w.bid.competitors[0];
    if (w.likelyClaimedBy && top) {
      return (
        <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
          Likely outbid · {top.teamName}
        </span>
      );
    }
    if (w.bid.competitors.length) {
      return (
        <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
          {w.bid.competitors.length} other team{w.bid.competitors.length === 1 ? "" : "s"} bidding
        </span>
      );
    }
    return (
      <span className="rounded-full bg-mint-400/15 px-2 py-0.5 text-[11px] font-semibold text-mint-300">
        Little competition
      </span>
    );
  }
  if (w.likelyClaimedBy) {
    return (
      <span
        title={`Projected to be claimed by ${w.likelyClaimedBy} before your turn`}
        className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300"
      >
        Likely gone · {w.likelyClaimedBy}
      </span>
    );
  }
  if (w.contestedBy.length) {
    return (
      <span
        title={`Also a fit for: ${w.contestedBy.join(", ")}`}
        className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
      >
        Contested · {w.contestedBy.length} team{w.contestedBy.length === 1 ? "" : "s"} ahead
      </span>
    );
  }
  return <span className="rounded-full bg-mint-400/15 px-2 py-0.5 text-[11px] font-semibold text-mint-300">Likely available</span>;
}

function Rivals({ a }: { a: Analysis }) {
  const rivals = a.rivals.filter((r) => r.targets.length);
  if (!rivals.length) return null;
  const faab = a.waiver.type === "faab";
  return (
    <Card
      title={faab ? "Teams with more FAAB than you" : "Teams ahead of you on waivers"}
      action={<span className="text-xs text-ink-400">who they&apos;ll likely claim</span>}
    >
      <ul className="flex flex-col divide-y divide-ink-700/60">
        {rivals.map((r) => (
          <li key={r.rosterId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 items-center gap-3 sm:w-56">
              <span className="w-12 shrink-0 font-mono text-sm font-semibold text-ink-300 tabular-nums">
                {faab ? `$${r.budgetLeft}` : `#${r.waiverPosition}`}
              </span>
              {r.avatar ? (
                <img src={avatarUrl(r.avatar)} alt="" className="h-7 w-7 rounded-full" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-700 text-xs font-bold">
                  {r.teamName.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate text-sm font-semibold">{r.teamName}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 pl-[60px] sm:pl-0">
              {r.projectedClaim && (
                <span className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 py-0.5 pr-2.5 pl-0.5">
                  <Headshot p={r.projectedClaim} size={24} />
                  <span className="text-xs font-semibold">{r.projectedClaim.name}</span>
                </span>
              )}
              {r.targets
                .filter((t) => t.player.id !== r.projectedClaim?.id)
                .slice(0, 2)
                .map((t) => (
                  <span key={t.player.id} className="text-xs text-ink-400">
                    {t.player.name}
                  </span>
                ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-400">
        Projection: each team takes the free agent that would help their lineup most, in waiver order. Teams can make
        several claims, so treat this as a guide.
      </p>
    </Card>
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

// --- Trades ----------------------------------------------------------------

function Trades({ a }: { a: Analysis }) {
  const report = useMemo(() => findTrades(a), [a]);
  const max = Math.max(1, ...report.strengths.map((s) => Math.max(s.value, s.leagueAverage)));
  return (
    <div className="flex flex-col gap-5">
      <Card title="Your team vs. the league" action={<span className="text-xs text-ink-400">rest-of-season starters</span>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {report.strengths.map((s) => {
            const good = s.rank <= Math.ceil(s.teams / 3);
            const bad = s.rank > Math.floor((s.teams * 2) / 3);
            return (
              <div key={s.position}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <PosBadge pos={s.position} />
                    <span className={`font-semibold ${good ? "text-mint-400" : bad ? "text-rose-300" : ""}`}>
                      #{s.rank} of {s.teams}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-ink-400 tabular-nums">
                    {s.value} vs avg {s.leagueAverage} pts/wk
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-ink-700">
                  <div
                    className={`h-full rounded-full ${good ? "bg-mint-400" : bad ? "bg-rose-500" : "bg-ink-300"}`}
                    style={{ width: `${(s.value / max) * 100}%` }}
                  />
                  <div
                    className="absolute -top-1 h-4 w-0.5 rounded bg-ink-100"
                    style={{ left: `${(s.leagueAverage / max) * 100}%` }}
                    title="League average"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-ink-400">
          Strong spots are where you can afford to trade from; weak spots are what to trade for. The tick mark is the
          league average.
        </p>
      </Card>

      <Card title="Trade ideas">
        {report.ideas.length === 0 ? (
          <Empty>No trade clearly helps both you and another team right now. Check back after this week&apos;s games.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {report.ideas.map((t, i) => (
              <article key={i} className="rounded-xl border border-ink-700 bg-ink-850 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {t.avatar ? (
                      <img src={avatarUrl(t.avatar)} alt="" className="h-6 w-6 rounded-full" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-700 text-[11px] font-bold">
                        {t.teamName.charAt(0).toUpperCase()}
                      </span>
                    )}
                    with {t.teamName}
                  </span>
                  <span className="flex gap-1.5 text-[11px] font-semibold">
                    <span className="rounded-full bg-mint-400/15 px-2 py-0.5 text-mint-300">You +{t.yourGain}/wk</span>
                    <span className="rounded-full bg-ink-700 px-2 py-0.5 text-ink-300">Them +{t.theirGain}/wk</span>
                  </span>
                </div>
                <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold tracking-wider text-rose-300 uppercase">You give</span>
                    {t.give.map((p) => (
                      <PlayerLine key={p.id} p={p} size={34} />
                    ))}
                  </div>
                  <span className="hidden text-xl text-ink-400 sm:block">⇄</span>
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold tracking-wider text-mint-400 uppercase">You get</span>
                    {t.get.map((p) => (
                      <PlayerLine key={p.id} p={p} size={34} />
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ink-400">{t.reason}</p>
              </article>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-ink-400">
          Every idea improves both teams&apos; best lineups for the rest of the season (pts/week) and is roughly even
          on value over replacement, so it&apos;s worth proposing. Gains assume both teams start their best players.
        </p>
      </Card>
    </div>
  );
}

// --- Season planner -------------------------------------------------------

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
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

function cellStyle(v: number, max: number) {
  const t = Math.max(0, Math.min(1, v / max));
  return { backgroundColor: `color-mix(in srgb, var(--color-mint-400) ${Math.round(8 + t * 47)}%, transparent)` };
}

/** Byes at the positions a planner alert is about. */
function ByeNote({ w }: { w: Plan["weeks"][number] }) {
  const affected = [...w.holes, ...w.thin];
  const relevant = w.byes.filter((p) => affected.includes(p.position));
  const shown = relevant.length ? relevant : affected.some((h) => !["QB", "RB", "WR", "TE", "K", "DEF"].includes(h)) ? w.byes : [];
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
  const stashes = [...plan.rows].filter((r) => r.playoffPoints > 0).sort((x, y) => y.playoffPoints - x.playoffPoints).slice(0, 3);
  return (
    <div className="flex flex-col gap-5">
      <Card title="Projected points by week" action={plan.playoffStart && <span className="text-xs text-ink-400">playoffs start week {plan.playoffStart}</span>}>
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
                {w.holes.length ? `hole: ${w.holes.join(", ")}` : w.thin.length ? `thin: ${w.thin.join(", ")}` : `${w.byes.length} on bye`}
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
                <ByeNote w={w} />
                .{" "}
                {w.holes.length > 0 && (
                  <span className="text-ink-300">
                    {w.week - 1 > a.week ? `Pick someone up on week ${w.week - 1} waivers.` : "Pick someone up this week."}
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
              <div key={r.player.id} className="flex items-center justify-between gap-2 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5">
                <PlayerLine p={r.player} size={32} />
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold tabular-nums">{r.playoffPoints.toFixed(1)}</div>
                  <div className="text-[10px] text-ink-400">wks {plan.playoffWeeks[0]}–{plan.playoffWeeks.at(-1)}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">Projected points across the fantasy playoffs — protect these players.</p>
        </Card>
      )}

      <Card title="Week-by-week projections">
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] tracking-wider text-ink-400 uppercase">
                <th className="sticky left-0 z-10 bg-ink-900 py-2 pr-2 pl-4 text-left font-semibold sm:pl-5">Player</th>
                {plan.weeks.map((w) => (
                  <th key={w.week} className={`px-1 py-2 text-center font-semibold ${w.playoff ? "text-mint-400" : ""}`}>
                    {w.week}
                  </th>
                ))}
                {plan.playoffWeeks.length > 0 && <th className="px-2 py-2 text-right font-semibold text-mint-400">Playoffs</th>}
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
                        <span className="block rounded bg-ink-700 px-1 py-1 text-center text-[9px] font-bold text-ink-400">BYE</span>
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
                    <td className="px-2 text-right font-mono font-semibold tabular-nums">{r.playoffPoints.toFixed(0)}</td>
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

