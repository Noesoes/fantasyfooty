// Hate Watch: the rest of your league's lineup mistakes, live. For every other
// team, from Sleeper's scoring for the week:
//  - blunders: a bench player who outscored someone they started in a spot he
//    could have filled ("benched Puka 24.3, started Pittman 3.1")
//  - bench monsters: big games wasted on the bench
//  - points left on the bench: their best possible lineup in hindsight minus
//    what they actually scored
// Your own team is left out: this is about everyone else.

import { SLOT_ELIGIBILITY, type Analysis, type PlayerAnalysis } from "./advisor";
import { getMatchups } from "./sleeper";

export interface Blunder {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  benched: PlayerAnalysis;
  benchedPts: number;
  started: PlayerAnalysis;
  startedPts: number;
  /** The slot the starter filled, e.g. "WR", "FLEX". */
  slot: string;
  /** Points they gave up by starting the wrong guy. */
  cost: number;
  /** True when this team is playing you this week. */
  vsYou: boolean;
  /** The starter's game isn't over yet: he can still catch up. */
  pending: boolean;
  /** Kickoff of the starter's game, when pending and known. */
  kickoff: number | null;
}

export interface BenchMonster {
  rosterId: number;
  teamName: string;
  player: PlayerAnalysis;
  pts: number;
  vsYou: boolean;
}

export interface ShameRow {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  /** What they scored with the lineup they set. */
  scored: number;
  /** Best possible from their roster, in hindsight. */
  best: number;
  left: number;
  vsYou: boolean;
  /** Counted from finished games only (the week is still being played). */
  soFar: boolean;
}

export interface HateWatch {
  week: number;
  /** False until games in the week have produced points. */
  started: boolean;
  blunders: Blunder[];
  monsters: BenchMonster[];
  shame: ShameRow[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const BIG_GAME = 15;
const GAME_LENGTH = 3.5 * 3_600_000;
const MIN_BLUNDER = 3;

export async function buildHateWatch(a: Analysis, week: number, now = Date.now()): Promise<HateWatch> {
  // Past weeks are over. In the current week, a starter's zero only counts once his game is done
  // (or he was on bye / without a team): before that he can still catch up.
  const pastWeek = week < a.week;
  const done = (p: PlayerAnalysis) =>
    pastWeek || p.onBye || !p.team || !p.game || (p.game.kickoffKnown && now > p.game.kickoff + GAME_LENGTH);
  const rows = await getMatchups(a.league.league_id, week);
  const slots = a.league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const mine = rows.find((r) => r.roster_id === a.myRosterId);
  const oppId =
    mine?.matchup_id != null
      ? rows.find((r) => r.matchup_id === mine.matchup_id && r.roster_id !== a.myRosterId)?.roster_id
      : undefined;

  const blunders: Blunder[] = [];
  const monsters: BenchMonster[] = [];
  const shame: ShameRow[] = [];
  let started = false;

  for (const team of a.otherTeams) {
    const row = rows.find((r) => r.roster_id === team.rosterId);
    if (!row?.players?.length || !row.starters) continue;
    const pts = (id: string) => row.players_points?.[id] ?? 0;
    if (Object.values(row.players_points ?? {}).some((v) => v !== 0)) started = true;
    const byId = new Map([...team.players, ...team.reserve].map((p) => [p.id, p]));
    const reserve = new Set(team.reserve.map((p) => p.id));
    const startedIds = row.starters.filter((id) => id && id !== "0");
    const bench = row.players
      .filter((id) => !startedIds.includes(id) && !reserve.has(id) && byId.has(id))
      .map((id) => byId.get(id)!);
    const vsYou = team.rosterId === oppId;

    // Blunders: each bench player against the lowest-scoring starter he could have replaced.
    const starters = row.starters
      .map((id, i) => ({ id, slot: slots[i], p: byId.get(id) }))
      .filter(
        (s): s is { id: string; slot: string; p: PlayerAnalysis } => !!s.p && !!s.slot && s.slot in SLOT_ELIGIBILITY,
      );
    const used = new Set<string>();
    const candidates = bench
      .map((b) => {
        const fits = starters
          .filter((s) => !used.has(s.id) && SLOT_ELIGIBILITY[s.slot].some((pos) => b.eligible.includes(pos)))
          .sort((x, y) => pts(x.id) - pts(y.id));
        return { b, worst: fits[0] };
      })
      .filter((c) => c.worst && pts(c.b.id) - pts(c.worst.id) >= MIN_BLUNDER)
      .sort((x, y) => pts(y.b.id) - pts(y.worst!.id) - (pts(x.b.id) - pts(x.worst!.id)));
    for (const { b } of candidates) {
      // Re-pick the starter now that others may be taken by a bigger blunder.
      const s = starters
        .filter((x) => !used.has(x.id) && SLOT_ELIGIBILITY[x.slot].some((pos) => b.eligible.includes(pos)))
        .sort((x, y) => pts(x.id) - pts(y.id))[0];
      if (!s || pts(b.id) - pts(s.id) < MIN_BLUNDER) continue;
      used.add(s.id);
      const pending = !done(s.p);
      blunders.push({
        rosterId: team.rosterId,
        teamName: team.teamName,
        avatar: team.avatar,
        benched: b,
        benchedPts: r1(pts(b.id)),
        started: s.p,
        startedPts: r1(pts(s.id)),
        slot: s.slot,
        cost: r1(pts(b.id) - pts(s.id)),
        vsYou,
        pending,
        kickoff: pending && s.p.game?.kickoffKnown ? s.p.game.kickoff : null,
      });
    }

    for (const b of bench) {
      if (pts(b.id) >= BIG_GAME)
        monsters.push({ rosterId: team.rosterId, teamName: team.teamName, player: b, pts: r1(pts(b.id)), vsYou });
    }

    // Best lineup in hindsight: fill the most restrictive slots first with the top scorers.
    const pool = [...starters.map((s) => s.p), ...bench].sort((x, y) => pts(y.id) - pts(x.id));
    const taken = new Set<string>();
    let best = 0;
    for (const slot of [...slots]
      .filter((s) => s in SLOT_ELIGIBILITY)
      .sort((x, y) => SLOT_ELIGIBILITY[x].length - SLOT_ELIGIBILITY[y].length)) {
      const p = pool.find((x) => !taken.has(x.id) && SLOT_ELIGIBILITY[slot].some((pos) => x.eligible.includes(pos)));
      if (p) {
        taken.add(p.id);
        best += pts(p.id);
      }
    }
    const scored = starters.reduce((sum, s) => sum + pts(s.id), 0);
    // Mid-week, count only blunders whose games are over (the rest can still change).
    const settled = blunders.filter((b) => b.rosterId === team.rosterId && !b.pending).reduce((n, b) => n + b.cost, 0);
    shame.push({
      rosterId: team.rosterId,
      teamName: team.teamName,
      avatar: team.avatar,
      scored: r1(scored),
      best: r1(best),
      left: r1(pastWeek ? Math.max(0, best - scored) : settled),
      vsYou,
      soFar: !pastWeek,
    });
  }

  return {
    week,
    started,
    blunders: blunders.sort((x, y) => y.cost - x.cost),
    monsters: monsters.sort((x, y) => y.pts - x.pts),
    shame: shame.sort((x, y) => y.left - x.left),
  };
}
