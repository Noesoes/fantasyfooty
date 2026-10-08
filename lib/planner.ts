// Rest-of-season planner: your roster's projection for every remaining week,
// bye-week holes, and who carries you through the fantasy playoffs.

import { points, SLOT_ELIGIBILITY, slotName, type Analysis, type PlayerAnalysis } from "./advisor";
import { getPlayerWeeklyProjections, getSchedule } from "./sleeper";

export type Cell = number | "BYE" | null;

export interface PlannerRow {
  player: PlayerAnalysis;
  /** Projected points per week, aligned with `weeks`. null = no projection (injured, inactive). */
  cells: Cell[];
  playoffPoints: number;
  restOfSeason: number;
}

export interface PlannerWeek {
  week: number;
  playoff: boolean;
  /** Projected points from your best lineup that week. */
  total: number;
  starters: string[];
  byes: PlayerAnalysis[];
  /** Lineup spots you can't fill with a player who has a game and a projection. */
  holes: string[];
  /** Positions left with no backup that week because of byes/injuries. */
  thin: string[];
}

export interface Plan {
  weeks: PlannerWeek[];
  rows: PlannerRow[];
  playoffWeeks: number[];
  playoffStart: number | null;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function buildPlan(a: Analysis): Promise<Plan> {
  const season = a.season;
  const settings = a.league.settings as Record<string, unknown>;
  const playoffStart = typeof settings.playoff_week_start === "number" ? settings.playoff_week_start : null;
  const playoffTeams = Number(settings.playoff_teams ?? 6);
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, playoffTeams))));
  const lastWeek = Math.min(18, playoffStart ? playoffStart + rounds - 1 : 17);
  const weeks = Array.from({ length: Math.max(0, lastWeek - a.week + 1) }, (_, i) => a.week + i);
  const playoffWeeks = playoffStart ? weeks.filter((w) => w >= playoffStart) : [];

  const players = a.activeRoster;
  const [schedule, projections] = await Promise.all([
    getSchedule(season).catch(() => []),
    mapLimit(players, 6, (p) => getPlayerWeeklyProjections(season, p.id).catch(() => ({}))),
  ]);
  const playing = new Map<number, Set<string>>();
  for (const g of schedule) {
    if (g.status === "canceled") continue;
    if (!playing.has(g.week)) playing.set(g.week, new Set());
    playing.get(g.week)!.add(g.home);
    playing.get(g.week)!.add(g.away);
  }

  const scoring = a.league.scoring_settings;
  const rows: PlannerRow[] = players.map((player, i) => {
    const byWeek = projections[i] as Record<string, { stats?: Record<string, number> } | null>;
    const cells: Cell[] = weeks.map((w) => {
      const teams = playing.get(w);
      if (player.team && teams && teams.size && !teams.has(player.team)) return "BYE";
      const row = byWeek[String(w)];
      if (!row?.stats) return null;
      const pts = points(row.stats, scoring, player.position);
      return pts > 0 ? round1(pts) : null;
    });
    // This week's cell uses the full model (injury, recent form) instead.
    if (weeks[0] === a.week && cells[0] !== "BYE") cells[0] = player.weekScore > 0 ? player.weekScore : null;
    const num = (c: Cell) => (typeof c === "number" ? c : 0);
    return {
      player,
      cells,
      playoffPoints: round1(weeks.reduce((s, w, j) => s + (playoffWeeks.includes(w) ? num(cells[j]) : 0), 0)),
      restOfSeason: round1(cells.reduce<number>((s, c) => s + num(c), 0)),
    };
  });

  // Best lineup each week from those projections.
  const slots = a.league.roster_positions
    .filter((s) => s in SLOT_ELIGIBILITY)
    .sort((x, y) => SLOT_ELIGIBILITY[x].length - SLOT_ELIGIBILITY[y].length);
  const dedicated: Record<string, number> = {};
  for (const s of slots) if (SLOT_ELIGIBILITY[s].length === 1) dedicated[s] = (dedicated[s] ?? 0) + 1;

  // Your usual depth at each position (the most bodies with a game in any week),
  // so "thin" only fires when byes or injuries take someone away.
  const countAt = (pos: string, j: number) =>
    rows.filter((r) => r.player.position === pos && typeof r.cells[j] === "number").length;
  const usualDepth: Record<string, number> = {};
  for (const pos of Object.keys(dedicated)) usualDepth[pos] = Math.max(0, ...weeks.map((_, j) => countAt(pos, j)));

  const planWeeks: PlannerWeek[] = weeks.map((week, j) => {
    const available = rows
      .filter((r) => typeof r.cells[j] === "number")
      .sort((x, y) => (y.cells[j] as number) - (x.cells[j] as number));
    const used = new Set<string>();
    const holes: string[] = [];
    let total = 0;
    for (const slot of slots) {
      const r = available.find(
        (x) => !used.has(x.player.id) && x.player.eligible.some((pos) => SLOT_ELIGIBILITY[slot].includes(pos)),
      );
      if (r) {
        used.add(r.player.id);
        total += r.cells[j] as number;
      } else holes.push(slotName(slot));
    }
    const thin = Object.entries(dedicated)
      .filter(([pos, need]) => countAt(pos, j) === need && usualDepth[pos] > need)
      .map(([pos]) => pos)
      .filter((pos) => !holes.includes(pos));
    return {
      week,
      playoff: playoffWeeks.includes(week),
      total: round1(total),
      starters: [...used],
      byes: rows.filter((r) => r.cells[j] === "BYE").map((r) => r.player),
      holes,
      thin,
    };
  });

  rows.sort((x, y) => y.restOfSeason - x.restOfSeason);
  return { weeks: planWeeks, rows, playoffWeeks, playoffStart };
}
