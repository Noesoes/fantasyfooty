// News questions for Ask: "is Taylor getting traded?", "is Gibbs hurt?",
// "latest on Puka". These need the player's news feed, so they're answered
// asynchronously; everything else goes through the regular `answer`.

import type { Analysis, PlayerAnalysis } from "./advisor";
import type { AskAnswer, AskSource } from "./ask";
import { lastName } from "./names";
import { getPlayerNews, type NewsItem } from "./sleeper";
import { LAST_TRADE_WEEK, readTradeTalk } from "./tradetalk";

export type NewsKind = "trade" | "injury" | "news";

/** What kind of news question this is, if any. "Should I trade X?" is a trade-grade question, not news. */
export function newsKind(normalized: string): NewsKind | null {
  const q = normalized;
  if (/\b(traded|dealt)\b|\btrade (rumou?rs?|talk|news|request|speculation)\b|\brumou?rs?\b|\btrade block\b/.test(q))
    return "trade";
  if (
    /\b(hurt|injur\w*|healthy|health|status|questionable|doubtful|practic\w*|limited|concussion|ankle|knee|hamstring)\b/.test(
      q,
    ) ||
    /\b(is|will|does|can)\b.*\b(play|playing|suit up|active|out)\b/.test(q)
  )
    return "injury";
  if (/\b(news|latest|update|updates|whats going on|whats up with|what happened|heard)\b/.test(q)) return "news";
  return null;
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const SOURCE_NAMES: Record<string, string> = {
  rotowire: "RotoWire",
  rotoballer: "RotoBaller",
  fantasy_pros: "FantasyPros",
};
const sourceName = (s: string) => SOURCE_NAMES[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function toSource(n: NewsItem, stance: AskSource["stance"] = null): AskSource {
  return {
    title: (n.metadata.title ?? "").trim() || "(no headline)",
    url: n.metadata.url,
    source: sourceName(n.source),
    date: day(n.published),
    stance,
  };
}

// Matched against headlines only: article bodies mention old injuries and
// "running back" too often to be a useful signal.
const INJURY_NEWS = new RegExp(
  [
    String.raw`\b(injur\w*|hurt|questionable|doubtful|ruled out|out for|inactive|day-to-day|game-time decision)\b`,
    String.raw`\b(practic\w*|dnp|full participant|limited participant|limited in practice|did not practice)\b`,
    String.raw`\b(ir|injured reserve|reserve list|pup|activated|designated to return|cleared|concussion protocol)\b`,
    String.raw`\b(concussion|ankle|knee|hamstring|groin|shoulder|foot|calf|quad|hip|wrist|hand|elbow|ribs?|chest|neck|toe|achilles|acl|mcl|illness|back injury)\b`,
    String.raw`\b(will play|won't play|expected to play|set to play|ready to go|good to go|not playing|sitting out)\b`,
  ].join("|"),
  "i",
);

/** The backup on your roster who'd take over if this player's job opens (from the stash model). */
function yourStash(a: Analysis, p: PlayerAnalysis) {
  return a.roster.find((x) => x.stash?.starter === p.name) ?? null;
}

export async function answerNews(a: Analysis, p: PlayerAnalysis, kind: NewsKind, now = Date.now()): Promise<AskAnswer> {
  const news = await getPlayerNews(p.id, 25).catch(() => null);
  const last = lastName(p.name);
  const yours = a.roster.some((x) => x.id === p.id);
  const footer = "From Sleeper's player news feed (RotoWire, RotoBaller, FantasyPros).";
  if (news === null) {
    return {
      title: `Couldn't load ${last}'s news`,
      tone: "neutral",
      lines: ["Check your connection and ask again."],
      players: [p],
    };
  }

  if (kind === "trade") {
    const talk = readTradeTalk(news, last.toLowerCase(), now);
    const stash = yourStash(a, p);
    const deadlinePassed = a.week > LAST_TRADE_WEEK;
    const lines: string[] = [];
    let title: string;
    let tone: AskAnswer["tone"] = "neutral";
    if (deadlinePassed) {
      title = `No — the trade deadline has passed`;
      lines.push(`${p.name} stays with ${p.team ?? "his team"} for the rest of the season.`);
    } else if (!talk.items.length) {
      title = `No trade talk about ${last}`;
      lines.push(`Nothing in the last 3 weeks of news mentions ${p.name} being traded.`);
    } else {
      const firstRumor = talk.rumors.at(-1);
      const firstCooling = talk.cooling.at(-1);
      if (talk.lean <= -0.3) {
        title = `Probably not — the trade talk is cooling`;
      } else if (talk.lean >= 0.3) {
        title = `Possibly — ${last} is in active trade rumors`;
        tone = "bad";
      } else {
        title = `Too close to call — the reports are mixed`;
      }
      if (talk.rumors.length)
        lines.push(
          `${talk.rumors.length} report${talk.rumors.length > 1 ? "s" : ""} of trade talk since ${day(firstRumor!.published)}.`,
        );
      if (talk.cooling.length)
        lines.push(
          `${talk.cooling.length} report${talk.cooling.length > 1 ? "s" : ""} since ${day(firstCooling!.published)} say he's likely staying or hasn't asked out.`,
        );
    }
    if (!deadlinePassed) {
      if (yours && talk.items.length)
        lines.push(
          `For you: a trade changes his NFL team, not your roster. Keep starting him; a new offense could raise or lower his role.`,
        );
      if (stash?.stash)
        lines.push(
          `Your ${stash.name} is the stash here: ~${Math.round(stash.stash.chance * 100)}% chance ${last}'s job opens, worth ~${stash.stash.ifStarter} pts/game if it does.`,
        );
    }
    lines.push(footer);
    return {
      title,
      tone,
      lines,
      players: stash ? [p, stash] : [p],
      sources: talk.items.slice(0, 5).map((x) => toSource(x.item, x.stance)),
    };
  }

  if (kind === "injury") {
    const injuryNews = news.filter((n) => INJURY_NEWS.test(n.metadata.title ?? ""));
    const chance = p.playChance;
    const part = p.injuryBodyPart ? ` (${p.injuryBodyPart})` : "";
    let title: string;
    let tone: AskAnswer["tone"];
    if (p.onBye) {
      title = `${last} is on bye this week`;
      tone = "neutral";
    } else if (!p.injury) {
      // Off the report, but fresh injury news (a nagging calf) still deserves a look.
      const fresh = injuryNews[0] && now - injuryNews[0].published <= 5 * 86_400_000;
      title = fresh ? `${last} isn't on the injury report — but see the latest` : `${last} has no injury designation`;
      tone = fresh ? "neutral" : "good";
    } else if (["Out", "IR", "PUP", "Sus"].includes(p.injury)) {
      title = `${last} is ${p.injury === "IR" ? "on IR" : p.injury === "Sus" ? "suspended" : p.injury.toLowerCase()}${part}`;
      tone = "bad";
    } else {
      title = `${last} is ${p.injury.toLowerCase()}${part}${chance != null ? ` — ~${Math.round(chance * 100)}% to play` : ""}`;
      tone = chance != null && chance >= 0.7 ? "neutral" : "bad";
    }
    const lines: string[] = [];
    if (!injuryNews.length) lines.push(`No injury news about ${last} lately.`);
    if (yours && p.injury && !p.onBye)
      lines.push(
        p.weekScore > 0
          ? `He still projects ${p.weekScore} pts with the injury factored in — see the Injuries tab for a backup plan.`
          : `Plan to sit him — the Injuries tab has your best replacement.`,
      );
    lines.push(footer);
    return {
      title,
      tone,
      lines,
      players: [p],
      sources: injuryNews.slice(0, 4).map((n) => toSource(n)),
    };
  }

  // General news.
  const recent = news.slice(0, 5);
  return {
    title: recent.length ? `Latest on ${p.name}` : `No recent news on ${p.name}`,
    tone: "neutral",
    lines: [
      ...(p.injury ? [`Status: ${p.injury}${p.injuryBodyPart ? ` (${p.injuryBodyPart})` : ""}.`] : []),
      `Projects ${p.weekScore} pts this week.`,
      footer,
    ],
    players: [p],
    sources: recent.map((n) => toSource(n)),
  };
}
