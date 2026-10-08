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

const RECENT_WEEKS = 3;
// The Nth-best free agent at a position defines "replacement level".
const REPLACEMENT_INDEX = 3;

const SLOT_ELIGIBILITY: Record<string, string[]> = {
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
const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "NA", "DNR", "COV", "NFI"]);
const INJURY_FACTOR: Record<string, number> = { Doubtful: 0.3, Questionable: 0.85 };

export type MatchupGrade = "great" | "good" | "neutral" | "tough" | "brutal";

export interface Matchup {
  opponent: string;
  /** 1 = allows the fewest points to this position, 32 = allows the most. */
  rank: number;
  teams: number;
  /** Opponent's points allowed per game to this position vs. the league average. */
  ratio: number;
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
  role: PlayerRole;
  trendingAdds: number;
  weekScore: number;
  rosValue: number;
  notes: string[];
}

export interface LineupSlot {
  slot: string;
  player: PlayerAnalysis | null;
}

export interface LineupMove {
  action: "start" | "bench";
  player: PlayerAnalysis;
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
}

export interface Opponent {
  teamName: string;
  avatar: string | null;
  /** Their current starters' expected points this week. */
  projected: number;
}

export interface Analysis {
  league: League;
  teamName: string;
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
  /** When rosters were fetched (ms epoch); free agents are as of this time. */
  fetchedAt: number;
  moves: LineupMove[];
  warnings: string[];
  roster: PlayerAnalysis[];
  drops: DropCandidate[];
  waivers: WaiverTarget[];
  waiversByPosition: Record<string, PlayerAnalysis[]>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function scoringLabel(scoring: Record<string, number>): string {
  const rec = scoring.rec ?? 0;
  if (rec >= 1) return "PPR";
  if (rec >= 0.5) return "Half PPR";
  return "Standard";
}

/** Fantasy points for a stat line under the league's scoring settings. */
function points(stats: Record<string, number>, scoring: Record<string, number>, position: string): number {
  const label = scoringLabel(scoring);
  const preset =
    label === "PPR" ? stats.pts_ppr : label === "Half PPR" ? stats.pts_half_ppr : stats.pts_std;
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
    const all = [...perTeam.values()]
      .map((t) => t[position])
      .filter((v): v is number => typeof v === "number");
    if (all.length < 2) return null;
    const avg = all.reduce((a, b) => a + b, 0) / all.length;
    const rank = all.filter((v) => v < mine).length + 1;
    // Early-season samples are noisy; shrink toward neutral until ~6 games.
    const confidence = Math.min(1, (gamesByTeam.get(opponent) ?? 0) / 6);
    const ratio = avg > 0 ? 1 + (mine / avg - 1) * confidence : 1;
    return { opponent, rank, teams: all.length, ratio, grade: gradeFor(rank, all.length) };
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

  const result = new Map<string, PlayerAnalysis>();
  for (const id of ids) {
    if (!id || id === "0" || result.has(id)) continue;
    const proj = projById.get(id);
    const info: Partial<PlayerInfo> | undefined = proj?.player ?? extraInfo.get(id) ?? seasonById.get(id)?.player;
    const position = info?.position ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "?");
    const team = (position === "DEF" ? id : proj?.team ?? info?.team) ?? null;
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
    for (const week of recentById) {
      const row = week.get(id);
      if (!row) continue;
      if ((row.stats.gp ?? 0) > 0) {
        recentPts += points(row.stats, scoring, position);
        recentGames += 1;
      }
      if ((row.stats.tm_off_snp ?? 0) > 0) {
        snaps += row.stats.off_snp ?? 0;
        teamSnaps += row.stats.tm_off_snp ?? 0;
      }
    }
    const recentAvg = recentGames > 0 ? recentPts / recentGames : null;
    const snapShare = teamSnaps > 0 && position !== "K" && position !== "DEF" ? snaps / teamSnaps : null;

    // Prior for small samples. A projection is the best guess at a player's
    // role; a healthy player on a team that plays but gets no projection
    // probably isn't expected to play, so the prior is zero. Byes and
    // injuries say nothing about role, so fall back to the raw averages.
    const prior =
      projection > 0 ? projection : onBye || isOut || injury ? (recentAvg ?? seasonAvg ?? 0) : 0;
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
    if (!team) {
      weekScore = 0;
      notes.push("Not on an NFL roster");
    } else if (onBye) {
      weekScore = 0;
      notes.push("On bye this week");
    }
    if (isOut) {
      weekScore = 0;
      notes.push(`Ruled ${injury}${info?.injury_body_part ? ` (${info.injury_body_part})` : ""}`);
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
      role,
      trendingAdds: adds,
      weekScore: round1(weekScore),
      rosValue: round1(rosValue),
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
function optimizeLineup(rosterPositions: string[], players: PlayerAnalysis[], current: LineupSlot[]): LineupSlot[] {
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

function benchReason(p: PlayerAnalysis): string {
  if (p.onBye) return "on bye";
  if (p.injury && OUT_STATUSES.has(p.injury)) return `ruled ${p.injury}`;
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
  const starts: LineupMove[] = optimal
    .filter((s) => s.player && !currentIds.has(s.player.id))
    .sort((a, b) => (b.player as PlayerAnalysis).weekScore - (a.player as PlayerAnalysis).weekScore)
    .map((s) => {
      const p = s.player as PlayerAnalysis;
      return { action: "start", player: p, slot: slotName(s.slot), reason: capitalize(startReason(p)) + "." };
    });
  const benches: LineupMove[] = current
    .filter((s) => s.player && !optimalIds.has(s.player.id))
    .map((s) => s.player as PlayerAnalysis)
    .sort((a, b) => a.weekScore - b.weekScore)
    .map((p) => ({ action: "bench", player: p, slot: null, reason: capitalize(benchReason(p)) + "." }));
  return [...starts, ...benches];
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

export async function analyzeLeague(opts: {
  leagueId: string;
  userId: string;
  season: string;
  week: number;
}): Promise<Analysis> {
  const { leagueId, userId, season, week } = opts;
  const recentWeeks = Array.from({ length: RECENT_WEEKS }, (_, i) => week - 1 - i).filter((w) => w >= 1);

  const [league, rosters, users, matchups, projections, seasonStats, trending, ...recentStats] = await Promise.all([
    getLeague(leagueId),
    getRosters(leagueId),
    getLeagueUsers(leagueId),
    getMatchups(leagueId, week).catch(() => []),
    getWeekProjections(season, week),
    getSeasonStats(season).catch(() => [] as StatRow[]),
    getTrendingAdds().catch(() => [] as TrendingPlayer[]),
    ...recentWeeks.map((w) => getWeekStats(season, w).catch(() => [] as StatRow[])),
  ]);
  if (!league) throw new Error("League not found.");

  const mine = rosters.find(
    (r: Roster) => r.owner_id === userId || (r.co_owners ?? []).includes(userId),
  );
  if (!mine) throw new Error("You don't have a team in this league.");
  if (!mine.players?.length) {
    throw new Error("Your roster is empty — has the draft happened yet?");
  }

  const teamNameOf = (ownerId: string | null) => {
    const u = users.find((x) => x.user_id === ownerId);
    return ((u as unknown as { metadata?: { team_name?: string } })?.metadata?.team_name) || u?.display_name || "Team";
  };
  const owner = users.find((u) => u.user_id === userId);
  const teamName = teamNameOf(userId);

  const inputs: Inputs = { league, week, projections, seasonStats, recentStats, trending };

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
  const roster = [...myPlayers.values()].sort((a, b) => b.weekScore - a.weekScore);
  const active = roster.filter((p) => !reserved.has(p.id));

  const starterSlots = league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const currentLineup: LineupSlot[] = starterSlots.map((slot, i) => {
    const id = mine.starters?.[i];
    return { slot, player: id && id !== "0" ? myPlayers.get(id) ?? null : null };
  });
  const optimalLineup = optimizeLineup(league.roster_positions, active, currentLineup);
  const total = (l: LineupSlot[]) => round1(l.reduce((sum, s) => sum + (s.player?.weekScore ?? 0), 0));

  const warnings: string[] = [];
  for (const s of currentLineup) {
    if (!s.player) warnings.push(`Your ${slotName(s.slot)} slot is empty.`);
    else if (s.player.weekScore === 0) {
      warnings.push(`${s.player.name} is in your ${slotName(s.slot)} slot: ${s.player.notes[0] ?? "not projected to score"}.`);
    }
  }

  // --- Waiver wire ---
  const rostered = new Set(rosters.flatMap((r) => [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]));
  const usedPositions = new Set(
    league.roster_positions.flatMap((slot) => SLOT_ELIGIBILITY[slot] ?? []),
  );
  const freeAgentIds = projections
    .filter((r) => !rostered.has(r.player_id) && usedPositions.has(r.player?.position ?? ""))
    .map((r) => r.player_id);
  const freeAgents = [...analyzePlayers(freeAgentIds, inputs, new Map()).values()].filter(
    (p) =>
      p.team &&
      !(p.injury && OUT_STATUSES.has(p.injury)) &&
      // Backups and players Sleeper doesn't expect to play aren't pickups.
      p.role !== "backup" &&
      p.role !== "sidelined" &&
      (p.projection > 0 || p.onBye),
  );
  // Rank by rest-of-season value, but streaming K/DEF lean on this week only.
  const waiverRank = (p: PlayerAnalysis) =>
    p.position === "K" || p.position === "DEF" ? p.weekScore : p.rosValue;

  const waiversByPosition: Record<string, PlayerAnalysis[]> = {};
  for (const pos of OFFENSE_ORDER) {
    if (!usedPositions.has(pos)) continue;
    waiversByPosition[pos] = freeAgents
      .filter((p) => p.position === pos)
      .sort((a, b) => waiverRank(b) - waiverRank(a))
      .slice(0, 8);
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

  const dropPool = benchPlayers.filter((p) => canDrop(p)).sort((a, b) => vor(a) - vor(b));
  // Only flag players at or below what the waiver wire offers at their spot.
  const drops: DropCandidate[] = dropPool.filter((p) => vor(p) < 1).slice(0, 3).map((p) => {
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
  const waivers: WaiverTarget[] = [];
  // How much a free agent would improve your starting lineup (0 if they'd sit).
  // Counts both rest-of-season and this week, so a free agent jumps the queue
  // when the starter at that spot is out this week.
  const startUpgrade = (t: PlayerAnalysis) => {
    const slots = optimalLineup.filter((s) => SLOT_ELIGIBILITY[s.slot]?.some((pos) => t.eligible.includes(pos)));
    if (!slots.length) return { gain: 0, over: null as PlayerAnalysis | null };
    if (slots.some((s) => !s.player)) return { gain: t.rosValue + t.weekScore * 0.5, over: null };
    const filled = slots.map((s) => s.player as PlayerAnalysis);
    const weakest = [...filled].sort((a, b) => a.rosValue - b.rosValue)[0];
    const weakestThisWeek = [...filled].sort((a, b) => a.weekScore - b.weekScore)[0];
    const rosGain = Math.max(0, t.rosValue - weakest.rosValue);
    const weekGain = Math.max(0, t.weekScore - weakestThisWeek.weekScore);
    const over = weekGain * 0.5 > rosGain ? weakestThisWeek : weakest;
    return { gain: rosGain + weekGain * 0.5, over: rosGain + weekGain > 0 ? over : null };
  };
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
      dropFor = mineAtPos[0] ?? null;
      if (!dropFor && rosterFull) continue;
    } else {
      const value = claimValue(target);
      if (value <= 0.5) continue;
      if (rosterFull) {
        dropFor =
          dropPool.find((p) => !takenDrops.has(p.id) && canDrop(p, target) && vor(p) + 1 < value) ?? null;
        if (!dropFor) continue;
      }
    }
    if (dropFor) takenDrops.add(dropFor.id);
    perPosition[target.position] = (perPosition[target.position] ?? 0) + 1;

    const parts: string[] = [];
    if (!streamer && upgrade.over && upgrade.gain > 0) parts.push(`would start over ${upgrade.over.name}`);
    if (target.trendingAdds > 0) parts.push(`${target.trendingAdds.toLocaleString()} adds across Sleeper in the last 72h`);
    const form = formText(target);
    if (form) parts.push(form);
    if (target.onBye) parts.push(`on bye in week ${week}`);
    else parts.push(`projects ${target.weekScore} pts in week ${week}${target.matchup ? ` ${describeMatchup(target.matchup, target.position)}` : ""}`);
    if (dropFor) {
      parts.push(
        streamer
          ? `${dropFor.name} projects only ${dropFor.weekScore}`
          : `${dropFor.name} is your most expendable bench player`,
      );
    }
    waivers.push({ player: target, dropFor, reason: capitalize(parts.join("; ")) + "." });
  }

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
      teamName: teamNameOf(ownerId),
      avatar: users.find((u) => u.user_id === ownerId)?.avatar ?? null,
      projected: total(starters.map((id) => ({ slot: "", player: scored.get(id) ?? null }))),
    };
  }

  return {
    league,
    opponent,
    teamName,
    avatar: owner?.avatar ?? null,
    season,
    week,
    scoringLabel: scoringLabel(league.scoring_settings),
    currentLineup,
    optimalLineup,
    fetchedAt: Date.now(),
    currentTotal: total(currentLineup),
    optimalTotal: total(optimalLineup),
    moves: buildMoves(currentLineup, optimalLineup),
    warnings,
    roster,
    drops,
    waivers,
    waiversByPosition,
  };
}

const OFFENSE_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
