// Prints a Markdown alert if any starter in your lineup won't play and their
// game hasn't kicked off yet. Prints nothing when everything is fine.
//
//   SLEEPER_USERNAME=you npx tsx scripts/gameday-alert.ts
//
// Optional env: SLEEPER_LEAGUE_ID (comma-separated), WEEK.

import { gamedayCheck, hashSignature, renderGamedayMarkdown } from "../lib/gameday";
import { getNflState, getUser, getUserLeagues, upcomingWeek } from "../lib/sleeper";

async function main() {
  const username = process.env.SLEEPER_USERNAME?.trim();
  if (!username) throw new Error("Set SLEEPER_USERNAME to your Sleeper username.");
  const user = await getUser(username);
  if (!user) throw new Error(`No Sleeper user named "${username}".`);

  const state = await getNflState();
  if (state.season_type !== "regular") return;
  const week = process.env.WEEK ? Number(process.env.WEEK) : upcomingWeek(state);
  const season = state.league_season ?? state.season;
  const leagueIds = process.env.SLEEPER_LEAGUE_ID?.trim()
    ? process.env.SLEEPER_LEAGUE_ID.split(",").map((s) => s.trim())
    : (await getUserLeagues(user.user_id, season)).filter((l) => l.status === "in_season").map((l) => l.league_id);

  const sections: string[] = [];
  const signatures: string[] = [];
  for (const leagueId of leagueIds) {
    try {
      const result = await gamedayCheck({ leagueId, userId: user.user_id, season, week });
      if (result.issues.length) {
        sections.push(renderGamedayMarkdown(result));
        signatures.push(result.signature);
      }
    } catch (err) {
      console.error(`League ${leagueId}: ${(err as Error).message}`);
    }
  }
  if (!sections.length) return;

  console.log(`# 🚨 Lineup alert — Week ${week}`);
  console.log("");
  console.log("Starters below won't play, and their games haven't kicked off yet. Fix these in Sleeper now:");
  console.log("");
  console.log(sections.join("\n\n"));
  console.log("");
  // The workflow uses this marker to skip alerts it has already posted.
  console.log(`<!-- gameday-sig:${hashSignature(signatures.join("||"))} -->`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
