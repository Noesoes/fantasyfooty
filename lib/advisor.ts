// Turns raw Sleeper data into start/sit, drop and waiver recommendations.
//
// Each player gets two numbers:
//  - weekScore: expected points THIS week. Sleeper's projection (scored with
//    the league's own settings), blended with recent form, nudged by how many
//    fantasy points the opponent allows to that position, and zeroed or
//    discounted for byes and injuries.
//  - rosValue: rough rest-of-season worth, used to decide who is droppable and
//    which free agents are worth a claim. Season average, recent form and this
//    week's projection, with a bump for players the rest of Sleeper is adding.

import {
  getAllPlayers,
  getLeague,
  getLeagueUsers,
  getMatchups,
  getRosters,
  getSeasonStats,
  getTrendingAdds,
  getWeekProjections,
  getWeekStats,
  type League,
  type PlayerInfo,
  type Roster,
  type StatRow,
  type TrendingPlayer,
} from "./sleeper";
import { OUT_STATUSES } from "./status";
import { assessInjuries } from "./injuries";
import { isNoDrop, type Prefs } from "./prefs";
import { assessStashes, stashNote, stashPairing, STASH_POSITIONS, type Stash, type StashCandidate } from "./stash";
import { gameOutlook, getWeekGames, type Game, type GameOutlook } from "./scoreboard";

const RECENT_WEEKS = 3;
// The Nth-best free agent at a position defines "replacement level".
const REPLACEMENT_INDEX = 3;

export const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

// Statuses where the player will not suit up.
export { OUT_STATUSES };
const INJURY_FACTOR: Record<string, number> = { Doubtful: 0.3, Questionable: 0.85 };

export type MatchupGrade = "great" | "good" | "neutral" | "tough" | "brutal";

export interface Matchup {
  opponent: string;
  /** 1 = allows the fewest points to this position, 32 = allows the most. */
  rank: number;
  teams: number;
  /** Opponent's points allowed per game to this position vs. the league average. */
  ratio: number;
  /** Fantasy points per game this defense allows to the position, and the league average. */
  allowed: number;
  average: number;
  grade: MatchupGrade;
}

/** QB depth-chart status; null for other positions. */
export type PlayerRole = "starter" | "fill-in" | "sidelined" | "backup" | null;

export interface PlayerAnalysis {
  id: string;
  name: string;
  position: string;
  eligible: string[];
  team: string | null;
  injury: string | null;
  injuryBodyPart: string | null;
  onBye: boolean;
  matchup: Matchup | null;
  projection: number;
  seasonAvg: number | null;
  gamesPlayed: number;
  recentAvg: number | null;
  /** Games behind recentAvg (out of the last RECENT_WEEKS). */
  recentGames: number;
  /** Share of team offensive snaps over the recent games, 0-1. */
  snapShare: number | null;
  /** Workload over the recent games (RB/WR/TE), from Sleeper's weekly stats. */
  usage: Usage | null;
  role: PlayerRole;
  trendingAdds: number;
  weekScore: number;
  /** Chance to play this week (0–1) from the injury model, when assessed; weekScore is scaled by it. */
  playChance: number | null;
  rosValue: number;
  /** Upside if the starter ahead of him leaves or gets hurt (your bench backups only). */
  stash: Stash | null;
  /** Vegas line and weather for this week's game, when known. */
  game: GameOutlook | null;
  notes: string[];
}

export interface Usage {
  /** Carries + targets per game over the recent games. */
  touches: number;
  /** Same, over the whole season (null early on). */
  seasonTouches: number | null;
  /** Share of the team's carries / targets in the games he played, 0-1. */
  carryShare: number;
  targetShare: number;
  /** Red-zone carries + targets per game. */
  redZone: number;
  /** Multiplier applied to this week's projection for a growing or shrinking role (1 = none). */
  trendFactor: number;
}

export interface LineupSlot {
  slot: string;
  player: PlayerAnalysis | null;
}

export interface LineupMove {
  action: "start" | "bench";
  player: PlayerAnalysis;
  /** For starts: the current starter he replaces (for benches: the player taking his spot). */
  vs: PlayerAnalysis | null;
  /** Slot the player should go into (starts only). */
  slot: string | null;
  reason: string;
}

export interface DropCandidate {
  player: PlayerAnalysis;
  reason: string;
}

export interface WaiverTarget {
  player: PlayerAnalysis;
  /** Suggested player to release for this claim, if the roster is full. */
  dropFor: PlayerAnalysis | null;
  reason: string;
  /** Teams ahead of you on waivers who would also likely want this player. */
  contestedBy: string[];
  /** Team projected to claim this player before your turn, if any. */
  likelyClaimedBy: string | null;
  /** Why that team would want him, e.g. "he'd start over Bo Nix for them". */
  likelyClaimWhy: string | null;
  /** FAAB leagues only. */
  bid: BidSuggestion | null;
}

export interface BidSuggestion {
  /** What we'd bid. */
  suggested: number;
  /** What the player is worth to you alone, ignoring competition. */
  value: number;
  /** Rough amount needed to beat the most likely competing bid, if anyone else bids. */
  toWin: number | null;
  /** Don't go above this. */
  ceiling: number;
  /** Other teams likely to bid, with a guess at their bid. */
  competitors: { teamName: string; budgetLeft: number; estimate: number }[];
}

export type WaiverType = "rolling" | "reverse" | "faab";

export interface WaiverInfo {
  type: WaiverType;
  /** Your waiver priority; 1 = first claim. In FAAB leagues it only breaks ties. */
  position: number | null;
  teams: number;
  /** FAAB budget for the season, and how much of it you have left. */
  budget: number | null;
  budgetLeft: number | null;
}

export interface OtherTeam {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  /** Active players (IR/taxi excluded). */
  players: PlayerAnalysis[];
}

interface TeamModel {
  roster: Roster;
  teamName: string;
  avatar: string | null;
  players: PlayerAnalysis[];
  lineup: LineupSlot[];
  /** Free agents who'd improve this team's lineup, with the gain. */
  interest: Map<string, Interest>;
}

interface Interest {
  gain: number;
  over: PlayerAnalysis | null;
  /** "he'd start over Bo Nix for them" / "they have no one healthy for K this week". */
  why: string;
}

export interface Rival {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  waiverPosition: number | null;
  budgetLeft: number | null;
  /** Free agents this team would most likely put in a claim for, best first. */
  targets: { player: PlayerAnalysis; over: PlayerAnalysis | null; why: string }[];
  /** Their projected top claim once the teams ahead of them have picked. */
  projectedClaim: PlayerAnalysis | null;
}

export interface Opponent {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  /** Their current starters' expected points this week. */
  projected: number;
  /** Their starters this week, analyzed like yours. */
  starters: PlayerAnalysis[];
}

export interface Analysis {
  league: League;
  /** Your rules for your players (don't trade / don't drop / backup for). */
  prefs: Prefs;
  teamName: string;
  myRosterId: number;
  /** Best-ball league: Sleeper sets the lineup automatically, so no start/sit advice. */
  bestBall: boolean;
  /** Sleeper avatar id of the team owner, if set. */
  avatar: string | null;
  season: string;
  week: number;
  scoringLabel: string;
  currentLineup: LineupSlot[];
  optimalLineup: LineupSlot[];
  currentTotal: number;
  optimalTotal: number;
  opponent: Opponent | null;
  waiver: WaiverInfo;
  /** Good fits for your team that are likely still there at your turn. */
  backupTargets: PlayerAnalysis[];
  /** Teams that get claims processed before you (or can outbid you in FAAB), in that order. */
  rivals: Rival[];
  /** When rosters were fetched (ms epoch); free agents are as of this time. */
  fetchedAt: number;
  moves: LineupMove[];
  warnings: string[];
  roster: PlayerAnalysis[];
  /** Your roster minus IR/taxi — the players who can be started or traded. */
  activeRoster: PlayerAnalysis[];
  /** How a defense has done against a position this season (for any week's opponent). */
  defenseVs: (opponent: string, position: string) => Matchup | null;
  /** Every other team, modeled like yours (for trades). */
  otherTeams: OtherTeam[];
  drops: DropCandidate[];
  waivers: WaiverTarget[];
  waiversByPosition: Record<string, PlayerAnalysis[]>;
  streamersByPosition: Record<string, PlayerAnalysis[]>;
  /** Every unrostered player Sleeper projects (including injured players and backups), best first — for search. */
  freeAgentPool: PlayerAnalysis[];
  /** Rest-of-season value of a freely available player at each position (~4th best free agent). */
  replacementLevel: Record<string, number>;
  /** True when adding a player means dropping someone. */
  rosterFull: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function scoringLabel(scoring: Record<string, number>): string {
  const rec = scoring.rec ?? 0;
  if (rec >= 1) return "PPR";
  if (rec >= 0.5) return "Half PPR";
  return "Standard";
}

/** Fantasy points for a stat line under the league's scoring settings. */
export function points(stats: Record<string, number>, scoring: Record<string, number>, position: string): number {
  const label = scoringLabel(scoring);
  const preset = label === "PPR" ? stats.pts_ppr : label === "Half PPR" ? stats.pts_half_ppr : stats.pts_std;
  // Kickers and defenses score through yardage/points-allowed tiers that the
  // projection rows don't break out, so trust Sleeper's precomputed total.
  if (position === "K" || position === "DEF") return preset ?? 0;
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    const weight = scoring[key];
    if (weight && typeof value === "number") total += value * weight;
  }
  return total === 0 && preset ? preset : total;
}

function displayName(info: Partial<PlayerInfo> | undefined, id: string): string {
  if (!info) return id;
  if (info.position === "DEF") return `${info.team ?? id} D/ST`;
  const full = info.full_name ?? [info.first_name, info.last_name].filter(Boolean).join(" ");
  return full || id;
}

function gradeFor(rank: number, teams: number): MatchupGrade {
  const pct = rank / teams;
  if (pct > 0.85) return "great";
  if (pct > 0.62) return "good";
  if (pct > 0.38) return "neutral";
  if (pct > 0.15) return "tough";
  return "brutal";
}

/** Points allowed per game by each defense to each position, from season stats. */
function buildDefenseTable(seasonStats: StatRow[]) {
  const perTeam = new Map<string, Record<string, number>>();
  const gamesByTeam = new Map<string, number>();
  for (const row of seasonStats) {
    if (row.player?.position !== "DEF" && !/^[A-Z]{2,3}$/.test(row.player_id)) continue;
    const gp = row.stats.gp ?? 0;
    if (!gp) continue;
    const allowed: Record<string, number> = {};
    for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
      const value = row.stats[`fan_pts_allow_${pos.toLowerCase()}`];
      if (typeof value === "number") allowed[pos] = value / gp;
    }
    perTeam.set(row.player_id, allowed);
    gamesByTeam.set(row.player_id, gp);
  }

  return (opponent: string, position: string): Matchup | null => {
    const mine = perTeam.get(opponent)?.[position];
    if (mine === undefined) return null;
    const all = [...perTeam.values()].map((t) => t[position]).filter((v): v is number => typeof v === "number");
    if (all.length < 2) return null;
    const avg = all.reduce((a, b) => a + b, 0) / all.length;
    const rank = all.filter((v) => v < mine).length + 1;
    // Early-season samples are noisy; shrink toward neutral until ~6 games.
    const confidence = Math.min(1, (gamesByTeam.get(opponent) ?? 0) / 6);
    const ratio = avg > 0 ? 1 + (mine / avg - 1) * confidence : 1;
    return {
      opponent,
      rank,
      teams: all.length,
      ratio,
      grade: gradeFor(rank, all.length),
      allowed: Math.round(mine * 10) / 10,
      average: Math.round(avg * 10) / 10,
    };
  };
}

const GRADE_TEXT: Record<MatchupGrade, string> = {
  great: "smash matchup",
  good: "favorable matchup",
  neutral: "neutral matchup",
  tough: "tough matchup",
  brutal: "very tough matchup",
};

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function describeMatchup(m: Matchup, position: string): string {
  const generosity = m.teams - m.rank + 1;
  const who = position === "DEF" ? "D/STs" : position === "K" ? "kickers" : `${position}s`;
  const most = generosity === 1 ? "the most" : `the ${ordinal(generosity)}-most`;
  return `vs ${m.opponent}, who allow ${most} pts to ${who} (${GRADE_TEXT[m.grade]})`;
}

interface Inputs {
  league: League;
  week: number;
  projections: StatRow[];
  seasonStats: StatRow[];
  recentStats: StatRow[][];
  trending: TrendingPlayer[];
  games: Map<string, Game> | null;
}

/** Blend an observed per-game total with a prior, weighting the prior like `k` extra games. */
function shrink(total: number, games: number, prior: number, k: number): number {
  return (total + prior * k) / (games + k);
}

function analyzePlayers(ids: Iterable<string>, inputs: Inputs, extraInfo: Map<string, PlayerInfo>) {
  const { league, projections, seasonStats, recentStats, trending } = inputs;
  const scoring = league.scoring_settings;
  const projById = new Map(projections.map((r) => [r.player_id, r]));
  const seasonById = new Map(seasonStats.map((r) => [r.player_id, r]));
  const recentById = recentStats.map((week) => new Map(week.map((r) => [r.player_id, r])));
  const trendById = new Map(trending.map((t) => [t.player_id, t.count]));
  // Team -> this week's opponent. Players Sleeper doesn't project (often
  // injured starters) come without an opponent, so look it up by team.
  const opponentByTeam = new Map(
    projections.filter((r) => r.opponent && r.team).map((r) => [r.team as string, r.opponent as string]),
  );
  const teamsPlaying = new Set(opponentByTeam.keys());
  const matchupFor = buildDefenseTable(seasonStats);
  const nameOf = (id: string) => displayName(projById.get(id)?.player ?? seasonById.get(id)?.player, id);

  // Who starts at QB. Sleeper only projects pass attempts for the QB it
  // expects to start this week; the "usual" starter is whoever has started
  // the most games this season. Comparing the two spots injury fill-ins.
  const weekStarterQB = new Map<string, { id: string; att: number }>();
  for (const r of projections) {
    const att = r.stats.pass_att ?? 0;
    if (r.player?.position !== "QB" || !r.team || att < 10) continue;
    const cur = weekStarterQB.get(r.team);
    if (!cur || att > cur.att) weekStarterQB.set(r.team, { id: r.player_id, att });
  }
  const usualStarterQB = new Map<string, { id: string; gs: number }>();
  for (const r of seasonStats) {
    const gs = r.stats.gs ?? 0;
    if (r.player?.position !== "QB" || !r.team || gs < 1) continue;
    const cur = usualStarterQB.get(r.team);
    if (!cur || gs > cur.gs) usualStarterQB.set(r.team, { id: r.player_id, gs });
  }

  // Each team's carries and targets per recent week, for usage shares.
  const teamTotals = recentStats.map((week) => {
    const t = new Map<string, { att: number; tgt: number }>();
    for (const r of week) {
      if (!r.team) continue;
      const cur = t.get(r.team) ?? { att: 0, tgt: 0 };
      cur.att += r.stats.rush_att ?? 0;
      cur.tgt += r.stats.rec_tgt ?? 0;
      t.set(r.team, cur);
    }
    return t;
  });

  const result = new Map<string, PlayerAnalysis>();
  for (const id of ids) {
    if (!id || id === "0" || result.has(id)) continue;
    const proj = projById.get(id);
    const info: Partial<PlayerInfo> | undefined = proj?.player ?? extraInfo.get(id) ?? seasonById.get(id)?.player;
    const position = info?.position ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "?");
    const team = (position === "DEF" ? id : (proj?.team ?? info?.team)) ?? null;
    const injury = info?.injury_status ?? null;
    const isOut = Boolean(injury && OUT_STATUSES.has(injury));
    const notes: string[] = [];

    const projection = proj ? points(proj.stats, scoring, position) : 0;
    const onBye = Boolean(team) && teamsPlaying.size > 0 && !teamsPlaying.has(team as string);

    const season = seasonById.get(id);
    const gamesPlayed = season?.stats.gp ?? 0;
    const seasonPts = season && gamesPlayed > 0 ? points(season.stats, scoring, position) : 0;
    const seasonAvg = gamesPlayed > 0 ? seasonPts / gamesPlayed : null;

    let recentPts = 0;
    let recentGames = 0;
    let snaps = 0;
    let teamSnaps = 0;
    let att = 0;
    let tgt = 0;
    let rz = 0;
    let teamAtt = 0;
    let teamTgt = 0;
    recentById.forEach((week, w) => {
      const row = week.get(id);
      if (!row) return;
      if ((row.stats.gp ?? 0) > 0) {
        recentPts += points(row.stats, scoring, position);
        recentGames += 1;
        att += row.stats.rush_att ?? 0;
        tgt += row.stats.rec_tgt ?? 0;
        rz += (row.stats.rush_rz_att ?? 0) + (row.stats.rec_rz_tgt ?? 0);
        const tt = row.team ? teamTotals[w].get(row.team) : undefined;
        teamAtt += tt?.att ?? 0;
        teamTgt += tt?.tgt ?? 0;
      }
      if ((row.stats.tm_off_snp ?? 0) > 0) {
        snaps += row.stats.off_snp ?? 0;
        teamSnaps += row.stats.tm_off_snp ?? 0;
      }
    });
    const recentAvg = recentGames > 0 ? recentPts / recentGames : null;
    const snapShare = teamSnaps > 0 && position !== "K" && position !== "DEF" ? snaps / teamSnaps : null;
    let usage: Usage | null = null;
    if (["RB", "WR", "TE"].includes(position) && recentGames > 0) {
      const touches = (att + tgt) / recentGames;
      const sGames = season?.stats.gp ?? 0;
      const seasonTouches =
        sGames >= 3 ? ((season?.stats.rush_att ?? 0) + (season?.stats.rec_tgt ?? 0)) / sGames : null;
      // A role that's growing (or shrinking) lately counts for a little: projections lag behind usage changes.
      const trend = seasonTouches && seasonTouches >= 3 && recentGames >= 2 ? touches / seasonTouches : 1;
      usage = {
        touches,
        seasonTouches,
        carryShare: teamAtt > 0 ? att / teamAtt : 0,
        targetShare: teamTgt > 0 ? tgt / teamTgt : 0,
        redZone: rz / recentGames,
        trendFactor: Math.min(1.08, Math.max(0.92, 1 + (trend - 1) * 0.25)),
      };
    }

    // Prior for small samples. A projection is the best guess at a player's
    // role; a healthy player on a team that plays but gets no projection
    // probably isn't expected to play, so the prior is zero. Byes and
    // injuries say nothing about role, so fall back to his season average
    // (a couple of quiet games before a bye shouldn't define a starter).
    const prior = projection > 0 ? projection : onBye || isOut || injury ? (seasonAvg ?? recentAvg ?? 0) : 0;
    // A single spot start shouldn't read as "27 pts/game": observed averages
    // are shrunk toward the prior until there's a real sample.
    const seasonForm = shrink(seasonPts, gamesPlayed, prior, 2);
    const recentForm = shrink(recentPts, recentGames, prior, 1);

    const opponent = proj?.opponent ?? (team ? opponentByTeam.get(team) : undefined);
    const matchup = opponent ? matchupFor(opponent, position) : null;

    // --- Role ---
    let role: PlayerRole = null;
    let roleFactor = 1;
    if (position === "QB" && team) {
      const weekStarter = weekStarterQB.get(team)?.id;
      const usual = usualStarterQB.get(team)?.id;
      if (onBye || !weekStarter) {
        role = usual === id ? "starter" : usual ? "backup" : null;
      } else if (weekStarter === id) {
        role = usual && usual !== id ? "fill-in" : "starter";
      } else {
        role = usual === id ? "sidelined" : "backup";
      }
      if (role === "fill-in") {
        roleFactor = 0.6;
        notes.push(`Starting in place of ${nameOf(usual as string)}; value drops once the regular starter returns`);
      } else if (role === "sidelined") {
        roleFactor = 0.8;
        notes.push(`Not expected to start this week (${nameOf(weekStarter as string)} is projected to start)`);
      } else if (role === "backup") {
        roleFactor = 0.25;
        notes.push(`Backup QB${weekStarter || usual ? ` behind ${nameOf((weekStarter ?? usual) as string)}` : ""}`);
      }
    } else if (snapShare !== null && recentGames >= 2 && snapShare < 0.35) {
      roleFactor = 0.85;
      notes.push(`Part-time role (${Math.round(snapShare * 100)}% of snaps lately)`);
    }

    // --- This week's expected points ---
    let weekScore: number;
    if (projection > 0) {
      weekScore = 0.8 * projection + 0.2 * recentForm;
    } else if (role === "backup" || role === "sidelined") {
      weekScore = 0;
    } else {
      weekScore = 0.6 * recentForm;
      if (team && !onBye && !isOut) notes.push("No Sleeper projection — may be inactive, check news before starting");
    }
    if (matchup && weekScore > 0) {
      // Projections already bake in the matchup, so only lean on it lightly.
      weekScore *= Math.min(1.12, Math.max(0.88, 1 + (matchup.ratio - 1) * 0.5));
    }
    if (usage && weekScore > 0 && usage.trendFactor !== 1) weekScore *= usage.trendFactor;
    const game = onBye ? null : gameOutlook(team ? inputs.games?.get(team) : undefined, team, position);
    if (game && weekScore > 0) {
      weekScore *= game.factor;
      if (game.note) notes.push(game.note);
    }
    if (!team) {
      weekScore = 0;
      notes.push("Not on an NFL roster");
    } else if (onBye) {
      weekScore = 0;
      notes.push("On bye this week");
    }
    if (isOut) {
      weekScore = 0;
      notes.unshift(`Ruled ${injury}${info?.injury_body_part ? ` (${info.injury_body_part})` : ""}`);
    } else if (injury && INJURY_FACTOR[injury]) {
      weekScore *= INJURY_FACTOR[injury];
      notes.push(`${injury}${info?.injury_body_part ? ` (${info.injury_body_part})` : ""} — monitor before kickoff`);
    }

    // --- Rest-of-season value ---
    let rosValue = 0.4 * seasonForm + 0.35 * recentForm + 0.25 * (projection > 0 ? projection : prior);
    rosValue *= roleFactor;
    if (injury === "IR" || injury === "PUP") rosValue *= 0.45;
    else if (injury === "Out") rosValue *= 0.75;
    else if (injury === "Sus") rosValue *= 0.7;
    if (!team) rosValue *= 0.2;
    const adds = trendById.get(id) ?? 0;
    if (adds > 0) rosValue *= 1 + Math.min(0.1, Math.log10(1 + adds) / 60);

    result.set(id, {
      id,
      name: displayName(info, id),
      position,
      eligible: info?.fantasy_positions?.length ? info.fantasy_positions : [position],
      team,
      injury,
      injuryBodyPart: info?.injury_body_part ?? null,
      onBye,
      matchup,
      projection: round1(projection),
      seasonAvg: seasonAvg === null ? null : round1(seasonAvg),
      gamesPlayed,
      recentAvg: recentAvg === null ? null : round1(recentAvg),
      recentGames,
      snapShare: snapShare === null ? null : Math.round(snapShare * 100) / 100,
      usage: usage && {
        touches: round1(usage.touches),
        seasonTouches: usage.seasonTouches === null ? null : round1(usage.seasonTouches),
        carryShare: Math.round(usage.carryShare * 100) / 100,
        targetShare: Math.round(usage.targetShare * 100) / 100,
        redZone: round1(usage.redZone),
        trendFactor: Math.round(usage.trendFactor * 1000) / 1000,
      },
      role,
      trendingAdds: adds,
      weekScore: round1(weekScore),
      playChance: null,
      rosValue: round1(rosValue),
      stash: null,
      game,
      notes,
    });
  }
  return result;
}

const SLOT_NAMES: Record<string, string> = {
  SUPER_FLEX: "Superflex",
  FLEX: "Flex",
  WRRB_FLEX: "RB/WR flex",
  REC_FLEX: "WR/TE flex",
};

export const slotName = (slot: string) => SLOT_NAMES[slot] ?? slot;

const isStarterSlot = (slot: string) => slot in SLOT_ELIGIBILITY;

/** Greedy lineup fill: most restrictive slots first, best available player each time. */
export function optimizeLineup(
  rosterPositions: string[],
  players: PlayerAnalysis[],
  current: LineupSlot[],
): LineupSlot[] {
  const starterSlots = rosterPositions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const order = starterSlots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      const ea = SLOT_ELIGIBILITY[a.slot]?.length ?? 0;
      const eb = SLOT_ELIGIBILITY[b.slot]?.length ?? 0;
      return ea - eb;
    });
  const used = new Set<string>();
  const filled: LineupSlot[] = starterSlots.map((slot) => ({ slot, player: null }));

  // Slots we don't model (IDP etc.) keep whoever is in them now.
  for (const { slot, index } of order) {
    if (!isStarterSlot(slot)) {
      const keep = current[index]?.player ?? null;
      filled[index] = { slot, player: keep };
      if (keep) used.add(keep.id);
    }
  }
  for (const { slot, index } of order) {
    if (!isStarterSlot(slot)) continue;
    const eligible = SLOT_ELIGIBILITY[slot];
    const best = players
      .filter((p) => !used.has(p.id) && p.eligible.some((pos) => eligible.includes(pos)))
      .sort((a, b) => b.weekScore - a.weekScore || b.rosValue - a.rosValue)[0];
    if (best) {
      used.add(best.id);
      filled[index] = { slot, player: best };
    }
  }
  return filled;
}

/** Rest-of-season value for deciding whether to keep someone: his own value plus stash upside. */
export function keepValue(p: PlayerAnalysis): number {
  return p.rosValue + (p.stash?.value ?? 0);
}

/**
 * Credit your backups (RB/TE/QB) whose starter might leave or get hurt:
 * trade rumors, injuries, analysts calling them the stash. Network failures
 * just mean no stash credit.
 */
async function applyStashes(active: PlayerAnalysis[], inputs: Inputs, week: number) {
  const scoring = inputs.league.scoring_settings;
  const byTeamPos = new Map<string, { id: string; pts: number }[]>();
  for (const r of inputs.projections) {
    const pos = r.player?.position;
    if (!r.team || !pos || !STASH_POSITIONS.includes(pos)) continue;
    const key = `${r.team}|${pos}`;
    const list = byTeamPos.get(key) ?? [];
    list.push({ id: r.player_id, pts: points(r.stats, scoring, pos) });
    byTeamPos.set(key, list);
  }
  const pending: { player: PlayerAnalysis; starterId: string; clearBackup: boolean }[] = [];
  for (const p of active) {
    if (!p.team || !STASH_POSITIONS.includes(p.position)) continue;
    const mates = [...(byTeamPos.get(`${p.team}|${p.position}`) ?? [])].sort((a, b) => b.pts - a.pts);
    // Your own starter ahead of him is a handcuff you already own the upside of; still counts.
    const pair = stashPairing(p, mates);
    if (pair) pending.push({ player: p, ...pair });
  }
  if (!pending.length) return;
  const starters = analyzePlayers([...new Set(pending.map((x) => x.starterId))], inputs, new Map());
  const candidates: StashCandidate[] = pending
    .filter((x) => starters.has(x.starterId))
    .map((x) => ({ player: x.player, starter: starters.get(x.starterId)!, clearBackup: x.clearBackup }));
  try {
    const stashes = await assessStashes(candidates, week);
    for (const p of active) {
      const st = stashes.get(p.id);
      if (!st) continue;
      p.stash = st;
      p.notes.push(stashNote(p, st));
    }
  } catch {
    // No news, no stash credit.
  }
}

function benchReason(p: PlayerAnalysis): string {
  if (p.onBye) return "on bye";
  if (p.injury && OUT_STATUSES.has(p.injury)) return `ruled ${p.injury}`;
  if (p.playChance !== null && p.playChance < 0.85) return `only ~${Math.round(p.playChance * 100)}% to play this week`;
  if (p.injury && INJURY_FACTOR[p.injury]) return `${p.injury.toLowerCase()} and projected lower`;
  return `projects ${p.weekScore} pts`;
}

/** "12.3 pts/game over the last 3 games" — with the real sample size. */
function formText(p: PlayerAnalysis): string | null {
  if (p.recentAvg === null) return null;
  const games = p.recentGames === 1 ? "1 game" : `${p.recentGames} games`;
  return `${p.recentAvg} pts/game over the last ${games}`;
}

function startReason(p: PlayerAnalysis): string {
  const parts = [`projects ${p.weekScore} pts`];
  if (p.matchup) parts.push(describeMatchup(p.matchup, p.position));
  const form = formText(p);
  if (form) parts.push(form);
  return parts.join(", ");
}

function buildMoves(current: LineupSlot[], optimal: LineupSlot[]): LineupMove[] {
  const currentIds = new Set(current.map((s) => s.player?.id).filter(Boolean));
  const optimalIds = new Set(optimal.map((s) => s.player?.id).filter(Boolean));
  const ins = optimal
    .filter((s) => s.player && !currentIds.has(s.player.id))
    .sort((a, b) => (b.player as PlayerAnalysis).weekScore - (a.player as PlayerAnalysis).weekScore);
  const outs = current
    .filter((s) => s.player && !optimalIds.has(s.player.id))
    .map((s) => s.player as PlayerAnalysis)
    .sort((a, b) => a.weekScore - b.weekScore);
  // Pair each new starter with a benched player he can replace (same position first).
  const pairedOut = new Set<string>();
  const vsFor = new Map<string, PlayerAnalysis>();
  for (const s of ins) {
    const p = s.player as PlayerAnalysis;
    const pick =
      outs.find((o) => !pairedOut.has(o.id) && o.position === p.position) ??
      outs.find((o) => !pairedOut.has(o.id) && o.eligible.some((e) => SLOT_ELIGIBILITY[s.slot]?.includes(e))) ??
      outs.find((o) => !pairedOut.has(o.id));
    if (pick) {
      pairedOut.add(pick.id);
      vsFor.set(p.id, pick);
      vsFor.set(pick.id, p);
    }
  }
  const starts: LineupMove[] = ins.map((s) => {
    const p = s.player as PlayerAnalysis;
    return {
      action: "start",
      player: p,
      vs: vsFor.get(p.id) ?? null,
      slot: slotName(s.slot),
      reason: capitalize(startReason(p)) + ".",
    };
  });
  const benches: LineupMove[] = outs.map((p) => ({
    action: "bench",
    player: p,
    vs: vsFor.get(p.id) ?? null,
    slot: null,
    reason: capitalize(benchReason(p)) + ".",
  }));
  return [...starts, ...benches];
}

/**
 * How much a free agent would improve a starting lineup (0 if they'd sit).
 * Counts both rest-of-season and this week, so a free agent jumps the queue
 * when the starter at that spot is out this week.
 */
function lineupUpgrade(t: PlayerAnalysis, lineup: LineupSlot[]) {
  const slots = lineup.filter((s) => SLOT_ELIGIBILITY[s.slot]?.some((pos) => t.eligible.includes(pos)));
  if (!slots.length) return { gain: 0, over: null as PlayerAnalysis | null };
  if (slots.some((s) => !s.player)) return { gain: t.rosValue + t.weekScore * 0.5, over: null };
  const filled = slots.map((s) => s.player as PlayerAnalysis);
  const weakest = [...filled].sort((a, b) => a.rosValue - b.rosValue)[0];
  const weakestThisWeek = [...filled].sort((a, b) => a.weekScore - b.weekScore)[0];
  const rosGain = Math.max(0, t.rosValue - weakest.rosValue);
  const weekGain = Math.max(0, t.weekScore - weakestThisWeek.weekScore);
  const over = weekGain * 0.5 > rosGain ? weakestThisWeek : weakest;
  return { gain: rosGain + weekGain * 0.5, over: rosGain + weekGain > 0 ? over : null };
}

/**
 * Which free agents another team would actually claim. Judged on their
 * rest-of-season lineup (so a team with three good QBs doesn't chase a QB
 * because one of theirs is on bye), plus real holes this week: a lineup slot
 * they can't fill with anyone healthy.
 */
function rivalInterest(
  pool: PlayerAnalysis[],
  players: PlayerAnalysis[],
  weekLineup: LineupSlot[],
  rosterPositions: string[],
  current: LineupSlot[],
): Map<string, Interest> {
  // Best lineup by rest-of-season value: who they'd start in a normal week.
  const asRos = players.map((p) => ({ ...p, weekScore: p.rosValue }));
  const rosLineup = optimizeLineup(rosterPositions, asRos, current);
  const out = new Map<string, Interest>();
  for (const p of pool) {
    const fits = (slot: string) => SLOT_ELIGIBILITY[slot]?.some((pos) => p.eligible.includes(pos));
    const rosSlots = rosLineup.filter((s) => fits(s.slot));
    if (!rosSlots.length) continue;
    let best: Interest | null = null;
    const open = rosSlots.find((s) => !s.player);
    if (open) best = { gain: p.rosValue, over: null, why: `they have nobody for ${slotName(open.slot)}` };
    else {
      const weakest = [...rosSlots].sort((a, b) => a.player!.rosValue - b.player!.rosValue)[0].player!;
      const gain = p.rosValue - weakest.rosValue;
      if (gain >= 1.5) best = { gain, over: weakest, why: `he'd start over ${weakest.name} for them` };
    }
    // A hole this week (bye, injury) that nobody on their bench covers.
    const hole = weekLineup.find((s) => fits(s.slot) && (!s.player || s.player.weekScore <= 0));
    if (hole && !p.onBye && p.weekScore * 0.5 > (best?.gain ?? 0)) {
      best = {
        gain: p.weekScore * 0.5,
        over: hole.player,
        why: `they have no one healthy for ${slotName(hole.slot)} this week`,
      };
    }
    if (best && best.gain >= 1.5) out.set(p.id, best);
  }
  return out;
}

/** How many players at each position the lineup needs at minimum (dedicated slots only). */
function minimumNeeds(rosterPositions: string[]): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const slot of rosterPositions) {
    const elig = SLOT_ELIGIBILITY[slot];
    if (elig?.length === 1) needs[elig[0]] = (needs[elig[0]] ?? 0) + 1;
    // Superflex slots are almost always filled by a QB, so keep one per slot.
    if (slot === "SUPER_FLEX") needs.QB = (needs.QB ?? 0) + 1;
  }
  return needs;
}

/**
 * Replace the flat Questionable/Doubtful discounts with the injury model's
 * chance to play (designation + this week's practice reports + news), so an
 * injured player's projection is his expected points. Best effort: if the
 * news can't be fetched, the flat discounts stay.
 */
async function applyPlayChances(players: PlayerAnalysis[], season: string, week: number) {
  const hurt = players.filter((p) => p.team && !p.onBye && p.injury && !OUT_STATUSES.has(p.injury));
  if (!hurt.length) return;
  const { rows } = await assessInjuries(
    hurt.map((p) => ({ player: p, side: "mine" as const, starter: false })),
    season,
    week,
    { articles: false },
  ).catch(() => ({ rows: [] }));
  for (const r of rows) {
    const p = r.player;
    const flat = (p.injury && INJURY_FACTOR[p.injury]) || 1;
    const full = p.weekScore / flat;
    p.playChance = r.probability;
    p.weekScore = round1(full * r.probability);
    const practice = r.practice.length
      ? `; practice ${r.practice.map((n) => (n.level === "Limited" ? "LP" : n.level === "Full" ? "FP" : "DNP")).join(" → ")}`
      : "";
    const note = `~${Math.round(r.probability * 100)}% to play (${p.injury}${practice}) — projection scaled to ${p.weekScore}`;
    // Lead with it: it's the most important thing about this player this week.
    p.notes = [note, ...p.notes.filter((n) => !n.includes("monitor before kickoff"))];
  }
}

export async function analyzeLeague(opts: {
  leagueId: string;
  userId: string;
  season: string;
  week: number;
  prefs?: Prefs;
}): Promise<Analysis> {
  const { leagueId, userId, season, week } = opts;
  const prefs = opts.prefs ?? {};
  const recentWeeks = Array.from({ length: RECENT_WEEKS }, (_, i) => week - 1 - i).filter((w) => w >= 1);

  const [league, rosters, users, matchups, projections, seasonStats, trending, weekGames, ...recentStats] =
    await Promise.all([
      getLeague(leagueId),
      getRosters(leagueId),
      getLeagueUsers(leagueId),
      getMatchups(leagueId, week).catch(() => []),
      getWeekProjections(season, week),
      getSeasonStats(season).catch(() => [] as StatRow[]),
      getTrendingAdds().catch(() => [] as TrendingPlayer[]),
      getWeekGames(season, week).catch(() => null),
      ...recentWeeks.map((w) => getWeekStats(season, w).catch(() => [] as StatRow[])),
    ]);
  if (!league) throw new Error("League not found.");

  const mine = rosters.find((r: Roster) => r.owner_id === userId || (r.co_owners ?? []).includes(userId));
  if (!mine) throw new Error("You don't have a team in this league.");
  if (!mine.players?.length) {
    throw new Error("Your roster is empty — has the draft happened yet?");
  }

  const bestBall = league.settings.best_ball === 1;
  const teamNameOf = (ownerId: string | null) => {
    const u = users.find((x) => x.user_id === ownerId);
    return (u as unknown as { metadata?: { team_name?: string } })?.metadata?.team_name || u?.display_name || "Team";
  };
  const owner = users.find((u) => u.user_id === userId);
  const teamName = teamNameOf(userId);

  const inputs: Inputs = {
    league,
    week,
    projections,
    seasonStats,
    recentStats: recentStats as StatRow[][],
    trending,
    games: weekGames?.byTeam ?? null,
  };

  // Players on IR/taxi aren't on the active roster and can't be started.
  const reserved = new Set([...(mine.reserve ?? []), ...(mine.taxi ?? [])]);
  const myIds = mine.players.filter((id) => id !== "0");

  // Rostered players without a projection row (long-term IR, cut players)
  // still need names; fall back to the full player DB only when that happens.
  const projectedIds = new Set(projections.map((r) => r.player_id));
  const extraInfo = new Map<string, PlayerInfo>();
  if (myIds.some((id) => !projectedIds.has(id) && !/^[A-Z]{2,3}$/.test(id))) {
    try {
      const all = await getAllPlayers();
      for (const id of myIds) if (all[id]) extraInfo.set(id, all[id]);
    } catch {
      // Names fall back to IDs; the analysis still works.
    }
  }

  const myPlayers = analyzePlayers(myIds, inputs, extraInfo);
  await applyPlayChances([...myPlayers.values()], season, week);
  const roster = [...myPlayers.values()].sort((a, b) => b.weekScore - a.weekScore);
  const active = roster.filter((p) => !reserved.has(p.id));
  await applyStashes(active, inputs, week);
  // Your designated backups say so wherever they show up.
  for (const p of roster) {
    const starter = prefs[p.id]?.backupFor;
    if (starter) p.notes.unshift(`Your backup for ${myPlayers.get(starter)?.name ?? "a starter"}`);
  }

  const starterSlots = league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const currentLineup: LineupSlot[] = starterSlots.map((slot, i) => {
    const id = mine.starters?.[i];
    return { slot, player: id && id !== "0" ? (myPlayers.get(id) ?? null) : null };
  });
  const optimalLineup = optimizeLineup(league.roster_positions, active, currentLineup);
  const total = (l: LineupSlot[]) => round1(l.reduce((sum, s) => sum + (s.player?.weekScore ?? 0), 0));

  const warnings: string[] = [];
  for (const s of currentLineup) {
    if (!s.player) warnings.push(`Your ${slotName(s.slot)} slot is empty.`);
    else if (s.player.weekScore === 0) {
      warnings.push(
        `${s.player.name} is in your ${slotName(s.slot)} slot: ${s.player.notes[0] ?? "not projected to score"}.`,
      );
    } else if (s.player.playChance !== null && s.player.playChance < 0.6) {
      const keep = optimalLineup.some((o) => o.player?.id === s.player!.id);
      warnings.push(
        `${s.player.name} is only ~${Math.round(s.player.playChance * 100)}% to play this week (${s.player.injury})${
          keep ? ": still your best option, but have a backup ready and check before kickoff" : ""
        }.`,
      );
    }
  }

  // --- Waiver wire ---
  const rostered = new Set(rosters.flatMap((r) => [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]));
  const usedPositions = new Set(league.roster_positions.flatMap((slot) => SLOT_ELIGIBILITY[slot] ?? []));
  const freeAgentIds = projections
    .filter((r) => !rostered.has(r.player_id) && usedPositions.has(r.player?.position ?? ""))
    .map((r) => r.player_id);
  const freeAgentPool = [...analyzePlayers(freeAgentIds, inputs, new Map()).values()]
    .filter((p) => p.team || p.injury)
    .sort((a, b) => b.rosValue - a.rosValue);
  const freeAgents = freeAgentPool.filter(
    (p) =>
      p.team &&
      !(p.injury && OUT_STATUSES.has(p.injury)) &&
      // Backups and players Sleeper doesn't expect to play aren't pickups.
      p.role !== "backup" &&
      p.role !== "sidelined" &&
      (p.projection > 0 || p.onBye),
  );
  // Rank by rest-of-season value, but streaming K/DEF lean on this week only.
  const waiverRank = (p: PlayerAnalysis) => (p.position === "K" || p.position === "DEF" ? p.weekScore : p.rosValue);

  const waiversByPosition: Record<string, PlayerAnalysis[]> = {};
  // Best free agents for THIS week only (gameday fill-ins).
  const streamersByPosition: Record<string, PlayerAnalysis[]> = {};
  for (const pos of OFFENSE_ORDER) {
    if (!usedPositions.has(pos)) continue;
    const atPos = freeAgents.filter((p) => p.position === pos);
    waiversByPosition[pos] = [...atPos].sort((a, b) => waiverRank(b) - waiverRank(a)).slice(0, 8);
    streamersByPosition[pos] = [...atPos].sort((a, b) => b.weekScore - a.weekScore).slice(0, 15);
  }

  // Value over replacement: how much better a player is than what's freely
  // available at the same position. Without it, QBs (who all score a lot)
  // would crowd every other position out of the recommendations.
  const replacement: Record<string, number> = {};
  for (const pos of Object.keys(waiversByPosition)) {
    const values = freeAgents
      .filter((p) => p.position === pos)
      .map((p) => p.rosValue)
      .sort((a, b) => b - a);
    replacement[pos] = values[REPLACEMENT_INDEX] ?? values[values.length - 1] ?? 0;
  }
  const vor = (p: PlayerAnalysis) => p.rosValue - (replacement[p.position] ?? 0);
  // For keeping a player: his own value plus any stash upside.
  const holdValue = (p: PlayerAnalysis) => keepValue(p) - (replacement[p.position] ?? 0);

  // --- Drops ---
  const optimalIds = new Set(optimalLineup.map((s) => s.player?.id).filter(Boolean));
  const needs = minimumNeeds(league.roster_positions);
  const countAt = (pos: string, pool: PlayerAnalysis[]) => pool.filter((p) => p.position === pos).length;
  const benchPlayers = active.filter((p) => !optimalIds.has(p.id));

  const canDrop = (p: PlayerAnalysis, replacement?: PlayerAnalysis) => {
    const need = needs[p.position] ?? 0;
    const have = countAt(p.position, active) + (replacement?.position === p.position ? 1 : 0);
    return have - 1 >= need;
  };

  // Your best lineup on rest-of-season value: who you'd start in a normal
  // week. They're never drops, even when on bye or hurt this week.
  const rosCore = new Set(
    optimizeLineup(
      league.roster_positions,
      active.map((p) => ({ ...p, weekScore: keepValue(p) })),
      currentLineup,
    )
      .map((s) => s.player?.id)
      .filter(Boolean),
  );
  // Players you've said to keep are never suggested as drops.
  const dropPool = benchPlayers
    .filter((p) => canDrop(p) && !isNoDrop(prefs, p.id) && !rosCore.has(p.id))
    .sort((a, b) => holdValue(a) - holdValue(b));
  // Only flag players at or below what the waiver wire offers at their spot.
  const drops: DropCandidate[] = dropPool
    .filter((p) => holdValue(p) < 1)
    .slice(0, 3)
    .map((p) => {
      const reasons: string[] = [];
      if (p.injury === "IR" || p.injury === "PUP") reasons.push(`on ${p.injury}`);
      if (!p.team) reasons.push("no longer on an NFL roster");
      if (p.seasonAvg !== null) reasons.push(`${p.seasonAvg} pts/game this season`);
      const form = formText(p);
      if (form) reasons.push(form);
      if (p.seasonAvg === null && p.recentAvg === null) reasons.push(`projects ${p.projection} pts this week`);
      return { player: p, reason: `Lowest rest-of-season value on your bench: ${reasons.join(", ")}.` };
    });

  // --- Waiver targets paired with a drop ---
  const rosterSize = league.roster_positions.filter((s) => s !== "IR" && s !== "TAXI").length;
  const rosterFull = active.length >= rosterSize;
  const takenDrops = new Set<string>();
  const streamWarned = new Set<string>();
  const byeNotes: { name: string; text: string }[] = [];
  const waivers: WaiverTarget[] = [];
  const startUpgrade = (t: PlayerAnalysis) => lineupUpgrade(t, optimalLineup);
  const claimValue = (t: PlayerAnalysis) => vor(t) + startUpgrade(t).gain;

  const perPosition: Record<string, number> = {};
  // One QB claim per QB-capable lineup spot (two in superflex); K/DEF are
  // weekly streams, so one each.
  const qbSpots = league.roster_positions.filter((slot) => slot === "QB" || slot === "SUPER_FLEX").length;
  const claimCap = (pos: string) => (pos === "K" || pos === "DEF" ? 1 : pos === "QB" ? Math.max(1, qbSpots) : 2);
  const candidates = freeAgents
    .filter((p) => p.position !== "K" && p.position !== "DEF")
    .sort((a, b) => claimValue(b) - claimValue(a))
    .slice(0, 40);
  // Streaming K/DEF is about this week only.
  const streamers = freeAgents
    .filter((p) => p.position === "K" || p.position === "DEF")
    .sort((a, b) => b.weekScore - a.weekScore);

  for (const target of [...candidates, ...streamers]) {
    if (waivers.length >= 6) break;
    if ((perPosition[target.position] ?? 0) >= claimCap(target.position)) continue;
    const streamer = target.position === "K" || target.position === "DEF";
    const upgrade = startUpgrade(target);
    let dropFor: PlayerAnalysis | null = null;

    if (streamer) {
      // Only stream a K/DEF if it clearly beats the one you'd start this week.
      const mineAtPos = active
        .filter((p) => p.position === target.position && !takenDrops.has(p.id))
        .sort((a, b) => a.weekScore - b.weekScore);
      const bestMine = mineAtPos[mineAtPos.length - 1];
      if (bestMine && target.weekScore < bestMine.weekScore + 1.5) continue;
      // Never drop a K/DEF who's as good as the streamer the rest of the way
      // (e.g. a top kicker on bye): you'd just want him back next week.
      // Kickers and defenses swing a lot week to week, so judge them on the season average.
      const kdValue = (p: PlayerAnalysis) => p.seasonAvg ?? p.rosValue;
      dropFor = mineAtPos.find((p) => kdValue(p) < kdValue(target) - 1 && !isNoDrop(prefs, p.id)) ?? null;
      if (!dropFor && rosterFull) {
        // Carry two for a week only if a bench spot is truly free (below waiver-level value).
        dropFor =
          dropPool.find(
            (p) => !takenDrops.has(p.id) && p.position !== target.position && canDrop(p) && holdValue(p) < 0,
          ) ?? null;
        if (!dropFor) {
          const keeper = mineAtPos.find((p) => p.onBye || p.weekScore === 0);
          if (keeper && !streamWarned.has(target.position)) {
            streamWarned.add(target.position);
            byeNotes.push({
              name: keeper.name,
              text: `${keeper.name} is ${keeper.onBye ? "on bye" : "out"} in week ${week}. Keep him (${keeper.seasonAvg ?? keeper.rosValue} pts/game this season); you'll take a 0 at ${target.position} unless you free up a bench spot for a one-week streamer like ${target.name} (${target.weekScore} projected).`,
            });
          }
          continue;
        }
      }
    } else {
      const value = claimValue(target);
      if (value <= 0.5) continue;
      if (rosterFull) {
        dropFor = dropPool.find((p) => !takenDrops.has(p.id) && canDrop(p, target) && holdValue(p) + 1 < value) ?? null;
        if (!dropFor) continue;
      }
    }
    if (dropFor) takenDrops.add(dropFor.id);
    perPosition[target.position] = (perPosition[target.position] ?? 0) + 1;

    const parts: string[] = [];
    if (!streamer && upgrade.over && upgrade.gain > 0) parts.push(`would start over ${upgrade.over.name}`);
    if (target.trendingAdds > 0)
      parts.push(`${target.trendingAdds.toLocaleString()} adds across Sleeper in the last 72h`);
    const form = formText(target);
    if (form) parts.push(form);
    if (target.onBye) parts.push(`on bye in week ${week}`);
    else
      parts.push(
        `projects ${target.weekScore} pts in week ${week}${target.matchup ? ` ${describeMatchup(target.matchup, target.position)}` : ""}`,
      );
    if (dropFor) {
      parts.push(
        streamer
          ? dropFor.position === target.position
            ? `${dropFor.name} projects only ${dropFor.weekScore} and isn't better the rest of the way`
            : `carry two ${target.position}s this week: ${dropFor.name} is below waiver-level value, and you keep ${
                active.find((p) => p.position === target.position)?.name ?? `your ${target.position}`
              } for when he's back`
          : `${dropFor.name} is your most expendable bench player`,
      );
    }
    waivers.push({
      player: target,
      dropFor,
      reason: capitalize(parts.join("; ")) + ".",
      contestedBy: [],
      likelyClaimedBy: null,
      likelyClaimWhy: null,
      bid: null,
    });
  }

  // --- Waiver order and rivals ---
  const waiverType: WaiverType =
    league.settings.waiver_type === 2 ? "faab" : league.settings.waiver_type === 1 ? "reverse" : "rolling";
  const budget = waiverType === "faab" ? Number(league.settings.waiver_budget ?? 100) : null;
  const waiverPos = (r: Roster) =>
    typeof r.settings?.waiver_position === "number" ? r.settings.waiver_position : null;
  const budgetLeft = (r: Roster) => (budget === null ? null : budget - Number(r.settings?.waiver_budget_used ?? 0));
  const myPos = waiverPos(mine) ?? Infinity;
  const myBudget = budgetLeft(mine) ?? 0;
  // Who gets a player before you: in FAAB, anyone with more money left (or
  // the same and a better tiebreak); otherwise anyone higher in the order.
  const isAhead = (r: Roster) => {
    const pos = waiverPos(r) ?? Infinity;
    if (waiverType !== "faab") return pos < myPos;
    const left = budgetLeft(r) ?? 0;
    return left > myBudget || (left === myBudget && pos < myPos);
  };

  // Model every other team the same way as yours: their players, best
  // lineup, and which free agents would crack it. Used to predict waiver
  // claims, FAAB competition and trades.
  const contestPool = freeAgents
    .filter((p) => p.position !== "K" && p.position !== "DEF" && !p.onBye && vor(p) > -2)
    .sort((a, b) => vor(b) - vor(a))
    .slice(0, 40);
  const others: TeamModel[] = rosters
    .filter((r) => r.roster_id !== mine.roster_id && r.players?.length)
    .map((r) => {
      const out = new Set([...(r.reserve ?? []), ...(r.taxi ?? [])]);
      const theirIds = (r.players ?? []).filter((id) => id !== "0" && !out.has(id));
      const players = [...analyzePlayers(theirIds, inputs, new Map()).values()];
      const byId = new Map(players.map((p) => [p.id, p]));
      const theirCurrent = starterSlots.map((slot, i) => {
        const id = r.starters?.[i];
        return { slot, player: id && id !== "0" ? (byId.get(id) ?? null) : null };
      });
      const lineup = optimizeLineup(league.roster_positions, players, theirCurrent);
      const interest = rivalInterest(contestPool, players, lineup, league.roster_positions, theirCurrent);
      return {
        roster: r,
        teamName: teamNameOf(r.owner_id),
        avatar: users.find((u) => u.user_id === r.owner_id)?.avatar ?? null,
        players,
        lineup,
        interest,
      };
    });

  const rivals: Rival[] = others
    .filter((t) => isAhead(t.roster))
    .map((t) => ({
      rosterId: t.roster.roster_id,
      teamName: t.teamName,
      avatar: t.avatar,
      waiverPosition: waiverPos(t.roster),
      budgetLeft: budgetLeft(t.roster),
      targets: contestPool
        .filter((p) => t.interest.has(p.id))
        .sort((x, y) => vor(y) + t.interest.get(y.id)!.gain - (vor(x) + t.interest.get(x.id)!.gain))
        .slice(0, 5)
        .map((p) => ({ player: p, over: t.interest.get(p.id)!.over, why: t.interest.get(p.id)!.why })),
      projectedClaim: null as PlayerAnalysis | null,
    }))
    .sort((a, b) =>
      waiverType === "faab"
        ? (b.budgetLeft ?? 0) - (a.budgetLeft ?? 0) || (a.waiverPosition ?? 99) - (b.waiverPosition ?? 99)
        : (a.waiverPosition ?? 99) - (b.waiverPosition ?? 99),
    );
  // FAAB: what a player is worth as a share of the budget left. A free agent
  // who adds ~5 pts/game over your lineup is worth about a quarter of it
  // (capped at 35%); a marginal upgrade a few percent. Everyone else is estimated the same way
  // from their own need and budget, and you bid just over the likeliest
  // competitor — but never far past what the player is worth to you.
  const minBid = Number(league.settings.waiver_bid_min ?? 0);
  const budgetShare = (value: number) => Math.min(0.35, Math.max(0.02, value / 20));
  const suggestBid = (w: WaiverTarget): BidSuggestion => {
    const p = w.player;
    if (p.position === "K" || p.position === "DEF") {
      const amount = Math.min(myBudget, Math.max(minBid, 1));
      return { suggested: amount, value: amount, toWin: null, ceiling: amount, competitors: [] };
    }
    const value = Math.max(minBid, Math.round(myBudget * budgetShare(claimValue(p))));
    const ceiling = Math.min(myBudget, Math.max(value, Math.round(value * 1.6)));
    const competitors = others
      .filter((t) => t.interest.has(p.id))
      .map((t) => {
        const left = budgetLeft(t.roster) ?? 0;
        const estimate = Math.min(left, Math.round(left * budgetShare(vor(p) + t.interest.get(p.id)!.gain)));
        return { teamName: t.teamName, budgetLeft: left, estimate };
      })
      .filter((c) => c.estimate > 0)
      .sort((a, b) => b.estimate - a.estimate);
    const toWin = competitors.length ? Math.min(myBudget, competitors[0].estimate + 1) : null;
    const suggested =
      toWin === null
        ? Math.max(minBid, Math.round(value * 0.6)) // nobody else needs this player: save money
        : Math.min(ceiling, Math.max(value, toWin));
    return { suggested, value, toWin, ceiling, competitors: competitors.slice(0, 4) };
  };

  // Simulate the waiver run up to your turn: each team ahead takes its top
  // target that hasn't gone yet. A rough guess (teams can put in several
  // claims), but it shows which of your targets are realistic.
  const claimedBy = new Map<string, { team: string; why: string }>();
  for (const r of rivals) {
    const pick = r.targets.find((t) => !claimedBy.has(t.player.id));
    if (pick) {
      r.projectedClaim = pick.player;
      claimedBy.set(pick.player.id, { team: r.teamName, why: pick.why });
    }
  }
  for (const w of waivers) {
    w.contestedBy = rivals.filter((r) => r.targets.some((t) => t.player.id === w.player.id)).map((r) => r.teamName);
    w.likelyClaimedBy = claimedBy.get(w.player.id)?.team ?? null;
    w.likelyClaimWhy = claimedBy.get(w.player.id)?.why ?? null;
    if (waiverType === "faab") {
      // Blind bidding: everyone with interest competes, regardless of order.
      const bid = suggestBid(w);
      w.bid = bid;
      w.contestedBy = bid.competitors.map((c) => c.teamName);
      const top = bid.competitors[0];
      w.likelyClaimedBy = top && top.estimate >= bid.suggested ? top.teamName : null;
      w.likelyClaimWhy = w.likelyClaimedBy
        ? (others.find((t) => t.teamName === w.likelyClaimedBy)?.interest.get(w.player.id)?.why ?? null)
        : null;
    }
  }
  const recommended = new Set(waivers.map((w) => w.player.id));
  const backupTargets: PlayerAnalysis[] = [];
  if (waivers.some((w) => w.likelyClaimedBy)) {
    const perPos: Record<string, number> = {};
    for (const p of candidates) {
      if (backupTargets.length >= 4) break;
      if (recommended.has(p.id) || claimedBy.has(p.id) || claimValue(p) <= 0.5) continue;
      if ((perPos[p.position] ?? 0) >= claimCap(p.position)) continue;
      perPos[p.position] = (perPos[p.position] ?? 0) + 1;
      backupTargets.push(p);
    }
  }
  const waiver: WaiverInfo = {
    type: waiverType,
    position: waiverPos(mine),
    teams: rosters.length,
    budget,
    budgetLeft: budgetLeft(mine),
  };

  // This week's opponent, scored with the same model as your team.
  let opponent: Opponent | null = null;
  const mineMatchup = matchups.find((m) => m.roster_id === mine.roster_id);
  const theirs = mineMatchup?.matchup_id
    ? matchups.find((m) => m.matchup_id === mineMatchup.matchup_id && m.roster_id !== mine.roster_id)
    : undefined;
  if (theirs) {
    const theirRoster = rosters.find((r) => r.roster_id === theirs.roster_id);
    const starters = (theirs.starters ?? theirRoster?.starters ?? []).filter((id) => id && id !== "0");
    const scored = analyzePlayers(starters, inputs, new Map());
    const ownerId = theirRoster?.owner_id ?? null;
    opponent = {
      rosterId: theirs.roster_id,
      teamName: teamNameOf(ownerId),
      avatar: users.find((u) => u.user_id === ownerId)?.avatar ?? null,
      projected: total(starters.map((id) => ({ slot: "", player: scored.get(id) ?? null }))),
      starters: starters.map((id) => scored.get(id)).filter((p): p is PlayerAnalysis => Boolean(p)),
    };
  }

  // A keeper K/DEF on bye: say to hold him instead of the generic "on bye in your lineup" alert.
  for (const note of byeNotes) {
    const i = warnings.findIndex((w) => w.startsWith(`${note.name} is in your`));
    if (i >= 0) warnings[i] = note.text;
    else warnings.push(note.text);
  }

  return {
    league,
    opponent,
    waiver,
    rivals,
    backupTargets,
    teamName,
    myRosterId: mine.roster_id,
    avatar: owner?.avatar ?? null,
    season,
    week,
    scoringLabel: scoringLabel(league.scoring_settings),
    currentLineup,
    optimalLineup,
    fetchedAt: Date.now(),
    currentTotal: total(currentLineup),
    optimalTotal: total(optimalLineup),
    bestBall,
    moves: bestBall ? [] : buildMoves(currentLineup, optimalLineup),
    warnings: bestBall ? [] : warnings,
    roster,
    activeRoster: active,
    defenseVs: buildDefenseTable(seasonStats),
    prefs,
    otherTeams: others.map((t) => ({
      rosterId: t.roster.roster_id,
      teamName: t.teamName,
      avatar: t.avatar,
      players: t.players,
    })),
    drops,
    waivers,
    waiversByPosition,
    streamersByPosition,
    freeAgentPool,
    replacementLevel: replacement,
    rosterFull,
  };
}

const OFFENSE_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
