// Generates the weekly recommendations as Markdown on stdout.
//
//   SLEEPER_USERNAME=you npx tsx scripts/weekly-report.ts
//
// Optional env:
//   SLEEPER_LEAGUE_ID  which league to analyze (default: every league you're in)
//   WEEK               override the week (default: the upcoming week)

import { analyzeLeague } from "../lib/advisor";
import { renderMarkdown } from "../lib/report";
import { buildTrackRecord } from "../lib/backtest";
import { buildInjuryReport } from "../lib/injuries";
import { getNflState, getUser, getUserLeagues, upcomingWeek } from "../lib/sleeper";

async function main() {
  const username = process.env.SLEEPER_USERNAME?.trim();
  if (!username) throw new Error("Set SLEEPER_USERNAME to your Sleeper username.");

  const user = await getUser(username);
  if (!user) throw new Error(`No Sleeper user named "${username}".`);

  const state = await getNflState();
  if (state.season_type === "off") {
    console.log("The NFL is in the offseason — no report this week.");
    return;
  }
  const week = process.env.WEEK ? Number(process.env.WEEK) : upcomingWeek(state);
  const season = state.league_season ?? state.season;

  const leagueIds = process.env.SLEEPER_LEAGUE_ID?.trim()
    ? process.env.SLEEPER_LEAGUE_ID.split(",").map((s) => s.trim())
    : (await getUserLeagues(user.user_id, season)).filter((l) => l.status === "in_season").map((l) => l.league_id);

  if (leagueIds.length === 0) {
    console.log(`No in-season ${season} leagues found for ${username}.`);
    return;
  }

  const sections: string[] = [];
  for (const leagueId of leagueIds) {
    try {
      const analysis = await analyzeLeague({ leagueId, userId: user.user_id, season, week });
      const [record, injuries] = await Promise.all([
        buildTrackRecord(analysis).catch(() => null),
        buildInjuryReport(analysis).catch(() => null),
      ]);
      sections.push(renderMarkdown(analysis, record, injuries));
    } catch (err) {
      sections.push(`# League ${leagueId}\n\nCouldn't analyze: ${(err as Error).message}`);
    }
  }
  console.log(sections.join("\n\n---\n\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
