// Opponent scouting: this week's opponent, slot by slot against your best
// lineup, where they're weak, the moves they're likely to make, and how
// they've managed so far this season (from Sleeper's matchup history and
// transaction log) — plus a few stats worth bringing up in the group chat.

import {
  OUT_STATUSES,
  optimizeLineup,
  SLOT_ELIGIBILITY,
  type Analysis,
  type LineupSlot,
  type PlayerAnalysis,
} from "./advisor";
import { getMatchups, getRosters, getTransactions, type MatchupRow, type Roster } from "./sleeper";

export interface SlotEdge {
  slot: string;
  mine: PlayerAnalysis | null;
  theirs: PlayerAnalysis | null;
  /** Your projection minus theirs. */
  edge: number;
}

export interface WeakSpot {
  slot: string;
  player: PlayerAnalysis | null;
  reason: string;
}

export interface LikelyMove {
  kind: "swap" | "pickup";
  in: PlayerAnalysis;
  out: PlayerAnalysis | null;
  gain: number;
}

export interface Meeting {
  week: number;
  you: number;
  them: number;
}

export interface Tendencies {
  weeks: number;
  /** Points left on the bench vs. their best possible lineup, per week. */
  benchLeftPerWeek: number | null;
  benchLeftTotal: number | null;
  /** Times they started someone who scored 0. */
  zeroStarts: number;
  waiverAdds: number;
  freeAgentAdds: number;
  trades: number;
  faabSpent: number | null;
  /** Their average score over the last 3 weeks, and where it ranks (1 = best). */
  recentAvg: number | null;
  recentRank: number | null;
}

export interface Scouting {
  rosterId: number;
  teamName: string;
  avatar: string | null;
  record: { wins: number; losses: number; ties: number };
  pointsFor: number;
  /** 1 = most points in the league. */
  pointsForRank: number;
  /** 1 = best record. */
  standing: number;
  teams: number;
  edges: SlotEdge[];
  yourProjected: number;
  theirProjected: number;
  /** What they'd project with their best lineup. */
  theirBest: number;
  weakSpots: WeakSpot[];
  moves: LikelyMove[];
  tendencies: Tendencies;
  meetings: Meeting[];
  talk: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

type RosterSettings = NonNullable<Roster["settings"]> & { ties?: number; fpts?: number; fpts_decimal?: number };

export async function buildScouting(a: Analysis): Promise<Scouting | null> {
  const opp = a.opponent;
  if (!opp) return null;
  const leagueId = a.league.league_id;
  const theirTeam = a.otherTeams.find((t) => t.rosterId === opp.rosterId);
  const startWeek = Number((a.league.settings as Record<string, unknown>).start_week ?? 1) || 1;
  const pastWeeks = Array.from({ length: Math.max(0, a.week - startWeek) }, (_, i) => startWeek + i);

  const [rosters, thisWeek, history, transactions] = await Promise.all([
    getRosters(leagueId),
    getMatchups(leagueId, a.week).catch(() => [] as MatchupRow[]),
    Promise.all(pastWeeks.map((w) => getMatchups(leagueId, w).catch(() => [] as MatchupRow[]))),
    Promise.all(
      Array.from({ length: Math.max(1, a.week) }, (_, i) => getTransactions(leagueId, i + 1).catch(() => [])),
    ),
  ]);

  // --- Standings ---
  const st = (r: Roster) => (r.settings ?? {}) as RosterSettings;
  const pf = (r: Roster) => (st(r).fpts ?? 0) + (st(r).fpts_decimal ?? 0) / 100;
  const theirRoster = rosters.find((r) => r.roster_id === opp.rosterId);
  const byPoints = [...rosters].sort((x, y) => pf(y) - pf(x));
  const winPct = (r: Roster) => {
    const s = st(r);
    const g = (s.wins ?? 0) + (s.losses ?? 0) + (s.ties ?? 0);
    return g ? ((s.wins ?? 0) + (s.ties ?? 0) / 2) / g : 0;
  };
  const byRecord = [...rosters].sort((x, y) => winPct(y) - winPct(x) || pf(y) - pf(x));

  // --- Slot by slot: your best lineup vs. their current one ---
  const lookup = new Map<string, PlayerAnalysis>();
  for (const p of [...(theirTeam?.players ?? []), ...opp.starters]) lookup.set(p.id, p);
  const starterSlots = a.league.roster_positions.filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  const theirRow = thisWeek.find((m) => m.roster_id === opp.rosterId);
  const theirStarterIds = theirRow?.starters ?? theirRoster?.starters ?? [];
  const theirCurrent: LineupSlot[] = starterSlots.map((slot, i) => {
    const id = theirStarterIds[i];
    return { slot, player: id && id !== "0" ? (lookup.get(id) ?? null) : null };
  });
  const theirOptimal = theirTeam
    ? optimizeLineup(a.league.roster_positions, theirTeam.players, theirCurrent)
    : theirCurrent;
  const total = (l: LineupSlot[]) => round1(l.reduce((s, x) => s + (x.player?.weekScore ?? 0), 0));

  const edges: SlotEdge[] = starterSlots.map((slot, i) => {
    const mine = a.optimalLineup[i]?.player ?? null;
    const theirs = theirCurrent[i]?.player ?? null;
    return { slot, mine, theirs, edge: round1((mine?.weekScore ?? 0) - (theirs?.weekScore ?? 0)) };
  });

  // --- Weak spots in the lineup they have set ---
  const weakSpots: WeakSpot[] = [];
  theirCurrent.forEach((s, i) => {
    const p = s.player;
    const slot = starterSlots[i];
    if (!p) weakSpots.push({ slot, player: null, reason: "Empty slot" });
    else if (p.onBye) weakSpots.push({ slot, player: p, reason: "On bye" });
    else if (p.injury && OUT_STATUSES.has(p.injury)) weakSpots.push({ slot, player: p, reason: `Ruled ${p.injury}` });
    else if (p.injury === "Doubtful" || p.injury === "Questionable")
      weakSpots.push({ slot, player: p, reason: p.injury });
    else if (p.weekScore === 0) weakSpots.push({ slot, player: p, reason: "Not projected to play" });
  });

  // --- Moves they're likely to make ---
  const moves: LikelyMove[] = [];
  const currentIds = new Set(theirCurrent.map((s) => s.player?.id).filter(Boolean));
  const optimalIds = new Set(theirOptimal.map((s) => s.player?.id).filter(Boolean));
  const ins = theirOptimal.map((s) => s.player).filter((p): p is PlayerAnalysis => !!p && !currentIds.has(p.id));
  const outs = theirCurrent
    .map((s) => s.player)
    .filter((p): p is PlayerAnalysis => !!p && !optimalIds.has(p.id))
    .sort((x, y) => x.weekScore - y.weekScore);
  ins
    .sort((x, y) => y.weekScore - x.weekScore)
    .forEach((p, i) => {
      const out = outs[i] ?? null;
      const gain = round1(p.weekScore - (out?.weekScore ?? 0));
      if (gain >= 1) moves.push({ kind: "swap", in: p, out, gain });
    });
  // Free agents who'd beat the weakest starter they'd have at that slot.
  const usedFa = new Set<string>();
  theirOptimal.forEach((s, i) => {
    const eligible = SLOT_ELIGIBILITY[starterSlots[i]];
    if (!eligible) return;
    const current = s.player?.weekScore ?? 0;
    const fa = eligible
      .flatMap((pos) => a.streamersByPosition[pos] ?? [])
      .filter((p) => !usedFa.has(p.id) && !p.injury && p.weekScore >= current + 3)
      .sort((x, y) => y.weekScore - x.weekScore)[0];
    if (fa) {
      usedFa.add(fa.id);
      moves.push({ kind: "pickup", in: fa, out: s.player, gain: round1(fa.weekScore - current) });
    }
  });
  moves.sort((x, y) => (x.kind === y.kind ? y.gain - x.gain : x.kind === "swap" ? -1 : 1));

  // --- How they've managed so far ---
  const positions = new Map<string, string[]>();
  for (const p of [...a.roster, ...a.otherTeams.flatMap((t) => t.players)]) positions.set(p.id, p.eligible);
  let benchLeft = 0;
  let benchWeeks = 0;
  let zeroStarts = 0;
  const meetings: Meeting[] = [];
  const recentScores = new Map<number, number[]>();
  history.forEach((rows, k) => {
    const week = pastWeeks[k];
    const row = rows.find((m) => m.roster_id === opp.rosterId);
    if (!row?.players_points || !Object.values(row.players_points).some((v) => v !== 0)) return;
    for (const r of rows) {
      if (k >= pastWeeks.length - 3)
        recentScores.set(r.roster_id, [...(recentScores.get(r.roster_id) ?? []), r.points]);
    }
    const pts = (id: string) => row.players_points?.[id] ?? 0;
    const started = (row.starters ?? []).filter((id, i) => id && id !== "0" && SLOT_ELIGIBILITY[starterSlots[i]]);
    zeroStarts += started.filter((id) => pts(id) === 0).length;
    // Best lineup in hindsight from players we can place at a position.
    const pool = (row.players ?? []).filter((id) => positions.has(id)).sort((x, y) => pts(y) - pts(x));
    const used = new Set<string>();
    let best = 0;
    for (const slot of [...starterSlots].sort(
      (x, y) => (SLOT_ELIGIBILITY[x]?.length ?? 99) - (SLOT_ELIGIBILITY[y]?.length ?? 99),
    )) {
      const eligible = SLOT_ELIGIBILITY[slot];
      if (!eligible) continue;
      const id = pool.find((x) => !used.has(x) && positions.get(x)!.some((p) => eligible.includes(p)));
      if (id) {
        used.add(id);
        best += pts(id);
      }
    }
    const actual = started.reduce((s, id) => s + pts(id), 0);
    benchLeft += Math.max(0, best - actual);
    benchWeeks++;
    const mine = rows.find((m) => m.roster_id === a.myRosterId);
    if (mine && row.matchup_id && mine.matchup_id === row.matchup_id) {
      meetings.push({ week, you: round1(mine.points), them: round1(row.points) });
    }
  });

  let waiverAdds = 0;
  let freeAgentAdds = 0;
  let trades = 0;
  let leagueMoves = 0;
  for (const t of transactions.flat()) {
    if (t.status === "complete") leagueMoves++;
    if (t.status !== "complete" || !t.roster_ids.includes(opp.rosterId)) continue;
    if (t.type === "trade") trades++;
    else if (t.adds && Object.values(t.adds).includes(opp.rosterId)) {
      if (t.type === "waiver") waiverAdds++;
      else if (t.type === "free_agent") freeAgentAdds++;
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const recentAvgs = [...recentScores.entries()]
    .map(([id, xs]) => ({ id, avg: avg(xs) }))
    .sort((x, y) => y.avg - x.avg);
  const theirRecent = recentAvgs.find((r) => r.id === opp.rosterId);
  const tendencies: Tendencies = {
    weeks: benchWeeks,
    benchLeftPerWeek: benchWeeks ? round1(benchLeft / benchWeeks) : null,
    benchLeftTotal: benchWeeks ? round1(benchLeft) : null,
    zeroStarts,
    waiverAdds,
    freeAgentAdds,
    trades,
    faabSpent: a.waiver.type === "faab" ? (theirRoster?.settings?.waiver_budget_used ?? 0) : null,
    recentAvg: theirRecent ? round1(theirRecent.avg) : null,
    recentRank: theirRecent ? recentAvgs.indexOf(theirRecent) + 1 : null,
  };

  const s = theirRoster ? st(theirRoster) : {};
  const record = { wins: s.wins ?? 0, losses: s.losses ?? 0, ties: s.ties ?? 0 };
  const teams = rosters.length;
  const pointsForRank = theirRoster ? byPoints.indexOf(theirRoster) + 1 : teams;
  const standing = theirRoster ? byRecord.indexOf(theirRoster) + 1 : teams;
  const yourProjected = a.optimalTotal;
  const theirProjected = total(theirCurrent);
  const theirBest = total(theirOptimal);

  // --- Talking points: true, and a little pointed ---
  const talk: string[] = [];
  const wonSlots = edges.filter((e) => e.edge > 0.5).length;
  const modeled = edges.filter((e) => e.mine || e.theirs).length;
  const out = weakSpots.find((w) => w.player && /Ruled|bye/i.test(w.reason));
  if (out?.player) {
    const why = out.reason === "On bye" ? "on bye" : out.player.injury;
    talk.push(`${out.player.name} (${why}) is still in their lineup.`);
  }
  if (tendencies.benchLeftTotal !== null && tendencies.benchLeftPerWeek !== null && tendencies.benchLeftPerWeek >= 8) {
    talk.push(
      `They've left ${tendencies.benchLeftTotal.toFixed(0)} pts on their bench this season (${tendencies.benchLeftPerWeek.toFixed(1)} a week).`,
    );
  }
  if (standing <= Math.ceil(teams / 3) && pointsForRank >= Math.ceil(teams / 2) + 1) {
    talk.push(
      `Their ${record.wins}-${record.losses} record is flattering: only the ${ordinal(pointsForRank)}-most points in the league.`,
    );
  }
  if (tendencies.recentRank !== null && tendencies.recentRank >= teams - 2 && tendencies.recentAvg !== null) {
    talk.push(
      `Averaging ${tendencies.recentAvg.toFixed(1)} over the last 3 weeks, ${tendencies.recentRank === teams ? "worst" : `${ordinal(teams - tendencies.recentRank + 1)}-worst`} in the league.`,
    );
  }
  if (zeroStarts >= 2) talk.push(`They've started a player who scored zero ${zeroStarts} times.`);
  // Only notable if the rest of the league is active (and the log isn't just empty).
  if (waiverAdds + freeAgentAdds + trades === 0 && benchWeeks >= 3 && leagueMoves >= teams) {
    talk.push("Zero roster moves all season. Set-it-and-forget-it energy.");
  } else if (waiverAdds + freeAgentAdds >= 10) {
    talk.push(`${waiverAdds + freeAgentAdds} pickups already — expect them to work the wire before kickoff.`);
  }
  if (modeled && wonSlots > modeled / 2) talk.push(`You have the edge at ${wonSlots} of ${modeled} lineup spots.`);
  const lastMeeting = meetings.at(-1);
  if (lastMeeting) {
    talk.push(
      lastMeeting.you > lastMeeting.them
        ? `You beat them ${lastMeeting.you.toFixed(1)}–${lastMeeting.them.toFixed(1)} in week ${lastMeeting.week}.`
        : `Revenge game: they beat you ${lastMeeting.them.toFixed(1)}–${lastMeeting.you.toFixed(1)} in week ${lastMeeting.week}.`,
    );
  }

  return {
    rosterId: opp.rosterId,
    teamName: opp.teamName,
    avatar: opp.avatar,
    record,
    pointsFor: round1(theirRoster ? pf(theirRoster) : 0),
    pointsForRank,
    standing,
    teams,
    edges,
    yourProjected,
    theirProjected,
    theirBest,
    weakSpots,
    moves: moves.slice(0, 5),
    tendencies,
    meetings,
    talk: talk.slice(0, 4),
  };
}
