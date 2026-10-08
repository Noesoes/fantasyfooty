// Trade finder: look for swaps with every team that make BOTH starting
// lineups better for the rest of the season — the only trades anyone accepts.
//
// A team's worth is the rest-of-season value of its best lineup plus a
// little credit for bench depth (byes and injuries happen). We try every
// 1-for-1, 2-for-1 and 1-for-2 between your top players and theirs.

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

export function findTrades(a: Analysis): TradeReport {
  const slots = lineupSlots(a.league.roster_positions);
  const tradeable = (p: PlayerAnalysis) => p.position !== "K" && p.position !== "DEF" && p.rosValue > 1;

  const mine = [...a.activeRoster].sort(byValue);
  const myBase = teamValue(slots, mine);
  const myPool = mine.filter(tradeable).slice(0, POOL_SIZE);

  // --- Positional strength vs. the league ---
  const allTeams = [{ id: -1, players: mine }, ...a.otherTeams.map((t) => ({ id: t.rosterId, players: t.players }))];
  const values = allTeams.map((t) => ({ id: t.id, v: positionValues(slots, t.players) }));
  const strengths: PositionStrength[] = CORE_POSITIONS.filter((pos) => values.some((t) => t.v[pos] > 0)).map(
    (pos) => {
      const sorted = values.map((t) => t.v[pos]).sort((x, y) => y - x);
      const value = values[0].v[pos];
      return {
        position: pos,
        value: round1(value),
        leagueAverage: round1(sorted.reduce((s, x) => s + x, 0) / sorted.length),
        rank: sorted.indexOf(value) + 1,
        teams: sorted.length,
      };
    },
  );
  const myRank = Object.fromEntries(strengths.map((s) => [s.position, s.rank]));

  // --- Market value ---
  // What other managers will think a player is worth: value over the last
  // starter-caliber player at the position league-wide (so QBs count for more
  // in superflex). Trades must be roughly even on this scale — otherwise you
  // either get fleeced or the offer gets laughed off.
  const teams = allTeams.length;
  const flex = (slot: string) => a.league.roster_positions.filter((s) => s === slot).length;
  const startersAt: Record<string, number> = {
    QB: flex("QB") + flex("SUPER_FLEX") * 0.9,
    RB: flex("RB") + flex("FLEX") * 0.45 + flex("WRRB_FLEX") * 0.5 + flex("SUPER_FLEX") * 0.05,
    WR: flex("WR") + flex("FLEX") * 0.45 + flex("WRRB_FLEX") * 0.5 + flex("REC_FLEX") * 0.7 + flex("SUPER_FLEX") * 0.05,
    TE: flex("TE") + flex("FLEX") * 0.1 + flex("REC_FLEX") * 0.3,
  };
  const everyone = allTeams.flatMap((t) => t.players);
  const replacement: Record<string, number> = {};
  for (const pos of CORE_POSITIONS) {
    const vals = everyone
      .filter((p) => p.position === pos)
      .map((p) => p.rosValue)
      .sort((x, y) => y - x);
    replacement[pos] = vals[Math.max(0, Math.round((startersAt[pos] ?? 1) * teams) - 1)] ?? 0;
  }
  const market = (ps: PlayerAnalysis[]) =>
    ps.reduce((sum, p) => sum + Math.max(0, p.rosValue - (replacement[p.position] ?? 0)), 0);
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
    if (weak.length) parts.push(`shores up your ${weak.join("/")} (ranked ${weak.map((p) => `#${myRank[p]}`).join("/")} in the league)`);
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
