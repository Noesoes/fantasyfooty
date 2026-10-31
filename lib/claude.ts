// Ask, answered by Claude. With your own Anthropic API key saved on this
// device, each question goes straight from your phone to Claude Haiku 5.5,
// along with tools that call the app's own models: your lineup, any week's
// matchup, players, news, start/sit, trade grades, waivers and the league.
// Claude asks for just what the question needs, so answers quote the same
// numbers as the rest of the app and stay cheap (a fraction of a cent a question).
//
// The key never leaves this device except to go to Anthropic: it isn't in the
// site's code, on GitHub or on any server of ours.

import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { analyzeLeague, type Analysis, type PlayerAnalysis } from "./advisor";
import { findPlayers } from "./ask";
import { answerNews, type NewsKind } from "./asknews";
import { compareStart } from "./explain";
import { confidenceWord, playerRange, powerRankings, startConfidence } from "./insights";
import { outcome, positionEdges, stacks, timeWindows } from "./matchup";
import { evaluatePickup } from "./pickup";
import { buildPlayoffOdds } from "./playoffs";
import { evaluateTrade } from "./trades";

export const CLAUDE_MODEL = "claude-haiku-5-5";
export const CLAUDE_MODEL_NAME = "Claude Haiku 5.5";

// --- The key, on this device only ----------------------------------------------

const KEY = "claude-api-key";
export const KEY_EVENT = "claude-key-changed";

export function getClaudeKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setClaudeKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(KEY_EVENT));
}

const client = (apiKey: string) =>
  // Safe here: the key is the user's own, typed into their own browser, and goes only to Anthropic.
  new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });

/** Check a key before saving it (listing models costs nothing). */
export async function checkClaudeKey(apiKey: string): Promise<"ok" | "invalid" | "offline"> {
  try {
    await client(apiKey).models.retrieve(CLAUDE_MODEL);
    return "ok";
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "invalid";
    return "offline";
  }
}

// --- What Claude sees about a player -------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => Math.round(n * 100);

function ownerOf(a: Analysis, p: PlayerAnalysis): string {
  if (a.roster.some((x) => x.id === p.id)) return "you";
  const t = a.otherTeams.find((t) => t.players.some((x) => x.id === p.id));
  return t ? t.teamName : "free agent";
}

function brief(a: Analysis, p: PlayerAnalysis | null | undefined) {
  if (!p) return null;
  const range = playerRange(p);
  return {
    name: p.name,
    pos: p.position,
    team: p.team ?? "FA",
    owner: ownerOf(a, p),
    week: a.week,
    projected: r1(p.weekScore),
    range: `${range.floor}-${range.ceiling}`,
    restOfSeasonPerGame: r1(p.rosValue),
    seasonAvg: p.seasonAvg,
    recentAvg: p.recentAvg,
    onBye: p.onBye || undefined,
    injury: p.injury ?? undefined,
    chanceToPlay: p.playChance != null ? pct(p.playChance) : undefined,
    opponent: p.game ? `${p.game.home ? "vs" : "@"} ${p.game.opponent}` : (p.matchup?.opponent ?? undefined),
    defenseVsPosition: p.matchup
      ? `${p.matchup.grade} (allows ${p.matchup.allowed} pts/g to ${p.position}s, league avg ${p.matchup.average}; rank ${p.matchup.rank} of ${p.matchup.teams}, 1 = fewest)`
      : undefined,
    vegas: p.game?.implied ? `team implied ${p.game.implied}, spread ${p.game.spread ?? "?"}` : undefined,
    usage: p.usage
      ? {
          touchesPerGame: r1(p.usage.touches),
          carryShare: pct(p.usage.carryShare),
          targetShare: pct(p.usage.targetShare),
          redZonePerGame: r1(p.usage.redZone),
        }
      : undefined,
    snapShare: p.snapShare != null ? pct(p.snapShare) : undefined,
    stash: p.stash ? `~${pct(p.stash.chance)}% chance ${p.stash.starter}'s job opens` : undefined,
    notes: p.notes.length ? p.notes.slice(0, 3) : undefined,
  };
}

const json = (x: unknown) => JSON.stringify(x, (_k, v) => (v === undefined || v === null ? undefined : v));

function lookup(a: Analysis, name: string): PlayerAnalysis[] {
  const mine = a.roster;
  const everyone = [...mine, ...a.freeAgentPool, ...a.otherTeams.flatMap((t) => t.players)];
  return findPlayers(name, everyone, mine);
}

// --- Tools -------------------------------------------------------------------------

export type Step = (label: string) => void;

function buildTools(a: Analysis, step: Step) {
  const weeks = new Map<number, Promise<Analysis>>([[a.week, Promise.resolve(a)]]);
  const analysisFor = (week: number) => {
    if (!weeks.has(week))
      weeks.set(
        week,
        analyzeLeague({ leagueId: a.league.league_id, userId: a.userId, season: a.season, week, prefs: a.prefs }),
      );
    return weeks.get(week)!;
  };

  return [
    betaTool({
      name: "get_my_team",
      description:
        "The user's lineup for the current week: current starters, the recommended lineup, the bench, lineup moves to make, projected totals and the opponent. Use for questions about the user's own team or lineup.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        step("Looking at your lineup…");
        return json({
          week: a.week,
          team: a.teamName,
          opponent: a.opponent?.teamName ?? "none (bye or playoffs)",
          currentLineup: a.currentLineup.map((s) => ({ slot: s.slot, player: brief(a, s.player) })),
          recommendedLineup: a.optimalLineup.map((s) => ({ slot: s.slot, player: s.player?.name ?? "EMPTY" })),
          currentProjected: r1(a.currentTotal),
          recommendedProjected: r1(a.optimalTotal),
          movesToMake: a.moves.map((m) => `${m.action} ${m.player.name}${m.reason ? `: ${m.reason}` : ""}`),
          bench: a.activeRoster
            .filter((p) => !a.optimalLineup.some((s) => s.player?.id === p.id))
            .map((p) => brief(a, p)),
          reserve: a.roster.filter((p) => !a.activeRoster.includes(p)).map((p) => p.name),
          warnings: a.warnings,
        });
      },
    }),
    betaTool({
      name: "get_matchup",
      description:
        "Head-to-head matchup analysis for a week: win chance, each side's floor / projection / upside, the gain from recommended moves, the edge at each lineup slot, points per kickoff window, stacks, and both starting lineups. Omit week for the current week; pass a week number for next week or any other week.",
      inputSchema: {
        type: "object",
        properties: { week: { type: "integer", minimum: 1, maximum: 18, description: "NFL week number" } },
        additionalProperties: false,
      },
      run: async ({ week }) => {
        const w = week ?? a.week;
        step(w === a.week ? "Checking this week's matchup…" : `Checking week ${w}'s matchup…`);
        const wa = await analysisFor(w);
        const o = outcome(wa);
        if (!o || !wa.opponent) return json({ week: w, note: "No opponent this week (bye or playoffs)." });
        return json({
          week: w,
          you: { ...o.me, sd: undefined, win: pct(o.me.win) + "%" },
          opponent: { ...o.opp, sd: undefined, win: pct(o.opp.win) + "%" },
          withRecommendedMoves: o.withMoves ? { projected: o.withMoves.mean, win: pct(o.withMoves.win) + "%" } : null,
          edgesBySlot: positionEdges(wa),
          kickoffWindows: timeWindows(wa).map((t) => ({ window: t.label, you: t.mine, them: t.theirs })),
          stacks: stacks(wa).stacks.map((s) => `${s.team}: ${s.players.map((p) => p.name).join(" + ")}`),
          yourStarters: wa.currentLineup.map((s) => ({ slot: s.slot, player: brief(wa, s.player) })),
          theirStarters: wa.opponent.starters.map((p) => brief(wa, p)),
        });
      },
    }),
    betaTool({
      name: "find_player",
      description:
        "Look up any NFL player by name: who owns him in this league, this week's projection and range, matchup, Vegas, usage, injury and rest-of-season value. For free agents, also the app's pickup verdict.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Player name as the user wrote it" } },
        required: ["name"],
        additionalProperties: false,
      },
      run: async ({ name }) => {
        step(`Looking up ${name}…`);
        const found = lookup(a, name);
        if (!found.length) return json({ error: `No player matching "${name}". Ask the user for the full name.` });
        return json(
          found.slice(0, 3).map((p) => {
            const fa = a.freeAgentPool.some((f) => f.id === p.id);
            const pick = fa ? evaluatePickup(a, p) : null;
            return {
              ...brief(a, p),
              pickup: pick
                ? { verdict: pick.verdict, headline: pick.headline, pros: pick.pros, cons: pick.cons }
                : undefined,
            };
          }),
        );
      },
    }),
    betaTool({
      name: "player_news",
      description:
        "Recent news headlines for a player from Sleeper's feed (RotoWire, RotoBaller, FantasyPros). topic 'trade' weighs trade rumors against reports he's staying; 'injury' gives injury status and headlines; 'latest' lists recent news.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          topic: { type: "string", enum: ["trade", "injury", "latest"] },
        },
        required: ["name", "topic"],
        additionalProperties: false,
      },
      run: async ({ name, topic }) => {
        step(`Reading ${name}'s news…`);
        const [p] = lookup(a, name);
        if (!p) return json({ error: `No player matching "${name}".` });
        const kind: NewsKind = topic === "latest" ? "news" : topic;
        const ans = await answerNews(a, p, kind);
        return json({
          player: p.name,
          summary: ans.title,
          details: ans.lines,
          headlines: (ans.sources ?? []).map(
            (s) => `${s.date} ${s.source}${s.stance ? ` [${s.stance}]` : ""}: ${s.title}`,
          ),
        });
      },
    }),
    betaTool({
      name: "compare_players",
      description:
        "Start/sit comparison of two players for the current week: who to start, the app's confidence, and the reasons each way.",
      inputSchema: {
        type: "object",
        properties: { first: { type: "string" }, second: { type: "string" } },
        required: ["first", "second"],
        additionalProperties: false,
      },
      run: async ({ first, second }) => {
        step("Comparing them…");
        const [x] = lookup(a, first);
        const [y] = lookup(a, second);
        if (!x || !y) return json({ error: `Couldn't find ${!x ? first : second}.` });
        const [pick, other] = x.weekScore >= y.weekScore ? [x, y] : [y, x];
        const conf = startConfidence(pick, other);
        const c = compareStart(pick, other);
        return json({
          start: pick.name,
          confidence: `${pct(conf)}% (${confidenceWord(conf)})`,
          headline: c.headline,
          reasonsFor: c.edges,
          reasonsAgainst: c.against,
          players: [brief(a, pick), brief(a, other)],
        });
      },
    }),
    betaTool({
      name: "grade_trade",
      description:
        "Grade a trade with one other team in the league: players the user gives and players they get. Returns the verdict, each lineup's change in points per week and a possible counter.",
      inputSchema: {
        type: "object",
        properties: {
          give: { type: "array", items: { type: "string" }, minItems: 1 },
          get: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["give", "get"],
        additionalProperties: false,
      },
      run: async ({ give, get }) => {
        step("Grading the trade…");
        const giveP = give.map((n) => lookup(a, n)[0]).filter((p): p is PlayerAnalysis => !!p);
        const getP = get.map((n) => lookup(a, n)[0]).filter((p): p is PlayerAnalysis => !!p);
        if (giveP.length !== give.length || getP.length !== get.length)
          return json({ error: "Couldn't find every player named." });
        if (!giveP.every((p) => a.roster.some((m) => m.id === p.id)))
          return json({ error: "Every player given must be on the user's roster." });
        const team = a.otherTeams.find((t) => getP.every((p) => t.players.some((x) => x.id === p.id)));
        if (!team) return json({ error: "The players to get must all be on one other team in this league." });
        const e = evaluateTrade(a, team.rosterId, giveP, getP);
        return json({
          with: team.teamName,
          verdict: e.verdict,
          summary: e.summary,
          yourLineupChangePerWeek: e.yourGain,
          theirLineupChangePerWeek: e.theirGain,
          positionRanks: e.ranks,
          counter: e.counter ? `Also ask for ${e.counter.add.name}` : undefined,
        });
      },
    }),
    betaTool({
      name: "waiver_options",
      description:
        "Waiver wire: the app's recommended claims (with who to drop and bids), the best free agents at a position, and the user's most droppable players.",
      inputSchema: {
        type: "object",
        properties: { position: { type: "string", enum: ["QB", "RB", "WR", "TE", "K", "DEF"] } },
        additionalProperties: false,
      },
      run: async ({ position }) => {
        step("Checking the waiver wire…");
        return json({
          recommendedClaims: a.waivers.map((w) => ({
            add: brief(a, w.player),
            drop: w.dropFor?.name,
            why: w.reason,
            bid: w.bid ?? undefined,
            likelyClaimedBy: w.likelyClaimedBy ?? undefined,
          })),
          bestAtPosition: position
            ? (a.waiversByPosition[position] ?? []).slice(0, 5).map((p) => brief(a, p))
            : undefined,
          droppable: a.drops.map((d) => `${d.player.name}: ${d.reason}`),
          waiverType: a.waiver.type,
        });
      },
    }),
    betaTool({
      name: "league_outlook",
      description:
        "The league picture: the user's playoff odds, record and projected wins, every team's record and playoff chance, and power rankings (rest-of-season strength).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        step("Simulating the rest of the season…");
        const odds = await buildPlayoffOdds(a);
        const power = powerRankings(a);
        return json({
          you: {
            record: `${odds.me.wins}-${odds.me.losses}${odds.me.ties ? `-${odds.me.ties}` : ""}`,
            playoffChance: `${Math.round(odds.me.playoffPct)}%`,
            projectedWins: r1(odds.me.projectedWins),
          },
          playoffSpots: odds.playoffTeams,
          remainingWeeks: odds.remainingWeeks,
          teams: odds.teams.map((t) => ({
            team: t.teamName,
            record: `${t.wins}-${t.losses}`,
            playoffChance: `${Math.round(t.playoffPct)}%`,
            powerRank: power.find((p) => p.rosterId === t.rosterId)?.rank,
            strengthPerWeek: power.find((p) => p.rosterId === t.rosterId)?.strength,
          })),
        });
      },
    }),
  ];
}

// --- Asking ---------------------------------------------------------------------------

const INSTRUCTIONS = `You are Prime Time, a fantasy football advisor inside a Sleeper companion app. You answer one manager's questions about their own Sleeper league.

How to answer:
- Get facts from the tools. Never invent projections, stats, injuries, news or league details; if a tool doesn't have it, say so.
- Use the tools that fit the question, and only those. "Next week" means the current week + 1.
- Lead with the answer in one short sentence, then 2-4 short bullet points with the numbers that back it up. Keep it under about 120 words: it's read on a phone.
- Formatting: plain text, "- " for bullets, **bold** for player names or the verdict. No headings, tables or emoji.
- Projections are expected fantasy points for the week; "range" is a realistic floor-ceiling.
- If the question isn't about fantasy football or this league, say briefly that you only help with their fantasy team.`;

export interface ClaudeTurn {
  question: string;
  answer: string;
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "limit" | "billing" | "offline" | "refusal" | "other",
  ) {
    super(message);
  }
}

/** Ask Claude about the user's team. `history` is earlier questions in this conversation (for follow-ups). */
export async function askClaude(
  a: Analysis,
  question: string,
  history: ClaudeTurn[],
  step: Step,
  apiKey: string,
): Promise<string> {
  const context = `League: ${a.league.name} (${a.scoringLabel}${a.bestBall ? ", best ball" : ""}). The user's team: ${a.teamName}. Current NFL week: ${a.week} of the ${a.season} season. Today: ${new Date().toDateString()}.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.answer },
    ]),
    { role: "user", content: question },
  ];
  try {
    const final = await client(apiKey)
      .beta.messages.toolRunner({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        output_config: { effort: "medium" },
        // Stable instructions first (cached), then this league's details.
        system: [
          { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
          { type: "text", text: context },
        ],
        tools: buildTools(a, step),
        messages,
        max_iterations: 6,
      })
      .runUntilDone();
    if (final.stop_reason === "refusal")
      throw new ClaudeError("Claude declined to answer that one. Try rephrasing.", "refusal");
    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new ClaudeError("Claude didn't come back with an answer. Try again.", "other");
    return text;
  } catch (e) {
    if (e instanceof ClaudeError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new ClaudeError("Your Claude API key was rejected. Check it in the menu.", "auth");
    if (e instanceof Anthropic.RateLimitError)
      throw new ClaudeError("Claude is rate limiting your key. Wait a minute and try again.", "limit");
    if (e instanceof Anthropic.BadRequestError && /credit|billing|balance/i.test(e.message))
      throw new ClaudeError("Your Anthropic account is out of credit. Add some in the Console.", "billing");
    if (e instanceof Anthropic.APIConnectionError)
      throw new ClaudeError("Couldn't reach Claude. Check your connection.", "offline");
    if (e instanceof Anthropic.APIError) throw new ClaudeError(`Claude error (${e.status}). Try again.`, "other");
    throw e;
  }
}
