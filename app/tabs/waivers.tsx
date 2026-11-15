"use client";

// Moves -> Waivers: claims, bids, waiver order and rivals.

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useRef, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { avatarUrl } from "@/lib/sleeper";
import { FillPosition, PlayerCheck } from "../playercheck";
import { StreamingPlanner } from "../insightsui";
import { StashTargets, WaiverRecapCard } from "../movesparts";
import { RuleChip } from "../rules";
import { Card, Empty, Headshot, MatchupChip, PlayerLine, Points } from "../ui";
import { lastName } from "@/lib/names";
import { PlayerTable, Stat, compact } from "./shared";

export function Waivers({ a, onRefresh, refreshing }: { a: Analysis; onRefresh: () => void; refreshing: boolean }) {
  const positions = Object.keys(a.waiversByPosition).filter((p) => a.waiversByPosition[p].length);
  const [pos, setPos] = useState(positions[0] ?? "QB");
  const [checking, setChecking] = useState<PlayerAnalysis | null>(null);
  const checkRef = useRef<HTMLElement>(null);
  const check = (p: PlayerAnalysis) => {
    setChecking(p);
    requestAnimationFrame(() => checkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <div className="flex flex-col gap-5">
      <WaiverRecapCard a={a} />
      <WaiverStatus a={a} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ink-700 bg-ink-900 px-4 py-2.5 text-xs text-ink-400">
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
              <article key={w.player.id} className="flex flex-col gap-3 rounded-xl bg-ink-850 p-4">
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
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-[11px] font-bold text-rose-400">DROP</span>
                    <div className="min-w-0 flex-1 opacity-80">
                      <PlayerLine p={w.dropFor} size={32} />
                    </div>
                    <RuleChip p={w.dropFor} kind="noDrop" />
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

      <StashTargets a={a} onCheck={check} />
      <StreamingPlanner a={a} />
      <PlayerCheck ref={checkRef} a={a} selected={checking} onSelect={setChecking} />
      <FillPosition a={a} onCheck={check} />

      {a.backupTargets.length > 0 && (
        <Card title="Backup targets">
          <p className="mb-3 text-sm text-ink-400">
            Your top claims will probably be gone before your turn. These are good fits for your team that teams ahead
            of you are less likely to take — put in claims for them too.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {a.backupTargets.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-850 px-3 py-2.5">
                <PlayerLine p={p} size={34} sub={<MatchupChip p={p} compact />} />
                <Points value={p.weekScore} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Rivals a={a} />

      {a.activeRoster.some((p) => p.stash) && (
        <Card title="Hold these stashes">
          <ul className="flex flex-col divide-y divide-ink-700/60">
            {a.activeRoster
              .filter((p) => p.stash)
              .sort((x, y) => y.stash!.value - x.stash!.value)
              .map((p) => {
                const st = p.stash!;
                return (
                  <li key={p.id} className="py-3">
                    <PlayerLine p={p} size={34} />
                    <div className="mt-1.5 ml-[46px] text-xs">
                      <p className="text-ink-100">
                        <b className="text-violet">~{Math.round(st.chance * 100)}% chance</b> {st.starter}&apos;s job
                        opens up — {lastName(p.name)} would be worth <b className="font-mono">~{st.ifStarter}</b>{" "}
                        pts/game if it does (<span className="font-mono">{p.rosValue}</span> now).
                      </p>
                      <ul className="mt-1 flex flex-col gap-0.5 text-ink-400">
                        {st.reasons.map((r) => (
                          <li key={r}>· {r}</li>
                        ))}
                      </ul>
                    </div>
                  </li>
                );
              })}
          </ul>
          <p className="mt-2 text-[11px] text-ink-400">
            Backups get credit for the chance their starter is traded or hurt, so the advisor won&apos;t suggest
            dropping them for a marginal pickup.
          </p>
        </Card>
      )}

      {a.drops.length > 0 && (
        <Card title="Drop candidates">
          <ul className="flex flex-col divide-y divide-ink-700/60">
            {a.drops.map((d) => (
              <li key={d.player.id} className="py-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <PlayerLine p={d.player} size={34} />
                  </div>
                  <RuleChip p={d.player} kind="noDrop" />
                </div>
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
          <PlayerTable players={a.waiversByPosition[pos] ?? []} week={a.week} showTrending onSelect={check} />
          <p className="mt-2 text-xs text-ink-400">
            Tap a player to see why you should (or shouldn&apos;t) pick him up.
          </p>
        </Card>
      )}
    </div>
  );
}

export function bidSummary(b: NonNullable<Analysis["waivers"][number]["bid"]>) {
  const top = b.competitors[0];
  if (!top) return "Little competition expected.";
  if (b.toWin !== null && b.toWin > b.ceiling) return `${top.teamName} may outbid you (~$${top.estimate}).`;
  return `Should beat ${top.teamName}'s likely ~$${top.estimate}.`;
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
        title={`Projected to be claimed by ${w.likelyClaimedBy} before your turn${w.likelyClaimWhy ? `: ${w.likelyClaimWhy}` : ""}`}
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
                <span
                  title={r.targets.find((t) => t.player.id === r.projectedClaim?.id)?.why}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 py-0.5 pr-2.5 pl-0.5"
                >
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
              {r.projectedClaim && (
                <span className="w-full text-[11px] text-ink-400">
                  {r.targets.find((t) => t.player.id === r.projectedClaim?.id)?.why}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-400">
        Projection: each team takes the free agent that would help their lineup most the rest of the season (or fill a
        hole they can&apos;t cover this week), in waiver order. A team that&apos;s already deep at a position isn&apos;t
        expected to chase it. Teams can make several claims, so treat this as a guide.
      </p>
    </Card>
  );
}
