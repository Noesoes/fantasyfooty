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

## How the recommendations work

Every player gets two scores.

**This week's expected points** (`weekScore`), used for start/sit:

- Sleeper's weekly projection, scored with **your league's own scoring settings**
- Blended 80/20 with recent form (last 3 games)
- Nudged up or down by the **opponent's points allowed to that position** this season (shrunk toward neutral early in the season, when samples are small)
- **QB depth chart:** Sleeper only projects pass attempts for the QB it expects to start, so backups score 0, and a usual starter who isn't projected to start (e.g. Lamar with Huntley projected to start) is flagged
- Zeroed for **byes** and players ruled Out/IR/Suspended. Questionable ×0.85, Doubtful ×0.3

**Rest-of-season value** (`rosValue`), used for drops and waivers:

- Season average and recent form, each **shrunk toward the projection when the sample is small**, so one spot start doesn't read as "27 pts/game"
- Role adjustments: backup QBs ×0.25, injury fill-in starters ×0.6, part-time players (<35% of snaps) ×0.85
- Discounted for IR/Out/suspension, with a small bump for players trending in adds across Sleeper
- Compared as **value over replacement** (vs. the ~4th-best free agent at the same position), so QBs don't crowd out every other position in 1-QB leagues
- A free agent gets priority if they'd crack your lineup, especially when one of your starters is out this week
- Backup QBs and players Sleeper doesn't expect to play are never recommended as pickups. QB claims are capped at your number of QB/superflex spots

**Waiver order:** shows your waiver priority (rolling or reverse standings) or FAAB budget left. Every team that claims before you (or has more FAAB to spend) is scored with the same model to guess which free agents they'd want. The app then simulates the waiver run in order, marks each of your claims as *likely gone*, *contested* or *likely available*, and suggests backup targets that are likely to still be there at your turn.

**FAAB bids:** in FAAB leagues every other team is modeled too. A player's worth is a share of your remaining budget based on how much they'd add over your lineup (≈5 pts/game ≈ a quarter of your budget, capped at 35%). Each interested team's likely bid is estimated the same way from their own need and budget. The suggestion bids just over the likeliest competitor without going past 1.6× the player's worth to you, and bids low when nobody else needs the player.

**Trade finder (Trades tab):** values every team by its best rest-of-season lineup (plus a little bench depth), tries every 1-for-1, 2-for-1 and 1-for-2 between your top players and each team's, and keeps trades that improve *both* lineups and are roughly even on value over replacement (so QBs are worth more in superflex). It also ranks your starters at each position against the league, to show what you can trade from and what you need.

**Season planner (Season tab):** pulls Sleeper's projection for every remaining week for each of your players, builds your best lineup each week, and flags weeks where byes leave you with no one to start (holes) or no backup (thin), so you can plan pickups a week early. It also shows each player's projected points across your league's fantasy playoff weeks.

**Track record (Record tab):** replays every completed week from Sleeper's matchup history (each week's roster, starters and actual points). It compares the lineup you started, the lineup the advisor would have picked from that week's pre-game projections, and the best lineup in hindsight. It also grades each start/sit call where the advisor disagreed with you. The weekly report opens with last week's result. Nothing needs to be stored, so it works for any league.

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
lib/report.ts              Markdown rendering for the weekly issue
lib/trades.ts              trade finder and positional strength
lib/planner.ts             rest-of-season projections, byes and playoff weeks
lib/backtest.ts            track record from past weeks' actual scores
lib/gameday.ts             pre-kickoff inactive check
scripts/weekly-report.ts   CLI entry point used by the weekly GitHub Action
scripts/gameday-alert.ts   CLI entry point used by the gameday GitHub Action
app/page.tsx               landing page, league/week controls
app/results.tsx            the tabs (game plan, lineup, waivers, trades, season, record, roster)
app/ui.tsx                 shared UI pieces
```
