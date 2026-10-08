"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { analyzeLeague, type Analysis } from "@/lib/advisor";
import {
  avatarUrl,
  getNflState,
  getUser,
  getUserLeagues,
  upcomingWeek,
  type League,
  type NflState,
  type SleeperUser,
} from "@/lib/sleeper";
import { Results } from "./results";

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

function forget() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function scoringOf(l: League) {
  const rec = l.scoring_settings.rec ?? 0;
  return rec >= 1 ? "PPR" : rec >= 0.5 ? "Half PPR" : "Std";
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [state, setState] = useState<NflState | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueId, setLeagueId] = useState("");
  const [week, setWeek] = useState(1);
  const [loadingUser, setLoadingUser] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const requestId = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const findLeagues = useCallback(async (name: string, preferLeague?: string) => {
    setLoadingUser(true);
    setError(null);
    setAnalysis(null);
    try {
      const [found, nfl] = await Promise.all([getUser(name), getNflState()]);
      if (!found)
        throw new Error(
          `No Sleeper account named "${name}". Check the spelling — it's your Sleeper username, not your display name.`,
        );
      const season = nfl.league_season ?? nfl.season;
      const all = await getUserLeagues(found.user_id, season);
      if (all.length === 0) throw new Error(`${found.display_name} isn't in any ${season} NFL leagues on Sleeper.`);
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
      setLoadingUser(false);
    }
  }, []);

  useEffect(() => {
    const saved = loadSaved();
    if (saved.username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage after hydration
      setUsername(saved.username);
      void findLeagues(saved.username, saved.leagueId);
    }
  }, [findLeagues]);

  // Re-run the analysis whenever the league or week changes.
  useEffect(() => {
    if (!user || !state || !leagueId) return;
    const id = ++requestId.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off a fetch for the new selection
    setLoadingAnalysis(true);
    setError(null);
    save({ username: user.username ?? username, leagueId });
    analyzeLeague({
      leagueId,
      userId: user.user_id,
      season: state.league_season ?? state.season,
      week,
    })
      .then((result) => {
        if (id === requestId.current) setAnalysis(result);
      })
      .catch((err) => {
        if (id === requestId.current) {
          setError((err as Error).message);
          setAnalysis(null);
        }
      })
      .finally(() => {
        if (id === requestId.current) setLoadingAnalysis(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- username is only used for saving
  }, [user, state, leagueId, week, refreshKey]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (username.trim()) void findLeagues(username.trim());
  }

  function signOut() {
    forget();
    setUser(null);
    setLeagues([]);
    setAnalysis(null);
    setUsername("");
  }

  return (
    <div className="flex min-h-full flex-col">
      <TopBar user={user} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
        {!user ? (
          <Landing
            username={username}
            setUsername={setUsername}
            onSubmit={onSubmit}
            loading={loadingUser}
            error={error}
          />
        ) : (
          <>
            <Controls
              leagues={leagues}
              leagueId={leagueId}
              setLeagueId={setLeagueId}
              week={week}
              setWeek={setWeek}
              currentWeek={state ? upcomingWeek(state) : week}
            />
            {error && <ErrorBox message={error} />}
            {loadingAnalysis && !analysis && <Skeleton />}
            {analysis && (
              <div className={loadingAnalysis ? "pointer-events-none opacity-50 transition" : "transition"}>
                <Results
                  key={`${analysis.league.league_id}-${analysis.week}`}
                  a={analysis}
                  onRefresh={() => setRefreshKey((k) => k + 1)}
                  refreshing={loadingAnalysis}
                />
              </div>
            )}
          </>
        )}
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 text-xs text-ink-400">
        Data from Sleeper&apos;s public API · Not affiliated with Sleeper · Always check injury news before kickoff.
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <div className="display flex items-baseline gap-3 leading-none">
      <span className="text-[34px] font-black italic tracking-tight">
        Prime<span className="text-mint-400">time</span>
      </span>
      <span className="hidden text-sm font-semibold tracking-[0.22em] text-ink-400 sm:inline">Lineup advisor</span>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    // The inline script in layout.tsx already applied the theme; mirror it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with the DOM after hydration
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // The toggle still works for this visit.
    }
  }
  return (
    <button
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Dark mode" : "Light mode"}
      className="flex h-9 w-10 -skew-x-12 items-center justify-center bg-ink-800 text-ink-300 transition hover:bg-ink-700 hover:text-mint-400"
    >
      {theme === "light" ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4 skew-x-12" fill="currentColor" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 skew-x-12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

function TopBar({ user, onSignOut }: { user: SleeperUser | null; onSignOut: () => void }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-5">
      <Logo />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        {user && (
          <div className="display flex h-9 -skew-x-12 items-center gap-2 bg-ink-800 pr-1 pl-1.5 font-semibold">
            {user.avatar ? (
              <img src={avatarUrl(user.avatar)} alt="" className="h-7 w-7 skew-x-12 rounded-full" />
            ) : (
              <span className="flex h-7 w-7 skew-x-12 items-center justify-center rounded-full bg-ink-700 text-xs font-bold">
                {user.display_name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="max-w-[120px] skew-x-12 truncate text-sm">{user.display_name}</span>
            <button
              onClick={onSignOut}
              className="px-2.5 py-1 text-xs text-ink-400 hover:bg-ink-700 hover:text-ink-100"
            >
              <span className="block skew-x-12">Switch</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function Landing({
  username,
  setUsername,
  onSubmit,
  loading,
  error,
}: {
  username: string;
  setUsername: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center pt-10 text-center sm:pt-16">
      <span className="display mb-6 -skew-x-12 bg-hot px-4 py-1 text-sm font-extrabold text-white">
        <span className="block skew-x-12">Free · No login · Any Sleeper league</span>
      </span>
      <h1 className="display max-w-3xl text-6xl leading-[0.9] font-black text-balance sm:text-8xl">
        Set the lineup.{" "}
        <span className="bg-gradient-to-r from-mint-400 via-violet to-hot bg-clip-text text-transparent">
          Win the week.
        </span>
      </h1>
      <p className="mt-4 max-w-xl text-base text-ink-300 sm:text-lg">
        Start/sit calls, waiver pickups and drop candidates for your Sleeper team, built from this week&apos;s
        projections, matchups, injuries, depth charts and recent form.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your Sleeper username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-12 flex-1 border border-ink-700 bg-ink-900 px-4 text-base outline-none placeholder:text-ink-400 focus:border-mint-400 focus:shadow-[0_0_0_4px_rgb(25_227_255/0.15)]"
        />
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="prime-gradient display h-12 -skew-x-12 px-7 text-lg font-extrabold text-ink-950 shadow-[0_0_28px_rgb(25_227_255/0.35)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
        >
          <span className="block skew-x-12">{loading ? "Loading…" : "Analyze my team"}</span>
        </button>
      </form>
      {error && (
        <div className="mt-4 w-full max-w-md">
          <ErrorBox message={error} />
        </div>
      )}

      <div className="mt-14 grid w-full gap-3 text-left sm:grid-cols-3">
        {[
          {
            icon: "🎯",
            title: "Start / sit",
            text: "Builds your best lineup from projections, matchups, byes and injury status — and flags QBs who aren't starting.",
          },
          {
            icon: "📈",
            title: "Waiver wire",
            text: "Ranks free agents by value over replacement, tells you who to drop, and highlights who the rest of Sleeper is adding.",
          },
          {
            icon: "📬",
            title: "Weekly report",
            text: "A GitHub Action can post your game plan every Tuesday, before waivers run.",
          },
        ].map((f) => (
          <div key={f.title} className="border border-ink-700/80 border-t-4 border-t-mint-400 bg-ink-900/80 p-5">
            <div className="text-2xl">{f.icon}</div>
            <div className="display mt-3 text-xl font-bold">{f.title}</div>
            <p className="mt-1 text-sm text-ink-400">{f.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Controls({
  leagues,
  leagueId,
  setLeagueId,
  week,
  setWeek,
  currentWeek,
}: {
  leagues: League[];
  leagueId: string;
  setLeagueId: (id: string) => void;
  week: number;
  setWeek: (w: number) => void;
  currentWeek: number;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {leagues.map((l) => {
          const active = l.league_id === leagueId;
          return (
            <button
              key={l.league_id}
              onClick={() => setLeagueId(l.league_id)}
              className={`flex shrink-0 -skew-x-12 items-center gap-2.5 px-4 py-2 text-left transition ${
                active
                  ? "prime-gradient text-ink-950 shadow-[0_0_24px_rgb(25_227_255/0.3)]"
                  : "bg-ink-800 hover:bg-ink-700"
              }`}
            >
              <span className="flex skew-x-12 items-center gap-2.5">
                {l.avatar ? (
                  <img src={avatarUrl(l.avatar)} alt="" className="h-8 w-8 rounded-lg" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-700 text-sm font-bold">
                    {l.name.charAt(0)}
                  </span>
                )}
                <span>
                  <span className="display block max-w-[200px] truncate text-base leading-tight font-bold">
                    {l.name}
                  </span>
                  <span className={`block text-[11px] ${active ? "text-ink-950/75" : "text-ink-400"}`}>
                    {l.total_rosters} teams · {scoringOf(l)}
                    {l.roster_positions.includes("SUPER_FLEX") ? " · SF" : ""}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="display flex shrink-0 items-center gap-2 self-start sm:self-auto">
        <button
          aria-label="Previous week"
          disabled={week <= 1}
          onClick={() => setWeek(week - 1)}
          className="h-9 w-8 text-2xl text-ink-300 hover:text-mint-400 disabled:opacity-30"
        >
          ‹
        </button>
        <div className="min-w-[110px] -skew-x-12 bg-hot px-4 py-1 text-center text-white">
          <div className="skew-x-12">
            <div className="text-xl leading-tight font-extrabold">Week {week}</div>
            {week === currentWeek && (
              <div className="text-[10px] leading-tight font-bold tracking-[0.18em]">Upcoming</div>
            )}
          </div>
        </div>
        <button
          aria-label="Next week"
          disabled={week >= 18}
          onClick={() => setWeek(week + 1)}
          className="h-9 w-8 text-2xl text-ink-300 hover:text-mint-400 disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-200">
      {message}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 flex flex-col gap-5" aria-busy="true" aria-label="Loading recommendations">
      <div className="skeleton h-40 rounded-2xl" />
      <div className="skeleton h-12 rounded-2xl" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-20 rounded-2xl" />
      ))}
    </div>
  );
}
