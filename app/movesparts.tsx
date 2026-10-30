"use client";

// Waivers-tab cards: the last waiver run's recap, and free agents worth
// stashing because the job ahead of them may open up.

import { useEffect, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { fetchWaiverRecap, type WaiverRecap } from "@/lib/recap";
import { findWaiverStashes, type StashTarget } from "@/lib/stash";
import { Card, PlayerLine } from "./ui";
import { lastName } from "@/lib/names";

const when = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

export function WaiverRecapCard({ a }: { a: Analysis }) {
  const [recap, setRecap] = useState<WaiverRecap | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchWaiverRecap(a)
      .then((r) => alive && setRecap(r))
      .catch(() => alive && setRecap(null));
    return () => {
      alive = false;
    };
  }, [a]);
  if (!recap) return null;
  const money = (n: number | null) => (recap.faab && n !== null ? `$${n}` : null);
  const standing =
    a.waiver.type === "faab"
      ? `$${a.waiver.budgetLeft ?? 0} of $${a.waiver.budget ?? 0} left`
      : a.waiver.position !== null
        ? `#${a.waiver.position} of ${a.waiver.teams} on waivers now`
        : null;
  return (
    <Card title="Last waiver run" action={<span className="text-xs text-ink-400">{when(recap.processed)}</span>}>
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="mb-2 text-sm font-extrabold">Your claims</h3>
          {recap.mine.length === 0 ? (
            <p className="text-sm text-ink-400">You didn&apos;t put in any claims.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recap.mine.map((c) => (
                <li key={c.playerId} className="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-850 p-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                      c.won ? "bg-mint-400 text-ink-950" : "bg-rose-400 text-ink-950"
                    }`}
                  >
                    {c.won ? "✓" : "✕"}
                  </span>
                  <div className="min-w-0 text-sm">
                    <div className="font-extrabold">
                      {c.won ? "Got" : "Missed"} {c.player}
                      {money(c.bid) && <span className="font-semibold text-ink-400"> · bid {money(c.bid)}</span>}
                    </div>
                    <div className="text-[13px] text-ink-300">
                      {c.won
                        ? c.dropped
                          ? `Dropped ${c.dropped}.`
                          : "Added to your roster."
                        : c.winner
                          ? `${c.winner} got him${money(c.winningBid) ? ` for ${money(c.winningBid)}` : ""}${
                              recap.faab && c.bid !== null && c.winningBid !== null
                                ? ` (${c.winningBid - c.bid >= 0 ? `$${c.winningBid - c.bid} more than you` : "a tiebreak"})`
                                : " (ahead of you on waivers)"
                            }.`
                          : (c.note ?? "The claim didn't go through.")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {recap.top.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-extrabold">
              Biggest adds in the league{" "}
              <span className="font-semibold text-ink-400">· {recap.totalClaims} claims</span>
            </h3>
            <ul className="flex flex-col divide-y divide-ink-700/60 text-sm">
              {recap.top.map((t) => (
                <li key={t.playerId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    <b>{t.player}</b> <span className="text-ink-400">→ {t.team}</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-ink-300">
                    {money(t.bid) ?? ""}
                    {t.claims > 1 && <span className="ml-2 text-ink-400">{t.claims} claims</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {standing && <p className="text-xs font-bold text-ink-400">Where you stand: {standing}.</p>}
      </div>
    </Card>
  );
}

export function StashTargets({ a, onCheck }: { a: Analysis; onCheck: (p: PlayerAnalysis) => void }) {
  const [list, setList] = useState<StashTarget[] | null>(null);
  useEffect(() => {
    let alive = true;
    const everyone = [...a.roster, ...a.otherTeams.flatMap((t) => t.players), ...a.freeAgentPool];
    findWaiverStashes(a.freeAgentPool, everyone, a.week)
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [a]);
  if (list === null) {
    return (
      <Card title="Stash candidates">
        <div className="skeleton h-16 rounded-xl" aria-busy="true" />
      </Card>
    );
  }
  if (!list.length) return null;
  return (
    <Card title="Stash candidates" action={<span className="text-xs text-ink-400">upside if the job opens up</span>}>
      <p className="mb-3 text-sm text-ink-400">
        Free agents next in line behind a starter who&apos;s hurt or in trade rumors.
      </p>
      <ul className="flex flex-col gap-2">
        {list.map(({ player: p, stash: s }) => (
          <li key={p.id} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <PlayerLine p={p} size={36} />
              </div>
              <span className="shrink-0 rounded-full bg-violet/15 px-2 py-0.5 text-xs font-black text-violet">
                {Math.round(s.chance * 100)}%
              </span>
            </div>
            <p className="mt-2 text-[13px] text-ink-300">
              {s.reasons[0]}. Worth ~{s.ifStarter} pts/game if {lastName(s.starter)}&apos;s job opens up.
            </p>
            <button
              onClick={() => onCheck(p)}
              className="mt-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-xs font-extrabold hover:bg-ink-800"
            >
              Should I pick him up? ›
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
