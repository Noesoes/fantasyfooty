// Plain-English breakdown of what drives a player's expected points this week,
// and why the advisor prefers one player over another.

import type { PlayerAnalysis } from "./advisor";
import { OUT_STATUSES } from "./status";

export type Tone = "good" | "bad" | "neutral";

export type FactorKey = "proj" | "def" | "work" | "trend" | "form" | "game" | "health" | "total";

export interface Factor {
  key: FactorKey;
  label: string;
  text: string;
  tone: Tone;
}

export const FACTOR_LABELS: Record<FactorKey, string> = {
  proj: "Projection",
  def: "Defense faced",
  work: "Workload",
  trend: "Role trend",
  form: "Recent form",
  game: "Game script",
  health: "Health",
  total: "Expected pts",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function positionWord(position: string): string {
  return position === "DEF" ? "D/STs" : position === "K" ? "kickers" : `${position}s`;
}

/** "the 3rd-most" / "the 2nd-fewest" points allowed to this position. */
function allows(p: PlayerAnalysis): string {
  const m = p.matchup!;
  const most = m.teams - m.rank + 1;
  if (most <= m.teams / 2) return most === 1 ? "the most" : `the ${ordinal(most)}-most`;
  return m.rank === 1 ? "the fewest" : `the ${ordinal(m.rank)}-fewest`;
}

function defenseText(p: PlayerAnalysis): string | null {
  if (!p.matchup) return null;
  return `vs ${p.matchup.opponent} — allows ${allows(p)} pts to ${positionWord(p.position)}`;
}

/** Is this workload a lead role, a fringe one, or in between — by position. */
function workloadTone(p: PlayerAnalysis): Tone {
  const u = p.usage;
  if (!u) return "neutral";
  if (p.position === "RB") return u.touches >= 15 ? "good" : u.touches < 8 ? "bad" : "neutral";
  const lead = p.position === "TE" ? 0.17 : 0.2;
  const fringe = p.position === "TE" ? 0.1 : 0.12;
  return u.targetShare >= lead ? "good" : u.targetShare < fringe ? "bad" : "neutral";
}

function workloadText(p: PlayerAnalysis): string | null {
  const u = p.usage;
  const parts: string[] = [];
  if (u) {
    parts.push(`${u.touches} touches/g`);
    if (p.position === "RB" || u.carryShare >= 0.1) parts.push(`${pct(u.carryShare)} of carries`);
    if (u.targetShare > 0) parts.push(`${pct(u.targetShare)} of targets`);
    if (u.redZone >= 0.5) parts.push(`${u.redZone} red-zone looks/g`);
  }
  if (p.snapShare !== null && p.position !== "K" && p.position !== "DEF") parts.push(`${pct(p.snapShare)} of snaps`);
  if (!parts.length && ["RB", "WR", "TE"].includes(p.position) && p.recentGames === 0)
    parts.push("No recent games to measure");
  if (p.position === "QB" && p.role) {
    const role = {
      starter: "Starting QB",
      "fill-in": "Fill-in starter",
      sidelined: "Not starting this week",
      backup: "Backup QB",
    }[p.role];
    parts.unshift(role);
  }
  return parts.length ? parts.join(" · ") : null;
}

function trendChange(p: PlayerAnalysis): number | null {
  const u = p.usage;
  if (!u || !u.seasonTouches || u.trendFactor === 1) return null;
  return u.touches / u.seasonTouches - 1;
}

function formTone(p: PlayerAnalysis): Tone {
  if (p.recentAvg === null || p.seasonAvg === null || p.seasonAvg <= 0) return "neutral";
  const r = p.recentAvg / p.seasonAvg;
  return r >= 1.15 ? "good" : r <= 0.85 ? "bad" : "neutral";
}

function gameText(p: PlayerAnalysis): string | null {
  const g = p.game;
  if (!g) return null;
  const parts: string[] = [];
  if (g.implied !== null) parts.push(`team implied ${g.implied} pts`);
  if (g.spread !== null && g.spread !== 0)
    parts.push(g.spread < 0 ? `favored by ${-g.spread}` : `${g.spread}-pt underdog`);
  if (g.weather) parts.push(g.weather);
  else if (g.indoor) parts.push("indoors");
  return parts.length ? parts.join(" · ") : null;
}

function healthOf(p: PlayerAnalysis): { text: string; tone: Tone } {
  if (p.onBye) return { text: "On bye", tone: "bad" };
  if (p.injury && OUT_STATUSES.has(p.injury)) return { text: `Ruled ${p.injury}`, tone: "bad" };
  if (p.playChance !== null)
    return {
      text: `~${pct(p.playChance)} to play${p.injury ? ` (${p.injury})` : ""}`,
      tone: p.playChance < 0.85 ? "bad" : "neutral",
    };
  if (p.injury) return { text: p.injury, tone: "bad" };
  return { text: "Healthy", tone: "good" };
}

/** Every factor that feeds this week's expected points, in a fixed order. */
export function factorsFor(p: PlayerAnalysis): Factor[] {
  const rows: Factor[] = [];
  const add = (key: FactorKey, text: string | null, tone: Tone = "neutral") => {
    if (text) rows.push({ key, label: FACTOR_LABELS[key], text, tone });
  };
  add(
    "proj",
    p.projection > 0 ? `${p.projection} pts (Sleeper)` : "No projection",
    p.projection > 0 ? "neutral" : "bad",
  );
  const g = p.matchup?.grade;
  add(
    "def",
    defenseText(p),
    g === "great" || g === "good" ? "good" : g === "tough" || g === "brutal" ? "bad" : "neutral",
  );
  add("work", workloadText(p), workloadTone(p));
  const change = trendChange(p);
  if (change !== null && p.usage?.seasonTouches) {
    const dir = change > 0 ? "Growing" : "Shrinking";
    add(
      "trend",
      `${dir}: ${p.usage.touches} touches/g lately vs ${p.usage.seasonTouches} on the season`,
      change > 0.1 ? "good" : change < -0.1 ? "bad" : "neutral",
    );
  }
  if (p.recentAvg === null && p.seasonAvg !== null)
    add("form", `${p.seasonAvg} pts/g season (${p.gamesPlayed} g), none lately`, "neutral");
  if (p.recentAvg !== null) {
    const games = p.recentGames === 1 ? "1 game" : `${p.recentGames} games`;
    add(
      "form",
      `${p.recentAvg} pts/g last ${games}${p.seasonAvg !== null ? ` (${p.seasonAvg} season)` : ""}`,
      formTone(p),
    );
  }
  add(
    "game",
    gameText(p),
    p.game ? (p.game.factor > 1.01 ? "good" : p.game.factor < 0.99 ? "bad" : "neutral") : "neutral",
  );
  const h = healthOf(p);
  add("health", h.text, h.tone);
  add("total", `${p.weekScore} pts`, "neutral");
  return rows;
}

export interface Comparison {
  /** "Start A over B: +4.2 expected pts." */
  headline: string;
  /** Reasons A is the better play. */
  edges: string[];
  /** Where B has the upper hand anyway. */
  against: string[];
}

const first = (name: string) => name.split(" ").slice(-1)[0];

/** Why `pick` is the better start than `other`, biggest edges first. */
export function compareStart(pick: PlayerAnalysis, other: PlayerAnalysis): Comparison {
  const A = first(pick.name);
  const B = first(other.name);
  type Edge = { weight: number; text: string };
  const edges: Edge[] = [];
  const against: Edge[] = [];
  const push = (diff: number, threshold: number, weight: number, forA: string, forB: string) => {
    if (Math.abs(diff) < threshold) return;
    (diff > 0 ? edges : against).push({ weight: Math.abs(diff) * weight, text: diff > 0 ? forA : forB });
  };

  // Health first: a player who probably won't suit up is the whole story.
  const chance = (p: PlayerAnalysis) => (p.onBye || (p.injury && OUT_STATUSES.has(p.injury)) ? 0 : (p.playChance ?? 1));
  const ca = chance(pick);
  const cb = chance(other);
  const healthText = (p: PlayerAnalysis, c: number) =>
    p.onBye
      ? `${first(p.name)} is on bye`
      : c === 0
        ? `${first(p.name)} is ruled ${p.injury}`
        : `${first(p.name)} is only ~${pct(c)} to play`;
  push(ca - cb, 0.15, 40, healthText(other, cb), healthText(pick, ca));

  // Defense faced.
  if (pick.matchup && other.matchup) {
    push(
      pick.matchup.ratio - other.matchup.ratio,
      0.08,
      30,
      `softer defense: ${pick.matchup.opponent} allows ${allows(pick)} pts to ${positionWord(pick.position)}, ${other.matchup.opponent} ${allows(other)} to ${positionWord(other.position)}`,
      `${B} has the softer defense (${other.matchup.opponent} allows ${allows(other)} to ${positionWord(other.position)}, ${pick.matchup.opponent} ${allows(pick)})`,
    );
  }

  // Workload.
  const ua = pick.usage;
  const ub = other.usage;
  if (ua && ub) {
    push(
      ua.touches - ub.touches,
      2.5,
      1,
      `more volume: ${ua.touches} touches/g vs ${ub.touches}`,
      `${B} sees more volume (${ub.touches} touches/g vs ${ua.touches})`,
    );
    if (pick.position !== "RB" || other.position !== "RB")
      push(
        ua.targetShare - ub.targetShare,
        0.05,
        40,
        `bigger target share: ${pct(ua.targetShare)} vs ${pct(ub.targetShare)}`,
        `${B} has the bigger target share (${pct(ub.targetShare)} vs ${pct(ua.targetShare)})`,
      );
    if (pick.position === "RB" && other.position === "RB")
      push(
        ua.carryShare - ub.carryShare,
        0.1,
        25,
        `bigger share of the backfield: ${pct(ua.carryShare)} of carries vs ${pct(ub.carryShare)}`,
        `${B} gets more of the backfield (${pct(ub.carryShare)} of carries vs ${pct(ua.carryShare)})`,
      );
    push(
      ua.redZone - ub.redZone,
      0.8,
      2,
      `more red-zone work: ${ua.redZone} looks/g vs ${ub.redZone}`,
      `${B} gets more red-zone work (${ub.redZone} looks/g vs ${ua.redZone})`,
    );
    const ta = trendChange(pick) ?? 0;
    const tb = trendChange(other) ?? 0;
    push(
      ta - tb,
      0.15,
      8,
      ta > 0 ? `role is growing (+${pct(ta)} touches lately)` : `${B}'s role is shrinking (${pct(tb)} touches lately)`,
      tb > 0
        ? `${B}'s role is growing (+${pct(tb)} touches lately)`
        : `${A}'s role is shrinking (${pct(ta)} touches lately)`,
    );
  } else if (pick.snapShare !== null && other.snapShare !== null) {
    push(
      pick.snapShare - other.snapShare,
      0.15,
      15,
      `on the field more: ${pct(pick.snapShare)} of snaps vs ${pct(other.snapShare)}`,
      `${B} plays more snaps (${pct(other.snapShare)} vs ${pct(pick.snapShare)})`,
    );
  }

  // Game environment.
  const ia = pick.game?.implied;
  const ib = other.game?.implied;
  if (ia != null && ib != null)
    push(
      ia - ib,
      3,
      1,
      `higher-scoring game: team implied for ${ia} pts vs ${ib}`,
      `${B}'s team is implied to score more (${ib} vs ${ia})`,
    );
  const fa = pick.game?.factor ?? 1;
  const fb = other.game?.factor ?? 1;
  if (pick.game?.weather && fa < 0.97 && fa < fb)
    against.push({ weight: 3, text: `${A}'s game weather: ${pick.game.weather}` });
  if (other.game?.weather && fb < 0.97 && fb < fa)
    edges.push({ weight: 3, text: `${B}'s game weather: ${other.game.weather}` });

  // Form.
  if (pick.recentAvg !== null && other.recentAvg !== null)
    push(
      pick.recentAvg - other.recentAvg,
      3,
      0.6,
      `hotter lately: ${pick.recentAvg} pts/g vs ${other.recentAvg}`,
      `${B} has been hotter lately (${other.recentAvg} pts/g vs ${pick.recentAvg})`,
    );

  // Raw projection.
  push(
    pick.projection - other.projection,
    1.5,
    0.8,
    `higher Sleeper projection: ${pick.projection} vs ${other.projection}`,
    `${B} has the higher Sleeper projection (${other.projection} vs ${pick.projection})`,
  );

  const diff = Math.round((pick.weekScore - other.weekScore) * 10) / 10;
  const sort = (l: Edge[]) => l.sort((x, y) => y.weight - x.weight).map((e) => e.text);
  // If the other player won't play, nothing else matters: any healthy option is better.
  if (cb === 0 && ca > 0) {
    const healthy = sort(edges).filter((e) => !e.startsWith(B) && !e.startsWith("higher Sleeper"));
    return {
      headline: `${healthText(other, cb)} (0 pts) — ${pick.name} (${pick.weekScore} expected pts) is the best healthy option for the spot.`,
      edges: [healthText(other, cb), ...healthy.slice(0, 3)],
      against: [],
    };
  }
  return {
    headline: `${pick.name} over ${other.name}: ${pick.weekScore} vs ${other.weekScore} expected pts (${diff >= 0 ? "+" : ""}${diff}).`,
    edges: sort(edges),
    against: sort(against),
  };
}
