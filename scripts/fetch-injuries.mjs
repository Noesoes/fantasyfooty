// Snapshots ESPN's league-wide NFL injury report into public/injuries.json so
// the site can read it from its own origin (no cross-site request for the
// browser to block). Run by the Pages deploy workflow before each build.
import { mkdirSync, writeFileSync } from "node:fs";

const URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 (fantasyfooty injury snapshot)" } });
if (!res.ok) throw new Error(`ESPN ${res.status}`);
const data = await res.json();

// Keep only what the app uses (the full payload is ~9 MB).
const injuries = (data.injuries ?? []).flatMap((team) =>
  (team.injuries ?? []).map((i) => ({
    status: i.status,
    date: i.date,
    shortComment: i.shortComment,
    longComment: i.longComment,
    details: { type: i.details?.type, returnDate: i.details?.returnDate },
    athlete: { displayName: i.athlete?.displayName, team: { abbreviation: i.athlete?.team?.abbreviation } },
  })),
);
mkdirSync("public", { recursive: true });
writeFileSync("public/injuries.json", JSON.stringify({ fetchedAt: new Date().toISOString(), injuries }));
console.log(`Saved ${injuries.length} injury reports`);
