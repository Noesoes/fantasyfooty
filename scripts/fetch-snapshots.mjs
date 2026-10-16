// Snapshots ESPN data into public/ so the site can read it from its own
// origin (ESPN blocks some browsers). Run by the Pages deploy workflow:
//  - public/injuries.json:   league-wide injury report
//  - public/scoreboard.json: this week's and next week's games (kickoff,
//    Vegas line, weather; clocks go stale, so the app re-derives live state)
//  - public/player-links.json: Sleeper id -> RotoWire id (so the injury tab
//    can link RotoWire updates, which come without a URL, to the player's
//    RotoWire page) and -> ESPN id (to find players in ESPN play-by-play).
//    From Sleeper's ~10 MB player database.
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const get = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (fantasyfooty snapshot)" } });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
};
mkdirSync("public", { recursive: true });
const fetchedAt = new Date().toISOString();

try {
  const data = await get(`${BASE}/injuries`);
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
  writeFileSync("public/injuries.json", JSON.stringify({ fetchedAt, injuries }));
  console.log(`Saved ${injuries.length} injury reports`);
} catch (err) {
  console.error(`Injuries: ${err.message}`);
}

try {
  const current = await get(`${BASE}/scoreboard`);
  const week = current.week?.number;
  const season = current.season?.year;
  const weeks = { [week]: current.events };
  if (week && week < 18) {
    const next = await get(`${BASE}/scoreboard?week=${week + 1}&seasontype=2&dates=${season}`);
    weeks[week + 1] = next.events;
  }
  // Trim each event to the fields lib/scoreboard.ts reads.
  const trim = (e) => ({
    id: e.id,
    date: e.date,
    weather: e.weather ? { displayValue: e.weather.displayValue, temperature: e.weather.temperature } : undefined,
    status: { period: e.status?.period, displayClock: e.status?.displayClock, type: e.status?.type },
    competitions: e.competitions.map((c) => ({
      venue: { indoor: c.venue?.indoor },
      competitors: c.competitors.map((t) => ({
        homeAway: t.homeAway,
        score: t.score,
        team: {
          abbreviation: t.team.abbreviation,
          id: t.team.id,
          color: t.team.color,
          alternateColor: t.team.alternateColor,
        },
      })),
      odds: (c.odds ?? []).slice(0, 1).map((o) => ({ details: o.details, overUnder: o.overUnder, spread: o.spread })),
    })),
  });
  for (const k of Object.keys(weeks)) weeks[k] = (weeks[k] ?? []).map(trim);
  writeFileSync("public/scoreboard.json", JSON.stringify({ fetchedAt, weeks }));
  console.log(`Saved scoreboard for weeks ${Object.keys(weeks).join(", ")}`);
} catch (err) {
  console.error(`Scoreboard: ${err.message}`);
}

try {
  const res = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!res.ok) throw new Error(`Sleeper ${res.status}`);
  const players = await res.json();
  const rw = {};
  const espn = {};
  for (const [id, p] of Object.entries(players)) {
    if (!["QB", "RB", "WR", "TE", "K"].includes(p.position)) continue;
    if (!p.team && !p.injury_status) continue;
    if (p.rotowire_id) rw[id] = p.rotowire_id;
    if (p.espn_id) espn[id] = Number(p.espn_id);
  }
  writeFileSync("public/player-links.json", JSON.stringify({ fetchedAt, rw, espn }));
  console.log(`Saved RotoWire ids for ${Object.keys(rw).length} players, ESPN ids for ${Object.keys(espn).length}`);
} catch (err) {
  console.error(`Player links: ${err.message}`);
}
