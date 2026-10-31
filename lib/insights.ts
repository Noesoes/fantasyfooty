// Features most paid fantasy tools have, built on the same analysis:
//  - a realistic range (floor / ceiling) for each player's week
//  - a confidence % on start/sit calls
//  - league power rankings with each team's strong and weak spots, and the
//    teams that make the best trade partners for you
//  - a streaming planner for QB, K and DEF over the next few weeks

import type { Analysis, PlayerAnalysis } from "./advisor";
import { phi } from "./live";
import { getSchedule } from "./sleeper";
import { bestLineup, lineupSlots, positionValues, teamValue } from "./trades";

const r1 = (n: number) => Math.round(n * 10) / 10;

// --- Floor / ceiling ---------------------------------------------------------

// Week-to-week spread as a share of expected points, by position (receivers and
// tight ends swing the most, quarterbacks the least).
const SPREAD: Record<string, number> = { QB: 0.4, RB: 0.5, WR: 0.6, TE: 0.65, K: 0.45, DEF: 0.6 };

export interface Range {
  floor: number;
  ceiling: number;
  /** Standard deviation used for the range and for confidence. */
  sd: number;
}

/** A realistic range for this week: the 20th to 80th percentile outcome (1 in 5 weeks below / above). */
export function playerRange(p: PlayerAnalysis): Range {
  const mean = p.weekScore;
  const sd = Math.max(mean > 0 ? 2.5 : 0, mean * (SPREAD[p.position] ?? 0.55));
  return { floor: r1(Math.max(0, mean - 0.84 * sd)), ceiling: r1(mean + 0.84 * sd), sd };
}

/** How sure the call is: the chance `pick` outscores `other` this week (0.5–1). */
export function startConfidence(pick: PlayerAnalysis, other: PlayerAnalysis): number {
  const a = playerRange(pick);
  const b = playerRange(other);
  const sd = Math.sqrt(a.sd ** 2 + b.sd ** 2);
  if (sd < 0.5) return pick.weekScore >= other.weekScore ? 1 : 0;
  return phi((pick.weekScore - other.weekScore) / sd);
}

export const confidenceWord = (c: number) =>
  c >= 0.8 ? "Confident" : c >= 0.65 ? "Fairly confident" : c >= 0.55 ? "Slight edge" : "Coin flip";

// --- Power rankings ----------------------------------------------------------

export interface PowerTeam {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  mine: boolean;
  /** Rest-of-season strength: best lineup plus some bench depth (pts/week). */
  strength: number;
  rank: number;
  /** League rank at each core position (1 = best). */
  posRank: Record<string, number>;
  best: string | null;
  worst: string | null;
  /** For other teams: how well they fit as a trade partner for you (higher = better). */
  fit: number;
  /** Plain-English reason for the fit, e.g. "deep at RB, thin at WR — you're the opposite". */
  fitWhy: string | null;
}

const CORE = ["QB", "RB", "WR", "TE"];

export function powerRankings(a: Analysis): PowerTeam[] {
  const slots = lineupSlots(a.league.roster_positions);
  const teams = [
    { rosterId: a.myRosterId, teamName: a.teamName, avatar: a.avatar, mine: true, players: a.activeRoster },
    ...a.otherTeams.map((t) => ({ ...t, mine: false })),
  ];
  const byValue = (x: PlayerAnalysis, y: PlayerAnalysis) => y.rosValue - x.rosValue;
  const rows = teams.map((t) => {
    const sorted = [...t.players].sort(byValue);
    // Depth: the best bench player at each core position (who steps in on a bye or injury).
    const { bench } = bestLineup(slots, sorted);
    const depth: Record<string, number> = {};
    for (const pos of CORE) depth[pos] = bench.find((p) => p.position === pos)?.rosValue ?? 0;
    return {
      ...t,
      strength: teamValue(slots, sorted),
      pos: positionValues(slots, t.players),
      depth,
    };
  });
  const posRank = (pos: string, v: number) => rows.filter((r) => r.pos[pos] > v).length + 1;
  const out: (PowerTeam & { depth: Record<string, number> })[] = rows
    .map((r) => {
      const ranks: Record<string, number> = {};
      for (const pos of CORE) ranks[pos] = posRank(pos, r.pos[pos]);
      const present = CORE.filter((pos) => rows.some((x) => x.pos[pos] > 0));
      const sortedPos = [...present].sort((x, y) => ranks[x] - ranks[y]);
      return {
        rosterId: r.rosterId,
        teamName: r.teamName,
        avatar: r.avatar,
        mine: r.mine,
        strength: r1(r.strength),
        rank: 0,
        posRank: ranks,
        best: sortedPos[0] ?? null,
        worst: sortedPos[sortedPos.length - 1] ?? null,
        fit: 0,
        fitWhy: null as string | null,
        depth: r.depth,
      };
    })
    .sort((x, y) => y.strength - x.strength)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  // Trade fit: a team that's deep where you're thin, and thin where you're deep.
  const me = out.find((t) => t.mine);
  const n = out.length;
  if (me) {
    for (const t of out) {
      if (t.mine) continue;
      let best = 0;
      let why: string | null = null;
      for (const need of CORE) {
        for (const give of CORE) {
          if (need === give) continue;
          // Their surplus at your need + your surplus at their need, in league ranks.
          const theirEdge = me.posRank[need] - t.posRank[need];
          const myEdge = t.posRank[give] - me.posRank[give];
          const depthBonus = t.depth[need] > 0 && me.depth[give] > 0 ? 1 : 0;
          const score = Math.min(theirEdge, myEdge) + depthBonus;
          if (theirEdge > 0 && myEdge > 0 && score > best) {
            best = score;
            why = `They're #${t.posRank[need]} at ${need} (you're #${me.posRank[need]}); you're #${me.posRank[give]} at ${give} (they're #${t.posRank[give]})`;
          }
        }
      }
      t.fit = r1(best / Math.max(1, n / 4));
      t.fitWhy = why;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- depth is only for the fit score
  return out.map(({ depth, ...t }) => t);
}

// --- Streaming planner -------------------------------------------------------

export interface StreamWeek {
  week: number;
  opponent: string | null;
  /** 1 = toughest defense for this position, teams = easiest. */
  rank: number | null;
  teams: number;
  grade: "great" | "good" | "neutral" | "tough" | "brutal" | "bye";
  /** Expected points that week (bye = 0). */
  pts: number;
}

export interface StreamOption {
  player: PlayerAnalysis;
  weeks: StreamWeek[];
  total: number;
  mine: boolean;
}

export interface StreamPlan {
  position: string;
  weeks: number[];
  options: StreamOption[];
}

export const STREAM_POSITIONS = ["QB", "K", "DEF"];

/**
 * Best free agents to stream at a position over the next few weeks, by schedule.
 * Each week's expected points = his usual output nudged by that opponent's
 * points allowed to the position (±25% at most); byes count as zero.
 */
export async function streamingPlan(a: Analysis, position: string, span = 3): Promise<StreamPlan> {
  const schedule = await getSchedule(a.season);
  const weeks = Array.from({ length: span }, (_, i) => a.week + i).filter((w) => w <= 18);
  const oppOf = new Map<string, string>();
  for (const g of schedule) {
    if (!weeks.includes(g.week)) continue;
    oppOf.set(`${g.week}|${g.home}`, g.away);
    oppOf.set(`${g.week}|${g.away}`, g.home);
  }
  const base = (p: PlayerAnalysis) => {
    const seasonish = p.seasonAvg ?? p.rosValue;
    return p.projection > 0 ? 0.5 * p.projection + 0.5 * seasonish : seasonish;
  };
  const plan = (p: PlayerAnalysis, mine: boolean): StreamOption => {
    const b = base(p);
    const ws: StreamWeek[] = weeks.map((w) => {
      const opp = p.team ? (oppOf.get(`${w}|${p.team}`) ?? null) : null;
      if (!opp) return { week: w, opponent: null, rank: null, teams: 32, grade: "bye", pts: 0 };
      const m = a.defenseVs(opp, position);
      const factor = m ? Math.min(1.25, Math.max(0.75, m.ratio)) : 1;
      return {
        week: w,
        opponent: opp,
        rank: m?.rank ?? null,
        teams: m?.teams ?? 32,
        grade: m?.grade ?? "neutral",
        pts: r1(b * factor),
      };
    });
    return { player: p, weeks: ws, total: r1(ws.reduce((s, w) => s + w.pts, 0)), mine };
  };
  const free = a.freeAgentPool
    .filter((p) => p.position === position && p.team && !(p.injury && ["IR", "Out", "PUP", "Sus"].includes(p.injury)))
    .filter((p) => position !== "QB" || p.role === "starter" || p.role === "fill-in" || p.role === null)
    .filter((p) => base(p) > 0)
    .map((p) => plan(p, false))
    .sort((x, y) => y.total - x.total)
    .slice(0, 6);
  const mine = a.activeRoster.filter((p) => p.position === position).map((p) => plan(p, true));
  return {
    position,
    weeks,
    options: [...mine, ...free].sort((x, y) => Number(y.mine) - Number(x.mine) || y.total - x.total),
  };
}

// --- All leagues at a glance ---------------------------------------------------

/** A lineup's expected total and its week-to-week spread (players' swings combined). */
export function teamOutcome(players: (PlayerAnalysis | null | undefined)[]): { mean: number; sd: number } {
  let mean = 0;
  let variance = 0;
  for (const p of players) {
    if (!p) continue;
    mean += p.weekScore;
    variance += playerRange(p).sd ** 2;
  }
  return { mean, sd: Math.sqrt(variance) };
}

/** Win chance from two lineups' expected points and each position's usual week-to-week swing. */
export function projectedWin(
  mine: (PlayerAnalysis | null | undefined)[],
  theirs: (PlayerAnalysis | null | undefined)[],
): number {
  const a = teamOutcome(mine);
  const b = teamOutcome(theirs);
  const sd = Math.sqrt(a.sd ** 2 + b.sd ** 2);
  const margin = a.mean - b.mean;
  return sd < 0.5 ? (margin > 0 ? 1 : margin < 0 ? 0 : 0.5) : phi(margin / sd);
}

export interface LeagueGlance {
  leagueId: string;
  /** Win chance with your current lineup, and with the suggested moves made. */
  win: number | null;
  winWithMoves: number | null;
  me: number;
  opp: number | null;
  oppName: string | null;
  /** Start/sit changes plus worthwhile waiver claims. */
  todo: number;
  /** Starters ruled out, on bye, or doubtful. */
  trouble: number;
}

export function glance(a: Analysis): LeagueGlance {
  const theirs = a.opponent?.starters ?? [];
  const now = a.currentLineup.map((s) => s.player);
  const best = a.optimalLineup.map((s) => s.player);
  const covered = new Set(a.moves.filter((m) => m.action === "start" && m.vs).map((m) => m.vs!.id));
  const lineupMoves = a.moves.filter((m) => !(m.action === "bench" && covered.has(m.player.id))).length;
  return {
    leagueId: a.league.league_id,
    win: a.opponent ? projectedWin(now, theirs) : null,
    winWithMoves: a.opponent ? projectedWin(best, theirs) : null,
    me: r1(a.currentTotal),
    opp: a.opponent ? r1(a.opponent.projected) : null,
    oppName: a.opponent?.teamName ?? null,
    todo: lineupMoves + Math.min(3, a.waivers.length),
    trouble: a.currentLineup.filter(
      (s) => !s.player || s.player.onBye || s.player.weekScore === 0 || (s.player.playChance ?? 1) < 0.5,
    ).length,
  };
}
