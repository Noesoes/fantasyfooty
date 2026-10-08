// Thin client for Sleeper's public API. No auth or API key is needed, and
// every endpoint used here sends `Access-Control-Allow-Origin: *`, so the same
// code runs in the browser and in Node (the weekly GitHub Actions report).
//
// The /v1 endpoints are documented at https://docs.sleeper.com. The
// /projections and /stats endpoints are the undocumented ones the Sleeper app
// itself uses; they have been stable for years but could change.

const BASE = "https://api.sleeper.app";

export const OFFENSE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof OFFENSE_POSITIONS)[number];

export interface NflState {
  week: number;
  display_week: number;
  season: string;
  league_season?: string;
  season_type: "pre" | "regular" | "post" | "off" | string;
  season_start_date: string | null;
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

export interface League {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, unknown>;
}

export interface Roster {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
}

export interface PlayerInfo {
  player_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position: string | null;
  fantasy_positions: string[] | null;
  team: string | null;
  injury_status: string | null;
  injury_body_part?: string | null;
  status?: string | null;
}

export interface StatRow {
  player_id: string;
  team: string | null;
  opponent?: string | null;
  week?: number | null;
  stats: Record<string, number>;
  player?: Partial<PlayerInfo> & {
    position?: string | null;
    fantasy_positions?: string[] | null;
  };
}

export interface TrendingPlayer {
  player_id: string;
  count: number;
}

export class SleeperError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new SleeperError(`Sleeper API ${res.status} for ${path}`);
  }
  // Sleeper returns a literal `null` body for unknown users/leagues.
  return (await res.json()) as T;
}

function positionQuery(positions: readonly string[]): string {
  return positions.map((p) => `position[]=${p}`).join("&");
}

export const getNflState = () => get<NflState>("/v1/state/nfl");

export const getUser = (usernameOrId: string) =>
  get<SleeperUser | null>(`/v1/user/${encodeURIComponent(usernameOrId.trim())}`);

export const getUserLeagues = (userId: string, season: string) =>
  get<League[] | null>(`/v1/user/${userId}/leagues/nfl/${season}`).then(
    (l) => l ?? [],
  );

export const getLeague = (leagueId: string) =>
  get<League | null>(`/v1/league/${leagueId}`);

export const getRosters = (leagueId: string) =>
  get<Roster[]>(`/v1/league/${leagueId}/rosters`);

export const getLeagueUsers = (leagueId: string) =>
  get<SleeperUser[]>(`/v1/league/${leagueId}/users`);

export const getTrendingAdds = (lookbackHours = 72, limit = 200) =>
  get<TrendingPlayer[]>(
    `/v1/players/nfl/trending/add?lookback_hours=${lookbackHours}&limit=${limit}`,
  );

/** Weekly projections; each row also carries the player's bio, injury status and opponent. */
export const getWeekProjections = (season: string, week: number) =>
  get<StatRow[]>(
    `/projections/nfl/${season}/${week}?season_type=regular&${positionQuery(OFFENSE_POSITIONS)}`,
  );

export const getWeekStats = (season: string, week: number) =>
  get<StatRow[]>(
    `/stats/nfl/${season}/${week}?season_type=regular&${positionQuery(OFFENSE_POSITIONS)}`,
  );

export const getSeasonStats = (season: string) =>
  get<StatRow[]>(
    `/stats/nfl/${season}?season_type=regular&${positionQuery(OFFENSE_POSITIONS)}`,
  );

/** The full player database (~5 MB). Only fetched when a rostered player is missing from projections. */
export const getAllPlayers = () =>
  get<Record<string, PlayerInfo>>("/v1/players/nfl");

/**
 * The week whose lineup decisions matter right now. Sleeper's own `week`
 * doesn't advance until midweek, so on the Tuesday after Monday Night Football
 * it still points at the week that just finished. Weeks are treated as
 * running Tuesday through Monday, counted from the season start date.
 */
export function upcomingWeek(state: NflState, now = new Date()): number {
  if (state.season_type !== "regular" || !state.season_start_date) {
    return Math.max(1, state.week || 1);
  }
  const start = new Date(`${state.season_start_date}T00:00:00Z`);
  // Back up to the Tuesday on or before the season start.
  const daysSinceTuesday = (start.getUTCDay() - 2 + 7) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceTuesday);
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const byCalendar = Math.floor(days / 7) + 1;
  return Math.min(18, Math.max(1, state.week, byCalendar));
}
