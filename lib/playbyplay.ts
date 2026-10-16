// Live play-by-play for your starters (and your opponent's): every play
// ESPN logs that involves one of them, with a short label ("23-yd catch")
// and roughly what it was worth under your league's scoring.
//
// ESPN's play feed names players only by ESPN id, so we map Sleeper players
// to ESPN ids via Sleeper's player database (snapshotted into
// player-links.json by the deploy workflow) and fall back to matching names
// in the game's box score for players Sleeper hasn't mapped (often rookies).

import type { Analysis, PlayerAnalysis } from "./advisor";
import type { LivePlayer, LiveState } from "./live";

const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
// site.web.api serves browsers (site.api is blocked for other origins).
const SITE = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl";
const TEAM_FIX: Record<string, string> = { WSH: "WAS" };

export interface PlayEvent {
  /** Unique per play and player. */
  key: string;
  player: PlayerAnalysis;
  side: "mine" | "opponent";
  /** Short summary, e.g. "23-yd catch", "12-yd rushing TD". */
  label: string;
  /** ESPN's play description, tidied. */
  text: string;
  /** Approximate fantasy points under your league's scoring. */
  points: number;
  kind: "td" | "turnover" | "big" | "normal" | "miss";
  /** "Q3 7:11", "OT 2:05". */
  clock: string;
  /** "DEN vs SEA". */
  matchup: string;
  /** When it happened (ms), for ordering across games. */
  at: number;
}

export interface PlayByPlay {
  events: PlayEvent[];
  /** Tracked players we couldn't find in ESPN's data (no plays shown for them). */
  unmatched: string[];
  asOf: number;
}

interface EspnPlay {
  id: string;
  sequenceNumber?: string;
  type: { text: string };
  text?: string;
  period: { number: number };
  clock: { displayValue: string };
  scoringPlay?: boolean;
  statYardage?: number;
  wallclock?: string;
  participants?: { type: string; athlete: { $ref: string } }[];
}

// --- caches (per page session) ---------------------------------------------

let links: Promise<Map<string, string>> | null = null;
/** Sleeper id -> ESPN id from the deploy workflow's snapshot. */
function espnIds(): Promise<Map<string, string>> {
  links ??= fetch("player-links.json")
    .then((r) => (r.ok ? r.json() : { espn: {} }))
    .then(
      (s: { espn?: Record<string, number> }) => new Map(Object.entries(s.espn ?? {}).map(([k, v]) => [k, String(v)])),
    )
    .catch(() => new Map<string, string>());
  return links;
}

const playCache = new Map<string, { plays: EspnPlay[]; final: boolean }>();
const boxCache = new Map<string, { names: Map<string, string>; at: number }>();

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function getPlays(eventId: string, final: boolean): Promise<EspnPlay[]> {
  const hit = playCache.get(eventId);
  if (hit?.final) return hit.plays;
  const res = await fetch(`${CORE}/events/${eventId}/competitions/${eventId}/plays?limit=500`, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN plays ${res.status}`);
  const data = (await res.json()) as { items?: EspnPlay[] };
  const plays = data.items ?? [];
  playCache.set(eventId, { plays, final });
  return plays;
}

/** "name|TEAM" -> ESPN id, from the game's box score. Refreshed at most every 5 minutes. */
async function getBoxNames(eventId: string): Promise<Map<string, string>> {
  const hit = boxCache.get(eventId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.names;
  const names = new Map<string, string>();
  try {
    const res = await fetch(`${SITE}/summary?event=${eventId}`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as {
        boxscore?: {
          players?: {
            team: { abbreviation: string };
            statistics: { athletes: { athlete: { id: string; displayName: string } }[] }[];
          }[];
        };
      };
      for (const team of data.boxscore?.players ?? []) {
        const abbr = TEAM_FIX[team.team.abbreviation] ?? team.team.abbreviation;
        for (const cat of team.statistics) {
          for (const a of cat.athletes) names.set(`${normName(a.athlete.displayName)}|${abbr}`, a.athlete.id);
        }
      }
    }
  } catch {
    // Name matching is a fallback; carry on without it.
  }
  boxCache.set(eventId, { names, at: Date.now() });
  return names;
}

// --- scoring -----------------------------------------------------------------

function fgPoints(yards: number, sc: Record<string, number>): number {
  const pick = (...keys: string[]) => keys.map((k) => sc[k]).find((v) => typeof v === "number") ?? 3;
  if (yards < 20) return pick("fgm_0_19", "fgm");
  if (yards < 30) return pick("fgm_20_29", "fgm");
  if (yards < 40) return pick("fgm_30_39", "fgm");
  if (yards < 50) return pick("fgm_40_49", "fgm");
  if (yards < 60) return pick("fgm_50_59", "fgm_50p", "fgm");
  return pick("fgm_60p", "fgm_50p", "fgm");
}

const tidy = (text: string) =>
  text
    .replace(/^\s*(\([^)]*\)\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();

/** What this play meant for one player, or null if it doesn't count for them. */
function describe(
  play: EspnPlay,
  roles: Set<string>,
  p: PlayerAnalysis,
  sc: Record<string, number>,
): { label: string; points: number; kind: PlayEvent["kind"] } | null {
  const type = play.type.text;
  const text = play.text ?? "";
  if (/No Play/i.test(text)) return null; // wiped out by a penalty
  const y = play.statYardage ?? 0;
  const td = /touchdown/i.test(type) || /TOUCHDOWN/.test(text);
  const v = (k: string, d = 0) => (typeof sc[k] === "number" ? sc[k] : d);
  const recBonus = v(`bonus_rec_${p.position.toLowerCase()}`);
  let label = "";
  let points = 0;
  let kind: PlayEvent["kind"] = "normal";

  const completion = /Reception|Passing Touchdown/i.test(type) && !/INTERCEPTED/.test(text);
  if (roles.has("receiver") && (completion || /Incompletion/i.test(type))) {
    if (completion) {
      points += v("rec") + recBonus + y * v("rec_yd") + (td ? v("rec_td", 6) : 0);
      label = td ? `${y}-yd TD catch` : `${y}-yd catch`;
    } else {
      label = "Targeted, incomplete";
    }
  } else if (roles.has("rusher")) {
    points += y * v("rush_yd") + (td ? v("rush_td", 6) : 0);
    label = td ? `${y}-yd rushing TD` : y < 0 ? `Run for a loss of ${-y}` : `${y}-yd run`;
  } else if (roles.has("passer")) {
    if (/Interception/i.test(type) || /INTERCEPTED/.test(text)) {
      points += v("pass_int", -1);
      label = "INTERCEPTED";
      kind = "turnover";
    } else if (/Sack/i.test(type)) {
      label = "Sacked";
    } else if (completion) {
      points += y * v("pass_yd") + (td ? v("pass_td", 4) : 0);
      label = td ? `${y}-yd TD pass` : `${y}-yd completion`;
    } else if (/Incompletion/i.test(type)) {
      label = "Incomplete pass";
    }
  } else if (roles.has("kicker") && /Field Goal/i.test(type)) {
    const dist = Number(text.match(/(\d+) yard field goal/i)?.[1] ?? y);
    if (/Good/i.test(type)) {
      points += fgPoints(dist, sc);
      label = `${dist}-yd FG good`;
    } else {
      points += v("fgmiss");
      label = `${dist}-yd FG missed`;
      kind = "miss";
    }
  }

  // Extra points and two-point conversions ride along on touchdown plays.
  if (roles.has("patScorer") && roles.has("kicker") && /extra point is GOOD/i.test(text)) {
    points += v("xpm", 1);
    label = label || "Extra point good";
  } else if (roles.has("patScorer") && /ATTEMPT SUCCEEDS/i.test(text)) {
    points += /pass/i.test(text.split("TWO-POINT")[1] ?? "") ? v("rec_2pt", 2) : v("rush_2pt", 2);
    label = label ? `${label} + 2-pt conversion` : "2-pt conversion";
  }
  if (roles.has("patPasser") && /ATTEMPT SUCCEEDS/i.test(text)) {
    points += v("pass_2pt", 2);
    label = label ? `${label} + 2-pt pass` : "2-pt conversion pass";
  }
  if (roles.has("fumbler") && /Fumble Recovery \(Opponent\)/i.test(type)) {
    points += v("fum_lost", -2);
    label = label ? `${label}, FUMBLE LOST` : "FUMBLE LOST";
    kind = "turnover";
  }
  if (roles.has("scorer") && !label && play.scoringPlay) {
    points += 6;
    label = "Return TD";
  }
  if (!label) return null;
  if (kind === "normal")
    kind = td || /TD/.test(label) ? "td" : Math.abs(y) >= 20 && !/incomplete/i.test(label) ? "big" : "normal";
  return { label, points: Math.round(points * 10) / 10, kind };
}

// --- main ----------------------------------------------------------------------

const TRACKED_ROLES = new Set([
  "passer",
  "rusher",
  "receiver",
  "kicker",
  "patScorer",
  "patPasser",
  "fumbler",
  "scorer",
]);

export async function fetchPlayByPlay(a: Analysis, live: LiveState): Promise<PlayByPlay> {
  const tracked: { lp: LivePlayer; side: PlayEvent["side"] }[] = [
    ...live.me.players.map((lp) => ({ lp, side: "mine" as const })),
    ...(live.opponent?.players ?? []).map((lp) => ({ lp, side: "opponent" as const })),
  ].filter(({ lp }) => lp.player && lp.game?.id && lp.status !== "pre" && lp.status !== "bye");

  const ids = await espnIds();
  const byGame = new Map<string, typeof tracked>();
  for (const t of tracked) byGame.set(t.lp.game!.id!, [...(byGame.get(t.lp.game!.id!) ?? []), t]);

  const events: PlayEvent[] = [];
  const unmatched: string[] = [];
  await Promise.all(
    [...byGame.entries()].map(async ([eventId, players]) => {
      const game = players[0].lp.game!;
      const plays = await getPlays(eventId, game.state === "post").catch(() => [] as EspnPlay[]);
      // Map each tracked player to an ESPN id.
      const want = new Map<string, (typeof players)[number]>();
      let box: Map<string, string> | null = null;
      for (const t of players) {
        const p = t.lp.player!;
        let espn = ids.get(p.id);
        if (!espn) {
          box ??= await getBoxNames(eventId);
          espn = box.get(`${normName(p.name)}|${p.team ?? ""}`);
        }
        if (espn) want.set(espn, t);
        else if (t.lp.points !== 0) unmatched.push(p.name); // no box-score line usually means they didn't play
      }
      for (const play of plays) {
        const roles = new Map<string, Set<string>>();
        for (const part of play.participants ?? []) {
          if (!TRACKED_ROLES.has(part.type)) continue;
          const id = part.athlete.$ref.match(/athletes\/(\d+)/)?.[1];
          if (!id || !want.has(id)) continue;
          roles.set(id, (roles.get(id) ?? new Set()).add(part.type));
        }
        for (const [id, r] of roles) {
          const t = want.get(id)!;
          const p = t.lp.player!;
          const d = describe(play, r, p, a.league.scoring_settings);
          if (!d) continue;
          const opp = p.team === game.home ? game.away : game.home;
          events.push({
            key: `${play.id}:${p.id}`,
            player: p,
            side: t.side,
            ...d,
            text: tidy(play.text ?? ""),
            clock: `${play.period.number > 4 ? "OT" : `Q${play.period.number}`} ${play.clock.displayValue}`,
            matchup: `${p.team} vs ${opp}`,
            at: play.wallclock ? Date.parse(play.wallclock) : Number(play.sequenceNumber ?? 0),
          });
        }
      }
    }),
  );
  events.sort((x, y) => y.at - x.at);
  return { events, unmatched, asOf: Date.now() };
}
