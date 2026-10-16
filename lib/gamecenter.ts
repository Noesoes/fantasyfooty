// Every NFL game this week, with your players (starters, bench) and your
// opponent's starters in each: live stat lines from Sleeper and fantasy
// points under your league's scoring.

import { points, type Analysis, type PlayerAnalysis } from "./advisor";
import { getWeekGames, type Game, type WeekGames } from "./scoreboard";
import { getWeekStats, type StatRow } from "./sleeper";

export interface GamePlayer {
  player: PlayerAnalysis;
  /** Your starter, your bench, or your opponent's starter. */
  role: "starter" | "bench" | "opponent";
  /** "12 car, 64 yds · 3 rec, 18 yds". Empty before they've recorded a stat. */
  line: string;
  points: number;
  /** Scrimmage yards (passing yards for QBs). */
  yards: number;
  touches: number;
}

export interface GameCard {
  game: Game;
  players: GamePlayer[];
}

export interface GameCenter {
  cards: GameCard[];
  source: WeekGames["source"];
  live: number;
  final: number;
  upcoming: number;
  asOf: number;
}

const n = (s: Record<string, number>, k: string) => s[k] ?? 0;

/** A compact box-score line for the stats that matter at this position. */
function statLine(position: string, s: Record<string, number>): string {
  const parts: string[] = [];
  const td = (k: string) => (n(s, k) ? `, ${n(s, k)} TD` : "");
  if (position === "K") {
    if (n(s, "fga")) parts.push(`${n(s, "fgm")}/${n(s, "fga")} FG`);
    if (n(s, "xpa") || n(s, "xpm")) parts.push(`${n(s, "xpm")}/${n(s, "xpa") || n(s, "xpm")} XP`);
    return parts.join(" · ");
  }
  if (n(s, "pass_att")) {
    parts.push(
      `${n(s, "pass_cmp")}/${n(s, "pass_att")}, ${n(s, "pass_yd")} yds${td("pass_td")}${n(s, "pass_int") ? `, ${n(s, "pass_int")} INT` : ""}`,
    );
  }
  if (n(s, "rush_att")) parts.push(`${n(s, "rush_att")} car, ${n(s, "rush_yd")} yds${td("rush_td")}`);
  if (n(s, "rec") || n(s, "rec_tgt")) {
    parts.push(
      `${n(s, "rec")} rec, ${n(s, "rec_yd")} yds${td("rec_td")}${n(s, "rec_tgt") > n(s, "rec") ? ` (${n(s, "rec_tgt")} tgt)` : ""}`,
    );
  }
  if (n(s, "fum_lost")) parts.push(`${n(s, "fum_lost")} fumble lost`);
  return parts.join(" · ");
}

export async function fetchGameCenter(a: Analysis, starters: Set<string>): Promise<GameCenter> {
  const [games, stats] = await Promise.all([
    getWeekGames(a.season, a.week),
    getWeekStats(a.season, a.week, true).catch(() => [] as StatRow[]),
  ]);
  const statsById = new Map(stats.map((r) => [r.player_id, r.stats]));

  const people: { player: PlayerAnalysis; role: GamePlayer["role"] }[] = [
    ...a.roster.map((p) => ({ player: p, role: starters.has(p.id) ? ("starter" as const) : ("bench" as const) })),
    ...(a.opponent?.starters ?? []).map((p) => ({ player: p, role: "opponent" as const })),
  ].filter((x) => x.player.team && x.player.position !== "DEF");

  // One card per game (byTeam lists each game twice).
  const cards = new Map<Game, GameCard>();
  for (const g of new Set(games.byTeam.values())) cards.set(g, { game: g, players: [] });
  const order = { starter: 0, bench: 1, opponent: 2 };
  for (const { player, role } of people) {
    const g = games.byTeam.get(player.team!);
    if (!g) continue;
    const s = statsById.get(player.id) ?? {};
    const qb = player.position === "QB";
    cards.get(g)!.players.push({
      player,
      role,
      line: statLine(player.position, s),
      points: Math.round(points(s, a.league.scoring_settings, player.position) * 10) / 10,
      yards: qb ? n(s, "pass_yd") + n(s, "rush_yd") : n(s, "rush_yd") + n(s, "rec_yd"),
      touches: n(s, "rush_att") + n(s, "rec") + (qb ? n(s, "pass_cmp") : 0),
    });
  }
  for (const c of cards.values()) c.players.sort((x, y) => order[x.role] - order[y.role] || y.points - x.points);

  // Live games first (yours before others), then upcoming by kickoff, then finals.
  const rank = (c: GameCard) => {
    const mine = c.players.some((p) => p.role !== "opponent");
    const state = c.game.state === "in" ? 0 : c.game.state === "pre" ? 2 : 4;
    return state + (mine ? 0 : 1);
  };
  const list = [...cards.values()].sort((x, y) => rank(x) - rank(y) || x.game.kickoff - y.game.kickoff);
  return {
    cards: list,
    source: games.source,
    live: list.filter((c) => c.game.state === "in").length,
    final: list.filter((c) => c.game.state === "post").length,
    upcoming: list.filter((c) => c.game.state === "pre").length,
    asOf: Date.now(),
  };
}
