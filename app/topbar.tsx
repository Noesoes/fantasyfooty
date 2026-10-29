"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

// Compact top bar for signed-in users: league, week and profile in one row.
// The league pill or the avatar opens a sheet to switch leagues, change the
// theme, install the app or switch accounts.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { avatarUrl, type League, type SleeperUser } from "@/lib/sleeper";
import { InstallButton } from "./install";
import { useDragToClose } from "./sheetdrag";
import { ThemeToggle } from "./theme";

function scoringOf(l: League) {
  const rec = l.scoring_settings.rec ?? 0;
  return rec >= 1 ? "PPR" : rec >= 0.5 ? "Half PPR" : "Std";
}

/** League name without emoji decorations, for the small pill. */
function shortName(name: string) {
  const plain = name.replace(/[\p{Extended_Pictographic}️]/gu, "").trim();
  return plain || name;
}

function LeagueAvatar({ l, size = 30 }: { l: League; size?: number }) {
  return l.avatar ? (
    <img
      src={avatarUrl(l.avatar)}
      alt=""
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-ink-700 text-sm font-black"
      style={{ width: size, height: size }}
    >
      {shortName(l.name).charAt(0)}
    </span>
  );
}

function MenuSheet({
  leagues,
  leagueId,
  setLeagueId,
  user,
  onSignOut,
  onClose,
}: {
  leagues: League[];
  leagueId: string;
  setLeagueId: (id: string) => void;
  user: SleeperUser;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const { handlers, style, pulled } = useDragToClose(onClose, scroll);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Leagues and settings"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        style={{ opacity: 1 - pulled * 0.7 }}
      />
      <div
        {...handlers}
        className="glass relative flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-ink-700 bg-ink-950/85 shadow-2xl sm:rounded-3xl"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))", ...style }}
      >
        <div data-sheet-handle className="flex shrink-0 justify-center pt-3 pb-2">
          <span className="h-1.5 w-10 rounded-full bg-ink-600" />
        </div>
        <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
          <h2 className="mb-3 text-xl font-black">Your leagues</h2>
          <ul className="flex flex-col gap-2">
            {leagues.map((l) => {
              const active = l.league_id === leagueId;
              return (
                <li key={l.league_id}>
                  <button
                    onClick={() => {
                      setLeagueId(l.league_id);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                      active ? "border-mint-400 bg-ink-900" : "border-ink-700 bg-ink-900 hover:bg-ink-800"
                    }`}
                  >
                    <LeagueAvatar l={l} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-extrabold">{l.name}</span>
                      <span className="block text-xs font-bold text-ink-400">
                        {l.total_rosters} teams · {scoringOf(l)}
                        {l.roster_positions.includes("SUPER_FLEX") ? " · SF" : ""}
                      </span>
                    </span>
                    {active && <span className="text-sm font-black text-mint-400">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex gap-2">
            <ThemeToggle labeled />
            <button
              onClick={() => {
                onClose();
                onSignOut();
              }}
              className="flex flex-1 items-center justify-center rounded-2xl border border-ink-700 bg-ink-900 px-3 py-3 text-sm font-extrabold"
            >
              Switch account
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-ink-400">
            <span className="truncate">Signed in as {user.display_name}</span>
            <InstallButton />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CompactBar({
  user,
  leagues,
  leagueId,
  setLeagueId,
  week,
  setWeek,
  currentWeek,
  onSignOut,
}: {
  user: SleeperUser;
  leagues: League[];
  leagueId: string;
  setLeagueId: (id: string) => void;
  week: number;
  setWeek: (w: number) => void;
  currentWeek: number;
  onSignOut: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const league = leagues.find((l) => l.league_id === leagueId);
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 pt-3 pb-1">
      <button
        onClick={() => setMenu(true)}
        className="flex min-w-0 items-center gap-2 rounded-full border border-ink-700 bg-ink-900 py-1 pr-3 pl-1 transition hover:bg-ink-800"
        aria-label="Switch league"
      >
        {league ? <LeagueAvatar l={league} /> : <span className="h-[30px] w-[30px] rounded-full bg-ink-700" />}
        <span className="truncate text-[14.5px] font-extrabold">
          {league ? shortName(league.name) : "Pick a league"}
        </span>
        <span className="shrink-0 text-xs text-ink-400">▾</span>
      </button>
      <div className="flex shrink-0 items-center rounded-full border border-ink-700 bg-ink-900 text-sm font-extrabold">
        <button
          aria-label="Previous week"
          disabled={week <= 1}
          onClick={() => setWeek(week - 1)}
          className="py-1.5 pr-1 pl-3 text-ink-300 disabled:opacity-30"
        >
          ‹
        </button>
        <span className="px-1 whitespace-nowrap" title={week === currentWeek ? "This week" : undefined}>
          Wk {week}
          {week === currentWeek && (
            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-mint-400 align-middle" />
          )}
        </span>
        <button
          aria-label="Next week"
          disabled={week >= 18}
          onClick={() => setWeek(week + 1)}
          className="py-1.5 pr-3 pl-1 text-ink-300 disabled:opacity-30"
        >
          ›
        </button>
      </div>
      <button
        onClick={() => setMenu(true)}
        aria-label="Settings and account"
        className="ml-auto shrink-0 rounded-full border-2 border-ink-600"
      >
        {user.avatar ? (
          <img src={avatarUrl(user.avatar)} alt="" className="h-9 w-9 rounded-full" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 text-sm font-black">
            {user.display_name.charAt(0).toUpperCase()}
          </span>
        )}
      </button>
      {menu && (
        <MenuSheet
          leagues={leagues}
          leagueId={leagueId}
          setLeagueId={setLeagueId}
          user={user}
          onSignOut={onSignOut}
          onClose={() => setMenu(false)}
        />
      )}
    </header>
  );
}
