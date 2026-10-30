// Highlight clips of your players: ESPN's clips from every game your players
// are in this week, matched by name within that game (so two players who
// share a last name on different teams can't be mixed up).

import type { Analysis, PlayerAnalysis } from "./advisor";
import { fetchGameDetail, type Highlight } from "./gamedetail";
import { getWeekGames, type Game } from "./scoreboard";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Is this player named in the text? Full name, or a distinctive (5+ letter) last name. */
export function namedIn(text: string, name: string): boolean {
  const t = ` ${norm(text)} `;
  const full = norm(name);
  const last = full.split(" ").slice(-1)[0];
  return t.includes(` ${full} `) || (last.length >= 5 && t.includes(` ${last} `));
}

export interface PlayerClip {
  clip: Highlight;
  players: PlayerAnalysis[];
  game: Game;
}

export interface ClipsResult {
  clips: PlayerClip[];
  /** True while any of these players' games is still going (worth checking again soon). */
  live: boolean;
}

/** Clips featuring any of `players` from this week's games, newest first. */
export async function fetchPlayerClips(a: Analysis, players: PlayerAnalysis[]): Promise<ClipsResult> {
  const games = await getWeekGames(a.season, a.week);
  const byGame = new Map<Game, PlayerAnalysis[]>();
  for (const p of players) {
    const g = p.team ? games.byTeam.get(p.team) : undefined;
    if (!g || !g.id || g.state === "pre" || p.position === "DEF") continue;
    byGame.set(g, [...(byGame.get(g) ?? []), p]);
  }
  const details = await Promise.all([...byGame.keys()].map((g) => fetchGameDetail(g).catch(() => null)));
  const clips: PlayerClip[] = [];
  [...byGame.entries()].forEach(([game, ps], i) => {
    for (const clip of details[i]?.highlights ?? []) {
      const who = ps.filter((p) => namedIn(clip.headline, p.name));
      if (who.length) clips.push({ clip, players: who, game });
    }
  });
  clips.sort((x, y) => y.clip.published - x.clip.published);
  return { clips, live: [...byGame.keys()].some((g) => g.state === "in") };
}
