"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { analyzeLeague, type Analysis } from "@/lib/advisor";
import { loadPrefs, savePrefs, withRule, type PlayerRule, type Prefs } from "@/lib/prefs";
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
import { RulesProvider } from "./rules";
import { InstallButton } from "./install";
import { ThemeToggle } from "./theme";
import { installErrorLogging } from "@/lib/errorlog";
import { CompactBar } from "./topbar";

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

export default function Home() {
  // Keep a local log of errors outside rendering (failed requests, event handlers).
  useEffect(() => installErrorLogging(), []);
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
  // Your rules for this league (don't trade / don't drop / backup for); a change re-runs the analysis.
  const [prefs, setPrefs] = useState<Prefs>({});
  const [rulesKey, setRulesKey] = useState(0);

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
    const rules = loadPrefs(leagueId);
    setPrefs(rules);
    analyzeLeague({
      leagueId,
      userId: user.user_id,
      season: state.league_season ?? state.season,
      week,
      prefs: rules,
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
  }, [user, state, leagueId, week, refreshKey, rulesKey]);

  const rulesApi = useMemo(
    () => ({
      prefs,
      setRule: (playerId: string, rule: PlayerRule | null) => {
        if (!leagueId) return;
        const next = withRule(prefs, playerId, rule);
        savePrefs(leagueId, next);
        setPrefs(next);
        setRulesKey((k) => k + 1);
      },
    }),
    [prefs, leagueId],
  );

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
    // Phones: a full-height frame where only the middle scrolls and the section bar sits
    // underneath it. (iOS moves position:fixed bars around while scrolling, especially in
    // home-screen apps, so the bar is laid out rather than fixed.) Desktop scrolls the page.
    <div
      className="flex min-h-full flex-col max-sm:h-dvh max-sm:min-h-0"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        id="scroller"
        className="flex flex-1 flex-col max-sm:min-h-0 max-sm:overflow-y-auto max-sm:overscroll-contain"
      >
        {user && leagues.length > 0 ? (
          <CompactBar
            user={user}
            leagues={leagues}
            leagueId={leagueId}
            setLeagueId={setLeagueId}
            week={week}
            setWeek={setWeek}
            currentWeek={state ? upcomingWeek(state) : week}
            onSignOut={signOut}
            season={state ? (state.league_season ?? state.season) : ""}
            analysis={analysis}
          />
        ) : (
          <TopBar user={user} onSignOut={signOut} />
        )}
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
              {error && <ErrorBox message={error} />}
              {loadingAnalysis && !analysis && <Skeleton />}
              {analysis && (
                <div className={loadingAnalysis ? "pointer-events-none opacity-50 transition" : "transition"}>
                  <RulesProvider value={rulesApi}>
                    <Results
                      key={`${analysis.league.league_id}-${analysis.week}`}
                      a={analysis}
                      onRefresh={() => setRefreshKey((k) => k + 1)}
                      refreshing={loadingAnalysis}
                    />
                  </RulesProvider>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="mx-auto w-full max-w-5xl px-4 pb-8 text-xs text-ink-400">
          Data from Sleeper&apos;s public API · Not affiliated with Sleeper · Always check injury news before kickoff.
        </footer>
      </div>
      {/* Phones: the section bar renders here (see Results). */}
      <div id="bottom-nav-slot" className="shrink-0 sm:hidden" />
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5 leading-none">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-mint-400 text-[15px] font-black text-ink-950">
        P
      </span>
      <span className="text-xl font-extrabold tracking-tight">Prime Time</span>
      <span className="hidden text-sm text-ink-400 sm:inline">Lineup advisor</span>
    </div>
  );
}

function TopBar({ user, onSignOut }: { user: SleeperUser | null; onSignOut: () => void }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-5">
      <Logo />
      <div className="flex items-center gap-2">
        <InstallButton />
        <ThemeToggle />
        {user && (
          <div className="display flex h-9 rounded-lg items-center gap-2 bg-ink-800 pr-1 pl-1.5 font-semibold">
            {user.avatar ? (
              <img src={avatarUrl(user.avatar)} alt="" className="h-7 w-7  rounded-full" />
            ) : (
              <span className="flex h-7 w-7  items-center justify-center rounded-full bg-ink-700 text-xs font-bold">
                {user.display_name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="hidden max-w-[120px]  truncate text-sm sm:inline">{user.display_name}</span>
            <button
              onClick={onSignOut}
              className="px-2.5 py-1 text-xs text-ink-400 hover:bg-ink-700 hover:text-ink-100"
            >
              <span className="block ">Switch</span>
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
      <span className="display mb-6 rounded-lg bg-hot px-4 py-1 text-sm font-extrabold text-white">
        <span className="block ">Free · No login · Any Sleeper league</span>
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
          className="prime-gradient display h-12 rounded-lg px-7 text-lg font-extrabold text-ink-950 shadow-[0_0_28px_rgb(25_227_255/0.35)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
        >
          <span className="block ">{loading ? "Loading…" : "Analyze my team"}</span>
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
