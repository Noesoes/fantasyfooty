// Track record: replay every completed week with what actually happened.
// For each week we compare the lineup you started, the lineup the advisor
// would have picked from Sleeper's pre-game projections, and the best lineup
// possible in hindsight — plus how often the advisor's start/sit calls (where
// it disagreed with you) were right.
//
// Uses only Sleeper data (matchups store each week's roster, starters and
// actual points), so it works for any league without saving anything.

import { points, SLOT_ELIGIBILITY, type Analysis } from "./advisor";
import { getMatchups, getWeekProjections, type StatRow } from "./sleeper";

export interface LitePlayer {
  id: string;
  name: string;
  position: string;
  team: string | null;
}

export interface Call {
  /** Advisor wanted this player in... */
  advisor: LitePlayer & { points: number };
  /** ...instead of this one, whom you started. */
  yours: LitePlayer & { points: number };
  hit: boolean;
}

export interface WeekResult {
  week: number;
  yours: number;
  advisor: number;
  best: number;
  opponent: number | null;
  won: boolean | null;
  /** Would the advisor's lineup have won? */
  advisorWon: boolean | null;
  calls: Call[];
}

export interface TrackRecord {
  weeks: WeekResult[];
  totals: { yours: number; advisor: number; best: number };
  calls: number;
  hits: number;
  bestBall: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function lineupSlots(rosterPositions: string[]) {
  return rosterPositions.filter((s) => s in SLOT_ELIGIBILITY).sort((a, b) => SLOT_ELIGIBILITY[a].length - SLOT_ELIGIBILITY[b].length);
}

/** Greedy lineup maximizing `score` over players with known positions. */
function pick(slots: string[], ids: string[], pos: Map<string, string[]>, score: (id: string) => number) {
  const sorted = ids.filter((id) => pos.has(id)).sort((a, b) => score(b) - score(a));
  const used = new Set<string>();
  for (const slot of slots) {
    const id = sorted.find((x) => !used.has(x) && pos.get(x)!.some((p) => SLOT_ELIGIBILITY[slot].includes(p)));
    if (id) used.add(id);
  }
  return used;
}

export async function buildTrackRecord(a: Analysis): Promise<TrackRecord> {
  const bestBall = a.bestBall;
  const startWeek = Number((a.league.settings as Record<string, unknown>).start_week ?? 1);
  const weeks = Array.from({ length: Math.max(0, a.week - startWeek) }, (_, i) => startWeek + i);
  const slots = lineupSlots(a.league.roster_positions);
  const starterSlots = a.league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const myRosterId = a.myRosterId;

  // Names/positions for players who weren't projected that week.
  const known = new Map<string, LitePlayer & { eligible: string[] }>();
  for (const p of [...a.roster, ...a.otherTeams.flatMap((t) => t.players)]) {
    known.set(p.id, { id: p.id, name: p.name, position: p.position, team: p.team, eligible: p.eligible });
  }

  const results = await Promise.all(
    weeks.map(async (week): Promise<WeekResult | null> => {
      const [matchups, projections] = await Promise.all([
        getMatchups(a.league.league_id, week),
        getWeekProjections(a.season, week).catch(() => [] as StatRow[]),
      ]);
      const mine = matchups.find((m) => m.roster_id === myRosterId);
      if (!mine?.players?.length || !mine.players_points) return null;
      const actual = (id: string) => mine.players_points?.[id] ?? 0;
      // Skip weeks that haven't been played/scored.
      if (!Object.values(mine.players_points).some((v) => v !== 0)) return null;

      const projById = new Map(projections.map((r) => [r.player_id, r]));
      const info = (id: string): LitePlayer & { eligible: string[] } => {
        const row = projById.get(id);
        const k = known.get(id);
        const position = row?.player?.position ?? k?.position ?? (/^[A-Z]{2,3}$/.test(id) ? "DEF" : "?");
        const eligible = row?.player?.fantasy_positions?.length ? row.player.fantasy_positions : (k?.eligible ?? [position]);
        const name =
          position === "DEF"
            ? `${id} D/ST`
            : ([row?.player?.first_name, row?.player?.last_name].filter(Boolean).join(" ") || k?.name || id);
        return { id, name, position, team: row?.team ?? k?.team ?? null, eligible };
      };
      const projected = (id: string) => {
        const row = projById.get(id);
        return row ? points(row.stats, a.league.scoring_settings, info(id).position) : 0;
      };

      const players = mine.players;
      const pos = new Map(players.map((id) => [id, info(id).eligible]));
      // Your actual lineup, restricted to slot types we model (no IDP).
      const yourIds = new Set(
        (mine.starters ?? []).filter((id, i) => id && id !== "0" && starterSlots[i] && starterSlots[i] in SLOT_ELIGIBILITY),
      );
      const advisorIds = pick(slots, players, pos, projected);
      const bestIds = pick(slots, players, pos, actual);
      const sum = (ids: Set<string>) => round1([...ids].reduce((s, id) => s + actual(id), 0));

      // Start/sit calls: where the advisor disagreed with you, pair its extra
      // starters with your extra starters (best-projected first) and see who
      // actually scored more.
      const advisorOnly = [...advisorIds].filter((id) => !yourIds.has(id)).sort((x, y) => projected(y) - projected(x));
      const yoursOnly = [...yourIds].filter((id) => !advisorIds.has(id)).sort((x, y) => projected(y) - projected(x));
      const calls: Call[] = advisorOnly.slice(0, yoursOnly.length).map((id, i) => {
        const other = yoursOnly[i];
        const lite = (x: string) => {
          const { id: pid, name, position, team } = info(x);
          return { id: pid, name, position, team, points: round1(actual(x)) };
        };
        return {
          advisor: lite(id),
          yours: lite(other),
          hit: actual(id) > actual(other),
        };
      });

      const opp = mine.matchup_id
        ? matchups.find((m) => m.matchup_id === mine.matchup_id && m.roster_id !== myRosterId)
        : undefined;
      const yours = sum(yourIds);
      const advisor = sum(advisorIds);
      // Your real total can include slots we don't model (IDP), so compare
      // results on Sleeper's official score, adjusted by the advisor's diff.
      const official = round1(mine.points ?? yours);
      const opponent = opp ? round1(opp.points) : null;
      return {
        week,
        yours,
        advisor,
        best: sum(bestIds),
        opponent,
        won: opponent === null ? null : official > opponent,
        advisorWon: opponent === null ? null : official - yours + advisor > opponent,
        calls,
      };
    }),
  );

  const done = results.filter((r): r is WeekResult => r !== null);
  const allCalls = done.flatMap((w) => w.calls);
  return {
    weeks: done,
    totals: {
      yours: round1(done.reduce((s, w) => s + w.yours, 0)),
      advisor: round1(done.reduce((s, w) => s + w.advisor, 0)),
      best: round1(done.reduce((s, w) => s + w.best, 0)),
    },
    calls: allCalls.length,
    hits: allCalls.filter((c) => c.hit).length,
    bestBall,
  };
}
