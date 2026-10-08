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
scripts/weekly-report.ts   CLI entry point used by the GitHub Action
app/page.tsx               the web UI
```
