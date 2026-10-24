// "Should I pick him up?" for any free agent: a verdict plus the reasons for
// and against, from the same model the rest of the app uses — this week's
// lineup, rest-of-season value vs. the player you'd drop, role and usage,
// form, injuries, matchup, depth at the position, and waiver competition.

import {
  describeMatchup,
  OUT_STATUSES,
  SLOT_ELIGIBILITY,
  slotName,
  type Analysis,
  type PlayerAnalysis,
  type WaiverTarget,
} from "./advisor";
import { ordinal } from "./scouting";

export type PickupVerdict = "Pick up" | "Stream" | "Stash" | "Pass";

export interface PickupReport {
  player: PlayerAnalysis;
  verdict: PickupVerdict;
  headline: string;
  pros: string[];
  cons: string[];
  /** Who you'd release to make room (null if you have an open spot). */
  drop: PlayerAnalysis | null;
  /** Suggested FAAB bid (FAAB leagues, worthwhile pickups only). */
  bid: number | null;
  /** Set when the player is already one of the app's waiver targets. */
  claim: WaiverTarget | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const last = (name: string) => name.split(" ").slice(-1)[0];

export function evaluatePickup(a: Analysis, p: PlayerAnalysis): PickupReport {
  const pros: string[] = [];
  const cons: string[] = [];
  const isStreamPos = p.position === "K" || p.position === "DEF";
  const claim = a.waivers.find((w) => w.player.id === p.id) ?? null;
  const out = Boolean(p.injury && OUT_STATUSES.has(p.injury));
  const longTerm = p.injury === "IR" || p.injury === "PUP";

  // --- This week: would he start? ---
  const slots = a.optimalLineup.filter((s) => SLOT_ELIGIBILITY[s.slot]?.some((pos) => p.eligible.includes(pos)));
  const filled = slots.map((s) => s.player).filter((x): x is PlayerAnalysis => !!x);
  const weakestNow = [...filled].sort((x, y) => x.weekScore - y.weekScore)[0] ?? null;
  const openSlot = slots.some((s) => !s.player);
  const startGain = openSlot ? p.weekScore : weakestNow ? p.weekScore - weakestNow.weekScore : 0;
  if (!slots.length) {
    cons.push(`Your league has no lineup spot for a ${p.position}.`);
  } else if (p.onBye) {
    cons.push("On bye this week, so no help right now.");
  } else if (openSlot && p.weekScore > 0) {
    pros.push(`Fills an empty ${p.position} spot in your lineup this week (projects ${p.weekScore}).`);
  } else if (weakestNow && startGain >= 1) {
    const slot = slots.find((s) => s.player?.id === weakestNow.id);
    // Say why the starter he'd replace scores nothing (bye, injury), when that's the case.
    const why =
      weakestNow.weekScore > 0
        ? ""
        : weakestNow.onBye
          ? " (on bye)"
          : weakestNow.injury
            ? ` (${weakestNow.injury})`
            : " (not projected to play)";
    pros.push(
      `Would start this week over ${weakestNow.name}${why}${slot ? ` at ${slotName(slot.slot)}` : ""}: projects ${p.weekScore} vs ${weakestNow.weekScore} (+${r1(startGain)}).`,
    );
  } else if (weakestNow && p.weekScore > 0) {
    cons.push(
      `Wouldn't crack your lineup this week: your weakest eligible starter, ${weakestNow.name}, projects ${weakestNow.weekScore} to his ${p.weekScore}.`,
    );
  }

  // --- Rest of season vs. the player you'd drop ---
  const optimalIds = new Set(a.optimalLineup.map((s) => s.player?.id));
  const bench = a.activeRoster.filter((x) => !optimalIds.has(x.id));
  const samePos = (x: PlayerAnalysis) => x.position === p.position;
  let drop: PlayerAnalysis | null = null;
  if (a.rosterFull) {
    drop = isStreamPos
      ? (a.activeRoster.filter(samePos).sort((x, y) => x.weekScore - y.weekScore)[0] ?? null)
      : (a.drops[0]?.player ?? [...bench].sort((x, y) => x.rosValue - y.rosValue)[0] ?? null);
  }
  const rosDelta = drop ? p.rosValue - drop.rosValue : p.rosValue;
  if (!a.rosterFull) {
    pros.push("You have an open roster spot, so it costs you nothing to add him.");
  } else if (drop && !isStreamPos) {
    if (rosDelta >= 1) {
      pros.push(
        `Better rest-of-season value than ${drop.name}, your most expendable player: ${p.rosValue} vs ${drop.rosValue} pts/game.`,
      );
    } else if (rosDelta <= -0.5) {
      cons.push(
        `Worth less the rest of the way than ${drop.name}, who you'd have to drop (${p.rosValue} vs ${drop.rosValue} pts/game).`,
      );
    } else {
      cons.push(`About the same rest-of-season value as ${drop.name}, who you'd drop: not a real upgrade.`);
    }
  }

  // --- Compared with the rest of the waiver wire ---
  const repl = a.replacementLevel[p.position] ?? 0;
  const vor = p.rosValue - repl;
  if (!isStreamPos) {
    if (vor >= 3)
      pros.push(
        `Clearly better than the other ${p.position}s on your waiver wire (+${r1(vor)} pts/game over a typical one).`,
      );
    else if (vor <= 0.5 && !longTerm)
      cons.push(`Replaceable: similar ${p.position}s are sitting on waivers (~${r1(repl)} pts/game).`);
  }

  // --- Role and usage ---
  if (p.role === "backup")
    cons.push(p.notes.find((n) => /Backup QB/.test(n)) ?? "Backup QB: only valuable if the starter gets hurt.");
  if (p.role === "sidelined")
    cons.push(p.notes.find((n) => /Not expected to start/.test(n)) ?? "Not expected to start this week.");
  if (p.role === "fill-in") {
    pros.push("Starting at QB right now.");
    cons.push(
      p.notes.find((n) => /Starting in place of/.test(n)) ?? "A fill-in: his value drops when the starter returns.",
    );
  }
  if (p.snapShare !== null && p.recentGames >= 2 && !isStreamPos && p.position !== "QB") {
    if (p.snapShare >= 0.7) pros.push(`Every-down role: ${pct(p.snapShare)} of snaps lately.`);
    else if (p.snapShare < 0.4) cons.push(`Part-time role: ${pct(p.snapShare)} of snaps lately.`);
  }

  // --- Form ---
  if (p.recentAvg !== null && p.seasonAvg !== null && p.recentGames >= 2) {
    if (p.recentAvg >= p.seasonAvg * 1.25 && p.recentAvg - p.seasonAvg >= 2) {
      pros.push(
        `Trending up: ${p.recentAvg} pts/game over his last ${p.recentGames} vs ${p.seasonAvg} for the season.`,
      );
    } else if (p.recentAvg <= p.seasonAvg * 0.75 && p.seasonAvg - p.recentAvg >= 2) {
      cons.push(
        `Cooling off: ${p.recentAvg} pts/game over his last ${p.recentGames} vs ${p.seasonAvg} for the season.`,
      );
    }
  } else if (p.gamesPlayed === 0 && !out) {
    cons.push("No production yet this season, so the projection is a guess.");
  }

  // --- Health ---
  if (longTerm) cons.push(`On ${p.injury}${p.injuryBodyPart ? ` (${p.injuryBodyPart})` : ""}: a stash at best.`);
  else if (out) cons.push(`Ruled ${p.injury} this week${p.injuryBodyPart ? ` (${p.injuryBodyPart})` : ""}.`);
  else if (p.injury)
    cons.push(`${p.injury}${p.injuryBodyPart ? ` (${p.injuryBodyPart})` : ""}: check his status before kickoff.`);

  // --- This week's matchup and game ---
  if (p.matchup && !p.onBye && !out) {
    const m = describeMatchup(p.matchup, p.position);
    if (p.matchup.grade === "great" || p.matchup.grade === "good") pros.push(`This week: ${m}.`);
    else if (p.matchup.grade === "tough" || p.matchup.grade === "brutal") cons.push(`This week: ${m}.`);
  }
  if (p.game?.implied != null && !p.onBye && !out) {
    if (p.game.implied >= 26)
      pros.push(`${p.team} are expected to score ${p.game.implied} this week (a high Vegas total).`);
    else if (p.game.implied <= 19) cons.push(`${p.team} are only expected to score ${p.game.implied} this week.`);
  }

  // --- Your depth at the position ---
  const mine = a.activeRoster.filter(samePos);
  const startersAt = slots.filter((s) => SLOT_ELIGIBILITY[s.slot]?.length === 1).length;
  if (!isStreamPos && mine.length <= startersAt) {
    pros.push(
      `You're thin at ${p.position}: only ${mine.length} on your roster for ${startersAt} starting spot${startersAt === 1 ? "" : "s"}.`,
    );
  }

  // --- Demand ---
  if (p.trendingAdds >= 500)
    pros.push(`${p.trendingAdds.toLocaleString()} adds across Sleeper in the last 3 days: other managers are on him.`);
  const rivalsWant = a.rivals.filter((r) => r.targets.some((t) => t.player.id === p.id));
  const takenBefore = a.rivals.find((r) => r.projectedClaim?.id === p.id);
  if (takenBefore) {
    cons.push(
      a.waiver.type === "faab"
        ? `${takenBefore.teamName} has more FAAB and likely wants him: you may need to outbid them.`
        : `${takenBefore.teamName} picks before you and will likely claim him.`,
    );
  } else if (rivalsWant.length) {
    cons.push(
      `${rivalsWant.map((r) => r.teamName).join(", ")} ${rivalsWant.length === 1 ? "is" : "are"} also likely to want him.`,
    );
  }

  // --- Verdict ---
  const weakRole = p.role === "backup" || p.role === "sidelined";
  const stashable = (longTerm || out || p.role === "fill-in" || p.trendingAdds >= 2000) && vor >= 2;
  let verdict: PickupVerdict;
  if (weakRole && !stashable) verdict = "Pass";
  else if (isStreamPos) verdict = startGain >= 1.5 && !out ? "Stream" : "Pass";
  else if (
    !out &&
    !longTerm &&
    vor > 0.5 &&
    (rosDelta >= 1.5 || (startGain >= 3 && rosDelta >= 1) || (!a.rosterFull && vor > 0.5))
  )
    verdict = "Pick up";
  else if (stashable && rosDelta >= -1) verdict = "Stash";
  else if (!out && startGain >= 1.5) verdict = "Stream";
  else verdict = "Pass";

  const dropText = drop ? ` for ${drop.name}` : "";
  const headline = {
    "Pick up": `Worth a claim${dropText}: he makes your team better${rosDelta >= 1.5 ? " the rest of the season" : " this week"}.`,
    Stream: `A one-week fill-in${dropText}: he helps this week but isn't a long-term add.`,
    Stash: `A speculative stash${dropText}: little help now, but upside if his situation changes.`,
    Pass:
      longTerm || out
        ? `Pass for now: he's ${longTerm ? `on ${p.injury}` : `ruled ${p.injury}`} and not enough of an upgrade to tie up a roster spot.`
        : weakRole
          ? "Pass: a backup with no clear path to playing time right now."
          : vor <= 0.5 && !isStreamPos
            ? `Pass: players like him are always available on waivers.`
            : `Pass: he wouldn't make your team better${drop ? ` than keeping ${last(drop.name)}` : ""}.`,
  }[verdict];

  // FAAB: worth = share of budget by how much he adds (same scale as the waiver tab).
  let bid: number | null = null;
  if (a.waiver.type === "faab" && a.waiver.budgetLeft !== null && verdict !== "Pass") {
    if (claim?.bid) bid = claim.bid.suggested;
    else {
      const value = Math.max(0, rosDelta) + Math.max(0, startGain) * 0.5;
      const share = Math.min(0.35, Math.max(0.02, value / 20));
      bid = Math.max(verdict === "Pick up" ? 1 : 0, Math.round(a.waiver.budgetLeft * share));
    }
  }

  return { player: p, verdict, headline, pros, cons, drop, bid, claim };
}

/** Free agents matching a search, best rest-of-season value first. */
export function searchFreeAgents(a: Analysis, query: string, position: string | null, limit = 8): PlayerAnalysis[] {
  const q = query.toLowerCase().replace(/[.'’]/g, "").trim();
  return a.freeAgentPool
    .filter((p) => !position || p.position === position)
    .filter((p) => {
      if (!q) return true;
      const name = p.name.toLowerCase().replace(/[.'’]/g, "");
      return name.includes(q) || (p.team ?? "").toLowerCase() === q;
    })
    .slice(0, limit);
}

export interface PositionPick {
  player: PlayerAnalysis;
  /** Expected points this week (projection × matchup × Vegas × chance to play). */
  points: number;
  /** Short reasons: usage, matchup, game environment, form, health. */
  why: string[];
  /** The starter he'd replace this week, if he'd start for you. */
  over: PlayerAnalysis | null;
}

export const FILL_POSITIONS: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  K: ["K"],
  DEF: ["DEF"],
};

/**
 * Best free agents to fill a position for THIS week: ranked by expected
 * points, nudged toward players with a real role (snap share), since a
 * part-timer's projection is shakier.
 */
export function bestAtPosition(a: Analysis, fill: string, limit = 8): PositionPick[] {
  const positions = FILL_POSITIONS[fill] ?? [fill];
  const slots = a.optimalLineup.filter((s) => SLOT_ELIGIBILITY[s.slot]?.some((pos) => positions.includes(pos)));
  const score = (p: PlayerAnalysis) => {
    const usage =
      p.snapShare === null || p.recentGames < 2 ? 1 : Math.min(1.05, Math.max(0.85, 0.85 + (p.snapShare - 0.3) * 0.4));
    return p.weekScore * usage;
  };
  return a.freeAgentPool
    .filter(
      (p) =>
        positions.includes(p.position) &&
        p.team &&
        !p.onBye &&
        !(p.injury && OUT_STATUSES.has(p.injury)) &&
        p.role !== "backup" &&
        p.role !== "sidelined" &&
        p.weekScore > 0,
    )
    .sort((x, y) => score(y) - score(x))
    .slice(0, limit)
    .map((p) => {
      const why: string[] = [];
      if (
        p.snapShare !== null &&
        p.recentGames >= 2 &&
        p.position !== "QB" &&
        p.position !== "K" &&
        p.position !== "DEF"
      ) {
        why.push(`${pct(p.snapShare)} of snaps`);
      }
      if (p.matchup) {
        const g = p.matchup.teams - p.matchup.rank + 1;
        const who = p.position === "DEF" ? "D/STs" : p.position === "K" ? "Ks" : `${p.position}s`;
        why.push(`vs ${p.matchup.opponent} (${g === 1 ? "most" : `${ordinal(g)}-most`} pts to ${who})`);
      }
      if (p.game?.implied != null) why.push(`${p.team} implied ${p.game.implied}`);
      if (p.recentAvg !== null && p.recentGames >= 2) why.push(`${p.recentAvg}/g last ${p.recentGames}`);
      if (p.injury) why.push(p.injury);
      if (p.trendingAdds >= 1000) why.push(`${p.trendingAdds.toLocaleString()} adds`);
      // Would he start for you?
      const filled = slots.map((s) => s.player).filter((x): x is PlayerAnalysis => !!x);
      const weakest = [...filled].sort((x, y) => x.weekScore - y.weekScore)[0] ?? null;
      const over = weakest && p.weekScore > weakest.weekScore + 0.5 ? weakest : null;
      return { player: p, points: r1(p.weekScore), why, over };
    });
}
