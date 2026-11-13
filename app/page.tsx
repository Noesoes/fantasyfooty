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
import { Ring } from "./ui";

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
  // A refresh you didn't ask for (coming back to the app): no dimming, and a failure keeps what's on screen.
  const quietRefresh = useRef(false);
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
    const quiet = quietRefresh.current;
    quietRefresh.current = false;
    if (!quiet) setLoadingAnalysis(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off a fetch for the new selection
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
        if (id === requestId.current && !quiet) {
          setError((err as Error).message);
          setAnalysis(null);
        }
      })
      .finally(() => {
        if (id === requestId.current && !quiet) setLoadingAnalysis(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- username is only used for saving
  }, [user, state, leagueId, week, refreshKey, rulesKey]);

  // Coming back to the app (e.g. after setting your lineup in Sleeper): reload if the data is
  // more than a minute old, so the plan reflects your current lineup.
  const fetchedAt = analysis?.fetchedAt ?? null;
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible" || fetchedAt === null) return;
      if (Date.now() - fetchedAt < 60_000) return;
      quietRefresh.current = true;
      setRefreshKey((k) => k + 1);
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("pageshow", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [fetchedAt]);

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

const FEATURES = [
  {
    icon: "🎯",
    title: "Lineup fixes",
    text: "Your best lineup every week, from projections, matchups, Vegas and injury odds. If a starter is out and your bench can't cover, it names the pickup.",
  },
  {
    icon: "📋",
    title: "Waivers & stashes",
    text: "Who to claim, who to drop, what to bid, and which rival will beat you to him. Plus the backups worth stashing before the starter gets hurt or traded.",
  },
  {
    icon: "⚔️",
    title: "Matchup analyzer",
    text: "Your win chance, floor and upside, where you win and lose the week slot by slot, and how the points land across each kickoff window.",
  },
  {
    icon: "🤝",
    title: "Trades",
    text: "Grade any offer for both sides, see your positional ranks before and after, and find the teams that fit you as trade partners.",
  },
  {
    icon: "📺",
    title: "Live game center",
    text: "Live win probability on game day, every game's box score and your players' plays, plus late-swap alerts before kickoff.",
  },
  {
    icon: "📰",
    title: "News that matters",
    text: "Injury odds from practice reports, and trade rumors weighed against denials. Ask \u201cis Taylor getting traded?\u201d and get a straight answer.",
  },
];

/** A static preview of the Plan screen, so the landing page shows what you get. */
function PlanPreview() {
  const rows = [
    { title: "Replace your QB on IR", sub: "Claim the QB who projects 25.4", tone: "text-mint-400" },
    { title: "Start your WR3 at Flex", sub: "+12.1 pts · 95% sure", tone: "text-mint-400" },
    { title: "Stash the backup RB", sub: "Starter in trade rumors · 60%", tone: "text-violet" },
  ];
  return (
    <div
      className="glass w-full max-w-md rounded-3xl border border-ink-700 bg-ink-900 p-4 text-left shadow-2xl"
      aria-hidden
    >
      <div className="flex items-center gap-4">
        <Ring value={0.64} size={76}>
          <span className="text-lg leading-none font-black">64%</span>
          <span className="mt-0.5 text-[8.5px] font-extrabold tracking-wide text-ink-300 uppercase">to win</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between text-[15px] font-extrabold">
            <span>You</span>
            <span className="font-mono">118.4</span>
          </div>
          <div className="flex items-baseline justify-between text-[15px] font-extrabold opacity-70">
            <span>Opponent</span>
            <span className="font-mono">109.9</span>
          </div>
          <div className="mt-0.5 text-[11.5px] font-bold text-mint-400">+9.6 with your moves</div>
        </div>
      </div>
      <div className="mt-3 text-[13px] font-extrabold">Do these 3 things</div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.title} className="flex items-center gap-3 rounded-2xl bg-ink-850 px-3 py-2.5">
            <span className="h-5 w-5 shrink-0 rounded-full border-2 border-ink-600" />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-bold">{r.title}</span>
              <span className={`block truncate text-[12px] font-semibold ${r.tone}`}>{r.sub}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
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
    <div className="flex flex-col items-center pt-8 text-center sm:pt-14">
      <span className="mb-5 rounded-full bg-mint-400/15 px-3.5 py-1 text-xs font-extrabold tracking-wide text-mint-400">
        Free · No login · Any Sleeper league
      </span>
      <h1 className="max-w-3xl text-[44px] leading-[0.95] font-black tracking-tight text-balance sm:text-7xl">
        Your Sleeper team,{" "}
        <span className="bg-gradient-to-r from-mint-400 via-violet to-hot bg-clip-text text-transparent">
          coached every week.
        </span>
      </h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-300 sm:text-lg">
        Who to start, who to claim, who to stash and whether to take the trade, built from projections, matchups, Vegas
        lines, injury reports and the news.
      </p>

      <form
        onSubmit={onSubmit}
        className="glass mt-7 flex w-full max-w-md flex-col gap-2 rounded-3xl border border-ink-700 bg-ink-900 p-3 text-left"
      >
        <label htmlFor="username" className="px-1 text-xs font-extrabold tracking-wide text-ink-400 uppercase">
          Sleeper username
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. adamlevitan"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          enterKeyHint="go"
          className="h-12 rounded-2xl border border-ink-700 bg-ink-850 px-4 text-base outline-none placeholder:text-ink-500 focus:border-mint-400"
        />
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="h-12 rounded-2xl bg-mint-400 text-base font-black text-ink-950 transition hover:brightness-105 disabled:opacity-40"
        >
          {loading ? "Finding your leagues…" : "See my game plan"}
        </button>
        <p className="px-1 text-[11.5px] text-ink-400">
          Your @handle in Sleeper (Account → Username), not your display name. Nothing to install or sign into.
        </p>
      </form>
      {error && (
        <div className="w-full max-w-md">
          <ErrorBox message={error} />
        </div>
      )}

      <div className="mt-10 flex w-full justify-center">
        <PlanPreview />
      </div>

      <div className="mt-10 grid w-full gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-3xl border border-ink-700 bg-ink-900 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-850 text-xl">{f.icon}</div>
            <div className="mt-3 text-lg font-extrabold tracking-tight">{f.title}</div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-300">{f.text}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 max-w-md text-xs text-ink-400">
        Reads only public league data from Sleeper and ESPN, straight from your phone. Your username and settings stay
        on this device.
      </p>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-left text-sm font-semibold text-ink-100">
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
