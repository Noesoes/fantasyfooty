// Injury report: for every injured or limited player on your roster (and your
// opponent's starters), will they play this week?
//
// Signals, strongest first:
//  - the official designation (Out / IR / Doubtful / Questionable), from Sleeper
//    and ESPN's league-wide injury report
//  - this week's practice participation (DNP / limited / full), parsed from
//    Sleeper's player news feed and ESPN's injury notes
//  - news that a player was ruled out, or is expected to play
//  - QB depth charts and whether Sleeper still projects the player at all
//
// The probabilities are rules of thumb (about 2 in 3 questionable players
// suit up, and far more when they finish the week with a full practice), not
// a trained model.

import { OUT_STATUSES, type Analysis, type PlayerAnalysis } from "./advisor";
import { getPlayerNews, getSchedule, type NewsItem } from "./sleeper";

export type PracticeLevel = "DNP" | "Limited" | "Full";
export type Verdict = "Playing" | "Likely" | "Toss-up" | "Unlikely" | "Out" | "Bye";

export interface PracticeNote {
  day: string;
  level: PracticeLevel;
}

export interface InjuryRow {
  player: PlayerAnalysis;
  side: "mine" | "opponent";
  starter: boolean;
  designation: string | null;
  bodyPart: string | null;
  practice: PracticeNote[];
  returnDate: string | null;
  headline: { text: string; source: string; published: number; url?: string } | null;
  probability: number;
  verdict: Verdict;
  reasons: string[];
  /** Their game has already kicked off — the lineup spot is locked. */
  locked: boolean;
}

export interface InjuryReport {
  rows: InjuryRow[];
  healthyStarters: number;
  totalStarters: number;
  fetchedAt: number;
  espnAvailable: boolean;
  /** When the ESPN report was fetched, if available. */
  espnAsOf: number | null;
}

const ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const ESPN_TEAM: Record<string, string> = { WSH: "WAS" };
const ESPN_STATUS: Record<string, string> = { "Injured Reserve": "IR" };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface EspnInjury {
  status: string;
  date: string;
  shortComment?: string;
  longComment?: string;
  details?: { type?: string; returnDate?: string };
  athlete: { displayName: string; team?: { abbreviation: string } };
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");

/**
 * ESPN's injury report. In the browser, prefer the copy the deploy workflow
 * snapshots next to the site every few hours (same origin, so it can't be
 * blocked); fall back to ESPN directly (which is what Node scripts use).
 */
async function fetchEspn(): Promise<{ map: Map<string, EspnInjury>; asOf: number }> {
  let list: EspnInjury[] | null = null;
  let asOf = Date.now();
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("injuries.json", { cache: "no-store" });
      if (res.ok) {
        const snap = (await res.json()) as { fetchedAt: string; injuries: EspnInjury[] };
        // Ignore a stale snapshot (deploys pause in the offseason).
        if (Date.now() - Date.parse(snap.fetchedAt) < 12 * 3_600_000) {
          list = snap.injuries;
          asOf = Date.parse(snap.fetchedAt);
        }
      }
    } catch {
      // fall through to ESPN
    }
  }
  if (!list) {
    const res = await fetch(ESPN_URL);
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const data = (await res.json()) as { injuries: { injuries: EspnInjury[] }[] };
    list = (data.injuries ?? []).flatMap((t) => t.injuries ?? []);
  }
  const map = new Map<string, EspnInjury>();
  for (const inj of list) {
    const abbr = inj.athlete.team?.abbreviation ?? "";
    map.set(`${normName(inj.athlete.displayName)}|${ESPN_TEAM[abbr] ?? abbr}`, inj);
  }
  return { map, asOf };
}

const FULL =
  /\b(full(y)?\s+(participant|participation|practice|go)|practiced fully|full participant|without (any )?limitations|upgraded to (a )?full)\b/i;
const DNP =
  /\b((did not|didn't|does not|doesn't|won't|will not|unable to|not)\s+(practice|participate|take part|present at practice|at practice)|non-?participant|sat out|DNP|missed practice|no practice|held out)\b/i;
const LIMITED = /\blimited\b/i;
const PRACTICE = /practic|participa|DNP/i;
const RULED_OUT =
  /\b(ruled out|won't play|will not play|declared inactive|is inactive|will miss (sunday|monday|thursday|the game|week)|won't suit up|out for (sunday|monday|thursday|week))\b/i;
const NEGATED = /\b(not|n't|never|yet to be)( been)?( officially)? ruled out\b/i;
// Sentences recapping earlier weeks ("he opened last week as a non-participant…").
const PAST = /\b(last week|previous week|a week ago|last season|last year|week \d+ injury report|ahead of week \d+)\b/i;

// Hedged sentences ("if he practices Thursday, there's a chance he will play") aren't news.
const HEDGED =
  /\b(if|chance|could|might|may|hope(s|ful)?|possibl[ey]|uncertain|unclear|remains to be seen|optimistic|would)\b/i;

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
const EXPECTED_IN =
  /\b(expect(s|ed)? to play|will play|good to go|no injury designation|without an injury designation|cleared to play|off the injury report|is active|will suit up|not listed)\b/i;

/** The first sentence that reports this week's practice participation (leads carry the news). */
function practiceFrom(text: string, when: Date): PracticeNote | null {
  for (const sentence of sentences(text)) {
    if (!PRACTICE.test(sentence) || PAST.test(sentence)) continue;
    const level: PracticeLevel | null = FULL.test(sentence)
      ? "Full"
      : DNP.test(sentence)
        ? "DNP"
        : LIMITED.test(sentence)
          ? "Limited"
          : null;
    if (!level) continue;
    const dayMatch = sentence.match(/\b(Mon|Tues|Wednes|Thurs|Fri|Satur)day\b/i);
    const day = dayMatch
      ? dayMatch[0][0].toUpperCase() + dayMatch[0].slice(1).toLowerCase()
      : DAYS[(when.getDay() + 6) % 7];
    return { day, level };
  }
  return null;
}

const ruledOutIn = (text: string) =>
  sentences(text).some((x) => RULED_OUT.test(x) && !NEGATED.test(x) && !PAST.test(x) && !HEDGED.test(x));
const expectedInIn = (text: string) =>
  sentences(text).some((x) => EXPECTED_IN.test(x) && !PAST.test(x) && !HEDGED.test(x));

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const verdictFor = (p: number): Verdict =>
  p >= 0.85 ? "Playing" : p >= 0.6 ? "Likely" : p >= 0.4 ? "Toss-up" : p >= 0.1 ? "Unlikely" : "Out";

export async function buildInjuryReport(a: Analysis): Promise<InjuryReport> {
  const myStarters = new Set(a.currentLineup.map((s) => s.player?.id).filter(Boolean) as string[]);
  const candidates: { player: PlayerAnalysis; side: "mine" | "opponent"; starter: boolean }[] = [
    ...a.roster.map((p) => ({ player: p, side: "mine" as const, starter: myStarters.has(p.id) })),
    ...(a.opponent?.starters ?? []).map((p) => ({ player: p, side: "opponent" as const, starter: true })),
  ].filter((c) => c.player.position !== "DEF");

  const [espnResult, schedule, news] = await Promise.all([
    fetchEspn().catch(() => null),
    getSchedule(a.season).catch(() => []),
    mapLimit(candidates, 6, (c) => getPlayerNews(c.player.id).catch(() => [] as NewsItem[])),
  ]);
  const espn = espnResult?.map ?? null;

  // This game week runs from the Tuesday before its first game.
  const weekGames = schedule.filter((g) => g.week === a.week);
  const firstGame = weekGames.map((g) => new Date(`${g.date}T12:00:00Z`).getTime()).sort((x, y) => x - y)[0];
  const weekStart = firstGame ? firstGame - 2 * 86_400_000 - 12 * 3_600_000 : Date.now() - 6 * 86_400_000;
  const gameStatus = new Map<string, string>();
  for (const g of weekGames) {
    gameStatus.set(g.home, g.status);
    gameStatus.set(g.away, g.status);
  }

  const rows: InjuryRow[] = [];
  candidates.forEach((c, i) => {
    const p = c.player;
    const e = espn?.get(`${normName(p.name)}|${p.team ?? ""}`);
    const espnStatus = e ? (ESPN_STATUS[e.status] ?? e.status) : null;
    const designation = p.injury ?? (espnStatus && espnStatus !== "Active" ? espnStatus : null);

    // Practice notes and headline news from this game week.
    const items = [
      ...news[i].map((n) => ({
        text: `${n.metadata.title ?? ""}. ${n.metadata.description ?? ""}`,
        when: new Date(n.published),
        source: n.source,
        url: n.metadata.url,
        title: n.metadata.title ?? n.metadata.description ?? "",
      })),
      ...(e
        ? [
            {
              text: `${e.shortComment ?? ""} ${e.longComment ?? ""}`,
              when: new Date(e.date),
              source: "ESPN",
              url: undefined,
              title: e.shortComment ?? "",
            },
          ]
        : []),
    ]
      .filter((n) => n.when.getTime() >= weekStart)
      .sort((x, y) => y.when.getTime() - x.when.getTime());

    const byDay = new Map<string, PracticeNote>();
    // Oldest first, so a later report for the same day wins.
    for (const n of [...items].reverse()) {
      const note = practiceFrom(n.text, n.when);
      if (note) byDay.set(note.day, note);
    }
    const practice = [...byDay.values()].sort((x, y) => DAYS.indexOf(x.day) - DAYS.indexOf(y.day));
    const latest = practice.at(-1);
    const ruledOut = items.some((n) => ruledOutIn(n.text));
    const expectedIn = items.some((n) => expectedInIn(n.text));

    const flagged =
      designation || (espnStatus && espnStatus !== "Active") || practice.some((n) => n.level !== "Full") || ruledOut;
    if (!flagged && p.role !== "sidelined") return;

    const reasons: string[] = [];
    let prob: number;
    let verdict: Verdict | null = null;
    if (p.onBye) {
      prob = 0;
      verdict = "Bye";
      reasons.push("On bye this week");
    } else if (designation && OUT_STATUSES.has(designation)) {
      prob = 0;
      reasons.push(designation === "IR" ? "On injured reserve" : `Officially ${designation}`);
    } else if (designation === "Doubtful") {
      prob = latest?.level === "Full" ? 0.4 : latest?.level === "Limited" ? 0.25 : 0.12;
      reasons.push("Listed doubtful — most doubtful players sit");
    } else if (designation === "Questionable") {
      const dnps = practice.filter((n) => n.level === "DNP").length;
      prob = !latest
        ? 0.68
        : latest.level === "Full"
          ? 0.9
          : latest.level === "Limited"
            ? 0.72
            : dnps >= 2 && practice.every((n) => n.level === "DNP")
              ? 0.3
              : 0.45;
      reasons.push("Listed questionable");
    } else {
      // No game designation (yet): mid-week practice reports carry the signal.
      prob = !latest
        ? 0.95
        : latest.level === "Full"
          ? 0.97
          : latest.level === "Limited"
            ? 0.88
            : latest.day === "Friday"
              ? 0.5
              : 0.75;
      if (latest && latest.level !== "Full") reasons.push("No game designation yet");
    }
    if (latest && verdict !== "Bye" && !(designation && OUT_STATUSES.has(designation))) {
      const trend = practice
        .map((n) => `${n.day.slice(0, 3)} ${n.level === "Limited" ? "LP" : n.level === "Full" ? "FP" : "DNP"}`)
        .join(" → ");
      reasons.push(`Practice: ${trend}`);
    }
    if (ruledOut && verdict !== "Bye") {
      prob = Math.min(prob, 0.03);
      reasons.push("Reported as ruled out");
    } else if (expectedIn && prob > 0 && !(designation && OUT_STATUSES.has(designation))) {
      prob = Math.max(prob, 0.92);
      reasons.push("Reported as expected to play");
    }
    if (p.role === "sidelined") {
      prob = Math.min(prob, 0.1);
      reasons.push("Sleeper projects another QB to start");
    } else if (prob > 0 && p.projection === 0 && p.team && !p.onBye && designation) {
      prob = Math.min(prob, 0.35);
      reasons.push("Sleeper has stopped projecting them — usually a sign they won't play");
    }
    const returnDate = e?.details?.returnDate ?? null;
    if (returnDate && prob < 0.5 && verdict !== "Bye") {
      reasons.push(
        `ESPN estimated return: ${new Date(`${returnDate}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" })}`,
      );
    }

    const top = items[0];
    rows.push({
      player: p,
      side: c.side,
      starter: c.starter,
      designation,
      bodyPart: p.injuryBodyPart ?? e?.details?.type ?? null,
      practice,
      returnDate,
      headline: top
        ? { text: top.title.trim(), source: top.source, published: top.when.getTime(), url: top.url }
        : null,
      probability: Math.round(prob * 100) / 100,
      verdict: verdict ?? verdictFor(prob),
      reasons,
      locked: Boolean(p.team && (gameStatus.get(p.team) ?? "pre_game") !== "pre_game"),
    });
  });

  // Your starters first, most at risk first; then your bench; then the opponent.
  const rank = (r: InjuryRow) => (r.side === "mine" ? (r.starter ? 0 : 1) : 2);
  rows.sort((x, y) => rank(x) - rank(y) || x.probability - y.probability);
  const mineStarters = a.currentLineup.filter((s) => s.player && s.player.position !== "DEF");
  const atRisk = new Set(
    rows.filter((r) => r.side === "mine" && r.starter && r.probability < 0.85).map((r) => r.player.id),
  );
  return {
    rows,
    healthyStarters: mineStarters.filter((s) => !atRisk.has(s.player!.id)).length,
    totalStarters: mineStarters.length,
    fetchedAt: Date.now(),
    espnAvailable: espn !== null,
    espnAsOf: espnResult?.asOf ?? null,
  };
}
