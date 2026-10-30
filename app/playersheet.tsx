"use client";

// Player sheet: tap any of your players to see this week's call (start,
// bench or out) and why, the defense he faces, the game environment, his
// workload (snaps, touches, carry and target share), and your rules for him.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { factorsFor, type Tone } from "@/lib/explain";
import { isNoDrop, isNoTrade } from "@/lib/prefs";
import { PlayerSheetContext, useOpenPlayer } from "./playerctx";
import { PlayerHighlights } from "./clipsui";
import { useRules } from "./rules";
import { useDragToClose } from "./sheetdrag";
import { teamColor } from "@/lib/teamcolors";
import { Headshot, InjuryTag, PosBadge } from "./ui";

const OUT = new Set(["Out", "IR", "PUP", "Sus", "NA", "DNR", "COV", "NFI"]);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const last = (name: string) => name.split(" ").slice(-1)[0];
const posWord = (pos: string) => (pos === "DEF" ? "D/STs" : pos === "K" ? "kickers" : `${pos}s`);
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

interface Verdict {
  label: string;
  detail: string;
  tone: Tone;
}

/** This week's call for a player on your roster, and the short reason. */
function weekVerdict(a: Analysis, p: PlayerAnalysis): Verdict {
  if (p.onBye) return { label: "Sit — on bye", detail: `No game in week ${a.week}.`, tone: "bad" };
  if (p.injury && OUT.has(p.injury))
    return { label: `Sit — ruled ${p.injury}`, detail: "He won't play this week.", tone: "bad" };
  const mine = a.roster.some((x) => x.id === p.id);
  const g = p.matchup?.grade;
  const spot =
    g === "great" || g === "good"
      ? "a good matchup"
      : g === "tough" || g === "brutal"
        ? "a tough matchup"
        : "a neutral matchup";
  if (!mine) {
    return {
      label: `Projects ${p.weekScore} pts`,
      detail: p.matchup ? `Faces ${spot} vs ${p.matchup.opponent}.` : "",
      tone: g === "great" || g === "good" ? "good" : g === "tough" || g === "brutal" ? "bad" : "neutral",
    };
  }
  const slot = a.optimalLineup.find((s) => s.player?.id === p.id);
  if (slot) {
    const chance =
      p.playChance !== null && p.playChance < 0.85
        ? ` He's only ~${pct(p.playChance)} to play — have a backup ready.`
        : "";
    return {
      label: `Start at ${slot.slot === "SUPER_FLEX" ? "Superflex" : slot.slot === "FLEX" ? "Flex" : slot.slot}`,
      detail: `One of your best ${slot.slot === "FLEX" || slot.slot === "SUPER_FLEX" ? "options" : posWord(p.position)} this week (${p.weekScore} pts) with ${spot}.${chance}`,
      tone: chance ? "neutral" : "good",
    };
  }
  // Benched: who's ahead of him at a spot he could fill.
  const ahead = a.optimalLineup
    .filter((s) => s.player && s.player.eligible.some((e) => p.eligible.includes(e)))
    .map((s) => s.player!)
    .sort((x, y) => x.weekScore - y.weekScore)[0];
  return {
    label: "Bench",
    detail: ahead
      ? `${ahead.name} projects more (${ahead.weekScore} vs ${p.weekScore}). He faces ${spot}.`
      : `Projects ${p.weekScore} pts with ${spot}.`,
    tone: "neutral",
  };
}

const TONE_TEXT: Record<Tone, string> = { good: "text-mint-400", bad: "text-rose-400", neutral: "text-ink-100" };
const TONE_BOX: Record<Tone, string> = {
  good: "bg-mint-400/10 ring-mint-400/30",
  bad: "bg-rose-500/10 ring-rose-400/30",
  neutral: "bg-ink-800 ring-ink-700",
};
const TONE_DOT: Record<Tone, string> = { good: "bg-mint-400", bad: "bg-rose-400", neutral: "bg-ink-500" };

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[15px] font-bold">{title}</h3>
        {right && <span className="text-xs text-ink-400">{right}</span>}
      </div>
      {children}
    </section>
  );
}

/** Usage as a ring: share of snaps, carries or targets (or a scaled count). */
function UsageRing({ label, value, color, text }: { label: string; value: number; color: string; text?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${color} 0 ${pct}%, var(--color-ink-700) ${pct}% 100%)` }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-950/85 font-mono text-[15px] font-black">
          {text ?? `${pct}%`}
        </div>
      </div>
      <span className="text-[11px] font-bold text-ink-300">{label}</span>
    </div>
  );
}

function Stat({ value, label, tone = "neutral" }: { value: string; label: string; tone?: Tone }) {
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900 px-2 py-3 text-center">
      <div className={`font-mono text-xl font-extrabold ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="text-[11px] text-ink-400">{label}</div>
    </div>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center justify-between rounded-xl bg-ink-800 px-3.5 py-3 text-left text-sm font-semibold"
    >
      {label}
      <span className={`relative h-7 w-12 rounded-full transition ${on ? "bg-mint-400" : "bg-ink-600"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function SheetBody({ a, p }: { a: Analysis; p: PlayerAnalysis }) {
  const { prefs, setRule } = useRules();
  const mine = a.roster.some((x) => x.id === p.id);
  const v = weekVerdict(a, p);
  const m = p.matchup;
  const u = p.usage;
  const g = p.game;
  const reasons = factorsFor(p).filter((f) => !["proj", "total"].includes(f.key));
  const slot = a.optimalLineup.find((s) => s.player?.id === p.id)?.slot;
  const status = !mine
    ? a.opponent?.starters.some((x) => x.id === p.id)
      ? "Opponent's starter"
      : "Not on your team"
    : slot
      ? "Starter"
      : "Bench";
  const backupFor = prefs[p.id]?.backupFor ? a.roster.find((x) => x.id === prefs[p.id]?.backupFor)?.name : null;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <span className="rounded-full border-4 border-white/25">
          <Headshot p={p} size={96} />
        </span>
        <div className="mt-2 text-[26px] leading-tight font-black tracking-tight">{p.name}</div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-sm font-semibold text-ink-300">
          <PosBadge pos={p.position} />
          <span>{p.team ?? "FA"}</span>
          {p.matchup && <span>· vs {p.matchup.opponent}</span>}
          <span>· {status}</span>
          {p.injury && <InjuryTag status={p.injury} />}
        </div>
        {backupFor && <div className="mt-1 text-xs font-bold text-violet">Your backup for {backupFor}</div>}
      </div>

      {/* This week's call */}
      <div className={`mt-4 rounded-2xl p-4 ring-1 ${TONE_BOX[v.tone]}`}>
        <div className={`text-lg font-extrabold ${TONE_TEXT[v.tone]}`}>{v.label}</div>
        {v.detail && <p className="mt-1 text-sm leading-relaxed text-ink-300">{v.detail}</p>}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat value={p.onBye ? "BYE" : p.weekScore.toFixed(1)} label={`Week ${a.week}`} />
        <Stat value={p.seasonAvg?.toFixed(1) ?? "—"} label="Season avg" />
        <Stat
          value={p.recentAvg?.toFixed(1) ?? "—"}
          label={`Last ${p.recentGames || 3}`}
          tone={
            p.recentAvg !== null && p.seasonAvg
              ? p.recentAvg >= p.seasonAvg * 1.15
                ? "good"
                : p.recentAvg <= p.seasonAvg * 0.85
                  ? "bad"
                  : "neutral"
              : "neutral"
          }
        />
      </div>

      <PlayerHighlights a={a} p={p} />

      {/* The defense */}
      {m && (
        <Section title={`vs ${m.opponent} defense`} right={`${m.teams} defenses ranked`}>
          <div className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm text-ink-300">
                Allows the{" "}
                <b className="text-ink-100">
                  {m.rank === m.teams
                    ? "most"
                    : m.rank === 1
                      ? "fewest"
                      : m.teams - m.rank + 1 <= m.teams / 2
                        ? `${ordinal(m.teams - m.rank + 1)}-most`
                        : `${ordinal(m.rank)}-fewest`}
                </b>{" "}
                pts to {posWord(p.position)}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                  m.grade === "great" || m.grade === "good"
                    ? "bg-mint-400/15 text-mint-400"
                    : m.grade === "tough" || m.grade === "brutal"
                      ? "bg-rose-500/15 text-rose-400"
                      : "bg-ink-700 text-ink-300"
                }`}
              >
                {m.grade === "great"
                  ? "Smash spot"
                  : m.grade === "good"
                    ? "Good spot"
                    : m.grade === "neutral"
                      ? "Neutral"
                      : m.grade === "tough"
                        ? "Tough"
                        : "Avoid"}
              </span>
            </div>
            {/* Toughest on the left, easiest on the right. */}
            <div className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-rose-400/70 via-ink-600 to-mint-400/80">
              <span
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900 bg-white"
                style={{ left: `${((m.rank - 1) / Math.max(1, m.teams - 1)) * 100}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-ink-500">
              <span>Toughest</span>
              <span>Easiest</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-ink-900 py-2">
                <div className="font-mono text-lg font-bold">{m.allowed}</div>
                <div className="text-[11px] text-ink-400">pts/g they allow</div>
              </div>
              <div className="rounded-xl bg-ink-900 py-2">
                <div className="font-mono text-lg font-bold text-ink-300">{m.average}</div>
                <div className="text-[11px] text-ink-400">league average</div>
              </div>
            </div>
            {g && (g.implied !== null || g.weather) && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-700 pt-3 text-xs text-ink-300">
                {g.implied !== null && (
                  <span>
                    {p.team} implied <b className="text-ink-100">{g.implied}</b> pts
                  </span>
                )}
                {g.spread !== null && g.spread !== 0 && (
                  <span>{g.spread < 0 ? `Favored by ${-g.spread}` : `${g.spread}-pt underdog`}</span>
                )}
                {g.overUnder !== null && <span>O/U {g.overUnder}</span>}
                {g.indoor ? <span>Indoors</span> : g.weather && <span>{g.weather}</span>}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Workload */}
      {(u || p.snapShare !== null) && p.position !== "K" && p.position !== "DEF" && (
        <Section title="Workload" right={`last ${p.recentGames || 3} games`}>
          <div className="flex flex-col gap-4 rounded-2xl border border-ink-700 bg-ink-900 p-4">
            <div className="flex justify-around">
              {p.snapShare !== null && <UsageRing label="Snaps" value={p.snapShare} color="var(--color-mint-400)" />}
              {u && (p.position === "RB" || u.carryShare >= 0.05) && (
                <UsageRing label="Carries" value={u.carryShare} color="#60a5fa" />
              )}
              {u && <UsageRing label="Targets" value={u.targetShare} color="#f472b6" />}
              {u && (
                <UsageRing
                  label="RZ looks/g"
                  value={Math.min(1, u.redZone / 5)}
                  text={String(u.redZone)}
                  color="#fbbf24"
                />
              )}
            </div>
            {u && (
              <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                <div>
                  <div className="font-mono text-lg font-bold">{u.touches}</div>
                  <div className="text-[11px] text-ink-400">touches/g</div>
                </div>
                <div>
                  <div
                    className={`font-mono text-lg font-bold ${
                      u.seasonTouches && u.touches > u.seasonTouches * 1.1
                        ? "text-mint-400"
                        : u.seasonTouches && u.touches < u.seasonTouches * 0.9
                          ? "text-rose-400"
                          : ""
                    }`}
                  >
                    {u.seasonTouches ?? "—"}
                  </div>
                  <div className="text-[11px] text-ink-400">season touches/g</div>
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Why */}
      {reasons.length > 0 && (
        <Section title="What goes into the call">
          <ul className="flex flex-col divide-y divide-ink-800 rounded-2xl border border-ink-700 bg-ink-900 px-4">
            {reasons.map((f) => (
              <li key={f.key} className="flex gap-3 py-2.5 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[f.tone]}`} />
                <span className="w-24 shrink-0 text-ink-400">{f.label}</span>
                <span className={f.tone === "neutral" ? "text-ink-100" : TONE_TEXT[f.tone]}>{f.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.notes.length > 0 && (
        <Section title="Notes">
          <ul className="flex flex-col gap-1.5 text-sm text-ink-300">
            {p.notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        </Section>
      )}

      {mine && (
        <Section title="Your rules">
          <div className="flex flex-col gap-2">
            <Toggle
              on={isNoDrop(prefs, p.id)}
              label="Don't suggest dropping him"
              onChange={() => setRule(p.id, { noDrop: !isNoDrop(prefs, p.id), noTrade: isNoTrade(prefs, p.id) })}
            />
            <Toggle
              on={isNoTrade(prefs, p.id)}
              label="Don't suggest trading him"
              onChange={() => setRule(p.id, { noDrop: isNoDrop(prefs, p.id), noTrade: !isNoTrade(prefs, p.id) })}
            />
          </div>
          {backupFor && (
            <p className="mt-2 text-xs text-ink-400">
              Set as your backup for {backupFor}, so he&apos;s never traded or dropped. Changing a switch replaces that
              rule.
            </p>
          )}
        </Section>
      )}
      <div className="h-6" />
    </>
  );
}

/** The overlay and bottom sheet; mounted only while open, so each opening starts fresh. */
function SheetFrame({ a, p, onClose }: { a: Analysis; p: PlayerAnalysis; onClose: () => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const { handlers, style, pulled } = useDragToClose(onClose, scroll);
  const tint = teamColor(p.team);
  // A new player starts at the top.
  useEffect(() => scroll.current?.scrollTo({ top: 0 }), [p.id]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={p.name}
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        style={{ opacity: 1 - pulled * 0.7 }}
      />
      <div
        {...handlers}
        className="glass relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-ink-700 bg-ink-950/85 shadow-2xl sm:rounded-3xl"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          // Tinted with the player's team color, fading into the glass.
          backgroundImage: tint
            ? `linear-gradient(180deg, ${tint}d9 0px, ${tint}55 180px, transparent 360px)`
            : undefined,
          ...style,
        }}
      >
        {/* Grab handle: drag down from here (or from anywhere at the top of the content) to close. */}
        <div data-sheet-handle className="flex h-8 shrink-0 items-start justify-center pt-3 sm:h-4">
          <span className="h-1.5 w-10 rounded-full bg-ink-600 sm:hidden" />
          <button
            onClick={onClose}
            aria-label="Close player"
            className="absolute top-3 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-ink-300 hover:text-ink-100"
          >
            ✕
          </button>
        </div>
        <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1">
          <SheetBody a={a} p={p} />
        </div>
      </div>
    </div>
  );
}

/** Provides `useOpenPlayer()` to everything inside, and renders the sheet. */
export function PlayerSheetProvider({ a, children }: { a: Analysis; children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((p: PlayerAnalysis) => setId(p.id), []);
  const close = useCallback(() => setId(null), []);
  // Look the player up in the latest analysis so rule changes show right away.
  const all = [
    ...a.roster,
    ...(a.opponent?.starters ?? []),
    ...a.otherTeams.flatMap((t) => t.players),
    ...a.freeAgentPool,
  ];
  const p = id ? (all.find((x) => x.id === id) ?? null) : null;

  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const scroller = document.getElementById("scroller");
    const prev = scroller?.style.overflow;
    if (scroller) scroller.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      if (scroller) scroller.style.overflow = prev ?? "";
    };
  }, [p, close]);

  return (
    <PlayerSheetContext.Provider value={open}>
      {children}
      {p && createPortal(<SheetFrame a={a} p={p} onClose={close} />, document.body)}
    </PlayerSheetContext.Provider>
  );
}

/** A player's name/headshot as a button that opens his sheet. */
export function PlayerButton({
  p,
  className = "",
  children,
}: {
  p: PlayerAnalysis;
  className?: string;
  children: React.ReactNode;
}) {
  const open = useOpenPlayer();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open?.(p);
      }}
      className={`text-left ${className}`}
      aria-label={`Open ${last(p.name)}'s details`}
    >
      {children}
    </button>
  );
}
