"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useEffect, useMemo, useRef, useState } from "react";
import { describeMatchup, type Analysis, type PlayerAnalysis } from "@/lib/advisor";
import { avatarUrl } from "@/lib/sleeper";
import { evaluateTrade, findTrades, type TradeVerdict } from "@/lib/trades";
import { buildPlan, type Plan } from "@/lib/planner";
import { buildScouting, ordinal, type Scouting } from "@/lib/scouting";
import { buildPlayoffOdds, type PlayoffOdds, type PlayoffTeam } from "@/lib/playoffs";
import { buildInjuryReport, type InjuryReport, type InjuryRow, type Verdict } from "@/lib/injuries";
import { buildTrackRecord, type TrackRecord } from "@/lib/backtest";
import { fetchLive, type LivePlayer, type LiveSide, type LiveState } from "@/lib/live";
import { fetchPlayByPlay, type PlayByPlay, type PlayEvent } from "@/lib/playbyplay";
import { Card, Empty, Headshot, MatchupChip, PlayerLine, Points, PosBadge, SlotBadge } from "./ui";

type Tab =
  | "live"
  | "plan"
  | "lineup"
  | "scout"
  | "injuries"
  | "waivers"
  | "trades"
  | "planner"
  | "playoffs"
  | "record"
  | "roster";

type Section = "week" | "moves" | "season" | "team";

// Four sections, each with a few sub-tabs. New features go into one of
// these rather than becoming another top-level tab.
const SECTIONS: { id: Section; label: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    id: "week",
    label: "This Week",
    tabs: [
      { id: "plan", label: "Game plan" },
      { id: "lineup", label: "Lineup" },
      { id: "injuries", label: "Injuries" },
      { id: "scout", label: "Opponent" },
    ],
  },
  {
    id: "moves",
    label: "Moves",
    tabs: [
      { id: "waivers", label: "Waivers" },
      { id: "trades", label: "Trades" },
    ],
  },
  {
    id: "season",
    label: "Season",
    tabs: [
      { id: "playoffs", label: "Playoffs" },
      { id: "planner", label: "Schedule" },
    ],
  },
  {
    id: "team",
    label: "My Team",
    tabs: [
      { id: "roster", label: "Roster" },
      { id: "record", label: "Track record" },
    ],
  },
];
const sectionOf = (tab: Tab): Section =>
  tab === "live" ? "week" : (SECTIONS.find((s) => s.tabs.some((t) => t.id === tab))?.id ?? "week");
const ALL_TABS = new Set<string>(["live", ...SECTIONS.flatMap((s) => s.tabs.map((t) => t.id))]);

function SectionIcon({ id, className = "h-5 w-5" }: { id: Section; className?: string }) {
  const paths: Record<Section, React.ReactNode> = {
    week: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 3h6v3H9zM9 13l2 2 4-4" />
      </>
    ),
    moves: <path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" />,
    season: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4" />,
    team: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 14.5a5 5 0 0 1 3 5.5" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[id]}
    </svg>
  );
}

function Badge({ n, active }: { n: number; active?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={`ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center px-1 font-mono text-[11px] leading-[1.1rem] font-bold ${
        active ? "bg-ink-950/25 text-ink-950" : "bg-hot text-white"
      }`}
    >
      {n}
    </span>
  );
}

/** Live scores for this week, refreshed every minute while games are on. */
function useLive(a: Analysis) {
  const [live, setLive] = useState<LiveState | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fetchLive(a);
        if (!alive) return;
        setLive(next);
        // Keep polling while anything is still to be played today.
        if (next.started && !next.allDone) timer = setTimeout(load, next.inProgress ? 60_000 : 5 * 60_000);
      } catch {
        if (alive) timer = setTimeout(load, 2 * 60_000);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [a]);
  return live;
}

export function Results({ a, onRefresh, refreshing }: { a: Analysis; onRefresh: () => void; refreshing: boolean }) {
  // The open sub-tab lives in the URL hash, so refresh and the back button keep your place.
  const [initial] = useState<Tab | null>(() => {
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    return ALL_TABS.has(h) ? (h as Tab) : null;
  });
  const [tab, setTabState] = useState<Tab>(initial && initial !== "live" ? initial : "plan");
  const [lastTab, setLastTab] = useState<Partial<Record<Section, Tab>>>({});
  const top = useRef<HTMLDivElement>(null);
  const setTab = (next: Tab) => {
    setTabState(next);
    setLastTab((prev) => ({ ...prev, [sectionOf(next)]: next }));
    try {
      history.replaceState(null, "", `#${next}`);
    } catch {
      // not fatal
    }
    // Bring the new view's top into sight if we were scrolled down the old one.
    if (top.current && top.current.getBoundingClientRect().top < 0) top.current.scrollIntoView({ block: "start" });
  };
  const live = useLive(a);
  const isLive = Boolean(live?.started && !live.allDone);
  const showLive = Boolean(live?.started);
  // Jump to the Live tab the first time we see games underway — unless the
  // URL already says where you were (e.g. after a refresh).
  const [autoSwitched, setAutoSwitched] = useState(initial !== null && initial !== "live");
  useEffect(() => {
    if (isLive && !autoSwitched) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time switch when games start
      setTabState("live");
      setAutoSwitched(true);
    }
  }, [isLive, autoSwitched]);

  const section = sectionOf(tab);
  const atRisk = a.currentLineup.filter(
    (s) => s.player && s.player.injury && s.player.injury !== "Questionable",
  ).length;
  const counts: Partial<Record<Tab, number>> = { waivers: a.waivers.length, injuries: atRisk };
  const sectionCount = (id: Section) =>
    SECTIONS.find((x) => x.id === id)!.tabs.reduce((n, t) => n + (counts[t.id] ?? 0), 0);
  const subTabs = SECTIONS.find((x) => x.id === section)!.tabs;
  const tabs =
    section === "week" && showLive ? [{ id: "live" as Tab, label: isLive ? "● Live" : "Final" }, ...subTabs] : subTabs;
  const openSection = (id: Section) => {
    const first = id === "week" && isLive ? "live" : SECTIONS.find((x) => x.id === id)!.tabs[0].id;
    setTab(lastTab[id] ?? first);
  };

  return (
    <div className="mt-6 flex flex-col gap-5 pb-20 sm:pb-0">
      <Ticker a={a} />
      {live && showLive ? <LiveScoreboard a={a} live={live} /> : <Scoreboard a={a} />}
      <div ref={top} className="-mb-5 scroll-mt-0" />
      <nav className="sticky top-0 z-20 -mx-4 bg-ink-950/90 px-4 pt-2 pb-1 backdrop-blur sm:mx-0 sm:px-1">
        {/* Sections: top bar on desktop (bottom bar on phones, below). */}
        <div className="hidden gap-1 px-2 sm:flex">
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              onClick={() => openSection(x.id)}
              aria-current={section === x.id ? "page" : undefined}
              className={`display flex flex-1 -skew-x-12 items-center justify-center px-4 py-2.5 text-base font-bold whitespace-nowrap transition ${
                section === x.id
                  ? "prime-gradient text-ink-950 shadow-[0_0_24px_rgb(25_227_255/0.35)]"
                  : "bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-100"
              }`}
            >
              <span className="flex skew-x-12 items-center gap-2">
                <SectionIcon id={x.id} className="h-[18px] w-[18px]" />
                {x.label}
                {x.id === "week" && isLive && <span className="h-2 w-2 animate-pulse rounded-full bg-hot" />}
                <Badge n={sectionCount(x.id)} active={section === x.id} />
              </span>
            </button>
          ))}
        </div>
        {/* Sub-tabs for the open section. */}
        <div className="no-scrollbar mt-1 flex gap-1 overflow-x-auto border-b border-ink-700/70 px-2 sm:mt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`display -mb-px shrink-0 border-b-[3px] px-3 py-2 text-[15px] font-bold whitespace-nowrap transition ${
                tab === t.id
                  ? t.id === "live"
                    ? "border-hot text-hot"
                    : "border-mint-400 text-ink-100"
                  : "border-transparent text-ink-400 hover:text-ink-100"
              }`}
            >
              {t.label}
              <Badge n={counts[t.id] ?? 0} />
            </button>
          ))}
        </div>
      </nav>
      {tab === "live" && live && <LiveTab a={a} live={live} />}
      {tab === "plan" && <GamePlan a={a} goTo={setTab} />}
      {tab === "lineup" && <Lineup a={a} />}
      {tab === "injuries" && <Injuries a={a} />}
      {tab === "waivers" && <Waivers a={a} onRefresh={onRefresh} refreshing={refreshing} />}
      {tab === "trades" && <Trades a={a} />}
      {tab === "scout" && <Scout a={a} />}
      {tab === "planner" && <Planner a={a} />}
      {tab === "playoffs" && <Playoffs a={a} />}
      {tab === "record" && <Record a={a} />}
      {tab === "roster" && <Roster a={a} />}

      {/* Phone: sections in a thumb-reach bottom bar. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700 bg-ink-900/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-md">
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              onClick={() => openSection(x.id)}
              aria-current={section === x.id ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 transition ${
                section === x.id ? "text-mint-400" : "text-ink-400"
              }`}
            >
              {section === x.id && <span className="prime-gradient absolute inset-x-4 top-0 h-[3px]" />}
              <span className="relative">
                <SectionIcon id={x.id} className="h-6 w-6" />
                {x.id === "week" && isLive ? (
                  <span className="absolute -top-0.5 -right-1 h-2.5 w-2.5 animate-pulse rounded-full bg-hot ring-2 ring-ink-900" />
                ) : (
                  sectionCount(x.id) > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[1.1rem] rounded-full bg-hot px-1 text-center font-mono text-[10px] leading-[1.1rem] font-bold text-white">
                      {sectionCount(x.id)}
                    </span>
                  )
                )}
              </span>
              <span className="display text-[11px] font-bold tracking-wide uppercase">{x.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Avatar({ id, name, ring = "ring-mint-400" }: { id: string | null; name: string; ring?: string }) {
  return id ? (
    <img src={avatarUrl(id)} alt="" className={`h-14 w-14 shrink-0 rounded-full ring-[3px] ${ring}`} />
  ) : (
    <div
      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink-700 text-lg font-bold text-ink-300 ring-[3px] ${ring}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/** Broadcast-style crawl of the week's headline facts. */
function Ticker({ a }: { a: Analysis }) {
  const gain = Math.round((a.optimalTotal - a.currentTotal) * 10) / 10;
  const items = [
    a.league.name,
    a.scoringLabel,
    waiverChip(a),
    a.warnings.length ? `${a.warnings.length} lineup alert${a.warnings.length === 1 ? "" : "s"}` : "Lineup set",
    gain > 0 ? `+${gain} with moves` : "Lineup optimal",
    a.waivers.length ? `${a.waivers.length} waiver target${a.waivers.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return (
    <div className="display flex h-9 items-stretch overflow-hidden border border-ink-700/80 bg-ink-900 text-sm font-semibold">
      <span className="flex shrink-0 items-center bg-hot px-4 pr-6 font-extrabold whitespace-nowrap text-white [clip-path:polygon(0_0,100%_0,85%_100%,0_100%)]">
        Prime time · Wk {a.week}
      </span>
      <div className="no-scrollbar flex items-center gap-6 overflow-x-auto pl-4 whitespace-nowrap text-ink-100">
        {items.map((t) => (
          <span key={t as string}>
            <span className="mr-1.5 text-hot">▸</span>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Scoreboard({ a }: { a: Analysis }) {
  const gain = Math.round((a.optimalTotal - a.currentTotal) * 10) / 10;
  const opp = a.opponent;
  const share = opp ? a.optimalTotal / Math.max(1, a.optimalTotal + opp.projected) : 0.5;
  return (
    <section className="overflow-hidden border border-ink-700/80 bg-gradient-to-b from-ink-800 to-ink-900 shadow-[0_0_48px_rgb(25_227_255/0.10)]">
      <div className="grid sm:grid-cols-[1fr_150px_1fr]">
        <div className="flex items-center gap-4 p-5">
          <Avatar id={a.avatar} name={a.teamName} />
          <div className="min-w-0">
            <div className="display truncate text-2xl leading-tight font-extrabold">{a.teamName}</div>
            <div className="text-xs text-ink-400">
              Current lineup {a.currentTotal.toFixed(1)}
              {gain > 0 && <span className="text-mint-300"> · +{gain} with moves</span>}
            </div>
          </div>
          <div className="glow ml-auto font-mono text-6xl leading-none font-black text-ink-100 tabular-nums sm:text-7xl">
            {a.optimalTotal.toFixed(1)}
          </div>
        </div>
        {opp ? (
          <>
            <div className="prime-gradient display flex items-center justify-center gap-3 py-2 text-ink-950 sm:flex-col sm:gap-0 sm:py-0 sm:[clip-path:polygon(14%_0,100%_0,86%_100%,0_100%)]">
              <span className="text-[11px] font-bold tracking-[0.14em]">Projected</span>
              <span className="font-mono text-3xl leading-none font-black sm:text-4xl">{Math.round(share * 100)}%</span>
              <span className="text-[11px] font-bold tracking-[0.14em]">Win share</span>
            </div>
            <div className="flex items-center gap-4 p-5 sm:flex-row-reverse sm:text-right">
              <Avatar id={opp.avatar} name={opp.teamName} ring="ring-hot" />
              <div className="min-w-0">
                <div className="display truncate text-2xl leading-tight font-extrabold">{opp.teamName}</div>
                <div className="text-xs text-ink-400">Opponent · projected</div>
              </div>
              <div className="glow-hot ml-auto font-mono text-6xl leading-none font-black text-rose-300 tabular-nums sm:mr-auto sm:ml-0 sm:text-7xl">
                {opp.projected.toFixed(1)}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center p-5 text-sm text-ink-400 sm:col-span-2 sm:justify-end">
            No head-to-head matchup this week.
          </div>
        )}
      </div>
      {opp && (
        <>
          <div className="flex h-2">
            <div
              className="prime-gradient shadow-[0_0_12px_rgb(25_227_255/0.6)]"
              style={{ width: `${share * 100}%` }}
            />
            <div className="flex-1 bg-hot" />
          </div>
          <div className="px-5 py-2.5 text-xs text-ink-400">
            {a.optimalTotal >= opp.projected
              ? `Projected to win by ${(a.optimalTotal - opp.projected).toFixed(1)} if you make the moves below.`
              : `Projected to lose by ${(opp.projected - a.optimalTotal).toFixed(1)} — the waiver tab may help close the gap.`}
          </div>
        </>
      )}
    </section>
  );
}

// --- Live -----------------------------------------------------------------

function LiveScoreboard({ a, live }: { a: Analysis; live: LiveState }) {
  const me = live.me;
  const opp = live.opponent;
  const win = live.winProbability;
  return (
    <section className="overflow-hidden border border-ink-700/80 bg-gradient-to-b from-ink-800 to-ink-900 shadow-[0_0_48px_rgb(255_46_136/0.12)]">
      <div className="grid sm:grid-cols-[1fr_150px_1fr]">
        <div className="flex items-center gap-4 p-5">
          <Avatar id={a.avatar} name={me.teamName} />
          <div className="min-w-0">
            <div className="display truncate text-2xl leading-tight font-extrabold">{me.teamName}</div>
            <div className="text-xs text-ink-400">
              {me.remaining > 0 ? `+${me.remaining} still to come · ` : ""}proj final {me.projectedFinal.toFixed(1)}
            </div>
          </div>
          <div className="glow ml-auto font-mono text-6xl leading-none font-black text-ink-100 tabular-nums sm:text-7xl">
            {me.score.toFixed(1)}
          </div>
        </div>
        {opp ? (
          <>
            <div className="prime-gradient display flex items-center justify-center gap-3 py-2 text-ink-950 sm:flex-col sm:gap-0 sm:py-0 sm:[clip-path:polygon(14%_0,100%_0,86%_100%,0_100%)]">
              <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em]">
                {!live.allDone && <span className="h-2 w-2 animate-pulse rounded-full bg-hot" />}
                {live.allDone ? "Final" : "Live"}
              </span>
              <span className="font-mono text-3xl leading-none font-black sm:text-4xl">
                {win === null ? "—" : `${Math.round(win * 100)}%`}
              </span>
              <span className="text-[11px] font-bold tracking-[0.14em]">{live.allDone ? "Result" : "Win prob"}</span>
            </div>
            <div className="flex items-center gap-4 p-5 sm:flex-row-reverse sm:text-right">
              <Avatar id={opp.avatar} name={opp.teamName} ring="ring-hot" />
              <div className="min-w-0">
                <div className="display truncate text-2xl leading-tight font-extrabold">{opp.teamName}</div>
                <div className="text-xs text-ink-400">
                  {opp.remaining > 0 ? `+${opp.remaining} still to come · ` : ""}proj final{" "}
                  {opp.projectedFinal.toFixed(1)}
                </div>
              </div>
              <div className="glow-hot ml-auto font-mono text-6xl leading-none font-black text-rose-300 tabular-nums sm:mr-auto sm:ml-0 sm:text-7xl">
                {opp.score.toFixed(1)}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center p-5 text-sm text-ink-400 sm:col-span-2 sm:justify-end">
            No head-to-head matchup this week.
          </div>
        )}
      </div>
      {opp && win !== null && (
        <>
          <div className="flex h-2">
            <div className="prime-gradient shadow-[0_0_12px_rgb(25_227_255/0.6)]" style={{ width: `${win * 100}%` }} />
            <div className="flex-1 bg-hot" />
          </div>
          <div className="flex flex-wrap justify-between gap-2 px-5 py-2.5 text-xs text-ink-400">
            <span>
              You: {me.playing} playing · {me.yetToPlay} yet to play — {opp.teamName}: {opp.playing} playing ·{" "}
              {opp.yetToPlay} yet to play
            </span>
            <span>
              Updated {new Date(live.asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {live.inProgress ? " · refreshes every minute" : ""}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/** Plays involving your (and your opponent's) starters, refreshed every 30s while games are on. */
function usePlayByPlay(a: Analysis, live: LiveState) {
  const [pbp, setPbp] = useState<PlayByPlay | null>(null);
  const [failed, setFailed] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fetchPlayByPlay(a, live);
        if (!alive) return;
        // Plays that arrived since the last refresh get a NEW tag (none on first load).
        const before = seen.current;
        setFresh(new Set(before ? next.events.filter((e) => !before.has(e.key)).map((e) => e.key) : []));
        seen.current = new Set(next.events.map((e) => e.key));
        setPbp(next);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
      if (alive && live.inProgress) timer = setTimeout(load, 30_000);
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [a, live]);
  return { pbp, failed, fresh };
}

const PLAY_CHIP: Record<PlayEvent["kind"], string> = {
  td: "bg-hot text-white",
  turnover: "bg-rose-500/20 text-rose-300",
  miss: "bg-rose-500/15 text-rose-300",
  big: "bg-mint-400/15 text-mint-300",
  normal: "bg-ink-700 text-ink-300",
};

function PlayFeed({
  pbp,
  failed,
  fresh,
  hasOpponent,
}: {
  pbp: PlayByPlay | null;
  failed: boolean;
  fresh: Set<string>;
  hasOpponent: boolean;
}) {
  const [filter, setFilter] = useState<"mine" | "opponent" | "all">("mine");
  const [showAll, setShowAll] = useState(false);
  const events = (pbp?.events ?? []).filter((e) => filter === "all" || e.side === filter);
  const shown = showAll ? events : events.slice(0, 25);
  return (
    <Card
      title="Play-by-play"
      action={
        hasOpponent ? (
          <div className="flex text-xs font-bold">
            {(
              [
                ["mine", "Yours"],
                ["opponent", "Opponent"],
                ["all", "All"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`display px-2.5 py-1 transition ${filter === id ? "bg-mint-400 text-ink-950" : "bg-ink-800 text-ink-400 hover:text-ink-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {!pbp ? (
        failed ? (
          <Empty>Couldn&apos;t reach ESPN&apos;s play-by-play. It&apos;ll retry shortly.</Empty>
        ) : (
          <div className="flex flex-col gap-2" aria-busy="true">
            <div className="skeleton h-12" />
            <div className="skeleton h-12" />
            <div className="skeleton h-12" />
          </div>
        )
      ) : events.length === 0 ? (
        <Empty>
          {filter === "opponent"
            ? "No plays from their starters yet."
            : "No plays yet — they'll show up here as soon as your players touch the ball."}
        </Empty>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-ink-700/60">
            {shown.map((e) => (
              <li
                key={e.key}
                className={`flex items-start gap-3 py-2.5 ${
                  e.kind === "td"
                    ? "-mx-4 border-l-4 border-hot bg-gradient-to-r from-hot/15 to-transparent px-3 sm:-mx-5 sm:px-4"
                    : ""
                }`}
              >
                <Headshot p={e.player} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{e.player.name}</span>
                    {e.side === "opponent" && (
                      <span className="display bg-rose-500/15 px-1.5 text-[10px] font-bold text-rose-300">OPP</span>
                    )}
                    <span className={`display px-2 py-0.5 text-[11px] font-extrabold uppercase ${PLAY_CHIP[e.kind]}`}>
                      {e.label}
                    </span>
                    {fresh.has(e.key) && (
                      <span className="animate-pulse text-[10px] font-black tracking-wider text-hot">NEW</span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{e.text}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`font-mono text-lg leading-none font-black tabular-nums ${
                      e.points > 0 ? "text-mint-400" : e.points < 0 ? "text-rose-300" : "text-ink-500"
                    }`}
                  >
                    {e.points > 0 ? "+" : ""}
                    {e.points.toFixed(1)}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold whitespace-nowrap text-ink-400">{e.clock}</div>
                  <div className="text-[10px] whitespace-nowrap text-ink-500">{e.matchup}</div>
                </div>
              </li>
            ))}
          </ul>
          {events.length > shown.length && (
            <button
              onClick={() => setShowAll(true)}
              className="display mt-3 w-full bg-ink-800 py-2 text-sm font-bold text-ink-300 hover:bg-ink-700"
            >
              Show all {events.length} plays
            </button>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-ink-400">
        From ESPN&apos;s live play-by-play, refreshed every 30 seconds while games are on. Points per play are estimated
        with your league&apos;s scoring; the totals above are Sleeper&apos;s official numbers.
        {pbp && pbp.unmatched.length > 0 && ` Couldn't find ${pbp.unmatched.join(", ")} in ESPN's data.`}
      </p>
    </Card>
  );
}

function LiveTab({ a, live }: { a: Analysis; live: LiveState }) {
  const { pbp, failed, fresh } = usePlayByPlay(a, live);
  // Each player's most recent play, for the lineup cards.
  const lastPlay = new Map<string, PlayEvent>();
  for (const e of pbp?.events ?? []) if (!lastPlay.has(e.player.id)) lastPlay.set(e.player.id, e);
  return (
    <div className="flex flex-col gap-5">
      {live.lateSwaps.length > 0 && (
        <div className="flex flex-col gap-2">
          {live.lateSwaps.map((s) => (
            <div
              key={s.out.id + s.in.id}
              className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-hot to-[#b5179e] px-4 py-3 text-sm font-semibold text-white"
            >
              <span className="display shrink-0 bg-ink-950 px-2 py-0.5 text-base font-black text-white">Late swap</span>
              <span>
                {s.freeAgent ? "Add free agent " : "Start "}
                <b>{s.in.name}</b> ({s.in.position}, {s.in.team}) {s.freeAgent ? "and start them " : ""}over{" "}
                <b>{s.out.name}</b> at {s.slot} — +{s.gain} projected. {s.reason}.
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <LiveRoster title="Your lineup" side={live.me} accent="mint" lastPlay={lastPlay} />
        {live.opponent && (
          <LiveRoster title={live.opponent.teamName} side={live.opponent} accent="hot" lastPlay={lastPlay} />
        )}
      </div>
      <PlayFeed pbp={pbp} failed={failed} fresh={fresh} hasOpponent={Boolean(live.opponent)} />
      <p className="text-xs text-ink-400">
        Points are Sleeper&apos;s live scoring. &quot;Still to come&quot; is each player&apos;s projection times the
        share of their game left; win probability assumes a typical player&apos;s score swings about ±60% of projection.
        Game clocks from{" "}
        {live.games.source === "espn"
          ? "ESPN"
          : live.games.source === "snapshot"
            ? "ESPN (saved copy)"
            : "Sleeper's schedule"}
        .
      </p>
    </div>
  );
}

function gameLabel(p: LivePlayer) {
  if (p.status === "bye") return "BYE";
  const g = p.game;
  if (!g) return "—";
  const opp = p.player?.team === g.home ? g.away : g.home;
  if (g.state === "pre") {
    const when = new Date(g.kickoff).toLocaleString(
      [],
      g.kickoffKnown ? { weekday: "short", hour: "numeric", minute: "2-digit" } : { weekday: "short" },
    );
    return `${when} vs ${opp}`;
  }
  const mine = p.player?.team === g.home ? g.homeScore : g.awayScore;
  const theirs = p.player?.team === g.home ? g.awayScore : g.homeScore;
  const score = mine !== null && theirs !== null ? ` · ${mine}-${theirs}` : "";
  return `${g.state === "post" ? "Final" : g.detail}${score} vs ${opp}`;
}

function LiveRoster({
  title,
  side,
  accent,
  lastPlay,
}: {
  title: string;
  side: LiveSide;
  accent: "mint" | "hot";
  lastPlay: Map<string, PlayEvent>;
}) {
  const max = Math.max(1, ...side.players.map((p) => p.points + p.remaining));
  return (
    <Card
      title={title}
      action={
        <span
          className={`font-mono text-xl font-black tabular-nums ${accent === "mint" ? "text-mint-400" : "text-rose-300"}`}
        >
          {side.score.toFixed(1)}
        </span>
      }
    >
      <ul className="flex flex-col divide-y divide-ink-700/60">
        {side.players.map((p, i) => (
          <li key={p.id + i} className="flex items-center gap-3 py-2.5">
            <SlotBadge slot={p.slot === "Superflex" ? "SUPER_FLEX" : p.slot === "Flex" ? "FLEX" : p.slot} />
            {p.player ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <PlayerLine p={p.player} size={34} />
                <div
                  className={`mt-1 ml-[46px] flex items-center gap-1.5 truncate text-[11px] font-semibold ${
                    p.status === "in" ? "text-hot" : "text-ink-400"
                  }`}
                >
                  {p.status === "in" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hot" />}
                  {gameLabel(p)}
                </div>
                {p.player && lastPlay.has(p.player.id) && (
                  <div className="mt-0.5 ml-[46px] truncate text-[11px] text-ink-300">
                    Last: {lastPlay.get(p.player.id)!.label}{" "}
                    <span className="text-ink-500">({lastPlay.get(p.player.id)!.clock})</span>
                  </div>
                )}
              </div>
            ) : (
              <span className="flex-1 text-sm text-ink-400 italic">{p.name}</span>
            )}
            <div className="w-20 shrink-0 text-right">
              <div className="font-mono text-2xl leading-none font-black tabular-nums">{p.points.toFixed(1)}</div>
              {p.remaining > 0 && (
                <div className="font-mono text-[11px] text-ink-400 tabular-nums">+{p.remaining.toFixed(1)} to come</div>
              )}
              <div className="mt-1 flex h-1 bg-ink-700">
                <div
                  className={accent === "mint" ? "bg-mint-400" : "bg-hot"}
                  style={{ width: `${(p.points / max) * 100}%` }}
                />
                <div className="bg-ink-400/40" style={{ width: `${(p.remaining / max) * 100}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
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
            {w.bid && (
              <>
                {" "}
                for <b>${w.bid.suggested}</b>
              </>
            )}
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
              className="flex items-center gap-3 bg-gradient-to-r from-hot to-[#b5179e] px-4 py-3 text-sm font-semibold text-white"
            >
              <span className="display shrink-0 bg-ink-950 px-2 py-0.5 text-base font-black text-white">Alert</span>
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
                        ? "border-ink-700 border-l-4 border-l-mint-400 bg-ink-850/40 opacity-55"
                        : "border-ink-700 border-l-4 border-l-violet bg-ink-850 hover:border-ink-600"
                    }`}
                  >
                    <span
                      className={`w-7 shrink-0 text-center font-mono text-4xl leading-none font-black ${
                        checked[t.id] ? "text-mint-400" : "glow text-mint-400"
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
        <QuickLink
          label="Recommended lineup"
          value={`${a.optimalLineup.length} starters`}
          onClick={() => goTo("lineup")}
        />
        <QuickLink label="Waiver targets" value={`${a.waivers.length} worth a claim`} onClick={() => goTo("waivers")} />
        <QuickLink label="Your roster" value={`${a.roster.length} players`} onClick={() => goTo("roster")} />
      </div>
    </div>
  );
}

function KindTag({ kind }: { kind: Task["kind"] }) {
  const style = {
    start: "bg-mint-400 text-ink-950",
    bench: "bg-ink-400 text-ink-950",
    add: "bg-ink-100 text-ink-950",
  }[kind];
  const label = { start: "Start", bench: "Bench", add: "Waiver" }[kind];
  return <span className={`display px-2 py-0.5 text-xs leading-none font-extrabold ${style}`}>{label}</span>;
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

      <GameLines a={a} />
    </div>
  );
}

function spreadText(spread: number | null) {
  if (spread === null) return "—";
  return spread === 0 ? "PK" : spread < 0 ? `${spread}` : `+${spread}`;
}

/** Vegas line and forecast for each of your starters' games. */
function GameLines({ a }: { a: Analysis }) {
  const starters = a.optimalLineup
    .map((s) => s.player)
    .filter(
      (p): p is PlayerAnalysis =>
        !!p?.game && !p.onBye && (p.game.implied !== null || (!p.game.indoor && !!p.game.weather)),
    );
  if (!starters.length) return null;
  return (
    <Card
      title="Vegas & weather"
      action={<span className="text-xs text-ink-400">team implied total · line · forecast</span>}
    >
      <ul className="flex flex-col divide-y divide-ink-700/60">
        {starters.map((p) => {
          const g = p.game!;
          const move = Math.round((g.factor - 1) * 100);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1 basis-56">
                <PlayerLine p={p} size={30} sub={<span className="text-xs text-ink-400">vs {g.opponent}</span>} />
              </div>
              <div className="flex w-full items-center gap-3 font-mono text-xs tabular-nums sm:w-auto sm:gap-4">
                <span className="w-12 text-right">
                  <span className="block text-[9px] tracking-wider text-ink-400 uppercase">Implied</span>
                  <span
                    className={
                      g.implied === null
                        ? "text-ink-400"
                        : g.implied >= 26
                          ? "font-bold text-mint-400"
                          : g.implied <= 19
                            ? "font-bold text-rose-300"
                            : ""
                    }
                  >
                    {g.implied?.toFixed(1) ?? "—"}
                  </span>
                </span>
                <span className="w-10 text-right">
                  <span className="block text-[9px] tracking-wider text-ink-400 uppercase">Line</span>
                  {spreadText(g.spread)}
                </span>
                <span className="w-10 text-right">
                  <span className="block text-[9px] tracking-wider text-ink-400 uppercase">O/U</span>
                  {g.overUnder ?? "—"}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-left font-sans text-ink-300 sm:w-32 sm:flex-none"
                  title={g.weather ?? ""}
                >
                  <span className="block font-mono text-[9px] tracking-wider text-ink-400 uppercase">Forecast</span>
                  {g.indoor ? "Indoors" : (g.weather ?? "—")}
                </span>
                <span
                  className={`w-10 text-right font-bold ${move >= 3 ? "text-mint-400" : move <= -3 ? "text-rose-300" : "text-ink-500"}`}
                  title={g.note ?? "No adjustment"}
                >
                  <span className="block text-[9px] font-normal tracking-wider text-ink-400 uppercase">Adj</span>
                  {move > 0 ? `+${move}%` : `${move}%`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-400">
        Projections are nudged a few percent for high or low implied totals, and down for passing games and kickers in
        snow, rain, wind or bitter cold (up for defenses). Lines and forecasts are from ESPN; lines come off the board
        once a game kicks off.
      </p>
    </Card>
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
              <article
                key={w.player.id}
                className="flex flex-col gap-3 rounded-xl border border-ink-700 bg-ink-850 p-4"
              >
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
                  <Stat label={`Last ${w.player.recentGames || 3}`} value={w.player.recentAvg?.toFixed(1) ?? "—"} />
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
            Your top claims will probably be gone before your turn. These are good fits for your team that teams ahead
            of you are less likely to take — put in claims for them too.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {a.backupTargets.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5"
              >
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
  return (
    <span className="rounded-full bg-mint-400/15 px-2 py-0.5 text-[11px] font-semibold text-mint-300">
      Likely available
    </span>
  );
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

const TRADE_VERDICT_STYLE: Record<TradeVerdict, string> = {
  Accept: "bg-mint-400 text-ink-950",
  "Lean accept": "bg-lime-400 text-ink-950",
  Counter: "bg-amber-400 text-ink-950",
  Decline: "bg-rose-500 text-white",
};

function PickList({
  players,
  selected,
  onToggle,
  tone,
}: {
  players: PlayerAnalysis[];
  selected: string[];
  onToggle: (id: string) => void;
  tone: "give" | "get";
}) {
  return (
    <ul className="no-scrollbar flex max-h-72 flex-col overflow-y-auto border border-ink-700">
      {players.map((p) => {
        const on = selected.includes(p.id);
        return (
          <li key={p.id}>
            <button
              onClick={() => onToggle(p.id)}
              className={`flex w-full items-center justify-between gap-2 border-b border-ink-700/60 px-3 py-2 text-left transition ${
                on ? (tone === "give" ? "bg-hot/15" : "bg-mint-400/15") : "hover:bg-ink-800"
              }`}
            >
              <PlayerLine p={p} size={28} />
              <span
                className={`display shrink-0 px-1.5 text-xs font-bold ${
                  on ? (tone === "give" ? "bg-hot text-white" : "bg-mint-400 text-ink-950") : "text-ink-400"
                }`}
              >
                {on ? (tone === "give" ? "Giving" : "Getting") : p.rosValue.toFixed(1)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Pick both sides of an offer you received and get a verdict. */
function TradeEvaluator({ a }: { a: Analysis }) {
  const [teamId, setTeamId] = useState<number>(a.otherTeams[0]?.rosterId ?? 0);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const team = a.otherTeams.find((t) => t.rosterId === teamId);
  const sortByValue = (ps: PlayerAnalysis[]) =>
    [...ps].filter((p) => p.position !== "DEF").sort((x, y) => y.rosValue - x.rosValue);
  const mine = sortByValue(a.activeRoster);
  const theirs = sortByValue(team?.players ?? []);
  const result = useMemo(() => {
    if (!team || !give.length || !get.length) return null;
    const pick = (ids: string[], pool: PlayerAnalysis[]) => pool.filter((p) => ids.includes(p.id));
    return evaluateTrade(a, team.rosterId, pick(give, mine), pick(get, theirs));
  }, [a, team, give, get, mine, theirs]);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Card
      title="Evaluate a trade offer"
      action={<span className="text-xs text-ink-400">tap players on each side</span>}
    >
      <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="display font-bold text-ink-300">Trading with</span>
        <select
          value={teamId}
          onChange={(e) => {
            setTeamId(Number(e.target.value));
            setGet([]);
          }}
          className="border border-ink-700 bg-ink-900 px-3 py-1.5 text-ink-100"
        >
          {a.otherTeams.map((t) => (
            <option key={t.rosterId} value={t.rosterId}>
              {t.teamName}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="display mb-1.5 text-sm font-bold text-rose-300">You give</div>
          <PickList players={mine} selected={give} onToggle={(id) => toggle(give, setGive, id)} tone="give" />
        </div>
        <div>
          <div className="display mb-1.5 text-sm font-bold text-mint-400">You get</div>
          <PickList players={theirs} selected={get} onToggle={(id) => toggle(get, setGet, id)} tone="get" />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-400">Numbers next to players are rest-of-season value (pts/week).</p>

      {result ? (
        <div className="mt-4 border border-ink-700 bg-ink-850 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`display -skew-x-12 px-3 py-1 text-xl font-black ${TRADE_VERDICT_STYLE[result.verdict]}`}>
              <span className="block skew-x-12">{result.verdict}</span>
            </span>
            <p className="min-w-0 flex-1 text-sm">{result.summary}</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Your lineup (pts/wk)" value={`${result.yourGain >= 0 ? "+" : ""}${result.yourGain}`} />
            <Stat label="Their lineup (pts/wk)" value={`${result.theirGain >= 0 ? "+" : ""}${result.theirGain}`} />
            <Stat label="Value out → in" value={`${result.marketGive} → ${result.marketGet}`} />
          </div>
          {result.ranks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {result.ranks.map((r) => (
                <span key={r.position} className="flex items-center gap-1.5 bg-ink-800 px-2 py-1">
                  <PosBadge pos={r.position} /> #{r.before} →{" "}
                  <b className={r.after < r.before ? "text-mint-400" : r.after > r.before ? "text-rose-300" : ""}>
                    #{r.after}
                  </b>
                  <span className="text-ink-400">of {result.teams}</span>
                </span>
              ))}
            </div>
          )}
          {result.theirGain < -1 && result.verdict !== "Decline" && (
            <p className="mt-3 text-xs text-ink-400">
              This deal hurts their lineup — if they offered it, take it before they reconsider.
            </p>
          )}
        </div>
      ) : (
        <Empty>Pick at least one player on each side to see a verdict.</Empty>
      )}
    </Card>
  );
}

function Trades({ a }: { a: Analysis }) {
  const report = useMemo(() => findTrades(a), [a]);
  const max = Math.max(1, ...report.strengths.map((s) => Math.max(s.value, s.leagueAverage)));
  return (
    <div className="flex flex-col gap-5">
      <TradeEvaluator a={a} />
      <Card
        title="Your team vs. the league"
        action={<span className="text-xs text-ink-400">rest-of-season starters</span>}
      >
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
          <Empty>
            No trade clearly helps both you and another team right now. Check back after this week&apos;s games.
          </Empty>
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
          Every idea improves both teams&apos; best lineups for the rest of the season (pts/week) and is roughly even on
          value over replacement, so it&apos;s worth proposing. Gains assume both teams start their best players.
        </p>
      </Card>
    </div>
  );
}

// --- Opponent scouting -----------------------------------------------------

function ScoutPlayer({ p, align }: { p: PlayerAnalysis | null; align: "left" | "right" }) {
  if (!p) return <span className={`text-xs text-ink-500 ${align === "right" ? "text-right" : ""}`}>Empty</span>;
  const flag = p.onBye ? "BYE" : p.injury ? p.injury.slice(0, 1) : null;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <span className="hidden sm:block">
        <Headshot p={p} size={30} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">
          {p.name}
          {flag && <span className="ml-1 rounded bg-rose-500/15 px-1 text-[10px] font-bold text-rose-300">{flag}</span>}
        </div>
        <div className="font-mono text-xs text-ink-400 tabular-nums">{p.weekScore.toFixed(1)}</div>
      </div>
    </div>
  );
}

function Scout({ a }: { a: Analysis }) {
  const { data: s, error } = useAsync<Scouting | null>(() => buildScouting(a), [a]);
  if (!a.opponent) return <Empty>No opponent this week (bye or playoffs).</Empty>;
  if (error) return <Empty>Couldn&apos;t load the scouting report: {error}</Empty>;
  if (!s) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-96 rounded-2xl" />
      </div>
    );
  }
  const t = s.tendencies;
  const maxEdge = Math.max(1, ...s.edges.map((e) => Math.abs(e.edge)));
  const asleep = s.theirBest - s.theirProjected;
  const rec = `${s.record.wins}-${s.record.losses}${s.record.ties ? `-${s.record.ties}` : ""}`;
  return (
    <div className="flex flex-col gap-5">
      <Card title="Scouting report">
        <div className="flex flex-wrap items-center gap-4">
          <TeamMark t={s} size={56} />
          <div className="min-w-0 flex-1">
            <div className="display truncate text-3xl leading-tight font-extrabold">{s.teamName}</div>
            <div className="text-xs text-ink-400">
              {rec} · {ordinal(s.standing)} in the standings · {ordinal(s.pointsForRank)} in points (
              {s.pointsFor.toFixed(0)})
            </div>
          </div>
        </div>
        {s.talk.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {s.talk.map((line) => (
              <li key={line} className="flex items-start gap-3 bg-hot/10 px-3 py-2 text-sm">
                <span className="display shrink-0 -skew-x-12 bg-hot px-2 py-0.5 text-xs font-black text-white">
                  <span className="inline-block skew-x-12">INTEL</span>
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Tale of the tape"
        action={
          <span className="font-mono text-sm font-semibold tabular-nums">
            <span className="text-mint-400">{s.yourProjected.toFixed(1)}</span>
            <span className="text-ink-500"> – </span>
            <span className="text-rose-300">{s.theirProjected.toFixed(1)}</span>
          </span>
        }
      >
        <div className="mb-2 grid grid-cols-[1fr_auto_1fr] gap-2 text-[10px] font-bold tracking-wider text-ink-400 uppercase">
          <span>You (best lineup)</span>
          <span />
          <span className="text-right">Them (as set)</span>
        </div>
        <ul className="flex flex-col divide-y divide-ink-700/60">
          {s.edges.map((e, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2">
              <ScoutPlayer p={e.mine} align="left" />
              <div className="flex w-16 flex-col items-center gap-1">
                <SlotBadge slot={e.slot} />
                <div className="flex h-1 w-full bg-ink-700">
                  <div className="flex w-1/2 justify-end">
                    {e.edge > 0 && (
                      <div className="h-full bg-mint-400" style={{ width: `${(e.edge / maxEdge) * 100}%` }} />
                    )}
                  </div>
                  <div className="w-1/2">
                    {e.edge < 0 && <div className="h-full bg-hot" style={{ width: `${(-e.edge / maxEdge) * 100}%` }} />}
                  </div>
                </div>
                <span
                  className={`font-mono text-[10px] font-bold tabular-nums ${e.edge > 0.5 ? "text-mint-400" : e.edge < -0.5 ? "text-hot" : "text-ink-500"}`}
                >
                  {e.edge > 0 ? `+${e.edge.toFixed(1)}` : e.edge.toFixed(1)}
                </span>
              </div>
              <ScoutPlayer p={e.theirs} align="right" />
            </li>
          ))}
        </ul>
        {asleep >= 3 && (
          <p className="mt-3 text-xs text-ink-400">
            Their lineup isn&apos;t set yet: their best possible lineup projects{" "}
            <b className="text-ink-200">{s.theirBest.toFixed(1)}</b>,{" "}
            {`${asleep.toFixed(1)} more than what's in there now. Plan for the better version.`}
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Weak spots">
          {s.weakSpots.length === 0 ? (
            <Empty>No holes — every starter is healthy and projected to play.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {s.weakSpots.map((w, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 border border-ink-700 bg-ink-850 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SlotBadge slot={w.slot} />
                    {w.player ? <PlayerLine p={w.player} size={28} /> : <span className="text-sm">Nobody</span>}
                  </div>
                  <span className="shrink-0 text-xs font-bold text-rose-300">{w.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Moves to expect">
          {s.moves.length === 0 ? (
            <Empty>Their lineup is already as good as it gets.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {s.moves.map((m) => (
                <li
                  key={m.in.id}
                  className="flex items-center justify-between gap-3 border border-ink-700 bg-ink-850 px-3 py-2"
                >
                  <div className="min-w-0">
                    <PlayerLine p={m.in} size={28} />
                    <div className="mt-0.5 ml-10 text-[11px] text-ink-400">
                      {m.kind === "pickup" ? "Free agent pickup" : "From their bench"}
                      {m.out ? ` · replaces ${m.out.name}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-bold text-hot tabular-nums">
                    +{m.gain.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Manager tendencies" action={<span className="text-xs text-ink-400">this season</span>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: "Bench pts left / wk",
              value: t.benchLeftPerWeek === null ? "—" : t.benchLeftPerWeek.toFixed(1),
            },
            { label: "Zero-point starts", value: String(t.zeroStarts) },
            {
              label: "Pickups · trades",
              value: `${t.waiverAdds + t.freeAgentAdds} · ${t.trades}`,
            },
            t.faabSpent !== null
              ? { label: "FAAB spent", value: `$${t.faabSpent}` }
              : {
                  label: "Last 3 wks avg",
                  value: t.recentAvg === null ? "—" : `${t.recentAvg.toFixed(1)}`,
                },
          ].map((x) => (
            <div key={x.label} className="border border-ink-700 bg-ink-850 px-3 py-2">
              <div className="text-[10px] font-bold tracking-wider text-ink-400 uppercase">{x.label}</div>
              <div className="font-mono text-xl font-bold tabular-nums">{x.value}</div>
            </div>
          ))}
        </div>
        {s.meetings.length > 0 && (
          <div className="mt-4 text-sm">
            <span className="text-xs font-bold tracking-wider text-ink-400 uppercase">Earlier this season · </span>
            {s.meetings.map((m) => (
              <span key={m.week} className="mr-3">
                Wk {m.week}:{" "}
                <b className={m.you > m.them ? "text-mint-400" : "text-rose-300"}>
                  {m.you > m.them ? "W" : "L"} {m.you.toFixed(1)}–{m.them.toFixed(1)}
                </b>
              </span>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-400">
          Bench points left = their best possible lineup in hindsight minus what they started, from Sleeper&apos;s
          weekly results{t.weeks ? ` (${t.weeks} weeks)` : ""}.
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
  const shown = relevant.length
    ? relevant
    : affected.some((h) => !["QB", "RB", "WR", "TE", "K", "DEF"].includes(h))
      ? w.byes
      : [];
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
  const stashes = [...plan.rows]
    .filter((r) => r.playoffPoints > 0)
    .sort((x, y) => y.playoffPoints - x.playoffPoints)
    .slice(0, 3);
  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Projected points by week"
        action={
          plan.playoffStart && <span className="text-xs text-ink-400">playoffs start week {plan.playoffStart}</span>
        }
      >
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
                {w.holes.length
                  ? `hole: ${w.holes.join(", ")}`
                  : w.thin.length
                    ? `thin: ${w.thin.join(", ")}`
                    : `${w.byes.length} on bye`}
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
                <ByeNote w={w} />.{" "}
                {w.holes.length > 0 && (
                  <span className="text-ink-300">
                    {w.week - 1 > a.week
                      ? `Pick someone up on week ${w.week - 1} waivers.`
                      : "Pick someone up this week."}
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
              <div
                key={r.player.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5"
              >
                <PlayerLine p={r.player} size={32} />
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold tabular-nums">{r.playoffPoints.toFixed(1)}</div>
                  <div className="text-[10px] text-ink-400">
                    wks {plan.playoffWeeks[0]}–{plan.playoffWeeks.at(-1)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Projected points across the fantasy playoffs — protect these players.
          </p>
        </Card>
      )}

      <Card title="Week-by-week projections">
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] tracking-wider text-ink-400 uppercase">
                <th className="sticky left-0 z-10 bg-ink-900 py-2 pr-2 pl-4 text-left font-semibold sm:pl-5">Player</th>
                {plan.weeks.map((w) => (
                  <th
                    key={w.week}
                    className={`px-1 py-2 text-center font-semibold ${w.playoff ? "text-mint-400" : ""}`}
                  >
                    {w.week}
                  </th>
                ))}
                {plan.playoffWeeks.length > 0 && (
                  <th className="px-2 py-2 text-right font-semibold text-mint-400">Playoffs</th>
                )}
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
                        <span className="block rounded bg-ink-700 px-1 py-1 text-center text-[9px] font-bold text-ink-400">
                          BYE
                        </span>
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
                    <td className="px-2 text-right font-mono font-semibold tabular-nums">
                      {r.playoffPoints.toFixed(0)}
                    </td>
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

// --- Playoff odds ---------------------------------------------------------

function TeamMark({ t, size = 28 }: { t: Pick<PlayoffTeam, "avatar" | "teamName">; size?: number }) {
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

function oddsTone(p: number) {
  return p >= 75 ? "text-mint-400" : p >= 40 ? "text-amber-300" : "text-rose-300";
}

const record = (t: PlayoffTeam) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`;

function Playoffs({ a }: { a: Analysis }) {
  const { data: odds, error } = useAsync<PlayoffOdds>(() => buildPlayoffOdds(a), [a]);
  if (error) return <Empty>Couldn&apos;t simulate the season: {error}</Empty>;
  if (!odds) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-80 rounded-2xl" />
      </div>
    );
  }
  const me = odds.me;
  const likelySeed = me.seedPct.indexOf(Math.max(...me.seedPct)) + 1;
  const leverage = [...odds.mustWin].sort((x, y) => y.ifWin - y.ifLose - (x.ifWin - x.ifLose));
  const topSwing = new Set(leverage.slice(0, 3).map((w) => w.week));
  const safe = odds.winsOutlook.find((w) => w.playoffPct >= 80 && w.chance > 0);
  const over = odds.remainingWeeks.length === 0;
  return (
    <div className="flex flex-col gap-5">
      <Card title="Your playoff odds">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-end gap-2">
            <span className={`glow font-mono text-7xl leading-none font-black tabular-nums ${oddsTone(me.playoffPct)}`}>
              {me.playoffPct >= 99.95
                ? "100"
                : me.playoffPct < 0.05
                  ? "0"
                  : me.playoffPct.toFixed(me.playoffPct < 10 ? 1 : 0)}
            </span>
            <span className="display pb-1 text-2xl font-bold text-ink-400">%</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Record", value: record(me) },
              { label: "Proj. wins", value: me.projectedWins.toFixed(1) },
              { label: "Likely seed", value: `#${likelySeed}` },
              odds.byes > 0
                ? { label: `Bye (top ${odds.byes})`, value: `${me.byePct.toFixed(0)}%` }
                : { label: "Points for", value: me.pointsFor.toFixed(0) },
            ].map((s) => (
              <div key={s.label} className="border border-ink-700 bg-ink-850 px-3 py-2">
                <div className="text-[10px] font-bold tracking-wider text-ink-400 uppercase">{s.label}</div>
                <div className="font-mono text-xl font-bold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-400">
          {over
            ? "The regular season is over — these are the final standings."
            : `${(10000).toLocaleString()} simulations of weeks ${odds.remainingWeeks[0]}–${odds.remainingWeeks.at(-1)} using the real schedule, each team's projected lineup strength and actual points so far. Top ${odds.playoffTeams} make it; ties broken on points for${odds.divisions ? ", division winners seeded first" : ""}${odds.medianGames ? "; includes the weekly game vs. the league median" : ""}.`}
          {safe && !over && (
            <>
              {" "}
              <b className="text-ink-200">
                {safe.wins} wins gets you in {safe.playoffPct.toFixed(0)}% of the time.
              </b>
            </>
          )}
        </p>
      </Card>

      {!over && odds.mustWin.length > 0 && (
        <Card
          title="Biggest games left"
          action={<span className="text-xs text-ink-400">playoff odds if you win / lose</span>}
        >
          <ul className="flex flex-col gap-2">
            {odds.mustWin.map((w) => {
              const swing = w.ifWin - w.ifLose;
              const hot = topSwing.has(w.week) && swing >= 5;
              return (
                <li
                  key={w.week}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 border px-3 py-2.5 text-sm ${
                    hot ? "border-hot/40 border-l-4 border-l-hot bg-hot/10" : "border-ink-700 bg-ink-850"
                  }`}
                >
                  <span className="display w-16 shrink-0 font-bold text-ink-300">Wk {w.week}</span>
                  <span className="min-w-0 flex-1 basis-[calc(100%-5rem)] truncate sm:basis-auto">
                    vs <b>{w.opponent ?? "TBD"}</b>
                    <span className="ml-2 text-xs text-ink-400">{w.winProbability.toFixed(0)}% to win</span>
                  </span>
                  <span className="ml-20 font-mono text-xs tabular-nums sm:ml-0">
                    <span className="text-mint-400">{w.ifWin.toFixed(0)}%</span>
                    <span className="text-ink-500"> / </span>
                    <span className="text-rose-300">{w.ifLose.toFixed(0)}%</span>
                  </span>
                  <span
                    className={`ml-auto w-20 shrink-0 text-right font-mono text-xs font-bold tabular-nums sm:ml-0 ${hot ? "text-hot" : "text-ink-400"}`}
                  >
                    {hot ? "MUST WIN" : `${swing.toFixed(0)}% swing`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!over && odds.winsOutlook.length > 1 && (
        <Card title="Wins you need">
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1">
            {odds.winsOutlook
              .filter((w) => w.chance >= 0.5)
              .map((w) => (
                <div key={w.wins} className="flex w-12 shrink-0 flex-col items-center gap-1">
                  <span className={`font-mono text-xs font-bold tabular-nums ${oddsTone(w.playoffPct)}`}>
                    {w.playoffPct.toFixed(0)}%
                  </span>
                  <div className="flex h-24 w-full items-end bg-ink-850">
                    <div
                      className={`w-full ${w.playoffPct >= 75 ? "bg-mint-400" : w.playoffPct >= 40 ? "bg-amber-300" : "bg-rose-400/70"}`}
                      style={{ height: `${Math.max(3, w.playoffPct)}%` }}
                    />
                  </div>
                  <span className="display text-sm font-bold">{w.wins}W</span>
                  <span className="text-[10px] text-ink-400">{w.chance.toFixed(0)}% likely</span>
                </div>
              ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Bar height = your playoff chance if you finish with that many wins. Below: how likely each finish is.
          </p>
        </Card>
      )}

      <Card title="League outlook">
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] tracking-wider text-ink-400 uppercase">
                <th className="py-2 pr-2 pl-4 text-left font-semibold sm:pl-5">Team</th>
                <th className="px-2 py-2 text-right font-semibold">Rec</th>
                <th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">PF</th>
                <th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">Pts/wk</th>
                <th className="px-2 py-2 text-right font-semibold">Proj W</th>
                {odds.byes > 0 && <th className="px-2 py-2 text-right font-semibold">Bye</th>}
                <th className="py-2 pr-4 pl-2 text-right font-semibold sm:pr-5">Playoffs</th>
              </tr>
            </thead>
            <tbody>
              {odds.teams.map((t, i) => (
                <tr
                  key={t.rosterId}
                  className={`border-t ${i === odds.playoffTeams ? "border-t-2 border-dashed border-t-hot/60" : "border-ink-700/60"} ${
                    t.rosterId === me.rosterId ? "bg-mint-400/10" : ""
                  }`}
                >
                  <td className="py-2 pr-2 pl-4 sm:pl-5">
                    <div className="flex min-w-0 items-center gap-2">
                      <TeamMark t={t} size={24} />
                      <span className={`truncate ${t.rosterId === me.rosterId ? "font-bold text-mint-400" : ""}`}>
                        {t.teamName}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{record(t)}</td>
                  <td className="hidden px-2 py-2 text-right font-mono text-ink-300 tabular-nums sm:table-cell">
                    {t.pointsFor.toFixed(0)}
                  </td>
                  <td className="hidden px-2 py-2 text-right font-mono text-ink-300 tabular-nums sm:table-cell">
                    {t.strength.toFixed(0)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{t.projectedWins.toFixed(1)}</td>
                  {odds.byes > 0 && (
                    <td className="px-2 py-2 text-right font-mono text-ink-300 tabular-nums">{t.byePct.toFixed(0)}%</td>
                  )}
                  <td className="py-2 pr-4 pl-2 sm:pr-5">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-16 overflow-hidden bg-ink-700 sm:block">
                        <div
                          className={
                            t.playoffPct >= 75
                              ? "h-full bg-mint-400"
                              : t.playoffPct >= 40
                                ? "h-full bg-amber-300"
                                : "h-full bg-rose-400/70"
                          }
                          style={{ width: `${t.playoffPct}%` }}
                        />
                      </div>
                      <span className={`w-12 text-right font-mono font-bold tabular-nums ${oddsTone(t.playoffPct)}`}>
                        {t.playoffPct >= 99.95
                          ? "100"
                          : t.playoffPct.toFixed(t.playoffPct < 10 && t.playoffPct > 0 ? 1 : 0)}
                        %
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Dashed line = playoff cut. Pts/wk is each team&apos;s projected weekly score for the rest of the season.
        </p>
      </Card>
    </div>
  );
}

// --- Track record ---------------------------------------------------------

function Record({ a }: { a: Analysis }) {
  const { data: r, error } = useAsync<TrackRecord>(() => buildTrackRecord(a), [a]);
  if (error) return <Empty>Couldn&apos;t load past weeks: {error}</Empty>;
  if (!r) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (r.weeks.length === 0) return <Empty>No completed weeks yet — check back after your first games.</Empty>;
  const diff = Math.round((r.totals.advisor - r.totals.yours) * 10) / 10;
  const pct = (x: number) => `${Math.round((x / Math.max(1, r.totals.best)) * 100)}%`;
  const max = Math.max(1, ...r.weeks.map((w) => Math.max(w.best, w.opponent ?? 0)));
  const extraWins = r.weeks.filter((w) => w.advisorWon && w.won === false).length;
  const lostWins = r.weeks.filter((w) => w.won && w.advisorWon === false).length;
  return (
    <div className="flex flex-col gap-5">
      {r.bestBall && (
        <div className="rounded-xl border border-pos-wr/30 bg-pos-wr/10 px-4 py-3 text-sm">
          Best-ball league: Sleeper already starts your best lineup, so there are no start/sit calls to grade.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <BigStat
          label="Start/sit calls right"
          value={r.calls ? `${r.hits}/${r.calls}` : "—"}
          sub={
            r.calls
              ? `${Math.round((r.hits / r.calls) * 100)}% when the advisor disagreed with you`
              : "The advisor agreed with every lineup you set"
          }
          tone={r.calls ? (r.hits / r.calls >= 0.55 ? "good" : r.hits / r.calls >= 0.45 ? "mid" : "bad") : "mid"}
        />
        <BigStat
          label="Advisor vs. your lineups"
          value={`${diff >= 0 ? "+" : ""}${diff} pts`}
          sub={`over ${r.weeks.length} week${r.weeks.length === 1 ? "" : "s"}${extraWins ? ` · ${extraWins} more win${extraWins === 1 ? "" : "s"}` : ""}${lostWins ? ` · ${lostWins} fewer win${lostWins === 1 ? "" : "s"}` : ""}`}
          tone={diff > 0 ? "good" : diff < 0 ? "bad" : "mid"}
        />
        <BigStat
          label="Share of max possible"
          value={`${pct(r.totals.yours)} → ${pct(r.totals.advisor)}`}
          sub="your lineups vs. the advisor's, against the best lineup in hindsight"
          tone="mid"
        />
      </div>

      <Card title="Week by week">
        <ul className="flex flex-col divide-y divide-ink-700/60">
          {[...r.weeks].reverse().map((w) => (
            <li key={w.week} className="py-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Week {w.week}</span>
                {w.won !== null && (
                  <span className="flex gap-1.5 text-[11px] font-semibold">
                    <span
                      className={`rounded-full px-2 py-0.5 ${w.won ? "bg-mint-400/15 text-mint-300" : "bg-rose-500/15 text-rose-300"}`}
                    >
                      You {w.won ? "won" : "lost"} vs {w.opponent?.toFixed(1)}
                    </span>
                    {w.advisorWon !== w.won && (
                      <span className="rounded-full bg-ink-700 px-2 py-0.5 text-ink-300">
                        Advisor lineup would have {w.advisorWon ? "won" : "lost"}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {[
                  { label: "You", v: w.yours, c: "bg-ink-300" },
                  { label: "Advisor", v: w.advisor, c: "bg-mint-400" },
                  { label: "Best", v: w.best, c: "bg-ink-600" },
                ].map((b) => (
                  <div key={b.label} className="flex items-center gap-3 text-xs">
                    <span className="w-14 shrink-0 text-ink-400">{b.label}</span>
                    <div className="relative h-2 flex-1 rounded-full bg-ink-800">
                      <div className={`h-full rounded-full ${b.c}`} style={{ width: `${(b.v / max) * 100}%` }} />
                      {w.opponent !== null && (
                        <div
                          className="absolute -top-0.5 h-3 w-0.5 rounded bg-rose-400"
                          style={{ left: `${(w.opponent / max) * 100}%` }}
                          title="Opponent"
                        />
                      )}
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono tabular-nums">{b.v.toFixed(1)}</span>
                  </div>
                ))}
              </div>
              {w.calls.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1">
                  {w.calls.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <span className={`font-bold ${c.hit ? "text-mint-400" : "text-rose-300"}`}>
                        {c.hit ? "✓" : "✗"}
                      </span>
                      <span className="text-ink-300">
                        Advisor: start <b className="text-ink-100">{c.advisor.name}</b> ({c.advisor.points}) over{" "}
                        <b className="text-ink-100">{c.yours.name}</b> ({c.yours.points})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-400">
          The advisor&apos;s lineup is rebuilt from Sleeper&apos;s pre-game projections for each week, using the roster
          you had then; points are what players actually scored. The red tick is your opponent&apos;s score. Excludes
          IDP slots.
        </p>
      </Card>
    </div>
  );
}

function BigStat({
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

const VERDICT_STYLE: Record<Verdict, { text: string; bar: string; chip: string }> = {
  Playing: { text: "text-mint-400", bar: "bg-mint-400", chip: "bg-mint-400 text-ink-950" },
  Likely: { text: "text-lime-400", bar: "bg-lime-400", chip: "bg-lime-400 text-ink-950" },
  "Toss-up": { text: "text-amber-300", bar: "bg-amber-400", chip: "bg-amber-400 text-ink-950" },
  Unlikely: { text: "text-rose-300", bar: "bg-rose-400", chip: "bg-rose-400 text-white" },
  Out: { text: "text-rose-400", bar: "bg-rose-500", chip: "bg-rose-500 text-white" },
  Bye: { text: "text-ink-400", bar: "bg-ink-600", chip: "bg-ink-600 text-ink-100" },
};

function timeAgo(ms: number) {
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function Injuries({ a }: { a: Analysis }) {
  const [refresh, setRefresh] = useState(0);
  const { data: r, error } = useAsync<InjuryReport>(() => buildInjuryReport(a), [a, refresh]);
  if (error) return <Empty>Couldn&apos;t load injury reports: {error}</Empty>;
  if (!r) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="skeleton h-24" />
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
    );
  }
  const myStarters = r.rows.filter((x) => x.side === "mine" && x.starter);
  const bench = r.rows.filter((x) => x.side === "mine" && !x.starter);
  const opp = r.rows.filter((x) => x.side === "opponent");
  const atRisk = myStarters.filter((x) => x.probability < 0.6).length;

  // Healthy bench fallback for an at-risk starter at the same position.
  const risky = new Set(r.rows.filter((x) => x.side === "mine" && x.probability < 0.85).map((x) => x.player.id));
  const starters = new Set(a.currentLineup.map((s) => s.player?.id));
  // Healthy bench player at the same position, else the best free agent.
  const pivot = (row: InjuryRow) => {
    const fits = (p: PlayerAnalysis) =>
      !risky.has(p.id) && p.weekScore > 0 && p.eligible.some((e) => row.player.eligible.includes(e));
    const fromBench = a.roster
      .filter((p) => !starters.has(p.id) && fits(p))
      .sort((x, y) => y.weekScore - x.weekScore)[0];
    if (fromBench) return { player: fromBench, freeAgent: false };
    const fa = row.player.eligible
      .flatMap((pos) => a.streamersByPosition[pos] ?? [])
      .filter((p) => fits(p) && !p.injury)
      .sort((x, y) => y.weekScore - x.weekScore)[0];
    return fa ? { player: fa, freeAgent: true } : undefined;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <BigStat
          label="Healthy starters"
          value={`${r.healthyStarters}/${r.totalStarters}`}
          sub="starters with no injury concern this week"
          tone={
            r.healthyStarters === r.totalStarters ? "good" : r.healthyStarters >= r.totalStarters - 1 ? "mid" : "bad"
          }
        />
        <BigStat
          label="Starters at risk"
          value={String(atRisk)}
          sub={atRisk ? "under 60% to play — have a backup ready" : "nobody in your lineup is in real doubt"}
          tone={atRisk ? "bad" : "good"}
        />
        <div className="flex flex-col justify-between gap-2 border border-ink-700/70 bg-ink-900 p-4">
          <div className="display text-[11px] font-bold tracking-wider text-ink-400">Sources</div>
          <div className="text-xs text-ink-300">
            Sleeper news feed
            {r.espnAvailable && r.espnAsOf
              ? ` + ESPN injury report (as of ${new Date(r.espnAsOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`
              : " (ESPN report unavailable right now)"}
          </div>
          <button
            onClick={() => setRefresh((n) => n + 1)}
            className="display self-start -skew-x-12 bg-ink-800 px-3 py-1 text-sm font-bold text-ink-100 hover:bg-ink-700"
          >
            <span className="block skew-x-12">↻ Refresh reports</span>
          </button>
        </div>
      </div>

      <InjurySection title="Your starters" rows={myStarters} pivot={pivot} empty="All your starters are healthy. ✅" />
      {bench.length > 0 && <InjurySection title="Your bench & IR" rows={bench} />}
      {a.opponent && (
        <InjurySection
          title={`${a.opponent.teamName}'s starters`}
          rows={opp}
          empty="Your opponent's lineup has no injury concerns."
        />
      )}
      <p className="text-xs text-ink-400">
        Play chances are rules of thumb from the official designation, this week&apos;s practice reports, news and
        Sleeper&apos;s projections — not a guarantee. Final word comes with inactives, 90 minutes before kickoff.
      </p>
    </div>
  );
}

function ArticleBox({ article: x }: { article: InjuryRow["article"] }) {
  const cta =
    x.kind === "article"
      ? `Read the full story on ${x.source}`
      : x.kind === "player-page"
        ? `Read it on ${x.source}`
        : "Search Google News";
  return (
    <a
      href={x.url}
      target="_blank"
      rel="noreferrer"
      className="group mt-3 block border-l-4 border-mint-400 bg-ink-900/70 px-3 py-2.5 transition hover:bg-ink-800"
    >
      <div className="flex items-center justify-between gap-3 text-[10px] font-bold tracking-wider text-ink-400 uppercase">
        <span>
          {x.kind === "search" ? (
            "No recent article"
          ) : (
            <>
              Latest update · {x.source}
              {x.published !== null && (
                <span className={x.stale ? "text-amber-300" : ""}> · {timeAgo(x.published)}</span>
              )}
            </>
          )}
        </span>
        <span className="text-mint-400" aria-hidden>
          ↗
        </span>
      </div>
      {x.kind !== "search" && (
        <div className="mt-1 text-sm leading-snug font-semibold text-ink-100 group-hover:text-mint-300">{x.title}</div>
      )}
      {x.summary && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-300">{x.summary}</p>}
      <div className="mt-1.5 text-[11px] font-bold text-mint-400 group-hover:underline">{cta} →</div>
    </a>
  );
}

function InjurySection({
  title,
  rows,
  pivot,
  empty,
}: {
  title: string;
  rows: InjuryRow[];
  pivot?: (r: InjuryRow) => { player: PlayerAnalysis; freeAgent: boolean } | undefined;
  empty?: string;
}) {
  return (
    <Card title={title} action={<span className="text-xs text-ink-400">{rows.length} on the report</span>}>
      {rows.length === 0 ? (
        <Empty>{empty ?? "Nothing to report."}</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const v = VERDICT_STYLE[r.verdict];
            const backup = pivot && r.probability < 0.6 && r.verdict !== "Bye" ? pivot(r) : undefined;
            return (
              <li key={r.player.id} className="border border-ink-700 bg-ink-850 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <PlayerLine
                    p={r.player}
                    sub={r.bodyPart ? <span className="text-ink-300">{r.bodyPart}</span> : undefined}
                  />
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className={`font-mono text-3xl leading-none font-black tabular-nums ${v.text}`}>
                        {r.verdict === "Bye" ? "—" : `${Math.round(r.probability * 100)}%`}
                      </div>
                      <div className="display text-[10px] font-bold tracking-wider text-ink-400">to play</div>
                    </div>
                    <span className={`display -skew-x-12 px-2.5 py-1 text-sm font-extrabold ${v.chip}`}>
                      <span className="block skew-x-12">{r.verdict}</span>
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-1.5 bg-ink-700">
                  <div className={`h-full ${v.bar}`} style={{ width: `${Math.max(2, r.probability * 100)}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {r.designation && (
                    <span className="display bg-ink-700 px-2 py-0.5 font-bold text-ink-100">{r.designation}</span>
                  )}
                  {r.practice.map((n) => (
                    <span
                      key={n.day}
                      title={`${n.day}: ${n.level}`}
                      className={`display px-2 py-0.5 font-bold ${
                        n.level === "Full"
                          ? "bg-mint-400/15 text-mint-300"
                          : n.level === "Limited"
                            ? "bg-amber-400/15 text-amber-300"
                            : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {n.day.slice(0, 3)} {n.level === "Limited" ? "LP" : n.level === "Full" ? "FP" : "DNP"}
                    </span>
                  ))}
                  {r.locked && (
                    <span className="display bg-ink-700 px-2 py-0.5 font-bold text-ink-300">🔒 Game started</span>
                  )}
                </div>
                {r.reasons.length > 0 && <p className="mt-2 text-xs text-ink-300">{r.reasons.join(" · ")}</p>}
                <ArticleBox article={r.article} />
                {backup && (
                  <p className="mt-2 text-xs font-semibold text-mint-300">
                    {r.verdict === "Out"
                      ? `Start ${backup.player.name} instead`
                      : `Backup plan: start ${backup.player.name}`}{" "}
                    ({backup.player.position}, {backup.player.weekScore.toFixed(1)} proj
                    {backup.freeAgent ? ", free agent — add them first" : ""})
                    {r.verdict === "Out" ? "." : ` if ${r.player.name.split(" ").slice(-1)[0]} is ruled out.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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
