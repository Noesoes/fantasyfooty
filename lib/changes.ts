// "What changed since you last looked": a small snapshot of your roster and
// matchup is kept per league and week on this device. On the next visit, the
// differences that matter (injury news, projection swings, roster moves, win
// chance, stash odds) are listed until you dismiss them.

import type { Analysis } from "./advisor";

export interface Snapshot {
  at: number;
  win: number | null;
  players: Record<
    string,
    { name: string; proj: number; injury: string | null; chance: number | null; stash: number | null }
  >;
}

export interface Change {
  key: string;
  text: string;
  tone: "good" | "bad" | "neutral";
  playerId?: string;
  /** Sort weight: injuries and roster moves first. */
  weight: number;
}

const SEVERITY: Record<string, number> = { Questionable: 1, Doubtful: 2, Out: 3, IR: 4, PUP: 4, Sus: 3 };
const sev = (s: string | null) => (s ? (SEVERITY[s] ?? 2) : 0);
const last = (name: string) => name.split(" ").slice(-1)[0];
const r1 = (n: number) => Math.round(n * 10) / 10;

export function snapshotOf(a: Analysis, win: number | null): Snapshot {
  const players: Snapshot["players"] = {};
  for (const p of a.roster) {
    players[p.id] = {
      name: p.name,
      proj: p.weekScore,
      injury: p.injury,
      chance: p.playChance,
      stash: p.stash?.chance ?? null,
    };
  }
  return { at: Date.now(), win, players };
}

export function diffSnapshots(prev: Snapshot, cur: Snapshot): Change[] {
  const out: Change[] = [];
  for (const [id, p] of Object.entries(cur.players)) {
    const before = prev.players[id];
    if (!before) {
      out.push({ key: `add-${id}`, text: `${p.name} joined your roster`, tone: "neutral", playerId: id, weight: 5 });
      continue;
    }
    if (before.injury !== p.injury) {
      const worse = sev(p.injury) > sev(before.injury);
      const text = !p.injury
        ? `${last(p.name)} is off the injury report`
        : !before.injury
          ? `${last(p.name)} is now ${p.injury.toLowerCase()}`
          : `${last(p.name)}: ${before.injury.toLowerCase()} → ${p.injury.toLowerCase()}`;
      out.push({ key: `inj-${id}`, text, tone: worse ? "bad" : "good", playerId: id, weight: 10 });
    } else if (before.chance !== null && p.chance !== null && Math.abs(p.chance - before.chance) >= 0.15) {
      out.push({
        key: `chance-${id}`,
        text: `${last(p.name)} now ~${Math.round(p.chance * 100)}% to play (was ~${Math.round(before.chance * 100)}%)`,
        tone: p.chance > before.chance ? "good" : "bad",
        playerId: id,
        weight: 9,
      });
    }
    const diff = p.proj - before.proj;
    if (Math.abs(diff) >= 2 && Math.abs(diff) >= 0.15 * Math.max(before.proj, 1)) {
      out.push({
        key: `proj-${id}`,
        text: `${last(p.name)}'s projection ${diff > 0 ? "up" : "down"} ${r1(Math.abs(diff))} (${r1(before.proj)} → ${r1(p.proj)})`,
        tone: diff > 0 ? "good" : "bad",
        playerId: id,
        weight: 4,
      });
    }
    const sb = before.stash ?? 0;
    const sa = p.stash ?? 0;
    if (Math.abs(sa - sb) >= 0.1) {
      out.push({
        key: `stash-${id}`,
        text:
          sa > sb
            ? `${last(p.name)}'s stash odds rose to ~${Math.round(sa * 100)}%`
            : `${last(p.name)}'s stash odds fell to ~${Math.round(sa * 100)}%`,
        tone: sa > sb ? "good" : "neutral",
        playerId: id,
        weight: 3,
      });
    }
  }
  for (const [id, p] of Object.entries(prev.players)) {
    if (!cur.players[id]) {
      out.push({ key: `drop-${id}`, text: `${p.name} is no longer on your roster`, tone: "neutral", weight: 5 });
    }
  }
  if (prev.win !== null && cur.win !== null && Math.abs(cur.win - prev.win) >= 0.05) {
    out.push({
      key: "win",
      text: `Win chance ${cur.win > prev.win ? "up" : "down"} to ${Math.round(cur.win * 100)}% (was ${Math.round(prev.win * 100)}%)`,
      tone: cur.win > prev.win ? "good" : "bad",
      weight: 6,
    });
  }
  return out.sort((x, y) => y.weight - x.weight);
}

const KEY = (leagueId: string, week: number) => `seen:${leagueId}:${week}`;

export function loadSeen(leagueId: string, week: number): Snapshot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(leagueId, week)) ?? "null");
    return raw && typeof raw === "object" && typeof raw.at === "number" && raw.players ? (raw as Snapshot) : null;
  } catch {
    return null;
  }
}

export function saveSeen(leagueId: string, week: number, snap: Snapshot) {
  try {
    localStorage.setItem(KEY(leagueId, week), JSON.stringify(snap));
  } catch {}
}
