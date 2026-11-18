"use client";

// Moves -> Trades: the trade evaluator, team strength and trade ideas.

import { useMemo, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { evaluateTrade, findTrades, type TradeVerdict } from "@/lib/trades";
import { TradePartners } from "../insightsui";
import { GetAPlayer, TradeIdeaCard, useTradeActivity } from "../tradefinder";
import { RulesCard } from "../rules";
import { Card, Empty, PlayerLine, PosBadge } from "../ui";
import { Stat } from "./shared";

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
    <ul className="no-scrollbar flex max-h-72 flex-col overflow-y-auto rounded-2xl border border-ink-700">
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
              <PlayerLine p={p} size={28} opensSheet={false} />
              <span
                className={`display shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                  on ? (tone === "give" ? "bg-hot text-ink-950" : "bg-mint-400 text-ink-950") : "text-ink-400"
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
  // Everyone on each roster, IR / taxi included: injured players get traded too.
  const mine = sortByValue(a.roster);
  const theirs = sortByValue([...(team?.players ?? []), ...(team?.reserve ?? [])]);
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
          className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-ink-100"
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
        <div className="mt-4 rounded-xl bg-ink-850 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`display rounded-lg px-3 py-1 text-xl font-black ${TRADE_VERDICT_STYLE[result.verdict]}`}>
              <span className="block ">{result.verdict}</span>
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

export function Trades({ a }: { a: Analysis }) {
  const report = useMemo(() => findTrades(a), [a]);
  const activity = useTradeActivity(a);
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

      <TradePartners a={a} />

      <GetAPlayer a={a} activity={activity} />

      <Card title="Trade ideas">
        {report.ideas.length === 0 ? (
          <Empty>
            No trade clearly helps both you and another team right now. Check back after this week&apos;s games.
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {report.ideas.map((t, i) => (
              <TradeIdeaCard key={i} a={a} t={t} activity={activity} />
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-ink-400">
          Every idea improves both teams&apos; best lineups for the rest of the season (pts/week). The badge is how
          likely they are to say yes: it weighs how much the deal helps them and whether they get fair value back. Gains
          assume both teams start their best players. Tap &ldquo;Not trading&rdquo; on a player and he won&apos;t be
          suggested again.
        </p>
      </Card>
      <RulesCard a={a} />
    </div>
  );
}

// --- Opponent scouting -----------------------------------------------------
