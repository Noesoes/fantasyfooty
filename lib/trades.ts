// Trade finder: look for swaps with every team that make BOTH starting
// lineups better for the rest of the season — the only trades anyone accepts.
//
// A team's worth is the rest-of-season value of its best lineup plus a
// little credit for bench depth (byes and injuries happen). We try every
// 1-for-1, 2-for-1 and 1-for-2 between your top players and theirs.

import { isNoTrade } from "./prefs";
import { SLOT_ELIGIBILITY, type Analysis, type PlayerAnalysis } from "./advisor";

const BENCH_WEIGHT = 0.15;
const BENCH_DEPTH = 4;
const POOL_SIZE = 16;
const PAIR_POOL = 9;
const CORE_POSITIONS = ["QB", "RB", "WR", "TE"];

export interface TradeIdea {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  give: PlayerAnalysis[];
  get: PlayerAnalysis[];
  /** Change in rest-of-season lineup value (pts/week) for you and for them. */
  yourGain: number;
  theirGain: number;
  reason: string;
}

export interface PositionStrength {
  position: string;
  /** Rest-of-season pts/week from your starters at this position. */
  value: number;
  leagueAverage: number;
  /** 1 = best in the league. */
  rank: number;
  teams: number;
}

export interface TradeReport {
  ideas: TradeIdea[];
  strengths: PositionStrength[];
}

/** Starter slots ordered most-restrictive first (QB before FLEX before SUPER_FLEX). */
function lineupSlots(rosterPositions: string[]) {
  return rosterPositions
    .filter((s) => s in SLOT_ELIGIBILITY)
    .map((s) => SLOT_ELIGIBILITY[s])
    .sort((a, b) => a.length - b.length);
}

/** Greedy best lineup by rest-of-season value. `players` must be sorted by rosValue, best first. */
function bestLineup(slots: string[][], players: PlayerAnalysis[]) {
  const used = new Set<string>();
  const starters: PlayerAnalysis[] = [];
  for (const eligible of slots) {
    const p = players.find((x) => !used.has(x.id) && x.eligible.some((pos) => eligible.includes(pos)));
    if (p) {
      used.add(p.id);
      starters.push(p);
    }
  }
  return { starters, bench: players.filter((p) => !used.has(p.id)) };
}

function teamValue(slots: string[][], players: PlayerAnalysis[]): number {
  const { starters, bench } = bestLineup(slots, players);
  let v = 0;
  for (const p of starters) v += p.rosValue;
  for (let i = 0; i < Math.min(BENCH_DEPTH, bench.length); i++) v += bench[i].rosValue * BENCH_WEIGHT;
  return v;
}

const byValue = (a: PlayerAnalysis, b: PlayerAnalysis) => b.rosValue - a.rosValue;

function swap(players: PlayerAnalysis[], out: PlayerAnalysis[], incoming: PlayerAnalysis[]) {
  const outIds = new Set(out.map((p) => p.id));
  return [...players.filter((p) => !outIds.has(p.id)), ...incoming].sort(byValue);
}

function combos<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]]);
  return out;
}

/** Rest-of-season value of starters at each core position, per team. */
function positionValues(slots: string[][], players: PlayerAnalysis[]) {
  const { starters } = bestLineup(slots, [...players].sort(byValue));
  const out: Record<string, number> = {};
  for (const pos of CORE_POSITIONS) out[pos] = 0;
  for (const p of starters) if (p.position in out) out[p.position] += p.rosValue;
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * What other managers will think players are worth: value over the last
 * starter-caliber player at the position league-wide (so QBs count for more
 * in superflex). Trades must be roughly even on this scale — otherwise you
 * either get fleeced or the offer gets laughed off.
 */
function buildMarket(a: Analysis, everyone: PlayerAnalysis[], teams: number) {
  const count = (slot: string) => a.league.roster_positions.filter((s) => s === slot).length;
  const startersAt: Record<string, number> = {
    QB: count("QB") + count("SUPER_FLEX") * 0.9,
    RB: count("RB") + count("FLEX") * 0.45 + count("WRRB_FLEX") * 0.5 + count("SUPER_FLEX") * 0.05,
    WR:
      count("WR") +
      count("FLEX") * 0.45 +
      count("WRRB_FLEX") * 0.5 +
      count("REC_FLEX") * 0.7 +
      count("SUPER_FLEX") * 0.05,
    TE: count("TE") + count("FLEX") * 0.1 + count("REC_FLEX") * 0.3,
  };
  const replacement: Record<string, number> = {};
  for (const pos of CORE_POSITIONS) {
    const vals = everyone
      .filter((p) => p.position === pos)
      .map((p) => p.rosValue)
      .sort((x, y) => y - x);
    replacement[pos] = vals[Math.max(0, Math.round((startersAt[pos] ?? 1) * teams) - 1)] ?? 0;
  }
  return (ps: PlayerAnalysis[]) =>
    ps.reduce((sum, p) => sum + Math.max(0, p.rosValue - (replacement[p.position] ?? 0)), 0);
}

/** Your rank (1 = best) at each core position, given your roster. */
function ranksFor(slots: string[][], mine: PlayerAnalysis[], others: PlayerAnalysis[][]) {
  const all = [mine, ...others].map((ps) => positionValues(slots, ps));
  const out: Record<string, number> = {};
  for (const pos of CORE_POSITIONS) {
    const sorted = all.map((v) => v[pos]).sort((x, y) => y - x);
    out[pos] = sorted.indexOf(all[0][pos]) + 1;
  }
  return out;
}

export type TradeVerdict = "Accept" | "Lean accept" | "Counter" | "Decline";

export interface TradeEvaluation {
  verdict: TradeVerdict;
  summary: string;
  /** Rest-of-season lineup value change, pts/week. */
  yourGain: number;
  theirGain: number;
  /** Value over replacement of each side (what the market thinks). */
  marketGive: number;
  marketGet: number;
  /** Your positional ranks before → after. */
  ranks: { position: string; before: number; after: number }[];
  /** Ask for this player too and the deal flips in your favor (if one exists). */
  counter: { add: PlayerAnalysis; yourGain: number; theirGain: number } | null;
  teams: number;
}

/** Grade a specific offer: you give `give` to team `rosterId` and get `get`. */
export function evaluateTrade(
  a: Analysis,
  rosterId: number,
  give: PlayerAnalysis[],
  get: PlayerAnalysis[],
): TradeEvaluation {
  const slots = lineupSlots(a.league.roster_positions);
  const team = a.otherTeams.find((t) => t.rosterId === rosterId);
  if (!team) throw new Error("Unknown team");
  const mine = [...a.activeRoster].sort(byValue);
  const theirs = [...team.players].sort(byValue);
  const allPlayers = [...mine, ...a.otherTeams.flatMap((t) => t.players)];
  const market = buildMarket(a, allPlayers, a.otherTeams.length + 1);

  const myAfter = swap(mine, give, get);
  const theirAfter = swap(theirs, get, give);
  const yourGain = teamValue(slots, myAfter) - teamValue(slots, mine);
  const theirGain = teamValue(slots, theirAfter) - teamValue(slots, theirs);
  const marketGive = market(give);
  const marketGet = market(get);
  const ratio = marketGive < 0.5 ? (marketGet >= marketGive ? 2 : 1) : marketGet / marketGive;

  const others = a.otherTeams.filter((t) => t.rosterId !== rosterId).map((t) => t.players);
  const before = ranksFor(slots, mine, [theirs, ...others]);
  const after = ranksFor(slots, myAfter, [theirAfter, ...others]);
  const ranks = CORE_POSITIONS.filter(
    (pos) => before[pos] !== after[pos] || [...give, ...get].some((p) => p.position === pos),
  ).map((pos) => ({ position: pos, before: before[pos], after: after[pos] }));

  // Counter: the cheapest extra player from their roster that makes it a clear win for you.
  let counter: TradeEvaluation["counter"] = null;
  if (yourGain < 1) {
    const extras = theirs
      .filter((p) => !get.some((g) => g.id === p.id) && p.position !== "K" && p.position !== "DEF" && p.rosValue > 1)
      .map((p) => {
        const getPlus = [...get, p];
        return {
          add: p,
          yourGain: teamValue(slots, swap(mine, give, getPlus)) - teamValue(slots, mine),
          theirGain: teamValue(slots, swap(theirs, getPlus, give)) - teamValue(slots, theirs),
          cost: market([p]),
        };
      })
      // Only counters they could plausibly accept (not much worse off for them).
      .filter((x) => x.yourGain >= 1 && x.yourGain > yourGain + 0.5 && x.theirGain >= -1.5)
      .sort((x, y) => x.cost - y.cost || y.yourGain - x.yourGain);
    if (extras[0])
      counter = { add: extras[0].add, yourGain: round1(extras[0].yourGain), theirGain: round1(extras[0].theirGain) };
  }

  let verdict: TradeVerdict;
  if (yourGain >= 0.3 && ratio >= 0.85) verdict = "Accept";
  else if ((yourGain >= 0.3 && ratio >= 0.65) || (yourGain > -0.3 && ratio >= 1.2)) verdict = "Lean accept";
  else if (counter || (yourGain > -1 && ratio >= 0.8)) verdict = "Counter";
  else verdict = "Decline";

  const lineup =
    Math.abs(yourGain) < 0.3
      ? "barely changes your lineup"
      : yourGain > 0
        ? `improves your best lineup by ${round1(yourGain)} pts/week`
        : `costs your best lineup ${round1(-yourGain)} pts/week`;
  const value =
    ratio >= 1.15
      ? "and you get more value than you give"
      : ratio >= 0.85
        ? "and the value is roughly even"
        : "but you give up more value than you get back";
  const summary =
    verdict === "Counter" && counter
      ? `It ${lineup} ${value}. Ask for ${counter.add.name} as well and it becomes a clear win (+${counter.yourGain}/wk).`
      : `It ${lineup} ${value}.`;

  const blocked = give.filter((p) => isNoTrade(a.prefs, p.id));
  const ruleNote = blocked.length
    ? ` Heads up: you marked ${blocked.map((p) => p.name).join(" and ")} as not for trade${blocked.some((p) => a.prefs[p.id]?.backupFor) ? " (your backup)" : ""}.`
    : "";

  return {
    verdict,
    summary: summary.charAt(0).toUpperCase() + summary.slice(1) + ruleNote,
    yourGain: round1(yourGain),
    theirGain: round1(theirGain),
    marketGive: round1(marketGive),
    marketGet: round1(marketGet),
    ranks,
    counter,
    teams: a.otherTeams.length + 1,
  };
}

export function findTrades(a: Analysis): TradeReport {
  const slots = lineupSlots(a.league.roster_positions);
  const tradeable = (p: PlayerAnalysis) => p.position !== "K" && p.position !== "DEF" && p.rosValue > 1;

  const mine = [...a.activeRoster].sort(byValue);
  const myBase = teamValue(slots, mine);
  // Players you've said you won't trade are never offered.
  const myPool = mine.filter((p) => tradeable(p) && !isNoTrade(a.prefs, p.id)).slice(0, POOL_SIZE);

  // --- Positional strength vs. the league ---
  const allTeams = [{ id: -1, players: mine }, ...a.otherTeams.map((t) => ({ id: t.rosterId, players: t.players }))];
  const values = allTeams.map((t) => ({ id: t.id, v: positionValues(slots, t.players) }));
  const strengths: PositionStrength[] = CORE_POSITIONS.filter((pos) => values.some((t) => t.v[pos] > 0)).map((pos) => {
    const sorted = values.map((t) => t.v[pos]).sort((x, y) => y - x);
    const value = values[0].v[pos];
    return {
      position: pos,
      value: round1(value),
      leagueAverage: round1(sorted.reduce((s, x) => s + x, 0) / sorted.length),
      rank: sorted.indexOf(value) + 1,
      teams: sorted.length,
    };
  });
  const myRank = Object.fromEntries(strengths.map((s) => [s.position, s.rank]));

  const market = buildMarket(
    a,
    allTeams.flatMap((t) => t.players),
    allTeams.length,
  );
  const fair = (give: PlayerAnalysis[], get: PlayerAnalysis[]) => {
    const g = market(give);
    const r = market(get);
    if (g < 0.5 && r < 0.5) return true; // depth-for-depth
    return r >= g * 0.8 && r <= g * 1.25 + 0.5;
  };

  // --- Search ---
  const ideas: TradeIdea[] = [];
  for (const team of a.otherTeams) {
    const theirs = [...team.players].sort(byValue);
    const theirBase = teamValue(slots, theirs);
    const theirPool = theirs.filter(tradeable).slice(0, POOL_SIZE);

    const packages: [PlayerAnalysis[], PlayerAnalysis[]][] = [];
    for (const g of myPool) for (const r of theirPool) packages.push([[g], [r]]);
    for (const pair of combos(myPool.slice(0, PAIR_POOL))) for (const r of theirPool) packages.push([pair, [r]]);
    for (const g of myPool) for (const pair of combos(theirPool.slice(0, PAIR_POOL))) packages.push([[g], pair]);

    const found: TradeIdea[] = [];
    for (const [give, get] of packages) {
      if (!fair(give, get)) continue;
      const yourGain = teamValue(slots, swap(mine, give, get)) - myBase;
      if (yourGain < 1) continue;
      const theirGain = teamValue(slots, swap(theirs, get, give)) - theirBase;
      if (theirGain < 0.3) continue;
      found.push({
        rosterId: team.rosterId,
        teamName: team.teamName,
        avatar: team.avatar,
        give,
        get,
        yourGain: round1(yourGain),
        theirGain: round1(theirGain),
        reason: "",
      });
    }
    // Balanced deals first: a trade that barely helps them won't get accepted.
    const score = (t: TradeIdea) => Math.min(t.yourGain, t.theirGain * 2) + t.yourGain * 0.25;
    found.sort((x, y) => score(y) - score(x));
    // Keep the best two per team, without reusing the same players.
    const usedIds = new Set<string>();
    for (const t of found) {
      if (ideas.filter((i) => i.rosterId === team.rosterId).length >= 2) break;
      if ([...t.give, ...t.get].some((p) => usedIds.has(p.id))) continue;
      [...t.give, ...t.get].forEach((p) => usedIds.add(p.id));
      ideas.push(t);
    }
  }

  for (const t of ideas) {
    const getPos = [...new Set(t.get.map((p) => p.position))];
    const givePos = [...new Set(t.give.map((p) => p.position))];
    const weak = getPos.filter((pos) => (myRank[pos] ?? 0) > (strengths[0]?.teams ?? 12) / 2);
    const parts: string[] = [];
    if (weak.length)
      parts.push(
        `shores up your ${weak.join("/")} (ranked ${weak.map((p) => `#${myRank[p]}`).join("/")} in the league)`,
      );
    else parts.push(`upgrades your ${getPos.join("/")}`);
    if (t.give.length > t.get.length) parts.push("consolidates depth into a better starter");
    if (t.get.length > t.give.length) parts.push("adds depth");
    parts.push(`${t.teamName} gets the ${givePos.join("/")} help they need`);
    const text = parts.join("; ");
    t.reason = `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  }

  const overall = (t: TradeIdea) => Math.min(t.yourGain, t.theirGain * 2) + t.yourGain * 0.25;
  ideas.sort((x, y) => overall(y) - overall(x));
  return { ideas: ideas.slice(0, 8), strengths };
}
