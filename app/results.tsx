"use client";

// The app shell: sections, sub-tabs, the scoreboard and the bottom bar. Each screen lives in app/tabs/.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Analysis } from "@/lib/advisor";
import { GamesTab } from "./games";
import { PlayerSheetProvider } from "./playersheet";
import { Injuries } from "./tabs/injuries";
import { Lineup } from "./tabs/lineup";
import { LiveScoreboard, LiveTab, useLive } from "./tabs/live";
import { GamePlan } from "./tabs/plan";
import { Scoreboard } from "./tabs/scoreboard";
import { Scout } from "./tabs/scout";
import { Season } from "./tabs/season";
import type { Section, Tab } from "./tabs/shared";
import { Trades } from "./tabs/trades";
import { Waivers } from "./tabs/waivers";

// Four sections, each with a few sub-tabs. New features go into one of
// these rather than becoming another top-level tab.
const SECTIONS: { id: Section; label: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    id: "week",
    label: "Home",
    tabs: [
      { id: "plan", label: "Plan" },
      { id: "injuries", label: "Injuries" },
      { id: "scout", label: "Matchup" },
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
  { id: "games", label: "Games", tabs: [{ id: "games", label: "Games" }] },
  {
    id: "team",
    label: "Team",
    tabs: [
      { id: "lineup", label: "Lineup" },
      { id: "season", label: "Season" },
    ],
  },
];

const sectionOf = (tab: Tab): Section =>
  tab === "live" ? "week" : (SECTIONS.find((s) => s.tabs.some((t) => t.id === tab))?.id ?? "week");

const ALL_TABS = new Set<string>(["live", ...SECTIONS.flatMap((s) => s.tabs.map((t) => t.id))]);

// Tabs that were merged into others; old links and bookmarks land on the new home.
const MERGED: Partial<Record<Tab, Tab>> = {
  power: "season",
  playoffs: "season",
  league: "season",
  planner: "season",
  record: "lineup",
  roster: "lineup",
};

const tabFromHash = (h: string): Tab | null => {
  const t = (MERGED[h as Tab] ?? h) as Tab;
  return ALL_TABS.has(t) ? t : null;
};

function SectionIcon({ id, className = "h-5 w-5" }: { id: Section; className?: string }) {
  const paths: Record<Section, React.ReactNode> = {
    week: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
    moves: <path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" />,
    games: (
      <>
        <ellipse cx="12" cy="12" rx="9" ry="6" transform="rotate(-35 12 12)" />
        <path d="M9.5 14.5l5-5M10.5 11l2.5 2.5M12 9.5l2.5 2.5" />
      </>
    ),
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
      className={`ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 font-mono text-[11px] leading-[1.1rem] font-bold ${
        active ? "bg-ink-950/20 text-ink-950" : "bg-hot text-ink-950"
      }`}
    >
      {n}
    </span>
  );
}

export function Results({ a, onRefresh, refreshing }: { a: Analysis; onRefresh: () => void; refreshing: boolean }) {
  // The open sub-tab lives in the URL hash, so refresh and the back button keep your place.
  const [initial] = useState<Tab | null>(() => {
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    return tabFromHash(h);
  });
  const [tab, setTabState] = useState<Tab>(initial && initial !== "live" ? initial : "plan");
  useEffect(() => {
    // An old link to a merged tab (#injuries, #playoffs…): point the URL at its new home.
    if (initial && location.hash.slice(1) !== initial) {
      try {
        history.replaceState(null, "", `#${initial}`);
      } catch {
        // not fatal
      }
    }
  }, [initial]);
  const [lastTab, setLastTab] = useState<Partial<Record<Section, Tab>>>({});
  const top = useRef<HTMLDivElement>(null);
  // Jump to the Live tab the first time we see games underway — unless the
  // URL already says where you were (e.g. after a refresh).
  const [autoSwitched, setAutoSwitched] = useState(initial !== null && initial !== "live");
  const setTab = (to: Tab) => {
    const next = MERGED[to] ?? to;
    setTabState(next);
    // You picked a tab: don't yank you to Live when live scores arrive.
    setAutoSwitched(true);
    setLastTab((prev) => ({ ...prev, [sectionOf(next)]: next }));
    try {
      history.replaceState(null, "", `#${next}`);
    } catch {
      // not fatal
    }
    // Bring the new view's top into sight if we were scrolled down the old one. On phones the
    // page scrolls inside #scroller rather than the window.
    const scroller = document.getElementById("scroller");
    const inner = scroller && getComputedStyle(scroller).overflowY === "auto";
    const edge = inner ? scroller.getBoundingClientRect().top : 0;
    if (top.current && top.current.getBoundingClientRect().top < edge) top.current.scrollIntoView({ block: "start" });
  };
  // Where the phone section bar renders (below the scrolling area, see page.tsx).
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the slot exists only in the DOM
    setNavSlot(document.getElementById("bottom-nav-slot"));
  }, []);
  const live = useLive(a);
  const isLive = Boolean(live?.started && !live.allDone);
  const showLive = Boolean(live?.started);
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
    <PlayerSheetProvider a={a}>
      <div className="mt-4 flex flex-col gap-4">
        {section === "week" && (live && showLive ? <LiveScoreboard a={a} live={live} /> : <Scoreboard a={a} />)}
        <div ref={top} className="-mb-4 scroll-mt-0" />
        <nav className="glass sticky top-0 z-20 -mx-4 bg-ink-950/75 px-4 pt-2 pb-2 sm:mx-0 sm:px-0">
          {/* Sections: top bar on desktop (bottom bar on phones, below). */}
          <div className="mb-2 hidden gap-1 rounded-xl bg-ink-900 p-1 sm:flex">
            {SECTIONS.map((x) => (
              <button
                key={x.id}
                onClick={() => openSection(x.id)}
                aria-current={section === x.id ? "page" : undefined}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
                  section === x.id ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-100"
                }`}
              >
                <SectionIcon id={x.id} className="h-[18px] w-[18px]" />
                {x.label}
                {x.id === "week" && isLive && <span className="h-2 w-2 animate-pulse rounded-full bg-hot" />}
                <Badge n={sectionCount(x.id)} />
              </button>
            ))}
          </div>
          {/* Sub-tabs for the open section, as a segmented control. */}
          {tabs.length > 1 && (
            <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-ink-900 p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={`flex shrink-0 grow items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition ${
                    tab === t.id
                      ? t.id === "live"
                        ? "bg-hot/15 text-hot"
                        : "bg-ink-800 text-ink-100 shadow-sm"
                      : "text-ink-400 hover:text-ink-100"
                  }`}
                >
                  {t.label}
                  <Badge n={counts[t.id] ?? 0} />
                </button>
              ))}
            </div>
          )}
        </nav>
        {tab === "live" && live && <LiveTab live={live} />}
        {tab === "plan" && <GamePlan a={a} goTo={setTab} />}
        {tab === "games" && <GamesTab a={a} />}
        {tab === "lineup" && <Lineup a={a} />}
        {tab === "waivers" && <Waivers a={a} onRefresh={onRefresh} refreshing={refreshing} />}
        {tab === "trades" && <Trades a={a} />}
        {tab === "scout" && <Scout a={a} />}
        {tab === "injuries" && <Injuries a={a} />}
        {tab === "season" && <Season a={a} />}

        {/* Phone: sections in a thumb-reach bar under the scrolling area. */}
        {navSlot &&
          createPortal(
            <nav className="px-3 pt-1" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
              <div className="glass mx-auto flex max-w-md rounded-[30px] border border-ink-700 bg-ink-900 px-1">
                {SECTIONS.map((x) => (
                  <button
                    key={x.id}
                    onClick={() => openSection(x.id)}
                    aria-current={section === x.id ? "page" : undefined}
                    className={`relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-1.5 transition ${
                      section === x.id ? "text-ink-100" : "text-ink-500"
                    }`}
                  >
                    <span className="relative">
                      <SectionIcon id={x.id} className={`h-6 w-6 ${section === x.id ? "text-mint-400" : ""}`} />
                      {x.id === "week" && isLive ? (
                        <span className="absolute -top-0.5 -right-1 h-2.5 w-2.5 animate-pulse rounded-full bg-hot ring-2 ring-ink-900" />
                      ) : (
                        sectionCount(x.id) > 0 && (
                          <span className="absolute -top-1.5 -right-2.5 min-w-[1.1rem] rounded-full bg-hot px-1 text-center font-mono text-[10px] leading-[1.1rem] font-bold text-ink-950">
                            {sectionCount(x.id)}
                          </span>
                        )
                      )}
                    </span>
                    <span className="text-[10.5px] font-semibold">{x.label}</span>
                  </button>
                ))}
              </div>
            </nav>,
            navSlot,
          )}
      </div>
    </PlayerSheetProvider>
  );
}
