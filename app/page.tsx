"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  analyzeLeague,
  describeMatchup,
  type Analysis,
  type MatchupGrade,
  type PlayerAnalysis,
} from "@/lib/advisor";
import {
  getNflState,
  getUser,
  getUserLeagues,
  upcomingWeek,
  type League,
  type NflState,
  type SleeperUser,
} from "@/lib/sleeper";

const STORAGE_KEY = "sleeper-advisor";

function loadSaved(): { username?: string; leagueId?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function save(data: { username: string; leagueId?: string }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Private mode etc. — remembering the username is just a convenience.
  }
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [state, setState] = useState<NflState | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueId, setLeagueId] = useState("");
  const [week, setWeek] = useState(1);
  const [loading, setLoading] = useState<"user" | "analysis" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  useEffect(() => {
    const saved = loadSaved();
    if (saved.username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage after hydration
      setUsername(saved.username);
      void findLeagues(saved.username, saved.leagueId);
    }
  }, []);

  async function findLeagues(name: string, preferLeague?: string) {
    setLoading("user");
    setError(null);
    setAnalysis(null);
    try {
      const [found, nfl] = await Promise.all([getUser(name), getNflState()]);
      if (!found) throw new Error(`No Sleeper account named "${name}".`);
      const season = nfl.league_season ?? nfl.season;
      const all = await getUserLeagues(found.user_id, season);
      if (all.length === 0) throw new Error(`${found.display_name} isn't in any ${season} NFL leagues.`);
      setUser(found);
      setState(nfl);
      setLeagues(all);
      setWeek(upcomingWeek(nfl));
      const pick = all.find((l) => l.league_id === preferLeague) ?? all[0];
      setLeagueId(pick.league_id);
      save({ username: name, leagueId: pick.league_id });
    } catch (err) {
      setError((err as Error).message);
      setUser(null);
      setLeagues([]);
    } finally {
      setLoading(null);
    }
  }

  async function runAnalysis() {
    if (!user || !state || !leagueId) return;
    setLoading("analysis");
    setError(null);
    try {
      save({ username, leagueId });
      const result = await analyzeLeague({
        leagueId,
        userId: user.user_id,
        season: state.league_season ?? state.season,
        week,
      });
      setAnalysis(result);
    } catch (err) {
      setError((err as Error).message);
      setAnalysis(null);
    } finally {
      setLoading(null);
    }
  }

  function onSubmitUser(e: FormEvent) {
    e.preventDefault();
    if (username.trim()) void findLeagues(username.trim());
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Sleeper Lineup Advisor</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Who to start, who to bench, who to drop and who to grab off waivers, based on this week&apos;s
          projections, matchups, injuries and recent form.
        </p>
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <form onSubmit={onSubmitUser} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium">Sleeper username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. fantasyking22"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 outline-none focus:border-emerald-500 dark:border-zinc-700"
            />
          </label>
          <button
            type="submit"
            disabled={loading !== null || !username.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {loading === "user" ? "Looking up…" : "Find my leagues"}
          </button>
        </form>

        {user && leagues.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 sm:flex-row sm:items-end dark:border-zinc-800">
            <label className="flex-1">
              <span className="mb-1 block text-sm font-medium">League</span>
              <select
                value={leagueId}
                onChange={(e) => setLeagueId(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {leagues.map((l) => (
                  <option key={l.league_id} value={l.league_id}>
                    {l.name} ({l.total_rosters} teams)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">Week</span>
              <select
                value={week}
                onChange={(e) => setWeek(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 sm:w-28 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>
                    Week {w}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={runAnalysis}
              disabled={loading !== null}
              className="rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading === "analysis" ? "Crunching…" : "Get recommendations"}
            </button>
          </div>
        )}
      </section>

      {error && (
        <p className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {analysis && <Results key={`${analysis.league.league_id}-${analysis.week}`} a={analysis} />}

      <footer className="mt-12 text-sm text-zinc-500">
        Data from Sleeper&apos;s public API. Recommendations are a starting point — check injury news before
        kickoff.
      </footer>
    </main>
  );
}

const GRADE_STYLE: Record<MatchupGrade, string> = {
  great: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  good: "bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300",
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  tough: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  brutal: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function MatchupBadge({ p }: { p: PlayerAnalysis }) {
  if (p.onBye) return <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-200 dark:bg-zinc-700">BYE</span>;
  if (!p.matchup) return <span className="text-zinc-400">—</span>;
  return (
    <span
      title={describeMatchup(p.matchup, p.position)}
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${GRADE_STYLE[p.matchup.grade]}`}
    >
      vs {p.matchup.opponent}
    </span>
  );
}

function InjuryBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const severe = !["Questionable"].includes(status);
  return (
    <span
      className={`ml-1.5 rounded px-1 text-[11px] font-semibold ${
        severe ? "bg-red-600 text-white" : "bg-amber-400 text-amber-950"
      }`}
    >
      {status === "Questionable" ? "Q" : status === "Doubtful" ? "D" : status}
    </span>
  );
}

function Name({ p }: { p: PlayerAnalysis }) {
  return (
    <span className="font-medium">
      {p.name}
      <span className="ml-1.5 text-xs font-normal text-zinc-500">
        {p.position} · {p.team ?? "FA"}
      </span>
      <InjuryBadge status={p.injury} />
    </span>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Results({ a }: { a: Analysis }) {
  const starts = a.moves.filter((m) => m.action === "start");
  const benches = a.moves.filter((m) => m.action === "bench");
  const positions = Object.keys(a.waiversByPosition).filter((p) => a.waiversByPosition[p].length);
  const [pos, setPos] = useState(positions[0] ?? "QB");

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">
          Week {a.week}: {a.teamName}
        </h2>
        <p className="text-sm text-zinc-500">
          {a.league.name} · {a.scoringLabel}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Current lineup" value={`${a.currentTotal} pts`} />
        <Stat label="Optimized lineup" value={`${a.optimalTotal} pts`} accent={a.optimalTotal > a.currentTotal} />
        <Stat label="Lineup changes" value={String(starts.length)} />
        <Stat label="Waiver adds" value={String(a.waivers.length)} />
      </div>

      {a.warnings.length > 0 && (
        <ul className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {a.warnings.map((w) => (
            <li key={w}>⚠️ {w}</li>
          ))}
        </ul>
      )}

      <Card title="Start / sit">
        {a.moves.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Your lineup is already optimal. No changes needed. ✅</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-600">Start</h3>
              <ul className="flex flex-col gap-3">
                {starts.map((m) => (
                  <li key={m.player.id} className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50/50 p-3 dark:bg-emerald-950/30">
                    <div className="flex items-center justify-between gap-2">
                      <Name p={m.player} />
                      <span className="text-xs text-zinc-500">{m.slot}</span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{m.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-600">Bench</h3>
              <ul className="flex flex-col gap-3">
                {benches.map((m) => (
                  <li key={m.player.id} className="rounded-lg border-l-4 border-amber-500 bg-amber-50/50 p-3 dark:bg-amber-950/30">
                    <Name p={m.player} />
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{m.reason}</p>
                  </li>
                ))}
                {benches.length === 0 && (
                  <li className="text-sm text-zinc-500">Nobody to bench — the new starters fill empty slots.</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </Card>

      <Card title="Recommended lineup">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-2 pr-3">Slot</th>
                <th className="py-2 pr-3">Player</th>
                <th className="py-2 pr-3">Matchup</th>
                <th className="py-2 text-right">Proj</th>
              </tr>
            </thead>
            <tbody>
              {a.optimalLineup.map((s, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{s.slot}</td>
                  <td className="py-2 pr-3">{s.player ? <Name p={s.player} /> : <em className="text-zinc-400">empty</em>}</td>
                  <td className="py-2 pr-3">{s.player && <MatchupBadge p={s.player} />}</td>
                  <td className="py-2 text-right tabular-nums">{s.player?.weekScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Waiver wire pickups">
          {a.waivers.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">No free agent clearly beats what you already have.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {a.waivers.map((w) => (
                <li key={w.player.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="text-sm">
                    <span className="mr-1 font-semibold text-emerald-600">Add</span>
                    <Name p={w.player} />
                  </div>
                  {w.dropFor && (
                    <div className="mt-0.5 text-sm">
                      <span className="mr-1 font-semibold text-red-600">Drop</span>
                      <Name p={w.dropFor} />
                    </div>
                  )}
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{w.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Drop candidates">
          {a.drops.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">Nobody on your bench is an obvious cut.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {a.drops.map((d) => (
                <li key={d.player.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <Name p={d.player} />
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{d.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {positions.length > 0 && (
        <Card title="Best available by position">
          <div className="mb-3 flex flex-wrap gap-2">
            {positions.map((p) => (
              <button
                key={p}
                onClick={() => setPos(p)}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  pos === p ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <PlayerTable players={a.waiversByPosition[pos] ?? []} showTrending />
        </Card>
      )}

      <Card title="Your roster">
        <PlayerTable players={a.roster} />
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? "text-emerald-600" : ""}`}>{value}</div>
    </div>
  );
}

function PlayerTable({ players, showTrending }: { players: PlayerAnalysis[]; showTrending?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-2 pr-3">Player</th>
            <th className="py-2 pr-3">Matchup</th>
            <th className="py-2 pr-3 text-right">Week proj</th>
            <th className="py-2 pr-3 text-right">Season avg</th>
            <th className="py-2 pr-3 text-right">Last 3</th>
            {showTrending && <th className="py-2 text-right">Adds (72h)</th>}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-2 pr-3">
                <Name p={p} />
              </td>
              <td className="py-2 pr-3">
                <MatchupBadge p={p} />
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{p.weekScore}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{p.seasonAvg ?? "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{p.recentAvg ?? "—"}</td>
              {showTrending && (
                <td className="py-2 text-right tabular-nums">{p.trendingAdds ? p.trendingAdds.toLocaleString() : "—"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
