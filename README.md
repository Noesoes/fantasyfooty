# Sleeper Lineup Advisor

**Live site: https://noesoes.github.io/fantasyfooty/**

Weekly fantasy football advice for your [Sleeper](https://sleeper.com) team:

- **Start / sit**: builds your best lineup for the week and tells you who to swap in and out (byes, injuries, matchups).
- **Waiver wire**: free agents worth claiming, each paired with the bench player to drop.
- **Drop candidates**: your most expendable bench players.
- **Best available**: top free agents at every position.

It runs two ways:

1. **Web app**: enter your Sleeper username and get a game plan for each of your leagues: a to-do checklist, your projected score vs. this week's opponent, a recommended lineup, waiver claims with who to drop, and your full roster with snap shares. It's a static site with no backend; your browser talks to Sleeper's public API directly.
2. **Weekly report**: a scheduled GitHub Action runs every **Tuesday morning** (after Monday Night Football, before Sleeper's default Wednesday waiver run) and posts next week's recommendations as a GitHub issue. GitHub emails you when it's created.

### Install it on your phone

No App Store needed. Open the site on your phone, then:
- **iPhone (Safari):** tap Share → **Add to Home Screen** → Add. The **Get app** button at the top shows these steps.
- **Android (Chrome):** tap **Get app** (or ⋮ → **Install app**).

It gets its own home-screen icon and opens full screen like a regular app. A service worker keeps the app's own files on the phone so it opens instantly, even on bad stadium Wi-Fi. Sleeper and ESPN data is never cached and always loads fresh. Updates arrive automatically whenever the site is redeployed.

### Finding your way around

Everything is grouped into four sections, each with a few tabs:

| Section | Tabs |
| --- | --- |
| **Home** | Plan (your matchup, the moves to make this week, heads-up alerts) · Lineup · Injuries · Opponent (plus **Live** on game days) |
| **Moves** | Waivers · Trades |
| **Games** | Every game this week, with a game center for each |
| **Team** | Roster · Playoffs · Schedule (bye weeks and week-by-week projections) · Track record |

**Look:** "Glass": frosted, translucent cards over colored light, big rounded numbers, and a floating tab bar (light and dark). Home opens with widgets for your win chance and projected score, then the moves to make, heads-up alerts, and Waivers and Injuries widgets. A player's sheet is tinted with his team's color and shows usage as rings.

**What changed:** the app keeps a small snapshot of your roster and matchup per league and week on your device. When you come back, Home lists what's different (injury status, chance to play, projections that moved 2+ pts, players added or dropped, win chance, stash odds) until you tap *Got it*.

**Your highlights:** Home shows a row of ESPN highlight clips featuring your players from this week's games (newest first, playable in the app), and each player's sheet has his own clips. Clips are matched by name within that player's game, rechecked every two minutes while one of his games is on, and stay up on ESPN for about two days.

**Start X or Y?** (Lineup tab): pick any two of your players, or one of yours and a free agent, for the call plus the edges on each side and every factor side by side.

**Waivers tab extras:** a *Last waiver run* recap (each of your claims: won, or who beat you and by how much in FAAB; the league's biggest adds; your priority or budget now) and *Stash candidates*: free agents next in line behind a starter who's hurt or in trade rumors (RBs, TEs and receivers), each with a one-tap pickup check.

**Player sheet:** tap any player (Roster, Lineup, the plan, waivers, trades) for this week's call (start, bench or out) and why, the defense he faces (where it ranks against his position, fantasy points it allows per game vs. the league average, and the Vegas line and weather), his workload (snap share, share of team carries and targets, touches and red-zone looks per game vs. his season average), every factor behind the projection, and switches for your rules.

On phones the sections sit in a bottom bar. Badges show only when there's something to act on: waiver targets, or starters who are out or doubtful. The open tab is kept in the URL (e.g. `#playoffs`), so refreshing or reopening the app keeps your place.

## How the recommendations work

Every player gets two scores.

**This week's expected points** (`weekScore`), used for start/sit:

- Sleeper's weekly projection, scored with **your league's own scoring settings**
- Blended 80/20 with recent form (last 3 games)
- Nudged up or down by the **opponent's points allowed to that position** this season (shrunk toward neutral early in the season, when samples are small)
- **Workload trend (RB/WR/TE):** touches per game, share of the team's carries and targets, and red-zone looks over the last 3 games, from Sleeper's weekly stats. A role that's growing or shrinking against the season average moves the projection up to ±8% (projections lag behind usage changes)
- **QB depth chart:** Sleeper only projects pass attempts for the QB it expects to start, so backups score 0, and a usual starter who isn't projected to start (e.g. Lamar with Huntley projected to start) is flagged
- Zeroed for **byes** and players ruled Out/IR/Suspended. Questionable and Doubtful players are scaled by their **chance to play** from the injury model (designation + this week's practice reports + news, the same estimate as the Injuries tab), so a questionable player who hasn't practiced counts for ~30% of his projection and one with full practices ~90%. If the news can't be loaded, the flat fallback is ×0.85 / ×0.3. Starters under 60% to play get a warning in the Game plan.
- Every start/sit call in the Game plan has a **Why this call?** panel: the biggest edges for the player to start over the one being replaced (health, defense faced, volume, target/carry share, red-zone work, role trend, implied team total, form, projection), what's in the other player's favor, and a side-by-side table of every factor colored good/bad.
- **Vegas and weather:** a few percent up or down for the team's implied total (half the over/under ± half the spread, vs. a ~22.5-pt average; for defenses, the opponent's), a small game-script nudge for RBs who are big favorites or underdogs, and down for passing games and kickers in snow, rain, wind or bitter cold (outdoor games only). Each player shows their team's implied total and a weather icon; tap a player for his game's line, over/under and forecast. Lines and forecasts come from ESPN's scoreboard (snapshotted by the deploy workflow for the browser).

**Rest-of-season value** (`rosValue`), used for drops and waivers:

- Season average and recent form, each **shrunk toward the projection when the sample is small**, so one spot start doesn't read as "27 pts/game"
- Role adjustments: backup QBs ×0.25, injury fill-in starters ×0.6, part-time players (<35% of snaps) ×0.85
- Discounted for IR/Out/suspension, with a small bump for players trending in adds across Sleeper
- Compared as **value over replacement** (vs. the ~4th-best free agent at the same position), so QBs don't crowd out every other position in 1-QB leagues
- **Stash value** for your backup RBs, TEs and QBs: the chance the starter ahead of them leaves or gets hurt, times what they'd gain by taking over. The chance starts at a base injury rate and goes up for trade rumors about the starter (before the trade deadline, counted by how many days they've been reported), the starter's injury status, and recent articles calling the backup a stash, handcuff or next man up. A growing workload is listed as supporting evidence. Stash value counts toward keeping a player, so the advisor won't suggest dropping, say, the handcuff to a starter in trade rumors for a marginal pickup. These players show in a *Hold these stashes* card on the Waivers tab
- **Your rules:** tell the advisor what you've decided and it respects it. Tap *Not trading* on a trade idea or *Keep* on a suggested drop, or use the *Your rules* card (Roster and Trades tabs): don't suggest trading him, don't suggest dropping him, untouchable, or *he's my backup for…* (never traded or dropped, labeled as your backup everywhere). Rules are saved per league on your device, and the trade grader warns if you build a trade around a protected player
- **K/DEF streams** never drop a kicker or defense who's averaging as much as the streamer this season (kickers swing week to week, so it's the season average that counts). If your good kicker is on bye, the advisor tells you to hold him; you only carry two for a week if a bench spot is below waiver-level value
- **Waiver competition:** a team ahead of you is only expected to claim a player who'd start for them on their rest-of-season lineup, or fill a hole they can't cover this week. A team with three good QBs isn't expected to chase another QB just because one of theirs is on bye. Each projected claim says why
- A free agent gets priority if they'd crack your lineup, especially when one of your starters is out this week
- Backup QBs and players Sleeper doesn't expect to play are never recommended as pickups. QB claims are capped at your number of QB/superflex spots

**Player check (Waivers tab):** search any free agent in your league by name or team (or filter by position), or tap a player in *Best available*. The check gives a verdict (**Pick up**, **Stream** for a one-week fill-in, **Stash** for injury or role upside, or **Pass**) plus the reasons for and against. It weighs:
- whether he'd start for you this week, and over whom
- rest-of-season value vs. the player you'd have to drop, and vs. the rest of the waiver wire at his position
- his role (backup QB, fill-in starter, snap share), recent form and injury status
- this week's matchup and Vegas total
- your depth at the position
- how many Sleeper managers are adding him, and whether teams ahead of you on waivers want him

It also names the drop and, in FAAB leagues, a suggested bid. Search covers every unrostered player Sleeper projects, including injured players and backups.

**Fill a position (Waivers tab):** pick QB, RB, WR, TE, Flex, K or DEF and get the available players ranked by expected points this week. The ranking combines projection, matchup, Vegas total and chance to play, with a small boost for players who see more snaps. The top pick is called out with its reasons and the starter he'd replace, and tapping anyone opens the full Player check.

**Waiver order:** shows your waiver priority (rolling or reverse standings) or FAAB budget left. Every team that claims before you (or has more FAAB to spend) is scored with the same model to guess which free agents they'd want. The app then simulates the waiver run in order, marks each of your claims as *likely gone*, *contested* or *likely available*, and suggests backup targets that are likely to still be there at your turn.

**FAAB bids:** in FAAB leagues every other team is modeled too. A player's worth is a share of your remaining budget based on how much they'd add over your lineup (≈5 pts/game ≈ a quarter of your budget, capped at 35%). Each interested team's likely bid is estimated the same way from their own need and budget. The suggestion bids just over the likeliest competitor without going past 1.6× the player's worth to you, and bids low when nobody else needs the player.

**Trade finder (Trades tab):** values every team by its best rest-of-season lineup (plus a little bench depth), tries every 1-for-1, 2-for-1 and 1-for-2 between your top players and each team's, and keeps trades that improve *both* lineups and are roughly even on value over replacement (so QBs are worth more in superflex). It also ranks your starters at each position against the league, to show what you can trade from and what you need.

**Trade evaluator (Trades tab):** got an offer? Pick the other team and the players on each side, and the app grades it **Accept**, **Lean accept**, **Counter** or **Decline**. The grade combines how much your best rest-of-season lineup changes, how fair the deal is on value over replacement, and how your positional ranks move. When a deal is close, it suggests a counter: the cheapest extra player from their roster that makes the deal worth it for you without gutting their lineup.

**Season planner (Season tab):** pulls Sleeper's projection for every remaining week for each of your players, builds your best lineup each week, and flags weeks where byes leave you with no one to start (holes) or no backup (thin), so you can plan pickups a week early. It also shows each player's projected points across your league's fantasy playoff weeks.

**Playoff odds (Playoffs tab):** simulates the rest of the regular season 10,000 times using the current standings, Sleeper's real remaining schedule, and each team's strength. Strength is its best lineup's projected points, blended with its actual points per week as the season goes on, and allows for the chance that our read on a team is off. If this week's games are underway, each simulation starts from the live scores. Seeding follows your league's settings: number of playoff teams, ties broken on points for, division winners first, and an extra weekly game vs. the league median. It shows your playoff and first-round-bye chances, your most likely seed, every team's odds, the remaining games with your playoff chances if you win vs. lose (the biggest swings are flagged as must-wins), and your chances at each final win total.

**Track record (Record tab):** replays every completed week from Sleeper's matchup history (each week's roster, starters and actual points). It compares the lineup you started, the lineup the advisor would have picked from that week's pre-game projections, and the best lineup in hindsight. It also grades each start/sit call where the advisor disagreed with you. The weekly report opens with last week's result. Nothing needs to be stored, so it works for any league.

**Live mode (Live tab):** once the week's games kick off, the scoreboard switches to live scoring and a Live tab opens. It shows both lineups with real points from Sleeper, each player's game status and clock, and "still to come" points (projection × share of the game left, using ESPN's game clock). It also shows a live win probability (assuming player scores vary by about ±60% of projection) and late-swap tips: a bench player or free agent whose game hasn't started and would beat a starter who won't play or is projected lower. It refreshes every minute while games are on.

**Opponent scouting (Scout tab):** a report on this week's opponent:
- **Tale of the tape:** your best lineup against the lineup they've set, slot by slot, with who has the edge. If they haven't set their best lineup yet, it says how much better it could be.
- **Weak spots:** starters who are out, on bye, questionable or not projected, plus empty slots.
- **Moves to expect:** bench players they should swap in and free agents who'd upgrade them.
- **Manager tendencies:** points left on their bench per week, zero-point starts, pickups, trades and FAAB spent, from Sleeper's weekly results and transaction log. Also lists earlier meetings this season.
- **Intel:** a few true, slightly pointed stats for the group chat. The weekly report includes them too.

**Football field (Games tab):** every live game card draws the field in team colors and charts the current drive, the way a TV drive chart does. Every snap is an arrow from where it started to where it ended: runs and catches, incompletions as a dashed ring, turnovers as an ✕, kicks as an arc, and penalties in amber. It also shows the line of scrimmage, the yellow line to gain and the ball. Snaps by your players (or your opponent's) are labeled with what they were worth under your league's scoring. Plays come from ESPN's live play feed. Players are matched by ESPN id from Sleeper's player database, or by name in the game's box score for players Sleeper hasn't mapped.

**Game center (Games tab):** tap any game, or any player in it, to open its game center. Swipe sideways (or use the arrows / arrow keys) to move between games. ☆ pins a game to the top of the list on this device. Filter the list by Live / Upcoming / Final.

- **Your stake:** each game card shows what that game means for your fantasy matchup: your starters' points there and what's still to come, your opponent's, the net, and how much a big game or a dud from those players would move your win chance (same model as Live mode).
- **Overview:** your stake, a win-probability chart you can drag across to see who was favored at any point (or ESPN's matchup predictor before kickoff), highlight clips that play right in the app (tagged when they feature your or your opponent's players), score by quarter, the scoring summary and team leaders. Before kickoff it shows the spread, over/under and weather instead.
- **Box:** the full box score for both teams (passing, rushing, receiving, kicking, defense), with your and your opponent's players marked.
- **Stats:** side-by-side bars for yards, passing, rushing, first downs, 3rd down, red zone, turnovers, penalties and time of possession.
- **Drives:** the current drive chart, then every drive as a bar on a mini field from where it started to where it ended, colored by result. Tap a drive for plays, yards and time, or filter to one team.
- **Players:** your players (and your opponent's starters) in that game, with snap counts (once Sleeper posts them; the recent snap share until then) and their highlight clips. Tap one to see where their fantasy points came from under your league's scoring.

It refreshes every 30 seconds while the game is live. Data comes from ESPN's game summary.

**Injury report (Injuries tab):** for everyone on your roster and your opponent's starters, it estimates the chance each player plays this week and labels it Playing, Likely, Toss-up, Unlikely or Out. The estimate combines:
- the official designation (Sleeper and ESPN's league-wide injury report)
- this week's practice participation (DNP / limited / full), parsed sentence by sentence from Sleeper's player news feed and ESPN's notes, ignoring recaps of earlier weeks and hedged "if he practices…" sentences
- reports that a player was ruled out or is expected to play
- whether Sleeper still projects the player, and QB depth charts

Each card shows the practice trend, ESPN's estimated return date, and a backup plan for at-risk starters (a bench player, or a free agent if you have none).

Each card also has a **Latest update** box: the newest news item about the injury, with a link to read it. Headlines about the injury come first; stories that only mention it in passing (dynasty outlooks, waiver columns) come after. FantasyPros and RotoBaller items link straight to the article. RotoWire blurbs come without a URL, so they link to the player's RotoWire news page, which carries the same update (the deploy workflow snapshots the RotoWire IDs into `player-links.json`). If nothing recent turns up, the box falls back to the latest linked story, with its age shown, or as a last resort a news search. The weekly report links the same articles. The weekly report includes the same table. The deploy workflow snapshots ESPN's report into `injuries.json` every 3 hours, so the browser reads it from the site's own address.

The lineup optimizer fills the most restrictive slots first (QB, K, DEF, then FLEX, then SUPER_FLEX). It respects your league's `roster_positions`, skips players on IR/taxi, and won't suggest dropping below one QB per QB/superflex slot or your only player at a required position. K and DEF are treated as weekly streamers.

IDP slots aren't modeled: whoever is in them now stays put.

## Setup

### Web app on GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Push to `main` (or run the *Deploy to GitHub Pages* workflow). The site is published at `https://noesoes.github.io/fantasyfooty/`.

### Weekly report

1. **Settings → Secrets and variables → Actions → Variables → New repository variable**
   - `SLEEPER_USERNAME`: your Sleeper username (required)
   - `SLEEPER_LEAGUE_ID`: optional, one or more comma-separated league IDs. Defaults to every in-season league you're in.
2. Make sure you're watching the repo (the default for repos you own), so the issue notification reaches your email.
3. Optional: try it now from **Actions → Weekly lineup report → Run workflow**.

To change when it runs, edit the `cron` line in `.github/workflows/weekly-report.yml` (times are UTC).

### Gameday alerts

`.github/workflows/gameday-alert.yml` runs shortly after NFL inactives are announced (Thursday night, Sunday 1pm / 4pm / night, Monday night). If any of your starters is ruled out, on bye, not starting at QB, doubtful, or has no projection, **and their game hasn't kicked off**, it opens an issue labeled `gameday` with the best bench (or free-agent) replacement. GitHub emails you when it's created. It stays quiet when everything is fine, posts each distinct alert only once, and skips best-ball leagues. It uses the same `SLEEPER_USERNAME` / `SLEEPER_LEAGUE_ID` variables. Run it locally with `SLEEPER_USERNAME=you npm run gameday`.

## Local development

```bash
npm install
npm run dev                                   # web app at http://localhost:3000
SLEEPER_USERNAME=yourname npm run report      # print the weekly report as Markdown
WEEK=6 SLEEPER_USERNAME=yourname npm run report
```

## Privacy & security

The app is a static site with no backend, accounts or database, so there's no server of ours to attack, no user data we hold, and no passwords or API keys anywhere (none in the code or the repo history either).

- **Data:** your browser talks to Sleeper and ESPN directly and reads only public league data. Your username, rules, checklists, pinned games, "what changed" snapshots and a small error log are kept in this browser only. *Privacy & data* in the league/settings sheet explains this and has **Clear my data on this device**.
- **Untrusted content:** React escapes everything rendered; links from news and video feeds are used only if they're plain `https://` URLs; saved data is validated when it's loaded, so damaged data can't crash the app.
- **Errors:** a crash screen (with *Try again*, *Reload* and *Copy error details*) replaces a blank page, and errors are logged on the device only. Nothing is sent anywhere unless you copy and share it.
- **Supply chain:** dependencies are pinned in `package-lock.json` (`npm audit`: 0 vulnerabilities), GitHub Actions are pinned to commit SHAs, Dependabot opens weekly update PRs, and every PR runs lint, type checks and a build (`checks.yml`). The deploy runs the same checks before publishing.

If the app ever gets accounts or a backend (e.g. a native iPhone app with synced rules), that's when server-side items (auth and MFA, rate limiting, database security and backups, secrets management, server logging) come into play.

## Data sources

Everything comes from Sleeper's public, keyless API:

| Data | Endpoint |
| --- | --- |
| User, leagues, rosters, scoring | `api.sleeper.app/v1/...` (documented) |
| Trending adds (72h) | `/v1/players/nfl/trending/add` |
| Weekly projections + opponents + injury status | `/projections/nfl/{season}/{week}` |
| Weekly and season stats, fantasy points allowed by each defense | `/stats/nfl/{season}[/{week}]` |

The `/projections` and `/stats` endpoints are undocumented: they're what the Sleeper app itself uses. They've been stable for years but could change without notice.

## Project layout

```
lib/sleeper.ts             Sleeper API client + "which week is upcoming" logic
lib/advisor.ts             scoring, lineup optimizer, drop & waiver logic
lib/prefs.ts               your rules (don't trade / don't drop / backup for), saved per league
lib/teamcolors.ts          NFL team colors for team-tinted player sheets
lib/recap.ts               last waiver run recap from league transactions
lib/changes.ts             'what changed since you last looked' snapshots
lib/clips.ts               highlight clips of your players from this week's games
lib/errorlog.ts            on-device error log, crash report text, clear-my-data
lib/stash.ts               stash value for backups (trade rumors, injuries, handcuff news)
lib/explain.ts             factor breakdown and start-over-sit comparison behind each Game plan call
lib/report.ts              Markdown rendering for the weekly issue
lib/trades.ts              trade finder, offer evaluator, positional strength
lib/planner.ts             rest-of-season projections, byes and playoff weeks
lib/backtest.ts            track record from past weeks' actual scores
lib/gameday.ts             pre-kickoff inactive check
lib/injuries.ts            injury report and chance-to-play estimates (also used to scale injured players' projections)
lib/status.ts              injury designations that mean a player won't play
lib/scoreboard.ts          NFL games: clock, score, Vegas lines, weather, and the start/sit nudges from them
lib/live.ts                live scoring, win probability, late swaps
lib/playbyplay.ts          drive charts for live games (ESPN play feed), your players' snaps labeled
app/field.tsx              football field drive chart
app/games.tsx              Games tab: live scoreboard with your players' stat lines
app/gamesheet.tsx          game center sheet: win probability, team stats, drives, points breakdown, swipe between games
app/gameparts.tsx          your stake in a game, highlight clips, full box score
lib/gamedetail.ts          ESPN game summary parsing (incl. highlights, box score) and fantasy points breakdown
lib/url.ts                 https-only guard for links from outside feeds
lib/gamecenter.ts          every game this week + your players' live stats
lib/pickup.ts              should-I-pick-him-up verdicts and best-available-by-position rankings
app/playercheck.tsx        Player check search and verdict card
lib/playoffs.ts            playoff odds simulation
lib/scouting.ts            opponent scouting report
scripts/fetch-snapshots.mjs ESPN injury + scoreboard snapshots used by the deploy workflow
scripts/weekly-report.ts   CLI entry point used by the weekly GitHub Action
scripts/gameday-alert.ts   CLI entry point used by the gameday GitHub Action
app/page.tsx               landing page, league/week controls
app/results.tsx            sections and tabs: This Week (live, game plan, games, lineup, injuries, opponent), Moves (waivers, trades), Season (playoffs, schedule), My Team (roster, track record)
app/ui.tsx                 shared UI pieces
app/install.tsx            "Get app" install button / iPhone instructions
app/manifest.ts            web app manifest (name, icons, colors)
public/sw.js               service worker: offline-friendly app shell
```
