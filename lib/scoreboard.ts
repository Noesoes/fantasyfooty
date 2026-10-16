// NFL games for a week from ESPN's scoreboard: kickoff, live clock, score,
// Vegas line (spread / over-under → implied team totals) and weather.
//
// In the browser we try ESPN directly first (live clocks need to be fresh),
// then the copy the deploy workflow snapshots next to the site every few
// hours, then Sleeper's schedule (status only). Node scripts go straight to
// ESPN.

import { getSchedule } from "./sleeper";

// site.web.api allows browser requests; site.api is blocked for other origins.
const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const TEAM_FIX: Record<string, string> = { WSH: "WAS" };
const fix = (abbr: string) => TEAM_FIX[abbr] ?? abbr;

export interface Game {
  /** ESPN event id (for play-by-play); null when only Sleeper's schedule is available. */
  id: string | null;
  home: string;
  away: string;
  kickoff: number;
  /** False when only the date is known (Sleeper-schedule fallback). */
  kickoffKnown: boolean;
  state: "pre" | "in" | "post";
  /** e.g. "Q3 7:12", "Final", "Sun 8:20 PM". */
  detail: string;
  /** Share of the game already played, 0–1. */
  elapsed: number;
  homeScore: number | null;
  awayScore: number | null;
  /** Favorite and points, e.g. { team: "ATL", points: 3.5 }. */
  spread: { team: string; points: number } | null;
  overUnder: number | null;
  weather: { temp: number | null; condition: string } | null;
  indoor: boolean;
}

export interface WeekGames {
  /** Keyed by team abbreviation (Sleeper style). */
  byTeam: Map<string, Game>;
  source: "espn" | "snapshot" | "sleeper";
  asOf: number;
}

interface EspnEvent {
  id?: string;
  date: string;
  weather?: { displayValue?: string; temperature?: number };
  status: { period?: number; displayClock?: string; type: { state: string; shortDetail: string; completed?: boolean } };
  competitions: {
    venue?: { indoor?: boolean };
    competitors: { homeAway: "home" | "away"; score?: string; team: { abbreviation: string } }[];
    odds?: { details?: string; overUnder?: number; spread?: number }[];
  }[];
}

function elapsedOf(e: EspnEvent): number {
  const t = e.status.type;
  if (t.state === "post" || t.completed) return 1;
  if (t.state !== "in") return 0;
  const period = e.status.period ?? 1;
  if (period > 4) return 0.98; // overtime
  const [m, s] = (e.status.displayClock ?? "15:00").split(":").map(Number);
  const left = (m || 0) + (s || 0) / 60;
  return Math.min(0.99, Math.max(0.01, ((period - 1) * 15 + (15 - left)) / 60));
}

/** Parse ESPN's "ATL -3.5" into favorite + points. */
function parseSpread(details: string | undefined): Game["spread"] {
  const m = details?.match(/^([A-Z]{2,3})\s*-?(\d+(\.\d+)?)/);
  if (!m) return null; // "EVEN" or missing
  return { team: fix(m[1]), points: Number(m[2]) };
}

export function gamesFromEspn(events: EspnEvent[]): Map<string, Game> {
  const byTeam = new Map<string, Game>();
  for (const e of events) {
    const c = e.competitions[0];
    const home = c.competitors.find((t) => t.homeAway === "home");
    const away = c.competitors.find((t) => t.homeAway === "away");
    if (!home || !away) continue;
    const odds = c.odds?.[0];
    const state = (e.status.type.state as Game["state"]) ?? "pre";
    const game: Game = {
      id: e.id ?? null,
      home: fix(home.team.abbreviation),
      away: fix(away.team.abbreviation),
      kickoff: Date.parse(e.date),
      kickoffKnown: true,
      state,
      detail: e.status.type.shortDetail,
      elapsed: elapsedOf(e),
      homeScore: state === "pre" ? null : Number(home.score ?? 0),
      awayScore: state === "pre" ? null : Number(away.score ?? 0),
      spread: parseSpread(odds?.details),
      overUnder: typeof odds?.overUnder === "number" ? odds.overUnder : null,
      weather: e.weather ? { temp: e.weather.temperature ?? null, condition: e.weather.displayValue ?? "" } : null,
      indoor: Boolean(c.venue?.indoor),
    };
    byTeam.set(game.home, game);
    byTeam.set(game.away, game);
  }
  return byTeam;
}

/** Points Vegas expects a team to score: half the total, plus/minus half the spread. */
export function impliedTotal(game: Game | undefined, team: string | null): number | null {
  if (!game || !team || game.overUnder === null) return null;
  const half = game.overUnder / 2;
  if (!game.spread) return Math.round(half * 10) / 10;
  const sign = game.spread.team === team ? 1 : -1;
  return Math.round((half + (sign * game.spread.points) / 2) * 10) / 10;
}

export async function getWeekGames(season: string, week: number): Promise<WeekGames> {
  const isBrowser = typeof window !== "undefined";
  // 1. ESPN directly (fresh; needed for live clocks).
  try {
    const res = await fetch(`${ESPN}?week=${week}&seasontype=2&dates=${season}`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { events: EspnEvent[] };
      return { byTeam: gamesFromEspn(data.events ?? []), source: "espn", asOf: Date.now() };
    }
  } catch {
    // blocked or offline — fall through
  }
  // 2. The deploy workflow's snapshot (browser only).
  if (isBrowser) {
    try {
      const res = await fetch("scoreboard.json", { cache: "no-store" });
      if (res.ok) {
        const snap = (await res.json()) as { fetchedAt: string; weeks: Record<string, EspnEvent[]> };
        const events = snap.weeks[String(week)];
        if (events) {
          const byTeam = gamesFromEspn(events);
          const age = Date.now() - Date.parse(snap.fetchedAt);
          // The copy's clocks and statuses go stale; refresh state from
          // Sleeper and estimate progress from kickoff (~3h15m per game).
          if (age > 10 * 60_000 && [...byTeam.values()].some((g) => g.state !== "post")) {
            const schedule = await getSchedule(season).catch(() => []);
            const status = new Map<string, string>();
            for (const g of schedule.filter((x) => x.week === week)) {
              status.set(g.home, g.status);
              status.set(g.away, g.status);
            }
            for (const [team, g] of byTeam) {
              const st = status.get(team);
              if (!st) continue;
              g.state = st === "complete" ? "post" : st === "in_game" ? "in" : "pre";
              g.elapsed =
                g.state === "post"
                  ? 1
                  : g.state === "pre"
                    ? 0
                    : Math.min(0.97, Math.max(0.03, (Date.now() - g.kickoff) / 11_700_000));
              g.detail = g.state === "post" ? "Final" : g.state === "in" ? "In progress" : g.detail;
              if (g.state !== "post") {
                g.homeScore = null;
                g.awayScore = null;
              }
            }
          }
          return { byTeam, source: "snapshot", asOf: Date.parse(snap.fetchedAt) };
        }
      }
    } catch {
      // fall through
    }
  }
  // 3. Sleeper's schedule: status only, no clock, lines or weather.
  const schedule = await getSchedule(season).catch(() => []);
  const byTeam = new Map<string, Game>();
  for (const g of schedule.filter((x) => x.week === week && x.status !== "canceled")) {
    const state: Game["state"] = g.status === "complete" ? "post" : g.status === "in_game" ? "in" : "pre";
    const game: Game = {
      id: null,
      home: g.home,
      away: g.away,
      kickoff: Date.parse(`${g.date}T12:00:00Z`),
      kickoffKnown: false,
      state,
      detail: state === "post" ? "Final" : state === "in" ? "In progress" : "",
      elapsed: state === "post" ? 1 : state === "in" ? 0.5 : 0,
      homeScore: null,
      awayScore: null,
      spread: null,
      overUnder: null,
      weather: null,
      indoor: false,
    };
    byTeam.set(g.home, game);
    byTeam.set(g.away, game);
  }
  return { byTeam, source: "sleeper", asOf: Date.now() };
}

export interface GameOutlook {
  opponent: string;
  /** Points Vegas expects this player's team to score. */
  implied: number | null;
  /** Team's line: negative = favored by that many. */
  spread: number | null;
  overUnder: number | null;
  /** e.g. "Snow, 28°F"; null indoors or unknown. */
  weather: string | null;
  indoor: boolean;
  /** Multiplier applied to this week's projection. */
  factor: number;
  /** Plain-English reason when the factor moved the projection. */
  note: string | null;
}

const AVG_IMPLIED = 22.5;
const PASSING = new Set(["QB", "WR", "TE"]);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Small start/sit nudges from the betting line and the forecast. Sleeper's
 * projections already lean on Vegas, so these stay light: a few percent for
 * a shootout or a slog, more for snow and wind that hurt passing and kicking.
 */
export function gameOutlook(game: Game | undefined, team: string | null, position: string): GameOutlook | null {
  if (!game || !team) return null;
  const opponent = game.home === team ? game.away : game.home;
  const implied = impliedTotal(game, team);
  const spread = game.spread ? (game.spread.team === team ? -game.spread.points : game.spread.points) : null;
  const reasons: string[] = [];
  let factor = 1;

  if (implied !== null && game.overUnder !== null) {
    if (position === "DEF") {
      const against = game.overUnder - implied;
      const f = 1 + clamp(((AVG_IMPLIED - against) / AVG_IMPLIED) * 0.4, -0.08, 0.08);
      factor *= f;
      if (Math.abs(f - 1) >= 0.03) reasons.push(`${opponent} implied for ${against.toFixed(1)} pts`);
    } else {
      const f = 1 + clamp(((implied - AVG_IMPLIED) / AVG_IMPLIED) * 0.3, -0.07, 0.07);
      factor *= f;
      if (Math.abs(f - 1) >= 0.03) reasons.push(`${team} implied for ${implied.toFixed(1)} pts`);
    }
    if (spread !== null && position === "RB") {
      if (spread <= -7) {
        factor *= 1.02;
        reasons.push(`favored by ${-spread} (run-heavy script)`);
      } else if (spread >= 7) {
        factor *= 0.98;
        reasons.push(`${spread}-pt underdog`);
      }
    }
  }

  let weather: string | null = null;
  if (!game.indoor && game.weather) {
    const c = game.weather.condition.toLowerCase();
    const temp = game.weather.temp;
    weather = [game.weather.condition, temp !== null ? `${temp}°F` : null].filter(Boolean).join(", ") || null;
    const before = factor;
    if (/snow|blizzard|flurr/.test(c)) {
      if (PASSING.has(position)) factor *= 0.93;
      else if (position === "K") factor *= 0.9;
      else if (position === "RB") factor *= 1.02;
      else if (position === "DEF") factor *= 1.05;
    } else if (/rain|shower|storm|thunder|drizzle/.test(c)) {
      if (PASSING.has(position)) factor *= 0.97;
      else if (position === "K") factor *= 0.95;
      else if (position === "DEF") factor *= 1.02;
    }
    if (/wind|breez|gust/.test(c)) {
      if (PASSING.has(position)) factor *= 0.94;
      else if (position === "K") factor *= 0.88;
    }
    if (temp !== null && temp <= 20) {
      if (PASSING.has(position)) factor *= 0.97;
      else if (position === "K") factor *= 0.95;
    }
    if (Math.abs(factor / before - 1) >= 0.02 && weather) reasons.push(weather);
  }

  factor = clamp(factor, 0.85, 1.1);
  const pctMove = Math.round((factor - 1) * 100);
  return {
    opponent,
    implied,
    spread,
    overUnder: game.overUnder,
    weather,
    indoor: game.indoor,
    factor,
    note:
      Math.abs(pctMove) >= 3 && reasons.length
        ? `${pctMove > 0 ? "Boost" : "Downgrade"} ${pctMove > 0 ? "+" : ""}${pctMove}%: ${reasons.join(", ")}`
        : null,
  };
}
