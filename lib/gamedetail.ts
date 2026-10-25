// One game's detail from ESPN's summary feed: score by quarter, win
// probability over the game, team stat comparison, drive results, scoring
// summary and team leaders. Used by the game sheet on the Games tab.

import type { Game } from "./scoreboard";

const SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary";

export interface TeamStatRow {
  label: string;
  away: string;
  home: string;
  /** Numeric values for the comparison bar (null when not comparable). */
  awayN: number | null;
  homeN: number | null;
  /** True when a lower number is better (turnovers, penalties). */
  lowerBetter: boolean;
}

export interface DriveSummary {
  team: string;
  /** Start / end measured from the away team's goal line (0–100), like Situation.ballFromAway. */
  start: number | null;
  end: number | null;
  quarter: number;
  clock: string;
  description: string;
  result: string;
  kind: "td" | "fg" | "turnover" | "punt" | "other" | "live";
}

export interface ScoringPlay {
  team: string;
  quarter: number;
  clock: string;
  type: string;
  text: string;
  away: number;
  home: number;
}

export interface Leader {
  team: string;
  category: string;
  name: string;
  line: string;
}

export interface GameDetail {
  /** Points per quarter (overtime included). */
  linescore: { away: number[]; home: number[] };
  records: { away: string | null; home: string | null };
  /** Home team's win chance after each play (0–1), oldest first. */
  winProb: number[];
  /** Pre-game win chance for the home team (ESPN's predictor), when no plays yet. */
  pregameHome: number | null;
  teamStats: TeamStatRow[];
  drives: DriveSummary[];
  scoring: ScoringPlay[];
  leaders: Leader[];
  asOf: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const STAT_ROWS: { key: string; label: string; lowerBetter?: boolean; num?: (v: string) => number | null }[] = [
  { key: "totalYards", label: "Total yards" },
  { key: "netPassingYards", label: "Passing" },
  { key: "rushingYards", label: "Rushing" },
  { key: "firstDowns", label: "First downs" },
  { key: "yardsPerPlay", label: "Yards per play" },
  {
    key: "thirdDownEff",
    label: "3rd down",
    num: (v) => {
      const [m, a] = v.split("-").map(Number);
      return a ? m / a : null;
    },
  },
  {
    key: "redZoneAttempts",
    label: "Red zone (TDs)",
    num: (v) => {
      const [m, a] = v.split("-").map(Number);
      return a ? m / a : null;
    },
  },
  { key: "turnovers", label: "Turnovers", lowerBetter: true },
  {
    key: "totalPenaltiesYards",
    label: "Penalties",
    lowerBetter: true,
    num: (v) => Number(v.split("-")[0]),
  },
  {
    key: "possessionTime",
    label: "Possession",
    num: (v) => {
      const [m, s] = v.split(":").map(Number);
      return Number.isFinite(m) ? m * 60 + (s || 0) : null;
    },
  },
];

const abbr = (t: Json): string => {
  const a = String(t?.abbreviation ?? "");
  return a === "WSH" ? "WAS" : a === "JAX" ? "JAC" : a;
};

function driveKind(result: string, live: boolean): DriveSummary["kind"] {
  if (live) return "live";
  const r = result.toUpperCase();
  if (/TD|TOUCHDOWN/.test(r)) return "td";
  if (/^FG$|FIELD GOAL$|^FG GOOD/.test(r) && !/MISS|BLOCK/.test(r)) return "fg";
  if (/INT|FUMBLE|DOWNS|SAFETY|MISS|BLOCK/.test(r)) return "turnover";
  if (/PUNT/.test(r)) return "punt";
  return "other";
}

/** ESPN yardLine is measured from the home goal line; flip to the away goal line. */
const fromAway = (yardLine: unknown): number | null =>
  typeof yardLine === "number" && Number.isFinite(yardLine) ? 100 - yardLine : null;

export async function fetchGameDetail(game: Game): Promise<GameDetail> {
  if (!game.id) throw new Error("No ESPN id for this game");
  const res = await fetch(`${SUMMARY}?event=${game.id}`);
  if (!res.ok) throw new Error(`ESPN summary ${res.status}`);
  const d: Json = await res.json();

  const comp = d.header?.competitions?.[0];
  const side = (homeAway: "home" | "away") => comp?.competitors?.find((c: Json) => c.homeAway === homeAway);
  const quarters = (c: Json) => (c?.linescores ?? []).map((l: Json) => Number(l.displayValue ?? l.value) || 0);
  const record = (c: Json) => c?.record?.find((r: Json) => r.type === "total")?.summary ?? null;

  const teams: Json[] = d.boxscore?.teams ?? [];
  const statsFor = (t: string) => {
    const team = teams.find((x) => abbr(x.team) === t);
    return new Map<string, string>((team?.statistics ?? []).map((s: Json) => [s.name, String(s.displayValue)]));
  };
  const awayStats = statsFor(game.away);
  const homeStats = statsFor(game.home);
  const teamStats: TeamStatRow[] = [];
  if (game.state !== "pre") {
    for (const r of STAT_ROWS) {
      const a = awayStats.get(r.key);
      const h = homeStats.get(r.key);
      if (a === undefined || h === undefined) continue;
      const num = r.num ?? ((v: string) => (Number.isFinite(Number(v)) ? Number(v) : null));
      teamStats.push({ label: r.label, away: a, home: h, awayN: num(a), homeN: num(h), lowerBetter: !!r.lowerBetter });
    }
  }

  const drives: DriveSummary[] = [];
  const toDrive = (x: Json, live: boolean): DriveSummary => {
    const result = live ? "In progress" : String(x.displayResult ?? x.result ?? "");
    return {
      team: abbr(x.team),
      start: fromAway(x.start?.yardLine),
      end: fromAway(x.end?.yardLine ?? (live ? x.plays?.at(-1)?.end?.yardLine : undefined)),
      quarter: Number(x.start?.period?.number) || 0,
      clock: String(x.start?.clock?.displayValue ?? ""),
      description: String(x.description ?? ""),
      result,
      kind: driveKind(result, live),
    };
  };
  for (const x of d.drives?.previous ?? []) drives.push(toDrive(x, false));
  const cur = d.drives?.current;
  if (cur && game.state === "in" && !drives.some((x) => x.description === cur.description && x.team === abbr(cur.team)))
    drives.push(toDrive(cur, true));

  const scoring: ScoringPlay[] = (d.scoringPlays ?? []).map((s: Json) => ({
    team: abbr(s.team),
    quarter: Number(s.period?.number) || 0,
    clock: String(s.clock?.displayValue ?? ""),
    type: String(s.type?.abbreviation ?? s.type?.text ?? ""),
    text: String(s.text ?? ""),
    away: Number(s.awayScore) || 0,
    home: Number(s.homeScore) || 0,
  }));

  const CATEGORY: Record<string, string> = {
    passingYards: "Passing",
    rushingYards: "Rushing",
    receivingYards: "Receiving",
  };
  const leaders: Leader[] = [];
  for (const t of d.leaders ?? []) {
    for (const cat of t.leaders ?? []) {
      const label = CATEGORY[cat.name];
      const top = cat.leaders?.[0];
      if (!label || !top) continue;
      leaders.push({
        team: abbr(t.team),
        category: label,
        name: String(top.athlete?.displayName ?? ""),
        line: String(top.displayValue ?? ""),
      });
    }
  }

  const predictor = d.predictor?.homeTeam?.gameProjection;
  return {
    linescore: { away: quarters(side("away")), home: quarters(side("home")) },
    records: { away: record(side("away")), home: record(side("home")) },
    winProb: (d.winprobability ?? [])
      .map((w: Json) => Number(w.homeWinPercentage))
      .filter((n: number) => Number.isFinite(n)),
    pregameHome: predictor !== undefined && Number.isFinite(Number(predictor)) ? Number(predictor) / 100 : null,
    teamStats,
    drives,
    scoring,
    leaders,
    asOf: Date.now(),
  };
}

// --- Fantasy point breakdown ------------------------------------------------

const STAT_LABEL: Record<string, string> = {
  pass_yd: "Passing yards",
  pass_td: "Passing TDs",
  pass_int: "Interceptions",
  pass_2pt: "Passing 2-pt",
  pass_cmp: "Completions",
  pass_inc: "Incompletions",
  pass_sack: "Sacks taken",
  rush_yd: "Rushing yards",
  rush_td: "Rushing TDs",
  rush_att: "Carries",
  rush_2pt: "Rushing 2-pt",
  rush_fd: "Rushing first downs",
  rec: "Receptions",
  rec_yd: "Receiving yards",
  rec_td: "Receiving TDs",
  rec_2pt: "Receiving 2-pt",
  rec_fd: "Receiving first downs",
  fum_lost: "Fumbles lost",
  fum: "Fumbles",
  bonus_rec_te: "TE reception bonus",
  bonus_rec_rb: "RB reception bonus",
  bonus_rec_wr: "WR reception bonus",
  st_td: "Return TDs",
  kr_yd: "Kick return yards",
  pr_yd: "Punt return yards",
};

export interface PointPart {
  label: string;
  stat: number;
  points: number;
}

/** Where a player's fantasy points came from under the league's scoring, biggest first. */
export function pointBreakdown(stats: Record<string, number>, scoring: Record<string, number>): PointPart[] {
  const parts = new Map<string, PointPart>();
  for (const [key, value] of Object.entries(stats)) {
    const weight = scoring[key];
    if (!weight || typeof value !== "number" || !value) continue;
    const pts = value * weight;
    if (Math.abs(pts) < 0.05) continue;
    const label = STAT_LABEL[key] ?? (key.startsWith("bonus_") ? "Bonuses" : key.replace(/_/g, " "));
    const prev = parts.get(label);
    if (prev) prev.points += pts;
    else parts.set(label, { label, stat: STAT_LABEL[key] ? value : 0, points: pts });
  }
  return [...parts.values()]
    .map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}
