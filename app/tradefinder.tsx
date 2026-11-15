"use client";

// Trade finder pieces for Moves -> Trades: a trade card with the odds they say
// yes, how often that manager trades, and a ready-to-send message; and "Get a
// player", which finds the cheapest fair offers for anyone on another team.

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useEffect, useMemo, useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { avatarUrl } from "@/lib/sleeper";
import { activityText, tradeActivity } from "@/lib/tradeactivity";
import { offerMessage, offersFor, type TradeIdea, type TradeOdds } from "@/lib/trades";
import { RuleChip } from "./rules";
import { Card, PlayerLine } from "./ui";

const ODDS_STYLE: Record<TradeOdds, string> = {
  Likely: "bg-mint-400/15 text-mint-400",
  Maybe: "bg-amber-300/20 text-amber-300",
  "Long shot": "bg-ink-700 text-ink-300",
};

/** Trades per team this season (loads in the background). */
export function useTradeActivity(a: Analysis) {
  const [counts, setCounts] = useState<Map<number, number> | null>(null);
  useEffect(() => {
    let live = true;
    tradeActivity(a)
      .then((c) => live && setCounts(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [a]);
  return counts;
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

export function TradeIdeaCard({ a, t, activity }: { a: Analysis; t: TradeIdea; activity: Map<number, number> | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(offerMessage(t));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <article className="rounded-2xl bg-ink-850 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {t.avatar ? (
            <img src={avatarUrl(t.avatar)} alt="" className="h-6 w-6 rounded-full" />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-700 text-[11px] font-bold">
              {t.teamName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate">with {t.teamName}</span>
            {activity && (
              <span className="block text-[11px] font-semibold text-ink-400">
                {activityText(activity.get(t.rosterId))}
              </span>
            )}
          </span>
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${ODDS_STYLE[t.odds]}`}>{t.odds}</span>
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
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
        <span
          className={`rounded-full px-2 py-0.5 ${t.yourGain >= 0 ? "bg-mint-400/15 text-mint-400" : "bg-rose-500/15 text-rose-400"}`}
        >
          You {signed(t.yourGain)}/wk
        </span>
        <span className="rounded-full bg-ink-700 px-2 py-0.5 text-ink-300">Them {signed(t.theirGain)}/wk</span>
      </div>
      {t.reason && <p className="mt-2 text-xs leading-relaxed text-ink-400">{t.reason}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={copy} className="rounded-full bg-mint-400 px-3 py-1.5 text-xs font-black text-ink-950">
          {copied ? "Copied ✓" : "Copy offer message"}
        </button>
        <a
          href={`https://sleeper.com/leagues/${a.league.league_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-ink-700 px-3 py-1.5 text-xs font-extrabold"
        >
          Open Sleeper ›
        </a>
        {t.give.map((p) => (
          <RuleChip key={p.id} p={p} kind="noTrade" />
        ))}
      </div>
    </article>
  );
}

/** Pick anyone on another team; see the cheapest fair offers from your roster. */
export function GetAPlayer({ a, activity }: { a: Analysis; activity: Map<number, number> | null }) {
  const [targetId, setTargetId] = useState("");
  const byPos = useMemo(() => {
    const groups = new Map<string, { id: string; label: string }[]>();
    const all = a.otherTeams
      .flatMap((t) => t.players.map((p) => ({ p, team: t.teamName })))
      .filter(({ p }) => p.rosValue >= 4 && p.position !== "K" && p.position !== "DEF")
      .sort((x, y) => y.p.rosValue - x.p.rosValue);
    for (const { p, team } of all) {
      const list = groups.get(p.position) ?? [];
      list.push({ id: p.id, label: `${p.name} (${p.team ?? "FA"}) · ${team}` });
      groups.set(p.position, list);
    }
    return ["QB", "RB", "WR", "TE"].filter((pos) => groups.has(pos)).map((pos) => [pos, groups.get(pos)!] as const);
  }, [a]);
  const target = useMemo(
    () => a.otherTeams.flatMap((t) => t.players).find((p) => p.id === targetId) ?? null,
    [a, targetId],
  );
  const offers = useMemo(() => (target ? offersFor(a, target) : []), [a, target]);
  const owner = target ? a.otherTeams.find((t) => t.players.some((p) => p.id === target.id)) : null;
  return (
    <Card title="Get a player">
      <p className="mb-3 text-sm text-ink-400">
        Pick anyone in your league and see the cheapest fair offers from your roster that their team would take.
      </p>
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        aria-label="Player you want"
        className="w-full rounded-2xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-[15px] font-semibold"
      >
        <option value="">Who do you want?</option>
        {byPos.map(([pos, list]) => (
          <optgroup key={pos} label={pos}>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {target && (
        <div className="mt-4 flex flex-col gap-3">
          {offers.length === 0 ? (
            <p className="rounded-2xl bg-ink-850 p-4 text-sm text-ink-300">
              Nothing on your roster adds up to {target.name}&apos;s value in a deal {owner?.teamName ?? "his team"}{" "}
              would take. Try a player a tier below, or check back as your roster changes.
            </p>
          ) : (
            offers.map((t, i) => <TradeIdeaCard key={i} a={a} t={t} activity={activity} />)
          )}
          {offers.some((o) => o.yourGain < 0) && (
            <p className="text-xs text-ink-400">
              A negative &ldquo;You&rdquo; number means your lineup gets weaker overall: worth it only if you really
              need him (an injury, a bye week, or a playoff push).
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
