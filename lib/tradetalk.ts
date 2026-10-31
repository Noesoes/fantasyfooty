// Reading trade news: which headlines are trade rumors and which say a player
// is staying put. "Hasn't requested a trade" mentions a trade but is the
// opposite of a rumor, so denials are checked first, and the headline counts
// for more than the blurb under it.

import type { NewsItem } from "./sleeper";

/** The NFL trade deadline falls after week 9 or 10; rumors don't matter after it. */
export const LAST_TRADE_WEEK = 10;

export const TRADE =
  /\btrad(e|ed|ing)\b|\bdealt\b|\bsuitors?\b|\blinked to\b|\bon the (trade )?block\b|\bshopping\b|\btrade deadline\b|\bfuture (remains |is )?uncertain\b/i;

export const TRADE_DENIED = new RegExp(
  [
    String.raw`\b(not|never) (be(ing)? )?(traded|dealt|available|moved)\b`,
    String.raw`\boff the table\b`,
    String.raw`\bno plans to (trade|move|deal)\b`,
    String.raw`\b(signed|agreed to) (an? )?(contract )?extension\b`,
    // "hasn't requested a trade", "has not asked for a trade", "didn't demand a trade"
    String.raw`\b(has ?n[o'’]?t|has not|did ?n[o'’]?t|did not|not|never) (requested|asked for|demanded)( a)? trade\b`,
    String.raw`\b(has ?n[o'’]?t|has not|not|never) asked out\b`,
    // "Colts don't seem likely to trade him", "unlikely to be dealt"
    String.raw`\b(do ?n[o'’]?t|does ?n[o'’]?t|do not|does not|not) (seem |appear )?likely to (trade|deal|move)\b`,
    String.raw`\bunlikely to (be )?(trade|traded|deal|dealt|move|moved)\b`,
    String.raw`\b(staying put|expected to stay|will stay)\b`,
  ].join("|"),
  "i",
);

export type Stance = "rumor" | "cooling";

const titleOf = (n: NewsItem) => n.metadata.title ?? "";
const bodyOf = (n: NewsItem) => n.metadata.description ?? "";

/** Whether one news item is trade talk about this player, and which way it leans. */
export function tradeStance(n: NewsItem, lastName: string): Stance | null {
  const title = titleOf(n);
  const body = bodyOf(n);
  if (!`${title} ${body}`.toLowerCase().includes(lastName.toLowerCase())) return null;
  for (const text of [title, body]) {
    if (TRADE_DENIED.test(text)) return "cooling";
    if (TRADE.test(text)) return "rumor";
  }
  return null;
}

export interface TradeTalk {
  rumors: NewsItem[];
  cooling: NewsItem[];
  /** Every trade item, newest first. */
  items: { item: NewsItem; stance: Stance }[];
  /** Recency-weighted lean: above 0 = rumors are winning, below 0 = he's staying. */
  lean: number;
}

/** Trade talk about a player in the last `days` days. Newer reports count for more (half-life 5 days). */
export function readTradeTalk(news: NewsItem[], lastName: string, now = Date.now(), days = 21): TradeTalk {
  const items = news
    .filter((n) => now - n.published <= days * 86_400_000)
    .map((item) => ({ item, stance: tradeStance(item, lastName) }))
    .filter((x): x is { item: NewsItem; stance: Stance } => x.stance !== null)
    .sort((x, y) => y.item.published - x.item.published);
  let lean = 0;
  for (const { item, stance } of items) {
    const age = (now - item.published) / 86_400_000;
    lean += (stance === "rumor" ? 1 : -1) * 0.5 ** (age / 5);
  }
  return {
    rumors: items.filter((x) => x.stance === "rumor").map((x) => x.item),
    cooling: items.filter((x) => x.stance === "cooling").map((x) => x.item),
    items,
    lean,
  };
}
