// Gameday check: right before kickoff, is anyone in your lineup not going to
// play? Only looks at players whose game hasn't started (Sleeper locks the
// rest), and suggests the best bench or free-agent replacement for each.

import { analyzeLeague, OUT_STATUSES, SLOT_ELIGIBILITY, slotName, type Analysis, type PlayerAnalysis } from "./advisor";
import { getSchedule } from "./sleeper";

export interface GamedayIssue {
  slot: string;
  player: PlayerAnalysis | null;
  problem: string;
  replacement: PlayerAnalysis | null;
  /** Where the replacement comes from. */
  source: "bench" | "free agent" | null;
}

export interface GamedayResult {
  analysis: Analysis;
  issues: GamedayIssue[];
  /** Stable fingerprint of the issues, used to avoid duplicate alerts. */
  signature: string;
}

/** Why a starter won't play, as a predicate ("is on bye"), or null if fine. */
function problemFor(p: PlayerAnalysis): string | null {
  const part = p.injuryBodyPart ? ` (${p.injuryBodyPart})` : "";
  if (p.injury && OUT_STATUSES.has(p.injury)) return `is ruled ${p.injury}${part}`;
  if (p.onBye) return "is on bye";
  if (!p.team) return "isn't on an NFL roster";
  if (p.role === "sidelined" || p.role === "backup") return "isn't starting at QB this week";
  if (p.injury === "Doubtful") return `is doubtful${part}`;
  if (p.projection === 0) return "has no projection, so is likely inactive";
  return null;
}

export async function gamedayCheck(opts: {
  leagueId: string;
  userId: string;
  season: string;
  week: number;
}): Promise<GamedayResult> {
  const [analysis, schedule] = await Promise.all([analyzeLeague(opts), getSchedule(opts.season)]);
  // Best-ball lineups are set automatically.
  if (analysis.bestBall) return { analysis, issues: [], signature: "" };
  const status = new Map<string, string>();
  for (const g of schedule.filter((g) => g.week === opts.week)) {
    status.set(g.home, g.status);
    status.set(g.away, g.status);
  }
  // Teams without a game (bye) count as not started; DEF ids are team codes.
  const notStarted = (p: PlayerAnalysis) => !p.team || (status.get(p.team) ?? "pre_game") === "pre_game";

  const starters = new Set(analysis.currentLineup.map((s) => s.player?.id).filter(Boolean));
  const used = new Set<string>();
  const issues: GamedayIssue[] = [];

  for (const s of analysis.currentLineup) {
    if (!(s.slot in SLOT_ELIGIBILITY)) continue; // IDP etc. aren't modeled
    if (s.player && !notStarted(s.player)) continue; // locked
    const problem = s.player ? problemFor(s.player) : "is empty";
    if (!problem) continue;

    const eligible = SLOT_ELIGIBILITY[s.slot] ?? [];
    const fits = (p: PlayerAnalysis) =>
      p.eligible.some((pos) => eligible.includes(pos)) && notStarted(p) && !problemFor(p) && !used.has(p.id);
    const bench = analysis.roster
      .filter((p) => !starters.has(p.id) && fits(p))
      .sort((a, b) => b.weekScore - a.weekScore)[0];
    const freeAgent = eligible
      .flatMap((pos) => analysis.streamersByPosition[pos] ?? [])
      .filter(fits)
      .sort((a, b) => b.weekScore - a.weekScore)[0];
    // Prefer the bench unless a free agent is clearly better this week.
    const useFa = freeAgent && (!bench || freeAgent.weekScore > bench.weekScore + 2);
    const replacement = useFa ? freeAgent : (bench ?? null);
    if (replacement) used.add(replacement.id);
    issues.push({
      slot: slotName(s.slot),
      player: s.player,
      problem,
      replacement,
      source: replacement ? (useFa ? "free agent" : "bench") : null,
    });
  }

  const signature = [opts.leagueId, opts.week, ...issues.map((i) => `${i.player?.id ?? i.slot}:${i.problem}`)].join("|");
  return { analysis, issues, signature };
}

export function renderGamedayMarkdown(r: GamedayResult): string {
  const a = r.analysis;
  const lines = [`## ${a.league.name} — ${a.teamName}`, ""];
  for (const i of r.issues) {
    const who = i.player ? `**${i.player.name}** (${i.player.position}, ${i.player.team ?? "FA"})` : `Your **${i.slot}** slot`;
    const r = i.replacement;
    const fix = r
      ? `→ ${i.source === "bench" ? "start" : "add free agent and start"} **${r.name}** (${r.position}, ${r.team}), projected ${r.weekScore} pts`
      : "→ no healthy replacement with a game still to play";
    lines.push(i.player ? `- ${who} at ${i.slot} ${i.problem} ${fix}.` : `- ${who} ${i.problem} ${fix}.`);
  }
  return lines.join("\n");
}

/** Short stable hash for de-duplicating alerts. */
export function hashSignature(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
