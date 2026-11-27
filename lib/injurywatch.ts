// Injury watch, league-wide: every NFL team's starting RB and top two WRs who
// are out (Out, Doubtful, IR, PUP, suspended), and the teammates in line for
// their touches or targets. Starters are picked by points per game this season,
// so a star on IR still counts as the starter his backups are replacing.
// Backups are ranked by this week's expected points: Sleeper's projections
// already move work to them when the starter is out. Each one shows where he
// is in your league: yours, another team's, or a free agent.

import type { Analysis, PlayerAnalysis } from "./advisor";

export const OUT_STATUSES = ["Out", "Doubtful", "IR", "PUP", "Sus"];
const STARTERS: Record<string, number> = { RB: 1, WR: 2 };

export interface Beneficiary {
  player: PlayerAnalysis;
  /** "you", another team's name, or "free agent". */
  owner: string;
  free: boolean;
  /** This week's expected points minus his season average (how much the injury helps). */
  bump: number | null;
}

export interface InjuryWatchItem {
  team: string;
  position: string;
  /** The starters who are out, each with his role ("RB1", "WR1", "WR2"). */
  out: { player: PlayerAnalysis; role: string }[];
  /** Healthy teammates in line for the work, best first. */
  next: Beneficiary[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildInjuryWatch(a: Analysis): InjuryWatchItem[] {
  const owner = new Map<string, string>();
  for (const p of a.roster) owner.set(p.id, "you");
  for (const t of a.otherTeams) for (const p of [...t.players, ...t.reserve]) owner.set(p.id, t.teamName);
  const everyone = new Map<string, PlayerAnalysis>();
  for (const p of [...a.roster, ...a.otherTeams.flatMap((t) => [...t.players, ...t.reserve]), ...a.freeAgentPool])
    if (p.team && STARTERS[p.position]) everyone.set(p.id, p);

  const groups = new Map<string, PlayerAnalysis[]>();
  for (const p of everyone.values()) {
    const key = `${p.team}|${p.position}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const items: InjuryWatchItem[] = [];
  for (const [key, players] of groups) {
    const position = key.split("|")[1];
    // Starters by this season's production (at least two games, so a one-week fill-in doesn't count).
    const starters = players
      .filter((p) => p.gamesPlayed >= 2 && p.seasonAvg !== null)
      .sort((x, y) => (y.seasonAvg ?? 0) - (x.seasonAvg ?? 0))
      .slice(0, STARTERS[position]);
    const hurt = starters.filter((p) => p.injury && OUT_STATUSES.includes(p.injury));
    if (!hurt.length) continue;
    const healthy = players
      .filter((p) => !starters.includes(p) && !(p.injury && OUT_STATUSES.includes(p.injury)) && p.weekScore > 0)
      .sort((x, y) => y.weekScore - x.weekScore)
      .slice(0, 2);
    items.push({
      team: key.split("|")[0],
      position,
      out: hurt.map((s) => ({ player: s, role: `${position}${starters.indexOf(s) + 1}` })),
      next: healthy.map((p) => ({
        player: p,
        owner: owner.get(p.id) ?? "free agent",
        free: !owner.has(p.id),
        bump: p.seasonAvg !== null ? r1(p.weekScore - p.seasonAvg) : null,
      })),
    });
  }
  // Biggest production lost first.
  const lost = (it: InjuryWatchItem) => it.out.reduce((n, o) => n + (o.player.seasonAvg ?? 0), 0);
  return items.sort((x, y) => lost(y) - lost(x));
}
