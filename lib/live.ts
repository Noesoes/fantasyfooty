// Live game-day view: real points from Sleeper as games are played, points
// still to come (projection × share of the game left), a win probability,
// and late-swap tips for players whose games haven't kicked off.

import { SLOT_ELIGIBILITY, slotName, type Analysis, type PlayerAnalysis } from "./advisor";
import { getMatchups } from "./sleeper";
import { getWeekGames, type Game, type WeekGames } from "./scoreboard";

export interface LivePlayer {
  id: string;
  slot: string;
  player: PlayerAnalysis | null;
  name: string;
  points: number;
  /** Expected points still to come. */
  remaining: number;
  game: Game | null;
  status: "pre" | "in" | "post" | "bye";
}

export interface LiveSide {
  teamName: string;
  avatar: string | null;
  score: number;
  remaining: number;
  projectedFinal: number;
  players: LivePlayer[];
  /** Starters whose games haven't kicked off / are underway / are done. */
  yetToPlay: number;
  playing: number;
}

export interface LateSwap {
  slot: string;
  out: LivePlayer;
  in: PlayerAnalysis;
  /** Needs a waiver/free-agent add first. */
  freeAgent: boolean;
  gain: number;
  reason: string;
}

export interface LiveState {
  /** True once any game this week has kicked off. */
  started: boolean;
  /** True while any of this week's games is in progress. */
  inProgress: boolean;
  allDone: boolean;
  me: LiveSide;
  opponent: LiveSide | null;
  winProbability: number | null;
  lateSwaps: LateSwap[];
  games: WeekGames;
  asOf: number;
}

/** Standard normal CDF (Abramowitz–Stegun approximation). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// A player's weekly score varies by roughly 60% of their projection.
const SPREAD = 0.6;
const round1 = (n: number) => Math.round(n * 10) / 10;

function side(
  teamName: string,
  avatar: string | null,
  starters: string[],
  slots: string[],
  points: Record<string, number>,
  lookup: Map<string, PlayerAnalysis>,
  games: WeekGames,
): { side: LiveSide; variance: number } {
  let variance = 0;
  const players: LivePlayer[] = starters.map((id, i) => {
    const p = lookup.get(id) ?? null;
    const game = p?.team ? (games.byTeam.get(p.team) ?? null) : null;
    const status: LivePlayer["status"] = !id || id === "0" ? "post" : !game ? "bye" : game.state;
    const left = game ? 1 - game.elapsed : 0;
    const projection = p?.weekScore ?? 0;
    const remaining = round1(projection * left);
    variance += (SPREAD * projection) ** 2 * left;
    return {
      id,
      slot: slotName(slots[i] ?? ""),
      player: p,
      name: p?.name ?? (id && id !== "0" ? id : "Empty"),
      points: round1(points[id] ?? 0),
      remaining,
      game,
      status,
    };
  });
  const score = round1(players.reduce((s, x) => s + x.points, 0));
  const remaining = round1(players.reduce((s, x) => s + x.remaining, 0));
  return {
    side: {
      teamName,
      avatar,
      score,
      remaining,
      projectedFinal: round1(score + remaining),
      players,
      yetToPlay: players.filter((x) => x.status === "pre").length,
      playing: players.filter((x) => x.status === "in").length,
    },
    variance,
  };
}

export async function fetchLive(a: Analysis): Promise<LiveState> {
  const [matchups, games] = await Promise.all([
    getMatchups(a.league.league_id, a.week),
    getWeekGames(a.season, a.week),
  ]);
  const slots = a.league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const mine = matchups.find((m) => m.roster_id === a.myRosterId);
  const theirs = mine?.matchup_id
    ? matchups.find((m) => m.matchup_id === mine.matchup_id && m.roster_id !== a.myRosterId)
    : undefined;

  const lookup = new Map<string, PlayerAnalysis>();
  for (const p of [...a.roster, ...a.otherTeams.flatMap((t) => t.players), ...(a.opponent?.starters ?? [])]) {
    lookup.set(p.id, p);
  }

  const myStarters = mine?.starters ?? a.currentLineup.map((s) => s.player?.id ?? "0");
  const me = side(a.teamName, a.avatar, myStarters, slots, mine?.players_points ?? {}, lookup, games);
  const opp =
    theirs && a.opponent
      ? side(
          a.opponent.teamName,
          a.opponent.avatar,
          theirs.starters ?? [],
          slots,
          theirs.players_points ?? {},
          lookup,
          games,
        )
      : null;

  let winProbability: number | null = null;
  if (opp) {
    const sd = Math.sqrt(me.variance + opp.variance);
    const margin = me.side.projectedFinal - opp.side.projectedFinal;
    winProbability = sd < 0.5 ? (margin > 0 ? 1 : margin < 0 ? 0 : 0.5) : phi(margin / sd);
  }

  // Late swaps: a bench player whose game hasn't started, who fits a slot
  // held by a starter whose game also hasn't started, and projects better.
  const used = new Set<string>();
  const lateSwaps: LateSwap[] = [];
  const starterIds = new Set(myStarters);
  const notStarted = (p: PlayerAnalysis) => {
    const g = p.team ? games.byTeam.get(p.team) : undefined;
    return !g || g.state === "pre";
  };
  for (const lp of me.side.players) {
    if (lp.status !== "pre" && lp.status !== "bye" && lp.player) continue;
    const slotKey = slots[me.side.players.indexOf(lp)];
    const eligible = SLOT_ELIGIBILITY[slotKey];
    if (!eligible) continue;
    const current = lp.player?.weekScore ?? 0;
    const fits = (p: PlayerAnalysis, margin: number) =>
      !starterIds.has(p.id) &&
      !used.has(p.id) &&
      notStarted(p) &&
      p.weekScore > current + margin &&
      p.eligible.some((e) => eligible.includes(e));
    const bench = a.roster.filter((p) => fits(p, 1)).sort((x, y) => y.weekScore - x.weekScore)[0];
    // Free agents only when the gain is big enough to be worth a roster move.
    const fa = bench
      ? undefined
      : eligible
          .flatMap((pos) => a.streamersByPosition[pos] ?? [])
          .filter((p) => fits(p, 4) && !p.injury)
          .sort((x, y) => y.weekScore - x.weekScore)[0];
    const best = bench ?? fa;
    if (best) {
      used.add(best.id);
      lateSwaps.push({
        slot: lp.slot,
        out: lp,
        in: best,
        freeAgent: !bench,
        gain: round1(best.weekScore - current),
        reason:
          lp.status === "bye" || current === 0
            ? `${lp.name} won't score this week`
            : `${best.name} projects ${best.weekScore} vs ${current} for ${lp.name}`,
      });
    }
  }

  const all = [...games.byTeam.values()];
  return {
    started: all.some((g) => g.state !== "pre"),
    inProgress: all.some((g) => g.state === "in"),
    allDone: all.length > 0 && all.every((g) => g.state === "post"),
    me: me.side,
    opponent: opp?.side ?? null,
    winProbability,
    lateSwaps,
    games,
    asOf: Date.now(),
  };
}
