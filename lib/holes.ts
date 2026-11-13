// Lineup holes: starting spots your own roster can't fill this week (the best
// you have is hurt, out, on bye or missing). For each, the best free agent
// who can still play, and who you'd drop for him. This ties "Lamar Jackson is
// on IR" to "claim Brock Purdy and start him", instead of listing the warning
// and the claim as two unrelated things.

import { SLOT_ELIGIBILITY, slotName, type Analysis, type PlayerAnalysis } from "./advisor";
import { isNoDrop } from "./prefs";

export interface Hole {
  /** Lineup slot code, e.g. "QB", "FLEX". */
  slot: string;
  slotLabel: string;
  /** Who's there now (null = nobody). */
  out: PlayerAnalysis | null;
  /** Why the spot is a hole, e.g. "Ruled IR", "On bye". */
  why: string;
  /** Best free agent for the spot. */
  fill: PlayerAnalysis;
  /** Who to release for him (null when there's an open roster spot). */
  drop: PlayerAnalysis | null;
  /** Expected points the fill-in adds this week. */
  gain: number;
  /** Teams ahead of you on waivers likely to take him. */
  likelyClaimedBy: string | null;
  /** Next-best free agent for the spot, in case the first choice gets claimed. */
  backup: PlayerAnalysis | null;
}

const OUT = new Set(["Out", "IR", "PUP", "Sus", "Doubtful"]);

function whyOut(p: PlayerAnalysis | null): string {
  if (!p) return "Empty";
  if (p.injury && OUT.has(p.injury)) return p.injury === "Doubtful" ? "Doubtful" : `Ruled ${p.injury}`;
  if (p.onBye) return "On bye";
  if (!p.team) return "Not on an NFL team";
  return "Not projected to play";
}

/** Locked once his game has started: you can't change that spot anymore. */
const locked = (p: PlayerAnalysis | null, now: number) =>
  !!p?.game && p.game.kickoffKnown && p.game.kickoff <= now;

export function findHoles(a: Analysis, now = Date.now()): Hole[] {
  if (a.bestBall) return [];
  const used = new Set<string>();
  const dropsUsed = new Set<string>();
  const holes: Hole[] = [];
  for (const s of a.optimalLineup) {
    const p = s.player;
    if (p && p.weekScore > 0.5) continue;
    if (locked(p, now)) continue;
    const eligible = SLOT_ELIGIBILITY[s.slot] ?? [];
    const pool = eligible
      .flatMap((pos) => a.streamersByPosition[pos] ?? [])
      .filter((f) => !used.has(f.id) && !f.onBye && f.weekScore > 0.5 && !locked(f, now))
      .sort((x, y) => y.weekScore - x.weekScore);
    const fill = pool[0];
    if (!fill) continue;
    used.add(fill.id);
    const backup = pool.find((x) => x.id !== fill.id && !used.has(x.id)) ?? null;
    // Prefer the drop the waiver model already paired with him; else the most expendable bench player.
    const claim = a.waivers.find((w) => w.player.id === fill.id);
    let drop: PlayerAnalysis | null = null;
    if (a.rosterFull) {
      const starters = new Set(a.optimalLineup.map((x) => x.player?.id));
      drop =
        (claim?.dropFor && !dropsUsed.has(claim.dropFor.id) ? claim.dropFor : null) ??
        a.drops.map((d) => d.player).find((d) => !dropsUsed.has(d.id) && !starters.has(d.id)) ??
        null;
      // The player in the hole himself is often the right one to let go (a season-ending IR stint).
      if (!drop && p && p.injury === "IR" && !isNoDrop(a.prefs, p.id)) drop = p;
      if (drop) dropsUsed.add(drop.id);
    }
    holes.push({
      slot: s.slot,
      slotLabel: slotName(s.slot),
      out: p,
      why: whyOut(p),
      fill,
      drop,
      gain: Math.round((fill.weekScore - (p?.weekScore ?? 0)) * 10) / 10,
      likelyClaimedBy: claim?.likelyClaimedBy ?? null,
      backup,
    });
  }
  return holes;
}
