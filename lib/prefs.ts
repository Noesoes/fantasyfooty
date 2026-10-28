// Your own calls about your players, per league, that the advisor respects:
// "don't suggest trading him", "don't suggest dropping him", and "he's my
// backup for X" (which means both). Kept on this device.

export interface PlayerRule {
  noTrade?: boolean;
  noDrop?: boolean;
  /** Player id of the starter this player backs up. */
  backupFor?: string;
}

export type Prefs = Record<string, PlayerRule>;

const key = (leagueId: string) => `rules:${leagueId}`;

export function loadPrefs(leagueId: string): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(key(leagueId)) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Prefs = {};
    for (const [id, r] of Object.entries(raw as Record<string, PlayerRule>)) {
      if (!r || typeof r !== "object") continue;
      const rule: PlayerRule = {};
      if (r.noTrade === true) rule.noTrade = true;
      if (r.noDrop === true) rule.noDrop = true;
      if (typeof r.backupFor === "string" && r.backupFor) rule.backupFor = r.backupFor;
      if (Object.keys(rule).length) out[id] = rule;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePrefs(leagueId: string, prefs: Prefs) {
  try {
    localStorage.setItem(key(leagueId), JSON.stringify(prefs));
  } catch {}
}

/** Set (or clear, with null / an empty rule) one player's rule. */
export function withRule(prefs: Prefs, id: string, rule: PlayerRule | null): Prefs {
  const next = { ...prefs };
  const clean: PlayerRule = {};
  if (rule?.noTrade) clean.noTrade = true;
  if (rule?.noDrop) clean.noDrop = true;
  if (rule?.backupFor) clean.backupFor = rule.backupFor;
  if (Object.keys(clean).length) next[id] = clean;
  else delete next[id];
  return next;
}

/** A designated backup is never a trade or drop suggestion. */
export const isNoTrade = (prefs: Prefs | undefined, id: string) => !!(prefs?.[id]?.noTrade || prefs?.[id]?.backupFor);
export const isNoDrop = (prefs: Prefs | undefined, id: string) => !!(prefs?.[id]?.noDrop || prefs?.[id]?.backupFor);
