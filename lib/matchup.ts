// Weekly matchup analyzer: your lineup against your opponent's.
//  - outcome: each side's expected total, floor and upside (10th / 90th
//    percentile weeks) and the win chance, plus the same with your moves made
//  - positions: where you win and lose the matchup, slot group by slot group
//  - time: how many points each side has in each kickoff window
//  - stacks: your players on the same NFL team (they rise and fall together)
//    and games where your players face your opponent's (they offset)

import type { Analysis, PlayerAnalysis } from "./advisor";
import { projectedWin, teamOutcome } from "./insights";

const r1 = (n: number) => Math.round(n * 10) / 10;
const Z90 = 1.2816;

export interface SideOutcome {
  name: string;
  mean: number;
  sd: number;
  floor: number;
  upside: number;
  win: number;
}

export interface Outcome {
  me: SideOutcome;
  opp: SideOutcome;
  /** Your win chance if you make the suggested lineup moves (null when none). */
  withMoves: { mean: number; win: number } | null;
}

function side(name: string, players: (PlayerAnalysis | null | undefined)[], win: number): SideOutcome {
  const t = teamOutcome(players);
  return {
    name,
    mean: r1(t.mean),
    sd: t.sd,
    floor: r1(Math.max(0, t.mean - Z90 * t.sd)),
    upside: r1(t.mean + Z90 * t.sd),
    win,
  };
}

export function outcome(a: Analysis): Outcome | null {
  if (!a.opponent) return null;
  const mine = a.currentLineup.map((s) => s.player);
  const theirs = a.opponent.starters;
  const win = projectedWin(mine, theirs);
  const best = a.optimalLineup.map((s) => s.player);
  const bestMean = best.reduce((s, p) => s + (p?.weekScore ?? 0), 0);
  const gain = bestMean - mine.reduce((s, p) => s + (p?.weekScore ?? 0), 0);
  return {
    me: side(a.teamName, mine, win),
    opp: side(a.opponent.teamName, theirs, 1 - win),
    withMoves: gain >= 0.5 ? { mean: r1(bestMean), win: projectedWin(best, theirs) } : null,
  };
}

/** Normal density, for drawing each side's score curve. */
export function density(x: number, mean: number, sd: number): number {
  const s = Math.max(sd, 1);
  return Math.exp(-0.5 * ((x - mean) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
}

// --- Positions ---------------------------------------------------------------

export interface PositionEdge {
  group: string;
  mine: number;
  theirs: number;
  /** Your edge in points (negative = theirs). */
  edge: number;
}

const GROUP_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

/** Expected points by lineup slot group. Opponent starters are grouped by their position (flex counted as FLEX when beyond the dedicated slots). */
export function positionEdges(a: Analysis): PositionEdge[] {
  if (!a.opponent) return [];
  const slotGroup = (slot: string) =>
    slot === "QB" || slot === "RB" || slot === "WR" || slot === "TE" || slot === "K" || slot === "DEF" ? slot : "FLEX";
  const mine = new Map<string, number>();
  for (const s of a.currentLineup) {
    const g = slotGroup(s.slot);
    mine.set(g, (mine.get(g) ?? 0) + (s.player?.weekScore ?? 0));
  }
  // Their starters come without slots: fill dedicated slots by position first, the rest are flex.
  const dedicated = new Map<string, number>();
  for (const s of a.currentLineup) {
    const g = slotGroup(s.slot);
    if (g !== "FLEX") dedicated.set(g, (dedicated.get(g) ?? 0) + 1);
  }
  const theirs = new Map<string, number>();
  const used = new Map<string, number>();
  const sorted = [...a.opponent.starters].sort((x, y) => y.weekScore - x.weekScore);
  for (const p of sorted) {
    const n = used.get(p.position) ?? 0;
    const g = n < (dedicated.get(p.position) ?? 0) ? p.position : "FLEX";
    used.set(p.position, n + 1);
    theirs.set(g, (theirs.get(g) ?? 0) + p.weekScore);
  }
  return GROUP_ORDER.filter((g) => mine.has(g) || theirs.has(g)).map((g) => ({
    group: g,
    mine: r1(mine.get(g) ?? 0),
    theirs: r1(theirs.get(g) ?? 0),
    edge: r1((mine.get(g) ?? 0) - (theirs.get(g) ?? 0)),
  }));
}

// --- Time windows ------------------------------------------------------------

export interface TimeWindow {
  label: string;
  start: number;
  mine: number;
  theirs: number;
  minePlayers: string[];
  theirPlayers: string[];
}

/** Which kickoff window a game falls in, in US Eastern time (how NFL slates are named). */
function windowOf(kickoff: number): { label: string; order: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(kickoff));
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 13);
  if (day === "Sun") {
    if (hour < 12) return { label: "Sun morning", order: 3 };
    if (hour < 16) return { label: "Sun early", order: 4 };
    if (hour < 19) return { label: "Sun late", order: 5 };
    return { label: "Sun night", order: 6 };
  }
  const order: Record<string, number> = { Thu: 1, Fri: 2, Sat: 2.5, Mon: 7, Tue: 8, Wed: 0 };
  return { label: day === "Mon" ? "Mon night" : day === "Thu" ? "Thu night" : day, order: order[day] ?? 9 };
}

export function timeWindows(a: Analysis): TimeWindow[] {
  if (!a.opponent) return [];
  const map = new Map<string, TimeWindow & { order: number }>();
  const add = (p: PlayerAnalysis | null, yours: boolean) => {
    if (!p || !p.game || p.onBye || p.weekScore <= 0) return;
    const w = windowOf(p.game.kickoff);
    const row = map.get(w.label) ?? {
      label: w.label,
      start: p.game.kickoff,
      mine: 0,
      theirs: 0,
      minePlayers: [],
      theirPlayers: [],
      order: w.order,
    };
    if (yours) {
      row.mine += p.weekScore;
      row.minePlayers.push(p.name);
    } else {
      row.theirs += p.weekScore;
      row.theirPlayers.push(p.name);
    }
    map.set(w.label, row);
  };
  for (const s of a.currentLineup) add(s.player, true);
  for (const p of a.opponent.starters) add(p, false);
  return [...map.values()]
    .sort((x, y) => x.order - y.order)
    .map((w) => ({
      label: w.label,
      start: w.start,
      mine: r1(w.mine),
      theirs: r1(w.theirs),
      minePlayers: w.minePlayers,
      theirPlayers: w.theirPlayers,
    }));
}

// --- Stacks ------------------------------------------------------------------

export interface Stack {
  team: string;
  players: PlayerAnalysis[];
  /** Combined expected points. */
  pts: number;
  /** QB + pass catcher stacks move together the most. */
  kind: "qb-stack" | "same-team";
}

export interface Clash {
  game: string;
  mine: PlayerAnalysis[];
  theirs: PlayerAnalysis[];
}

/** Your starters sharing an NFL team, and games where your starters face your opponent's. */
export function stacks(a: Analysis): { stacks: Stack[]; clashes: Clash[] } {
  const mine = a.currentLineup
    .map((s) => s.player)
    .filter((p): p is PlayerAnalysis => !!p && !!p.team && p.weekScore > 0);
  const theirs = (a.opponent?.starters ?? []).filter((p) => p.team && p.weekScore > 0);
  const byTeam = new Map<string, PlayerAnalysis[]>();
  for (const p of mine) byTeam.set(p.team!, [...(byTeam.get(p.team!) ?? []), p]);
  const out: Stack[] = [...byTeam.entries()]
    .filter(([, ps]) => ps.length > 1)
    .map(([team, ps]) => ({
      team,
      players: ps,
      pts: r1(ps.reduce((s, p) => s + p.weekScore, 0)),
      kind:
        ps.some((p) => p.position === "QB") && ps.some((p) => ["WR", "TE"].includes(p.position))
          ? "qb-stack"
          : "same-team",
    }));
  const gameKey = (p: PlayerAnalysis) => [p.team!, p.game?.opponent ?? p.matchup?.opponent ?? ""].sort().join(" vs ");
  const games = new Map<string, Clash>();
  for (const p of mine) {
    const k = gameKey(p);
    games.set(k, { game: k, mine: [...(games.get(k)?.mine ?? []), p], theirs: games.get(k)?.theirs ?? [] });
  }
  for (const p of theirs) {
    const k = gameKey(p);
    if (games.has(k)) games.get(k)!.theirs.push(p);
  }
  return {
    stacks: out.sort((x, y) => y.pts - x.pts),
    clashes: [...games.values()].filter((g) => g.mine.length && g.theirs.length),
  };
}

/** Plain-English summary of the matchup, like a preview. */
export function summary(a: Analysis, o: Outcome): string[] {
  const lines: string[] = [];
  const fav = o.me.win >= 0.5;
  lines.push(
    `Heading into the week, ${fav ? "you're" : `${o.opp.name} is`} the favorite at ${Math.round(Math.max(o.me.win, o.opp.win) * 100)}%, with ${o.me.mean} projected points for you against ${o.opp.mean}.`,
  );
  if (o.withMoves && o.withMoves.win > o.me.win + 0.005) {
    lines.push(
      `Making your suggested moves lifts you to ${o.withMoves.mean} points and your win chance to ${Math.round(o.withMoves.win * 100)}%.`,
    );
  }
  const edges = positionEdges(a).filter((e) => Math.abs(e.edge) >= 2);
  const best = [...edges].sort((x, y) => y.edge - x.edge)[0];
  const worst = [...edges].sort((x, y) => x.edge - y.edge)[0];
  if (best && best.edge > 0) lines.push(`Your biggest edge is at ${best.group} (+${best.edge}).`);
  if (worst && worst.edge < 0) lines.push(`They're stronger at ${worst.group} (${worst.edge}).`);
  const s = stacks(a).stacks.find((x) => x.kind === "qb-stack");
  if (s)
    lines.push(
      `Your ${s.team} stack (${s.players.map((p) => p.name).join(" + ")}) can swing your floor and upside together.`,
    );
  const close = Math.abs(o.me.mean - o.opp.mean);
  const sd = Math.sqrt(o.me.sd ** 2 + o.opp.sd ** 2);
  if (sd > 0 && close < 0.25 * sd) lines.push("It's close: a single big play could decide it.");
  return lines;
}
