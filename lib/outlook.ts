// A player's next few games: who he plays, how that defense does against his
// position this season, and Sleeper's projection for each week (scored with
// your league's settings). Summed up as a "schedule ahead" verdict.

import { points, type Analysis, type MatchupGrade, type PlayerAnalysis } from "./advisor";
import { getPlayerWeeklyProjections, getSchedule, type ScheduledGame } from "./sleeper";

export interface OutlookWeek {
  week: number;
  /** Opponent team code; null on a bye. */
  opponent: string | null;
  home: boolean;
  /** Kickoff date (ms), when the schedule has it. */
  date: number | null;
  /** How this defense does against his position (null when unknown or on bye). */
  grade: MatchupGrade | null;
  /** Points per game this defense allows to his position, and the league average. */
  allowed: number | null;
  average: number | null;
  /** 1 = allows the fewest points to the position. */
  rank: number | null;
  teams: number;
  /** Sleeper's projection for the week in your scoring (null when it hasn't posted one). */
  projected: number | null;
}

export interface Outlook {
  weeks: OutlookWeek[];
  /** Overall read of the stretch. */
  verdict: "Favorable" | "Neutral" | "Tough";
  /** Average of defense strength vs. the league (above 1 = softer than average). */
  softness: number;
  /** First fantasy playoff week, when the league has playoffs. */
  playoffStart: number | null;
  /** The same read for just your fantasy playoff weeks (null if none are left in the window). */
  playoffVerdict: "Favorable" | "Neutral" | "Tough" | null;
}

const schedules = new Map<string, Promise<ScheduledGame[]>>();
const scheduleFor = (season: string) => {
  if (!schedules.has(season))
    schedules.set(
      season,
      getSchedule(season).catch(() => []),
    );
  return schedules.get(season)!;
};

/**
 * The fantasy season's weeks for this league: playoffs start at `playoff_week_start`
 * and run one round per week until the championship (log2 of the playoff teams).
 */
export function fantasySeason(a: Analysis): { playoffStart: number | null; lastWeek: number } {
  const settings = a.league.settings as Record<string, unknown>;
  const playoffStart = typeof settings.playoff_week_start === "number" ? settings.playoff_week_start : null;
  const playoffTeams = Number(settings.playoff_teams ?? 6);
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, playoffTeams))));
  return { playoffStart, lastWeek: Math.min(18, playoffStart ? playoffStart + rounds - 1 : 17) };
}

/** Every remaining week of the fantasy season (or `span` weeks, if given). */
export async function playerOutlook(a: Analysis, p: PlayerAnalysis, span?: number): Promise<Outlook | null> {
  const { playoffStart, lastWeek } = fantasySeason(a);
  const end = span ? Math.min(lastWeek, a.week + span - 1) : lastWeek;
  if (!p.team) return null;
  const [schedule, projections] = await Promise.all([
    scheduleFor(a.season),
    getPlayerWeeklyProjections(a.season, p.id).catch(
      () => ({}) as Awaited<ReturnType<typeof getPlayerWeeklyProjections>>,
    ),
  ]);
  const weeks: OutlookWeek[] = [];
  for (let w = a.week; w <= end; w++) {
    const g = schedule.find((x) => x.week === w && (x.home === p.team || x.away === p.team));
    const row = projections[String(w)];
    const projected = row?.stats
      ? Math.round(points(row.stats, a.league.scoring_settings, p.position) * 10) / 10
      : null;
    if (!g) {
      weeks.push({
        week: w,
        opponent: null,
        home: false,
        date: null,
        grade: null,
        allowed: null,
        average: null,
        rank: null,
        teams: 32,
        projected: null,
      });
      continue;
    }
    const home = g.home === p.team;
    const opponent = home ? g.away : g.home;
    const m = a.defenseVs(opponent, p.position);
    const date = Date.parse(g.date);
    weeks.push({
      week: w,
      opponent,
      home,
      date: Number.isNaN(date) ? null : date,
      grade: m?.grade ?? null,
      allowed: m?.allowed ?? null,
      average: m?.average ?? null,
      rank: m?.rank ?? null,
      teams: m?.teams ?? 32,
      projected,
    });
  }
  if (!weeks.length) return null;
  const read = (ws: OutlookWeek[]) => {
    const rated = ws
      .map((w) => (w.allowed !== null && w.average ? w.allowed / w.average : null))
      .filter((x): x is number => x !== null);
    const softness = rated.length ? rated.reduce((s, x) => s + x, 0) / rated.length : 1;
    const verdict: Outlook["verdict"] = softness >= 1.06 ? "Favorable" : softness <= 0.94 ? "Tough" : "Neutral";
    return { softness: Math.round(softness * 100) / 100, verdict, rated: rated.length };
  };
  const all = read(weeks);
  const po = playoffStart ? read(weeks.filter((w) => w.week >= playoffStart)) : null;
  return {
    weeks,
    softness: all.softness,
    verdict: all.verdict,
    playoffStart,
    playoffVerdict: po && po.rated ? po.verdict : null,
  };
}
