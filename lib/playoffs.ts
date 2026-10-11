// Playoff odds: simulate the rest of the regular season thousands of times
// from the current standings, the real remaining schedule and each team's
// strength (its best lineup's projected points), then count how often each
// team makes the playoffs, earns a bye, or lands each seed.

import { SLOT_ELIGIBILITY, type Analysis, type PlayerAnalysis } from "./advisor";
import { getMatchups, getRosters, type MatchupRow, type Roster } from "./sleeper";
import { getWeekGames } from "./scoreboard";

const SIMS = 10_000;
// A team's weekly score swings by roughly a fifth of its average, and our
// read on how good a team really is can be off by several percent. Once a
// week is underway, a player's remaining points vary by ~60% of projection.
const WEEKLY_SPREAD = 0.22;
const STRENGTH_SPREAD = 0.07;
const PLAYER_SPREAD = 0.6;

export interface PlayoffTeam {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Expected points per week for the rest of the season. */
  strength: number;
  projectedWins: number;
  playoffPct: number;
  byePct: number;
  /** seedPct[i] = chance of finishing as seed i + 1. */
  seedPct: number[];
}

export interface MustWinWeek {
  week: number;
  opponent: string | null;
  winProbability: number;
  /** Your playoff chance if you win / lose that week. */
  ifWin: number;
  ifLose: number;
}

export interface PlayoffOdds {
  teams: PlayoffTeam[];
  me: PlayoffTeam;
  playoffTeams: number;
  byes: number;
  remainingWeeks: number[];
  playoffStart: number;
  mustWin: MustWinWeek[];
  /** Your final win total → how often it happens and your playoff chance with it. */
  winsOutlook: { wins: number; chance: number; playoffPct: number }[];
  medianGames: boolean;
  divisions: boolean;
}

type RosterSettings = NonNullable<Roster["settings"]> & {
  ties?: number;
  fpts?: number;
  fpts_decimal?: number;
  division?: number;
};

function lineupSlots(rosterPositions: string[]) {
  return rosterPositions
    .filter((s) => s in SLOT_ELIGIBILITY)
    .map((s) => SLOT_ELIGIBILITY[s])
    .sort((a, b) => a.length - b.length);
}

function lineupPoints(slots: string[][], players: PlayerAnalysis[], score: (p: PlayerAnalysis) => number) {
  const sorted = [...players].sort((x, y) => score(y) - score(x));
  const used = new Set<string>();
  let total = 0;
  for (const eligible of slots) {
    const p = sorted.find((x) => !used.has(x.id) && x.eligible.some((pos) => eligible.includes(pos)));
    if (p) {
      used.add(p.id);
      total += score(p);
    }
  }
  return total;
}

/** Box–Muller standard normal. */
function normal() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

const pct = (n: number) => Math.round(n * 1000) / 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function buildPlayoffOdds(a: Analysis): Promise<PlayoffOdds> {
  const settings = a.league.settings as Record<string, unknown>;
  const playoffStart = Number(settings.playoff_week_start ?? 15) || 15;
  const startWeek = Number(settings.start_week ?? 1) || 1;
  const playoffTeams = Number(settings.playoff_teams ?? 6) || 6;
  const medianGames = Number(settings.league_average_match ?? 0) === 1;
  const rosters = await getRosters(a.league.league_id);
  const n = rosters.length;
  const bracket = 2 ** Math.ceil(Math.log2(Math.max(2, playoffTeams)));
  const byes = Math.max(0, bracket - playoffTeams);

  // Who's who, and each team's strength.
  const slots = lineupSlots(a.league.roster_positions);
  const playersOf = new Map<number, PlayerAnalysis[]>([[a.myRosterId, a.activeRoster]]);
  const names = new Map<number, { teamName: string; avatar: string | null }>([
    [a.myRosterId, { teamName: a.teamName, avatar: a.avatar }],
  ]);
  for (const t of a.otherTeams) {
    playersOf.set(t.rosterId, t.players);
    names.set(t.rosterId, { teamName: t.teamName, avatar: t.avatar });
  }

  const s = (r: Roster) => (r.settings ?? {}) as RosterSettings;
  const played = Math.max(0, ...rosters.map((r) => (s(r).wins ?? 0) + (s(r).losses ?? 0) + (s(r).ties ?? 0)));
  const nextWeek = startWeek + Math.round(played / (medianGames ? 2 : 1));
  const remainingWeeks: number[] = [];
  for (let w = Math.max(nextWeek, startWeek); w < playoffStart; w++) remainingWeeks.push(w);

  const ids = rosters.map((r) => r.roster_id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const gamesSoFar = Math.max(1, Math.round(played / (medianGames ? 2 : 1)));
  const base = rosters.map((r) => {
    const st = s(r);
    const pointsFor = (st.fpts ?? 0) + (st.fpts_decimal ?? 0) / 100;
    const players = playersOf.get(r.roster_id) ?? [];
    const model = lineupPoints(slots, players, (p) => p.rosValue);
    // Lean on actual scoring once there's a real sample.
    const weight = Math.min(0.4, gamesSoFar * 0.05);
    const strength = played > 0 && pointsFor > 0 ? (1 - weight) * model + (weight * pointsFor) / gamesSoFar : model;
    const thisWeek = lineupPoints(slots, players, (p) => p.weekScore);
    return {
      rosterId: r.roster_id,
      ...(names.get(r.roster_id) ?? { teamName: `Team ${r.roster_id}`, avatar: null }),
      wins: st.wins ?? 0,
      losses: st.losses ?? 0,
      ties: st.ties ?? 0,
      pointsFor: round1(pointsFor),
      strength: round1(strength),
      thisWeek,
      division: st.division ?? 0,
    };
  });

  // Remaining schedule; weeks Sleeper hasn't paired yet get random pairings.
  const rowsByWeek = new Map<number, MatchupRow[]>();
  const schedule = await Promise.all(
    remainingWeeks.map(async (week) => {
      const rows = await getMatchups(a.league.league_id, week).catch(() => []);
      rowsByWeek.set(week, rows);
      const byMatch = new Map<number, number[]>();
      for (const m of rows) {
        if (!m.matchup_id || !index.has(m.roster_id)) continue;
        byMatch.set(m.matchup_id, [...(byMatch.get(m.matchup_id) ?? []), index.get(m.roster_id)!]);
      }
      const pairs = [...byMatch.values()].filter((p) => p.length === 2) as [number, number][];
      return { week, pairs: pairs.length ? pairs : null };
    }),
  );

  // If this week's games have started, start from the points already on the
  // board plus what each starter is still expected to add.
  const live = new Map<number, { banked: number; remaining: number; sd: number }>();
  if (remainingWeeks.includes(a.week)) {
    const games = await getWeekGames(a.season, a.week).catch(() => null);
    if (games && [...games.byTeam.values()].some((g) => g.state !== "pre")) {
      const lookup = new Map([...playersOf.values()].flat().map((p) => [p.id, p]));
      for (const row of rowsByWeek.get(a.week) ?? []) {
        const i = index.get(row.roster_id);
        if (i === undefined) continue;
        let banked = 0;
        let remaining = 0;
        let variance = 0;
        for (const id of row.starters ?? []) {
          banked += row.players_points?.[id] ?? 0;
          const p = lookup.get(id);
          const g = p?.team ? games.byTeam.get(p.team) : undefined;
          if (!p || !g) continue;
          const left = 1 - g.elapsed;
          remaining += p.weekScore * left;
          variance += (PLAYER_SPREAD * p.weekScore) ** 2 * left;
        }
        live.set(i, { banked, remaining, sd: Math.sqrt(variance) });
      }
    }
  }

  const meanFor = (i: number, week: number) => {
    const l = week === a.week ? live.get(i) : undefined;
    if (l) return l.banked + l.remaining;
    return week === a.week ? base[i].thisWeek : base[i].strength;
  };
  const sdFor = (i: number, week: number) => {
    const l = week === a.week ? live.get(i) : undefined;
    return l ? l.sd : meanFor(i, week) * WEEKLY_SPREAD;
  };
  const divisions = new Set(base.map((t) => t.division).filter(Boolean)).size > 1;

  const madeIt = new Array(n).fill(0);
  const byeCount = new Array(n).fill(0);
  const winTotals = new Array(n).fill(0);
  const seeds = base.map(() => new Array(n).fill(0));
  const me = index.get(a.myRosterId) ?? 0;
  const weekSplit = schedule.map(() => ({ win: 0, winMade: 0, lose: 0, loseMade: 0 }));
  const myWinsHist = new Map<number, { count: number; made: number }>();

  const wins = new Float64Array(n);
  const pf = new Float64Array(n);
  const myResult = new Int8Array(schedule.length);
  const form = new Float64Array(n);
  for (let sim = 0; sim < SIMS; sim++) {
    for (let i = 0; i < n; i++) {
      wins[i] = base[i].wins + base[i].ties / 2;
      pf[i] = base[i].pointsFor;
      form[i] = 1 + normal() * STRENGTH_SPREAD;
    }
    myResult.fill(-1);
    for (let k = 0; k < schedule.length; k++) {
      const { week, pairs } = schedule[k];
      const score = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const l = week === a.week ? live.get(i) : undefined;
        if (l) {
          score[i] = l.banked + l.remaining * form[i] + normal() * l.sd;
        } else {
          const mean = meanFor(i, week) * form[i];
          score[i] = mean + normal() * mean * WEEKLY_SPREAD;
        }
        pf[i] += score[i];
      }
      let games = pairs;
      if (!games) {
        const order = ids.map((_, i) => i).sort(() => Math.random() - 0.5);
        games = [];
        for (let j = 0; j + 1 < order.length; j += 2) games.push([order[j], order[j + 1]]);
      }
      for (const [x, y] of games) {
        const winner = score[x] >= score[y] ? x : y;
        wins[winner] += 1;
        if (x === me || y === me) myResult[k] = winner === me ? 1 : 0;
      }
      if (medianGames) {
        const sorted = Array.from(score).sort((p, q) => q - p);
        const cut = sorted[Math.floor(n / 2) - 1];
        for (let i = 0; i < n; i++) if (score[i] >= cut) wins[i] += 1;
      }
    }

    // Seed: division winners first (when the league has divisions), then by
    // record, points for as the tiebreaker.
    const order = ids.map((_, i) => i).sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]);
    let seeded = order;
    if (divisions) {
      const winners = new Set<number>();
      const seen = new Set<number>();
      for (const i of order) {
        if (!seen.has(base[i].division)) {
          seen.add(base[i].division);
          winners.add(i);
        }
      }
      seeded = [...order.filter((i) => winners.has(i)), ...order.filter((i) => !winners.has(i))];
    }
    seeded.forEach((i, rank) => {
      seeds[i][rank]++;
      if (rank < playoffTeams) madeIt[i]++;
      if (rank < byes) byeCount[i]++;
    });
    for (let i = 0; i < n; i++) winTotals[i] += wins[i];

    const myMade = seeded.indexOf(me) < playoffTeams;
    for (let k = 0; k < schedule.length; k++) {
      if (myResult[k] === 1) {
        weekSplit[k].win++;
        if (myMade) weekSplit[k].winMade++;
      } else if (myResult[k] === 0) {
        weekSplit[k].lose++;
        if (myMade) weekSplit[k].loseMade++;
      }
    }
    const w = Math.floor(wins[me]);
    const h = myWinsHist.get(w) ?? { count: 0, made: 0 };
    h.count++;
    if (myMade) h.made++;
    myWinsHist.set(w, h);
  }

  const teams: PlayoffTeam[] = base.map((t, i) => ({
    rosterId: t.rosterId,
    teamName: t.teamName,
    avatar: t.avatar,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: t.pointsFor,
    strength: t.strength,
    projectedWins: round1(winTotals[i] / SIMS),
    playoffPct: pct(madeIt[i] / SIMS),
    byePct: pct(byeCount[i] / SIMS),
    seedPct: seeds[i].map((c) => pct(c / SIMS)),
  }));

  const mustWin: MustWinWeek[] = schedule.map(({ week, pairs }, k) => {
    const pair = pairs?.find(([x, y]) => x === me || y === me);
    const opp = pair ? (pair[0] === me ? pair[1] : pair[0]) : null;
    const sd = (i: number) => sdFor(i, week);
    const winProbability =
      opp === null ? 0.5 : phi((meanFor(me, week) - meanFor(opp, week)) / Math.max(0.5, Math.hypot(sd(me), sd(opp))));
    const sp = weekSplit[k];
    return {
      week,
      opponent: opp === null ? null : base[opp].teamName,
      winProbability: pct(winProbability),
      ifWin: pct(sp.win ? sp.winMade / sp.win : 0),
      ifLose: pct(sp.lose ? sp.loseMade / sp.lose : 0),
    };
  });

  const winsOutlook = [...myWinsHist.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([w, h]) => ({ wins: w, chance: pct(h.count / SIMS), playoffPct: pct(h.made / h.count) }));

  return {
    teams: [...teams].sort((x, y) => y.playoffPct - x.playoffPct || y.projectedWins - x.projectedWins),
    me: teams[me],
    playoffTeams,
    byes,
    remainingWeeks,
    playoffStart,
    mustWin,
    winsOutlook,
    medianGames,
    divisions,
  };
}
