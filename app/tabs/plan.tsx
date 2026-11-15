"use client";

// Home -> Plan: the week's to-do list, what changed and heads-up notes.

import { useEffect, useMemo, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { compareStart, factorsFor, FACTOR_LABELS, type FactorKey, type Tone } from "@/lib/explain";
import { projectedWin, startConfidence } from "@/lib/insights";
import { diffSnapshots, loadSeen, saveSeen, snapshotOf, type Change } from "@/lib/changes";
import { AskBox } from "../askbox";
import { useOpenPlayer } from "../playerctx";
import { Headshot } from "../ui";
import { lastName } from "@/lib/names";
import { findHoles } from "@/lib/holes";
import { KickoffCard } from "../kickoff";
import { WeekRecap } from "../weekrecap";
import { type Tab, Widget } from "./shared";
import { bidSummary } from "./waivers";

interface Task {
  id: string;
  kind: "start" | "bench" | "add" | "fix";
  title: React.ReactNode;
  /** One line under the title. */
  short: React.ReactNode;
  detail: string;
  players: PlayerAnalysis[];
  /** Start/sit calls: the players to break down side by side (the pick first). */
  why?: PlayerAnalysis[];
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

export function GamePlan({ a, goTo }: { a: Analysis; goTo: (t: Tab) => void }) {
  const holes = useMemo(() => findHoles(a), [a]);
  const tasks: Task[] = useMemo(() => {
    const list: Task[] = [];
    // First: starting spots nobody on your roster can fill, each with the pickup that fills it.
    for (const h of holes) {
      const out = h.out ? lastName(h.out.name) : null;
      list.push({
        id: `fix-${h.slot}-${h.fill.id}`,
        kind: "fix",
        title: h.out ? (
          <>
            Replace {h.out.name} at {h.slotLabel}
          </>
        ) : (
          <>Fill your empty {h.slotLabel} spot</>
        ),
        short: (
          <>
            {h.out ? `${h.why} · ` : ""}claim {h.fill.name} <span className="text-mint-400">+{h.gain} pts</span>
          </>
        ),
        detail: [
          h.out
            ? `${h.out.name} is ${h.why.toLowerCase().replace(/^ruled /, "ruled ")} and nobody on your bench can play ${h.slotLabel} this week.`
            : `Nobody on your roster can fill ${h.slotLabel} this week.`,
          `Claim ${h.fill.name} (${h.fill.position}, ${h.fill.team}: ${h.fill.weekScore} projected) and start him${out ? ` in ${out}'s spot` : ""}.`,
          h.drop ? `To make room, drop ${h.drop.name}.` : "",
          h.likelyClaimedBy
            ? `${h.likelyClaimedBy} is ahead of you on waivers and may take him${h.backup ? `; if so, ${h.backup.name} (${h.backup.weekScore} projected) is your next best option` : ""}.`
            : h.backup
              ? `Next best: ${h.backup.name} (${h.backup.weekScore} projected).`
              : "",
        ]
          .filter(Boolean)
          .join(" "),
        players: [h.fill, ...(h.drop ? [h.drop] : []), ...(h.backup ? [h.backup] : [])],
      });
    }
    const filled = new Set(holes.map((h) => h.fill.id));
    // A start paired with the player it replaces reads as one call; the bench is implied.
    const covered = new Set(a.moves.filter((m) => m.action === "start" && m.vs).map((m) => m.vs!.id));
    for (const m of a.moves) {
      if (m.action === "bench" && covered.has(m.player.id)) continue;
      const pair = m.vs ? (m.action === "start" ? [m.player, m.vs] : [m.vs, m.player]) : [m.player];
      list.push({
        id: `${m.action}-${m.player.id}`,
        kind: m.action,
        title:
          m.action === "start" ? (
            <>
              Start {m.player.name} at {m.slot}
            </>
          ) : (
            <>Bench {m.player.name}</>
          ),
        short: m.vs ? (
          <>
            {m.action === "start" ? "Over" : "For"} {m.vs.name} ·{" "}
            <span className="text-mint-400">
              +{Math.round(Math.abs(pair[0].weekScore - pair[1].weekScore) * 10) / 10} pts
            </span>
            {" · "}
            {Math.round(startConfidence(pair[0], pair[1]) * 100)}% sure
          </>
        ) : (
          m.reason
        ),
        detail: m.vs ? compareStart(pair[0], pair[1]).headline : m.reason,
        players: pair,
        why: pair,
      });
    }
    for (const w of a.waivers.filter((w) => !filled.has(w.player.id)).slice(0, Math.max(0, 3 - holes.length))) {
      list.push({
        id: `add-${w.player.id}`,
        kind: "add",
        title: (
          <>
            Claim {w.player.name}
            {w.bid && <> for ${w.bid.suggested}</>}
          </>
        ),
        short: (
          <>
            {w.dropFor ? `Drop ${w.dropFor.name} · ` : ""}
            {w.likelyClaimedBy ? (
              <span className="text-rose-400">May go to {w.likelyClaimedBy}</span>
            ) : (
              <span className="text-mint-400">Likely yours</span>
            )}
          </>
        ),
        detail: w.bid
          ? `${bidSummary(w.bid)} ${w.reason}`
          : w.likelyClaimedBy
            ? `Heads up: ${w.likelyClaimedBy} is ahead of you and likely to claim this player first${w.likelyClaimWhy ? ` (${w.likelyClaimWhy})` : ""}. ${w.reason}`
            : w.reason,
        players: w.dropFor ? [w.player, w.dropFor] : [w.player],
      });
    }
    return list;
  }, [a, holes]);
  const [checked, toggle] = useChecked(`plan:${a.league.league_id}:${a.week}`);
  // Warnings a task above already handles ("Lamar Jackson is in your QB slot: Ruled IR") would just repeat it.
  const handled = [
    ...holes.flatMap((h) => (h.out ? [h.out.name] : [])),
    ...a.moves.flatMap((m) => [m.player.name, ...(m.vs ? [m.vs.name] : [])]),
  ];
  const warnings = a.warnings.filter((w) => !handled.some((name) => w.startsWith(name)));
  const [open, setOpen] = useState<string | null>(null);
  const done = tasks.filter((t) => checked[t.id]).length;
  const stashes = a.activeRoster.filter((p) => p.stash);
  const openPlayer = useOpenPlayer();
  const hurt = a.optimalLineup.map((x) => x.player).filter((p): p is PlayerAnalysis => !!p?.injury);

  return (
    <div className="flex flex-col gap-3">
      {a.bestBall && (
        <div className="rounded-2xl bg-pos-wr/10 px-4 py-3 text-sm text-ink-100">
          <b>Best-ball league:</b> Sleeper picks your highest-scoring lineup automatically each week, so there are no
          start/sit calls here. Waivers, trades and depth are what matter.
        </div>
      )}

      <AskBox a={a} />
      <WeekRecap a={a} onSeeRecord={() => goTo("lineup")} />
      {!a.bestBall && (
        <KickoffCard
          a={a}
          movePlayers={[
            ...a.moves.flatMap((m) => [m.player, ...(m.vs ? [m.vs] : [])]),
            ...holes.flatMap((h) => [h.fill, ...(h.out ? [h.out] : [])]),
          ]}
        />
      )}
      <WhatChanged a={a} />

      <div className="mt-2 flex items-baseline justify-between px-1">
        <h2 className="text-xl font-bold tracking-tight">
          {tasks.length === 0
            ? "Nothing to do"
            : `Do ${tasks.length === 1 ? "this" : `these ${tasks.length}`} ${tasks.length === 1 ? "thing" : "things"}`}
        </h2>
        {tasks.length > 0 && (
          <span className="text-sm text-ink-400">
            {done}/{tasks.length} done
          </span>
        )}
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-5 text-sm text-ink-300">
          Your lineup is already optimal and nothing on waivers beats your roster. Enjoy the games. 🏈
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {tasks.map((t) => {
            const isOpen = open === t.id;
            return (
              <li
                key={t.id}
                className={`rounded-2xl border border-ink-700 bg-ink-900 transition ${checked[t.id] ? "opacity-50" : ""}`}
              >
                <div className="flex items-center gap-3 p-3.5">
                  <button
                    onClick={() => toggle(t.id)}
                    aria-label={checked[t.id] ? "Mark as not done" : "Mark as done"}
                    aria-pressed={!!checked[t.id]}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition ${
                      checked[t.id]
                        ? "border-mint-400 bg-mint-400 text-ink-950"
                        : "border-ink-600 hover:border-mint-400"
                    }`}
                  >
                    {checked[t.id] ? "✓" : ""}
                  </button>
                  <button
                    onClick={() => openPlayer?.(t.players[0])}
                    className="shrink-0"
                    aria-label={`${t.players[0].name}: open details`}
                  >
                    <Headshot p={t.players[0]} size={44} />
                  </button>
                  <button
                    onClick={() => setOpen(isOpen ? null : t.id)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className={`text-[15px] leading-snug font-semibold ${checked[t.id] ? "line-through" : ""}`}>
                        {t.title}
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink-400">{t.short}</div>
                    </div>
                    <span className={`shrink-0 text-xl text-ink-500 transition ${isOpen ? "rotate-90" : ""}`}>›</span>
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-ink-800 px-4 pt-3 pb-4">
                    <p className="text-sm leading-relaxed text-ink-300">{t.detail}</p>
                    {t.why && <WhyBreakdown players={t.why} />}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {t.players.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => openPlayer?.(p)}
                          className="rounded-full bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-100 hover:bg-ink-700"
                        >
                          {lastName(p.name)}&apos;s matchup &amp; workload ›
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {(warnings.length > 0 || stashes.length > 0) && (
        <>
          <h2 className="mt-4 px-1 text-xl font-bold tracking-tight">Heads up</h2>
          <ul className="flex flex-col gap-2">
            {warnings.map((w) => (
              <li key={w} className="flex gap-3 rounded-2xl bg-rose-500/10 p-3.5 text-sm text-ink-100">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-400 text-xs font-black text-ink-950">
                  !
                </span>
                <span>{w}</span>
              </li>
            ))}
            {stashes.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => openPlayer?.(p)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-violet/10 p-3.5 text-left"
                >
                  <Headshot p={p} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">Keep stashing {p.name}</div>
                    <div className="truncate text-[13px] text-ink-400">
                      ~{Math.round(p.stash!.chance * 100)}% chance {p.stash!.starter}&apos;s job opens up
                    </div>
                  </div>
                  <span className="text-xl text-ink-500">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Widget label="Waivers" onClick={() => goTo("waivers")}>
          <span className="mt-2 font-mono text-4xl leading-none font-black">
            {a.waiver.type === "faab" ? `$${a.waiver.budgetLeft ?? 0}` : `#${a.waiver.position ?? "—"}`}
          </span>
          <span className="mt-2 text-[13px] font-bold text-ink-300">
            {a.waivers.length
              ? `${a.waivers.length} claim${a.waivers.length === 1 ? "" : "s"} worth it`
              : "Nothing worth a claim"}
          </span>
        </Widget>
        <Widget label="Injuries" onClick={() => goTo("injuries")}>
          <span
            className={`mt-2 font-mono text-4xl leading-none font-black ${hurt.length ? "text-amber-300" : "text-mint-400"}`}
          >
            {hurt.length}
          </span>
          <span className="mt-2 truncate text-[13px] font-bold text-ink-300">
            {hurt.length
              ? hurt
                  .slice(0, 2)
                  .map((p) => `${lastName(p.name)} · ${p.injury?.toLowerCase()}`)
                  .join(", ")
              : "Starters healthy"}
          </span>
        </Widget>
      </div>
    </div>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  good: "text-mint-400",
  bad: "text-rose-400",
  neutral: "text-ink-100",
};

/** Expandable "why": the edges behind a start/sit call and every factor, side by side. */
function WhyBreakdown({ players, open = false }: { players: PlayerAnalysis[]; open?: boolean }) {
  const cmp = players.length === 2 ? compareStart(players[0], players[1]) : null;
  const factors = players.map((p) => new Map(factorsFor(p).map((f) => [f.key, f])));
  const keys = (Object.keys(FACTOR_LABELS) as FactorKey[]).filter((k) => factors.some((m) => m.has(k)));
  return (
    <details open={open} className="group mt-3 rounded-xl bg-ink-850 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-semibold text-mint-400 select-none">
        <span>Why this call?</span>
        <span className="text-ink-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-ink-700 px-3 py-3">
        {cmp && (cmp.edges.length > 0 || cmp.against.length > 0) && (
          <div className="flex flex-col gap-2">
            {cmp.edges.length > 0 && (
              <div>
                <div className="mb-1 font-bold text-ink-100">Why {players[0].name}</div>
                <ul className="flex flex-col gap-1">
                  {cmp.edges.map((e) => (
                    <li key={e} className="flex gap-2 text-ink-100">
                      <span className="text-mint-400">+</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cmp.against.length > 0 && (
              <div>
                <div className="mb-1 font-bold text-ink-100">In {players[1].name}&apos;s favor</div>
                <ul className="flex flex-col gap-1">
                  {cmp.against.map((e) => (
                    <li key={e} className="flex gap-2 text-ink-400">
                      <span className="text-rose-400">−</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="text-left text-[10px] tracking-wider text-ink-400 uppercase">
              <th className="w-[22%] pb-1 font-semibold"></th>
              {players.map((p, i) => (
                <th key={p.id} className="pb-1 pl-2 font-semibold">
                  <span className={i === 0 && players.length === 2 ? "text-mint-400" : ""}>{p.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k} className={`border-t border-ink-800 align-top ${k === "total" ? "font-bold" : ""}`}>
                <td className="py-1.5 pr-1 text-ink-400">{FACTOR_LABELS[k]}</td>
                {factors.map((m, i) => {
                  const f = m.get(k);
                  return (
                    <td
                      key={i}
                      className={`py-1.5 pl-2 leading-snug break-words ${f ? TONE_CLASS[f.tone] : "text-ink-600"}`}
                    >
                      {f?.text ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] leading-relaxed text-ink-400">
          Expected pts start from the projection blended with recent form, then adjust for the defense, a growing or
          shrinking role, Vegas/weather and the chance to play.
        </p>
      </div>
    </details>
  );
}

// --- Lineup ----------------------------------------------------------------

/** Changes since you last looked at this league and week (kept on this device until you dismiss them). */
function WhatChanged({ a }: { a: Analysis }) {
  const [state, setState] = useState<{ changes: Change[]; since: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const openPlayer = useOpenPlayer();
  const current = useMemo(() => {
    const win = a.opponent
      ? projectedWin(
          a.currentLineup.map((s) => s.player),
          a.opponent.starters,
        )
      : null;
    return snapshotOf(a, win);
  }, [a]);
  useEffect(() => {
    const base = loadSeen(a.league.league_id, a.week);
    const changes = base ? diffSnapshots(base, current) : [];
    if (!base || !changes.length) {
      // First visit (or nothing new): this becomes the baseline for next time.
      saveSeen(a.league.league_id, a.week, current);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- comparing with what's saved on this device
    setState({ changes, since: base.at });
  }, [a, current]);
  if (!state) return null;
  const dismiss = () => {
    saveSeen(a.league.league_id, a.week, current);
    setState(null);
  };
  const shown = showAll ? state.changes : state.changes.slice(0, 4);
  const since = new Date(state.since).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className="mt-2 rounded-2xl border border-ink-700 bg-ink-900 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-black tracking-tight">What changed</h2>
        <span className="text-xs font-bold text-ink-400">since {since}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {shown.map((c) => {
          const p = c.playerId ? a.roster.find((x) => x.id === c.playerId) : undefined;
          const dot = c.tone === "good" ? "bg-mint-400" : c.tone === "bad" ? "bg-rose-400" : "bg-ink-500";
          const body = (
            <>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <span className="min-w-0 flex-1">{c.text}</span>
              {p && <span className="shrink-0 text-ink-500">›</span>}
            </>
          );
          return (
            <li key={c.key}>
              {p ? (
                <button onClick={() => openPlayer?.(p)} className="flex w-full gap-2.5 text-left text-sm">
                  {body}
                </button>
              ) : (
                <div className="flex gap-2.5 text-sm">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={dismiss}
          className="rounded-full bg-mint-400 px-4 py-1.5 text-xs font-black text-ink-950 hover:opacity-90"
        >
          Got it
        </button>
        {state.changes.length > 4 && (
          <button onClick={() => setShowAll((v) => !v)} className="px-2 text-xs font-bold text-ink-400">
            {showAll ? "Show less" : `+${state.changes.length - 4} more`}
          </button>
        )}
      </div>
    </section>
  );
}
