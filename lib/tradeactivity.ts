// How often each team in the league has traded this season (completed trades
// only), from Sleeper's transactions. A manager who never trades is a long
// shot whatever the offer; one who trades often is worth pitching first.

import type { Analysis } from "./advisor";
import { getTransactions } from "./sleeper";

const cache = new Map<string, Promise<Map<number, number>>>();

export function tradeActivity(a: Analysis): Promise<Map<number, number>> {
  const key = `${a.league.league_id}:${a.week}`;
  if (!cache.has(key)) {
    const weeks = Array.from({ length: Math.min(18, Math.max(1, a.week)) }, (_, i) => i + 1);
    cache.set(
      key,
      Promise.all(weeks.map((w) => getTransactions(a.league.league_id, w).catch(() => []))).then((all) => {
        const counts = new Map<number, number>();
        for (const t of all.flat()) {
          if (t.type !== "trade" || t.status !== "complete") continue;
          for (const id of t.roster_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        return counts;
      }),
    );
  }
  return cache.get(key)!;
}

/** "Trades often (4 this season)" / "Hasn't traded this season". */
export function activityText(count: number | undefined): string {
  if (!count) return "Hasn't traded this season";
  if (count >= 3) return `Trades often (${count} this season)`;
  return `${count} trade${count > 1 ? "s" : ""} this season`;
}
