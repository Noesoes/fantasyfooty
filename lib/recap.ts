// Waiver recap: what happened in the league's latest waiver run. Your claims
// (won, or lost and to whom for how much), the league's biggest adds, and
// where that leaves your priority or budget. Sleeper's transactions include
// failed claims with their bids, so lost claims can be explained.

import type { Analysis, PlayerAnalysis } from "./advisor";
import { getTransactions, type Transaction } from "./sleeper";

export interface ClaimResult {
  player: string;
  playerId: string;
  position: string | null;
  won: boolean;
  bid: number | null;
  dropped: string | null;
  /** For lost claims: who got him, and for how much (FAAB). */
  winner: string | null;
  winningBid: number | null;
  note: string | null;
}

export interface LeagueAdd {
  player: string;
  playerId: string;
  team: string;
  bid: number | null;
  /** Number of teams that put in a claim for him. */
  claims: number;
}

export interface WaiverRecap {
  week: number;
  /** When the run was processed. */
  processed: number;
  faab: boolean;
  mine: ClaimResult[];
  top: LeagueAdd[];
  /** Successful claims across the league. */
  totalClaims: number;
}

/** The most recent waiver run (this week's, else last week's), or null if there hasn't been one. */
export async function fetchWaiverRecap(a: Analysis): Promise<WaiverRecap | null> {
  const weeks = [a.week, a.week - 1, a.week - 2].filter((w) => w >= 1);
  let claims: Transaction[] = [];
  let week = a.week;
  for (const w of weeks) {
    const tx = await getTransactions(a.league.league_id, w);
    claims = tx.filter((t) => t.type === "waiver");
    if (claims.length) {
      week = w;
      break;
    }
  }
  if (!claims.length) return null;

  // The latest processing time is the run (a league can process more than once a week; keep the last).
  const processed = Math.max(...claims.map((t) => t.status_updated ?? t.created));
  const run = claims.filter((t) => Math.abs((t.status_updated ?? t.created) - processed) < 6 * 3600_000);

  const people = new Map<string, PlayerAnalysis>();
  for (const p of [...a.roster, ...a.otherTeams.flatMap((t) => t.players), ...a.freeAgentPool]) people.set(p.id, p);
  const teamOf = new Map<number, string>([
    [a.myRosterId, "You"],
    ...a.otherTeams.map((t) => [t.rosterId, t.teamName] as [number, string]),
  ]);
  const name = (id: string) => people.get(id)?.name ?? "A player";
  const added = (t: Transaction) => Object.keys(t.adds ?? {})[0];
  const bidOf = (t: Transaction) => (typeof t.settings?.waiver_bid === "number" ? t.settings.waiver_bid : null);

  const winners = new Map<string, Transaction>();
  for (const t of run) if (t.status === "complete" && added(t)) winners.set(added(t), t);
  const claimCount = new Map<string, number>();
  for (const t of run) if (added(t)) claimCount.set(added(t), (claimCount.get(added(t)) ?? 0) + 1);

  const mine: ClaimResult[] = run
    .filter((t) => t.roster_ids.includes(a.myRosterId) && added(t))
    .map((t) => {
      const id = added(t);
      const won = t.status === "complete";
      const w = won ? null : winners.get(id);
      const drop = Object.keys(t.drops ?? {})[0];
      return {
        player: name(id),
        playerId: id,
        position: people.get(id)?.position ?? null,
        won,
        bid: bidOf(t),
        dropped: drop ? name(drop) : null,
        winner: w ? (teamOf.get(w.roster_ids[0]) ?? "Another team") : null,
        winningBid: w ? bidOf(w) : null,
        note: won ? null : (t.metadata?.notes ?? null),
      };
    })
    .sort((x, y) => Number(y.won) - Number(x.won) || (y.bid ?? 0) - (x.bid ?? 0));

  const top: LeagueAdd[] = [...winners.entries()]
    .map(([id, t]) => ({
      player: name(id),
      playerId: id,
      team: teamOf.get(t.roster_ids[0]) ?? "A team",
      bid: bidOf(t),
      claims: claimCount.get(id) ?? 1,
    }))
    .sort((x, y) => (y.bid ?? 0) - (x.bid ?? 0) || y.claims - x.claims)
    .slice(0, 5);

  return {
    week,
    processed,
    faab: a.waiver.type === "faab",
    mine,
    top,
    totalClaims: winners.size,
  };
}
