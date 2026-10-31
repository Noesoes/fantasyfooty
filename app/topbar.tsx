"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

// Compact top bar for signed-in users: league, week and profile in one row.
// The league pill or the avatar opens a sheet to switch leagues, change the
// theme, install the app or switch accounts.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { analyzeLeague, type Analysis } from "@/lib/advisor";
import { glance, type LeagueGlance } from "@/lib/insights";
import { loadPrefs } from "@/lib/prefs";
import { avatarUrl, type League, type SleeperUser } from "@/lib/sleeper";
import { InstallButton } from "./install";
import { useDragToClose } from "./sheetdrag";
import { ThemeToggle } from "./theme";
import { clearLocalData, errorReport, readErrors } from "@/lib/errorlog";
import {
  CLAUDE_ASK_ENABLED,
  checkClaudeKey,
  CLAUDE_MODEL_NAME,
  getClaudeKey,
  KEY_EVENT,
  setClaudeKey,
} from "@/lib/claude";

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

// Glances survive closing the sheet, so reopening it is instant.
const glanceCache = new Map<string, LeagueGlance>();

/** Every league's matchup at a glance, analyzed one league at a time (the open one is reused). */
function useGlances(leagues: League[], userId: string, season: string, week: number, current: Analysis | null) {
  const [, bump] = useState(0);
  // The open league is already analyzed: use it right away.
  if (current && !glanceCache.has(`${current.league.league_id}:${current.week}`)) {
    glanceCache.set(`${current.league.league_id}:${current.week}`, glance(current));
  }
  useEffect(() => {
    let alive = true;
    // Three at a time: quick for a couple of leagues, polite to Sleeper for many.
    const queue = leagues.filter((l) => !glanceCache.has(`${l.league_id}:${week}`));
    const worker = async () => {
      for (let l = queue.shift(); l && alive; l = queue.shift()) {
        try {
          const a = await analyzeLeague({
            leagueId: l.league_id,
            userId,
            season,
            week,
            prefs: loadPrefs(l.league_id),
          });
          glanceCache.set(`${l.league_id}:${week}`, glance(a));
        } catch {
          // One league failing shouldn't stop the rest.
        }
        if (alive) bump((n) => n + 1);
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => {
      alive = false;
    };
  }, [leagues, userId, season, week, current]);
  return (leagueId: string) => glanceCache.get(`${leagueId}:${week}`);
}

function GlanceBadge({ g }: { g: LeagueGlance | undefined }) {
  if (!g) return <span className="skeleton h-9 w-14 shrink-0 rounded-xl" aria-label="Loading" />;
  const win = g.win;
  return (
    <span className="flex shrink-0 flex-col items-end">
      {win !== null ? (
        <span className={`font-mono text-lg leading-none font-black ${win >= 0.5 ? "text-mint-400" : "text-rose-400"}`}>
          {Math.round(win * 100)}%
        </span>
      ) : (
        <span className="text-xs font-bold text-ink-400">No game</span>
      )}
      <span className="mt-1 text-[11px] font-bold text-ink-400">
        {g.todo ? `${g.todo} to do` : "All set"}
        {g.trouble ? <span className="text-amber-300"> · {g.trouble} ⚠</span> : null}
      </span>
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
  season,
  week,
  current,
}: {
  leagues: League[];
  leagueId: string;
  setLeagueId: (id: string) => void;
  user: SleeperUser;
  onSignOut: () => void;
  onClose: () => void;
  season: string;
  week: number;
  current: Analysis | null;
}) {
  const glanceOf = useGlances(leagues, user.user_id, season, week, current);
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
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-black">Your leagues</h2>
            <span className="text-xs font-bold text-ink-400">Week {week} · win chance</span>
          </div>
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
                      {glanceOf(l.league_id)?.oppName && (
                        <span className="block truncate text-xs font-bold text-ink-300">
                          {glanceOf(l.league_id)!.me} vs {glanceOf(l.league_id)!.opp} · {glanceOf(l.league_id)!.oppName}
                        </span>
                      )}
                    </span>
                    <GlanceBadge g={glanceOf(l.league_id)} />
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
          {CLAUDE_ASK_ENABLED && <ClaudeKeyBox />}
          <PrivacyBox
            onCleared={() => {
              onClose();
              onSignOut();
            }}
          />
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

/**
 * Your own Anthropic API key, for Ask answered by Claude. Saved on this device
 * only; checked before saving.
 */
function ClaudeKeyBox() {
  const [saved, setSaved] = useState<string | null>(() => getClaudeKey());
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "invalid" | "offline">("idle");
  useEffect(() => {
    const sync = () => setSaved(getClaudeKey());
    window.addEventListener(KEY_EVENT, sync);
    return () => window.removeEventListener(KEY_EVENT, sync);
  }, []);
  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setStatus("checking");
    const result = await checkClaudeKey(key);
    if (result === "ok") {
      setClaudeKey(key);
      setDraft("");
      setStatus("idle");
    } else setStatus(result);
  };
  return (
    <details className="mt-4 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm" open={!saved || undefined}>
      <summary className="cursor-pointer font-extrabold">
        Claude for Ask{" "}
        <span className={`text-xs ${saved ? "text-mint-400" : "text-ink-400"}`}>{saved ? "· connected" : "· off"}</span>
      </summary>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-300">
        With your own Anthropic API key, Ask answers any question about your league with {CLAUDE_MODEL_NAME} (a fraction
        of a cent a question, billed to your Anthropic account). The key is saved on this device only and sent nowhere
        but Anthropic. Questions and the team data needed to answer them go to Anthropic too.
      </p>
      {saved ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-ink-300">Key …{saved.slice(-4)}</span>
          <button
            onClick={() => setClaudeKey(null)}
            className="rounded-full border border-ink-700 px-3 py-1.5 text-xs font-extrabold"
          >
            Remove key
          </button>
        </div>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setStatus("idle");
            }}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Anthropic API key"
            className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-[13px] focus:border-mint-400 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-mint-400"
            >
              Get a key ›
            </a>
            <button
              type="submit"
              disabled={!draft.trim() || status === "checking"}
              className="rounded-full bg-mint-400 px-4 py-1.5 text-xs font-black text-ink-950 disabled:opacity-40"
            >
              {status === "checking" ? "Checking…" : "Save key"}
            </button>
          </div>
          {status === "invalid" && (
            <p className="text-xs font-bold text-rose-400">That key was rejected. Copy it again from the Console.</p>
          )}
          {status === "offline" && (
            <p className="text-xs font-bold text-rose-400">
              Couldn&apos;t reach Anthropic to check the key. Try again.
            </p>
          )}
        </form>
      )}
    </details>
  );
}

/** What the app keeps (and doesn't), plus copy-error-log and clear-my-data. */
function PrivacyBox({ onCleared }: { onCleared: () => void }) {
  const [errors] = useState(() => readErrors().length);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <details className="mt-4 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-extrabold">Privacy &amp; data</summary>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-300">
        No account, no tracking, no server of ours: the app talks to Sleeper and ESPN directly from your phone, and
        reads only public league data. Your username, rules, checklists, pinned games and &ldquo;what changed&rdquo;
        snapshots are saved on this device only.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {errors > 0 && (
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(errorReport());
                setCopied(true);
              } catch {}
            }}
            className="rounded-full border border-ink-700 px-3 py-1.5 text-xs font-extrabold"
          >
            {copied ? "Copied" : `Copy error log (${errors})`}
          </button>
        )}
        <button
          onClick={() => {
            if (!confirm) return setConfirm(true);
            clearLocalData();
            onCleared();
          }}
          className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${confirm ? "bg-rose-400 text-ink-950" : "border border-ink-700 text-rose-300"}`}
        >
          {confirm ? "Tap again to erase" : "Clear my data on this device"}
        </button>
      </div>
    </details>
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
  season,
  analysis,
}: {
  user: SleeperUser;
  leagues: League[];
  leagueId: string;
  setLeagueId: (id: string) => void;
  week: number;
  setWeek: (w: number) => void;
  currentWeek: number;
  onSignOut: () => void;
  season: string;
  analysis: Analysis | null;
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
          season={season}
          week={week}
          current={analysis && analysis.week === week ? analysis : null}
        />
      )}
    </header>
  );
}
