// Stash value: what a backup is worth because the job ahead of him might open
// up. A handcuff's own stats look like nothing, but if the starter is hurt or
// in trade rumors he can become a weekly starter overnight. Without this, the
// advisor happily drops the backup the whole fantasy world is stashing.
//
// For each of your bench RBs, TEs and QBs we find the teammate he backs up
// (the highest-projected player at his position on his team), then read the
// recent news for both: trade rumors or injuries for the starter, and
// "stash" / "handcuff" / "next man up" talk about the backup.

import type { PlayerAnalysis } from "./advisor";
import { getPlayerNews, type NewsItem } from "./sleeper";
import { lastName } from "./names";

export interface Stash {
  /** Extra rest-of-season points/game credited for the upside (chance × what he'd gain). */
  value: number;
  /** Chance the starter's job opens up the rest of the way (0–1). */
  chance: number;
  starter: string;
  /** What he'd be worth as the starter (pts/game). */
  ifStarter: number;
  /** Plain-English reasons, strongest first. */
  reasons: string[];
}

const NEWS_DAYS = 21;
// Rough chance a starter misses real time over the rest of a season.
const BASE_HAZARD: Record<string, number> = { RB: 0.15, WR: 0.1, TE: 0.08, QB: 0.08 };
// Share of the starter's production a clear backup inherits (a committee splits it).
// A receiver who moves up the depth chart gets a bigger role, not the top guy's whole one.
const SHARE: Record<string, { clear: number; committee: number }> = {
  RB: { clear: 0.75, committee: 0.4 },
  TE: { clear: 0.75, committee: 0.4 },
  QB: { clear: 0.75, committee: 0.4 },
  WR: { clear: 0.5, committee: 0.3 },
};
/** Positions with a stash premium. */
export const STASH_POSITIONS = ["RB", "WR", "TE", "QB"];
// The NFL trade deadline falls after week 9 or 10; rumors don't matter after it.
const LAST_TRADE_WEEK = 10;

const TRADE =
  /\btrad(e|ed|ing)\b|\bdealt\b|\bsuitors?\b|\blinked to\b|\bon the (trade )?block\b|\bshopping\b|\btrade deadline\b|\bfuture (remains |is )?uncertain\b/i;
const TRADE_DENIED =
  /\b(not|never) (be(ing)? )?(traded|dealt|available)\b|\boff the table\b|\bno plans to (trade|move|deal)\b|\b(signed|agreed to) (an? )?(contract )?extension\b/i;
const STASH_TALK =
  /\bstash\b|\bhandcuff\b|\bnext man up\b|\btake over\b|\b(lead|No\. 1|RB1|starting) (back|role|job)\b|\bascend\b|\b(bigger|expanded|increased) role\b|\busage (was |has been )?(scaled|ticked|ramped) up\b/i;

// Lowercase last name, for matching inside news text.
const lastLower = (name: string) =>
  name
    .replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "")
    .trim()
    .split(/\s+/)
    .slice(-1)[0]
    .toLowerCase();
const textOf = (n: NewsItem) => `${n.metadata.title ?? ""}. ${n.metadata.description ?? ""}`;
const fresh = (n: NewsItem, now: number) => now - n.published <= NEWS_DAYS * 86_400_000;
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface StashCandidate {
  player: PlayerAnalysis;
  /** The teammate he backs up. */
  starter: PlayerAnalysis;
  /** True when he's the clear #2 at the position (not one of several backups). */
  clearBackup: boolean;
}

/** Stash value for each candidate; news that can't be loaded just means no news signal. */
export async function assessStashes(
  candidates: StashCandidate[],
  week: number,
  now = Date.now(),
): Promise<Map<string, Stash>> {
  const out = new Map<string, Stash>();
  const news = await Promise.all(
    candidates.map((c) =>
      Promise.all([
        getPlayerNews(c.starter.id).catch(() => [] as NewsItem[]),
        getPlayerNews(c.player.id).catch(() => [] as NewsItem[]),
      ]),
    ),
  );
  candidates.forEach(({ player: p, starter: s, clearBackup }, i) => {
    const [starterNews, ownNews] = news[i];
    const reasons: string[] = [];
    let chance = BASE_HAZARD[p.position] ?? 0.08;

    // Trade rumors about the starter (articles that name him), counted by day.
    if (week <= LAST_TRADE_WEEK) {
      const sLast = lastLower(s.name);
      const rumors = starterNews.filter((n) => {
        const t = textOf(n);
        return fresh(n, now) && t.toLowerCase().includes(sLast) && TRADE.test(t) && !TRADE_DENIED.test(t);
      });
      const days = [...new Set(rumors.map((n) => day(n.published)))];
      if (days.length) {
        chance += days.length >= 3 ? 0.4 : days.length === 2 ? 0.3 : 0.2;
        const since = day(Math.min(...rumors.map((n) => n.published)));
        reasons.push(
          `${s.name} is in trade rumors (${rumors.length} report${rumors.length > 1 ? "s" : ""} since ${since}) — if he's dealt, ${lastName(p.name)} is next in line`,
        );
      }
    }

    // The starter's health.
    const inj = s.injury;
    if (inj === "IR" || inj === "PUP") {
      chance += 0.5;
      reasons.push(`${s.name} is on ${inj}`);
    } else if (inj === "Out" || inj === "Doubtful") {
      chance += 0.25;
      reasons.push(`${s.name} is ${inj.toLowerCase()} this week`);
    } else if (inj === "Questionable") {
      chance += 0.08;
      reasons.push(`${s.name} is questionable`);
    }

    // Analysts calling him a stash / the next man up.
    const pLast = lastLower(p.name);
    const buzz = ownNews.filter(
      (n) => fresh(n, now) && textOf(n).toLowerCase().includes(pLast) && STASH_TALK.test(textOf(n)),
    );
    if (buzz.length) {
      chance += buzz.length >= 2 ? 0.05 : 0.02;
      reasons.push(
        `named a stash / handcuff in ${buzz.length} recent article${buzz.length > 1 ? "s" : ""} (latest ${day(buzz[0].published)})`,
      );
    }

    // A role that's already growing.
    const u = p.usage;
    if (u?.seasonTouches && u.touches >= u.seasonTouches * 1.3 && u.touches >= 4) {
      reasons.push(`his workload is growing: ${u.touches} touches/g lately vs ${u.seasonTouches} on the season`);
    }

    chance = Math.min(0.85, chance);
    const sh = SHARE[p.position] ?? SHARE.RB;
    const share = clearBackup || buzz.length > 0 ? sh.clear : sh.committee;
    const ifStarter = s.rosValue * share;
    const value = chance * Math.max(0, ifStarter - p.rosValue);
    // Only worth flagging when there's a real reason beyond "starters get hurt sometimes".
    if (reasons.length === 0 || value < 1) return;
    out.set(p.id, {
      value: round1(value),
      chance: round1(chance * 100) / 100,
      starter: s.name,
      ifStarter: round1(ifStarter),
      reasons,
    });
  });
  return out;
}

/** "Stash: ~55% chance Jonathan Taylor's job opens up — worth ~13 pts/game if it does." */
export function stashNote(p: PlayerAnalysis, s: Stash): string {
  return `Stash: ~${Math.round(s.chance * 100)}% chance ${s.starter}'s job opens up — ${lastName(p.name)} would be worth ~${s.ifStarter} pts/game if it does. ${s.reasons[0]}`;
}

/**
 * Pair a player with the teammate whose job he'd take: the top-projected player at
 * his position on his team. `mates` is that position group, best first.
 * RB/TE/QB: the #2 is the clear backup. WR: the #4 (he'd step into the top three).
 */
export function stashPairing(
  p: { id: string; position: string; projection: number },
  mates: { id: string; pts: number }[],
): { starterId: string; clearBackup: boolean } | null {
  const top = mates[0];
  if (!top || top.id === p.id || top.pts < 5) return null;
  // Already sharing the job (or the "starter" is barely ahead): no stash premium.
  if (p.projection >= top.pts * 0.6) return null;
  const rank = mates.findIndex((m) => m.id === p.id);
  if (p.position === "WR") {
    // WR2s and WR3s already play; a stash is the next receiver in line.
    if (rank >= 0 && rank < 3) return null;
    return { starterId: top.id, clearBackup: rank === 3 };
  }
  return { starterId: top.id, clearBackup: rank === 1 };
}

export interface StashTarget {
  player: PlayerAnalysis;
  stash: Stash;
}

/**
 * Free agents worth stashing: backups whose starter is hurt or in trade rumors.
 * News is fetched for a short list (starter hurt, clear backup, or being added
 * across Sleeper) to keep it to a couple dozen requests.
 */
export async function findWaiverStashes(
  freeAgents: PlayerAnalysis[],
  everyone: PlayerAnalysis[],
  week: number,
  limit = 10,
): Promise<StashTarget[]> {
  const groups = new Map<string, PlayerAnalysis[]>();
  for (const p of everyone) {
    if (!p.team || !STASH_POSITIONS.includes(p.position)) continue;
    const key = `${p.team}|${p.position}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const list of groups.values()) list.sort((a, b) => b.projection - a.projection);
  const byId = new Map(everyone.map((p) => [p.id, p]));
  const candidates: (StashCandidate & { priority: number })[] = [];
  for (const p of freeAgents) {
    if (!p.team || p.position === "QB" || !STASH_POSITIONS.includes(p.position)) continue;
    if (p.injury && ["IR", "Out", "PUP", "Sus"].includes(p.injury)) continue;
    const mates = groups.get(`${p.team}|${p.position}`) ?? [];
    const pair = stashPairing(
      p,
      mates.map((m) => ({ id: m.id, pts: m.projection })),
    );
    const starter = pair && byId.get(pair.starterId);
    if (!pair || !starter || starter.rosValue < 8) continue;
    const hurt = starter.injury ? 3 : 0;
    const priority = hurt + (pair.clearBackup ? 2 : 0) + Math.log10(1 + p.trendingAdds);
    candidates.push({ player: p, starter, clearBackup: pair.clearBackup, priority });
  }
  const short = candidates.sort((a, b) => b.priority - a.priority).slice(0, 14);
  const stashes = await assessStashes(short, week);
  return short
    .filter((c) => stashes.has(c.player.id))
    .map((c) => ({ player: c.player, stash: stashes.get(c.player.id)! }))
    .sort((a, b) => b.stash.value - a.stash.value)
    .slice(0, limit);
}
