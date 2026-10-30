// "Ask": plain-English questions about your team, answered with the same
// logic as the rest of the app (no AI service). Finds the players named in
// the question, works out what kind of question it is, and routes it:
//   "Gibbs or Taylor?"            -> start/sit comparison with confidence
//   "should I pick up Goodson?"   -> pickup verdict with pros and cons
//   "trade Metcalf for Achane?"   -> trade grade
//   "who should I drop?"          -> your most expendable player
//   "Gibbs" / "how's Gibbs?"      -> that player's call this week

import { keepValue, type Analysis, type PlayerAnalysis } from "./advisor";
import { compareStart } from "./explain";
import { confidenceWord, playerRange, startConfidence } from "./insights";
import { evaluatePickup } from "./pickup";
import { isNoDrop } from "./prefs";
import { evaluateTrade } from "./trades";
import { lastName } from "./names";

export type AskTone = "good" | "bad" | "neutral";

export interface AskAnswer {
  /** Short verdict, e.g. "Start Jahmyr Gibbs". */
  title: string;
  tone: AskTone;
  /** Supporting lines, strongest first. */
  lines: string[];
  /** Players to offer a "details" link for. */
  players: PlayerAnalysis[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface Found {
  player: PlayerAnalysis;
  at: number;
}

/** Last names in the question that match several players (and none decisively), with the options. */
export function ambiguousNames(
  text: string,
  mine: PlayerAnalysis[],
  everyone: PlayerAnalysis[],
): Map<string, PlayerAnalysis[]> {
  const t = ` ${norm(text)} `;
  const out = new Map<string, PlayerAnalysis[]>();
  const byLast = new Map<string, PlayerAnalysis[]>();
  for (const p of everyone) {
    const last = norm(p.name).split(" ").slice(-1)[0];
    byLast.set(last, [...(byLast.get(last) ?? []), p]);
  }
  for (const [last, ps] of byLast) {
    if (ps.length < 2 || last.length < 3 || !t.includes(` ${last} `)) continue;
    // A full name, or a single match on your own roster, settles it.
    if (ps.some((p) => t.includes(` ${norm(p.name)} `))) continue;
    if (mine.filter((p) => norm(p.name).split(" ").slice(-1)[0] === last).length === 1) continue;
    out.set(last, ps.sort((x, y) => y.rosValue - x.rosValue).slice(0, 4));
  }
  return out;
}

/**
 * Players named in the question, in the order they appear: full name, a last name
 * that's unique on your roster (checked first) or among everyone, or a distinctive
 * first name. `mine` comes first in `candidates` so your players win ties.
 */
export function findPlayers(text: string, candidates: PlayerAnalysis[], mine: PlayerAnalysis[] = []): PlayerAnalysis[] {
  const t = ` ${norm(text)} `;
  const lastCount = new Map<string, number>();
  for (const p of candidates) {
    const last = norm(p.name).split(" ").slice(-1)[0];
    lastCount.set(last, (lastCount.get(last) ?? 0) + 1);
  }
  const mineLast = new Map<string, number>();
  for (const p of mine) {
    const last = norm(p.name).split(" ").slice(-1)[0];
    mineLast.set(last, (mineLast.get(last) ?? 0) + 1);
  }
  const mineIds = new Set(mine.map((p) => p.id));
  const found: Found[] = [];
  const seen = new Set<string>();
  for (const p of candidates) {
    if (seen.has(p.id)) continue;
    const full = norm(p.name);
    const parts = full.split(" ");
    const last = parts[parts.length - 1];
    const first = parts[0];
    let at = t.indexOf(` ${full} `);
    // "Taylor" alone only counts if just one candidate is named Taylor; otherwise ask for a first name.
    if (at < 0 && last.length >= 3) {
      const uniqueMine = mineIds.has(p.id) && mineLast.get(last) === 1;
      const uniqueAll = lastCount.get(last) === 1 && !mineLast.get(last);
      if (uniqueMine || uniqueAll) at = t.indexOf(` ${last} `);
    }
    // First names work too when they're distinctive ("Kyren", "Jahmyr").
    if (at < 0 && first.length >= 5) {
      const sameFirst = candidates.filter((c) => norm(c.name).split(" ")[0] === first).length;
      if (sameFirst === 1) at = t.indexOf(` ${first} `);
    }
    if (at >= 0) {
      found.push({ player: p, at });
      seen.add(p.id);
    }
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.player);
}

const last = lastName;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function playerCall(a: Analysis, p: PlayerAnalysis): AskAnswer {
  const mine = a.roster.some((x) => x.id === p.id);
  const r = playerRange(p);
  const slot = a.optimalLineup.find((s) => s.player?.id === p.id)?.slot;
  const range = `Projects ${p.weekScore} pts (realistic range ${r.floor}–${r.ceiling}).`;
  const matchup = p.matchup
    ? `Faces ${p.matchup.opponent}: ${p.matchup.grade === "great" || p.matchup.grade === "good" ? "a good" : p.matchup.grade === "neutral" ? "a neutral" : "a tough"} matchup for ${p.position}s.`
    : null;
  if (!mine) {
    const pick = evaluatePickup(a, p);
    return {
      title: `${pick.verdict}: ${p.name}`,
      tone: pick.verdict === "Pass" ? "bad" : "good",
      lines: [pick.headline, ...pick.pros.slice(0, 2), ...pick.cons.slice(0, 1)],
      players: [p],
    };
  }
  if (p.onBye || p.weekScore === 0) {
    return {
      title: `Sit ${p.name}`,
      tone: "bad",
      lines: [p.notes[0] ?? "Not expected to score this week."],
      players: [p],
    };
  }
  return {
    title: slot ? `Start ${p.name}` : `Bench ${p.name}`,
    tone: slot ? "good" : "neutral",
    lines: [
      range,
      ...(matchup ? [matchup] : []),
      ...(p.playChance !== null && p.playChance < 0.85 ? [`Only ~${pct(p.playChance)} to play (${p.injury}).`] : []),
      ...p.notes.filter((n) => !/to play/.test(n)).slice(0, 1),
    ],
    players: [p],
  };
}

const HELP: AskAnswer = {
  title: "Try asking…",
  tone: "neutral",
  lines: [
    "“Gibbs or Taylor?” — who to start",
    "“Should I pick up Goodson?” — pickup verdict",
    "“Trade Metcalf for Achane?” — trade grade",
    "“Who should I drop?”",
    "Or just a player's name for his call this week.",
  ],
  players: [],
};

export function answer(a: Analysis, question: string): AskAnswer {
  const q = norm(question);
  if (!q) return HELP;
  const mine = a.roster;
  const everyone = [...mine, ...a.freeAgentPool, ...a.otherTeams.flatMap((t) => t.players)];
  const named = findPlayers(question, everyone, mine);
  const unclear = ambiguousNames(question, mine, everyone);
  if (unclear.size) {
    const [lastName, options] = [...unclear.entries()][0];
    return {
      title: `Which ${lastName.charAt(0).toUpperCase() + lastName.slice(1)}?`,
      tone: "neutral",
      lines: [`Add a first name: ${options.map((p) => `${p.name} (${p.position}, ${p.team ?? "FA"})`).join(", ")}.`],
      players: [],
    };
  }

  // Who to drop.
  if (/\b(drop|cut|release)\b/.test(q) && named.length === 0) {
    const pool = a.activeRoster.filter((p) => !isNoDrop(a.prefs, p.id));
    const drop = a.drops[0]?.player ?? [...pool].sort((x, y) => keepValue(x) - keepValue(y))[0];
    if (!drop) return { title: "Nobody to drop", tone: "neutral", lines: [], players: [] };
    return {
      title: `Drop ${drop.name}`,
      tone: "neutral",
      lines: [a.drops[0]?.reason ?? `Lowest rest-of-season value on your bench (${drop.rosValue} pts/game).`],
      players: [drop],
    };
  }

  // Trade: "trade X for Y" / "X for Y" where X is yours and Y is on another team.
  const tradeWords = /\b(trade|deal|swap|offer)\b/.test(q) || /\bfor\b/.test(q);
  if (tradeWords && named.length >= 2) {
    const give = named.filter((p) => mine.some((m) => m.id === p.id));
    const get = named.filter((p) => !mine.some((m) => m.id === p.id));
    const team = get.length ? a.otherTeams.find((t) => t.players.some((p) => p.id === get[0].id)) : undefined;
    if (give.length && get.length && team && get.every((p) => team.players.some((x) => x.id === p.id))) {
      const e = evaluateTrade(a, team.rosterId, give, get);
      return {
        title: `${e.verdict}: ${give.map((p) => last(p.name)).join(" + ")} for ${get.map((p) => last(p.name)).join(" + ")}`,
        tone:
          e.verdict === "Accept" || e.verdict === "Lean accept" ? "good" : e.verdict === "Decline" ? "bad" : "neutral",
        lines: [
          e.summary,
          `Your best lineup ${e.yourGain >= 0 ? "gains" : "loses"} ${Math.abs(e.yourGain)} pts/week; ${team.teamName}'s ${e.theirGain >= 0 ? "gains" : "loses"} ${Math.abs(e.theirGain)}.`,
        ],
        players: [...give, ...get],
      };
    }
    if (give.length && get.length && !team) {
      return {
        title: "That player isn't on another team",
        tone: "neutral",
        lines: [
          `${get.map((p) => p.name).join(", ")} is a free agent — ask "should I pick up ${last(get[0].name)}?" instead.`,
        ],
        players: get,
      };
    }
  }

  // Start/sit between two players.
  if (named.length >= 2) {
    const [x, y] = named;
    const [pick, other] = x.weekScore >= y.weekScore ? [x, y] : [y, x];
    const c = startConfidence(pick, other);
    const cmp = compareStart(pick, other);
    const word = confidenceWord(c);
    const fa = [pick, other].filter((p) => !mine.some((m) => m.id === p.id));
    return {
      title: `${word === "Coin flip" ? "Coin flip — lean" : "Start"} ${pick.name}`,
      tone: word === "Coin flip" ? "neutral" : "good",
      lines: [
        `${pct(c)} confident: ${cmp.headline}`,
        ...cmp.edges.slice(0, 2).map((e) => `+ ${e}`),
        ...cmp.against.slice(0, 1).map((e) => `− ${e}`),
        ...(fa.length
          ? [
              `${fa.map((p) => p.name).join(" and ")} ${fa.length > 1 ? "are" : "is"} a free agent — you'd have to add him first.`,
            ]
          : []),
      ],
      players: [pick, other],
    };
  }

  // Pickup question about one player.
  if (named.length === 1) {
    const p = named[0];
    const owner = a.otherTeams.find((t) => t.players.some((x) => x.id === p.id));
    if (owner && !/\b(start|sit|play)\b/.test(q)) {
      return {
        title: `${p.name} is on ${owner.teamName}`,
        tone: "neutral",
        lines: [
          `Projects ${p.weekScore} pts this week; ${p.rosValue} pts/game rest of season.`,
          `Want him? Ask "trade [your player] for ${last(p.name)}?"`,
        ],
        players: [p],
      };
    }
    return playerCall(a, p);
  }

  return {
    ...HELP,
    title: named.length === 0 && q.length > 2 ? "I couldn't find a player in that" : HELP.title,
  };
}
