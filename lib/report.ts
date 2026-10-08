// Renders an Analysis as Markdown, for the weekly GitHub issue / job summary.

import { describeMatchup, type Analysis, type PlayerAnalysis } from "./advisor";
import { findTrades } from "./trades";

function tag(p: PlayerAnalysis): string {
  const bits = [`${p.position}${p.team ? `, ${p.team}` : ""}`];
  if (p.injury) bits.push(p.injury);
  if (p.onBye) bits.push("BYE");
  return `**${p.name}** (${bits.join(", ")})`;
}

export function renderMarkdown(a: Analysis): string {
  const lines: string[] = [];
  lines.push(`# Week ${a.week} game plan — ${a.teamName}`);
  lines.push("");
  lines.push(`_${a.league.name} · ${a.scoringLabel} · ${a.season} season_`);
  lines.push("");
  if (a.opponent) {
    lines.push(
      `**Matchup:** you (${a.optimalTotal} projected with these moves) vs ${a.opponent.teamName} (${a.opponent.projected} projected)`,
    );
    lines.push("");
  }

  lines.push("## Start / sit");
  if (a.warnings.length) {
    for (const w of a.warnings) lines.push(`- ⚠️ ${w}`);
    lines.push("");
  }
  if (a.moves.length === 0) {
    lines.push(`Your current lineup is already optimal (${a.currentTotal} projected pts). No changes needed.`);
  } else {
    lines.push(
      `Making these changes takes your projection from **${a.currentTotal}** to **${a.optimalTotal}** pts.`,
    );
    lines.push("");
    for (const m of a.moves) {
      const head = m.action === "start" ? `**Start** ${tag(m.player)} at ${m.slot}` : `**Bench** ${tag(m.player)}`;
      lines.push(`- ${head} — ${m.reason}`);
    }
  }
  lines.push("");

  lines.push("### Recommended lineup");
  lines.push("| Slot | Player | Proj | Matchup | Notes |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const s of a.optimalLineup) {
    const p = s.player;
    if (!p) {
      lines.push(`| ${s.slot} | _empty_ | | | |`);
      continue;
    }
    const matchup = p.matchup ? describeMatchup(p.matchup, p.position) : p.onBye ? "BYE" : "";
    lines.push(`| ${s.slot} | ${p.name} (${p.team ?? "FA"}) | ${p.weekScore} | ${matchup} | ${p.notes.join("; ")} |`);
  }
  lines.push("");

  lines.push("## Waiver wire");
  lines.push(waiverLine(a));
  lines.push("");
  if (a.waivers.length === 0) {
    lines.push("No free agent is clearly better than what you already have.");
  } else {
    for (const w of a.waivers) {
      const drop = w.dropFor ? `, drop ${tag(w.dropFor)}` : "";
      const contested = w.bid
        ? ""
        : w.likelyClaimedBy
        ? ` 🚫 Likely claimed before your turn by ${w.likelyClaimedBy}.`
        : w.contestedBy.length
          ? ` ⚠️ Also wanted by ${w.contestedBy.slice(0, 3).join(", ")}${w.contestedBy.length > 3 ? ` +${w.contestedBy.length - 3}` : ""}.`
          : " ✅ Likely available at your turn.";
      const bid = w.bid ? ` ${bidText(w.bid)}` : "";
      lines.push(`- **Add** ${tag(w.player)}${drop} — ${w.reason}${bid}${contested}`);
    }
  }
  lines.push("");

  if (a.backupTargets.length) {
    lines.push(
      `**Backup targets likely still there at your turn:** ${a.backupTargets
        .map((p) => `${p.name} (${p.position}, ${p.team})`)
        .join(", ")}`,
    );
    lines.push("");
  }
  const rivals = a.rivals.filter((r) => r.targets.length);
  if (rivals.length) {
    lines.push(a.waiver.type === "faab" ? "### Teams with more FAAB than you" : "### Teams ahead of you on waivers");
    lines.push("| Team | Priority | Projected claim | Also interested in |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of rivals) {
      const prio = a.waiver.type === "faab" ? `$${r.budgetLeft} left` : `#${r.waiverPosition}`;
      const others = r.targets.filter((t) => t.player.id !== r.projectedClaim?.id).slice(0, 2);
      lines.push(
        `| ${r.teamName} | ${prio} | ${r.projectedClaim?.name ?? "—"} | ${others.map((t) => t.player.name).join(", ")} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Drop candidates");
  if (a.drops.length === 0) {
    lines.push("Nobody on your bench is an obvious cut.");
  } else {
    for (const d of a.drops) lines.push(`- ${tag(d.player)} — ${d.reason}`);
  }
  lines.push("");

  const trades = findTrades(a);
  lines.push("## Trade ideas");
  if (trades.strengths.length) {
    lines.push(
      trades.strengths.map((st) => `${st.position} #${st.rank}/${st.teams}`).join(" · ") + " _(your starters vs. the league)_",
    );
    lines.push("");
  }
  if (trades.ideas.length === 0) lines.push("No trade clearly helps both sides right now.");
  for (const t of trades.ideas.slice(0, 3)) {
    lines.push(`- **With ${t.teamName}:** give ${t.give.map(tag).join(" + ")}, get ${t.get.map(tag).join(" + ")} — ${t.reason}`);
  }
  lines.push("");

  lines.push("<details><summary>Best available by position</summary>");
  lines.push("");
  for (const [pos, players] of Object.entries(a.waiversByPosition)) {
    if (!players.length) continue;
    lines.push(
      `- **${pos}:** ${players
        .slice(0, 5)
        .map((p) => `${p.name} (${p.team}, ${p.weekScore} proj)`)
        .join(", ")}`,
    );
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push(
    "_Projections and stats from Sleeper. Re-check injury news before kickoff — statuses change late in the week._",
  );
  return lines.join("\n");
}

export function waiverLine(a: Analysis): string {
  const w = a.waiver;
  const ahead = a.rivals.length;
  if (w.type === "faab") {
    return `**FAAB:** $${w.budgetLeft} of $${w.budget} left · ${ahead === 0 ? "nobody has more to spend" : `${ahead} team${ahead === 1 ? "" : "s"} can outbid you`}${w.position ? ` · tiebreak #${w.position}` : ""}`;
  }
  const kind = w.type === "reverse" ? "reverse standings" : "rolling";
  return `**Waiver priority:** #${w.position ?? "?"} of ${w.teams} (${kind})${ahead ? ` · ${ahead} team${ahead === 1 ? "" : "s"} claim before you` : " · you claim first"}`;
}

export function bidText(b: NonNullable<Analysis["waivers"][number]["bid"]>): string {
  const top = b.competitors[0];
  if (!top) return `**Bid $${b.suggested}** — little competition expected, so no need to overpay.`;
  if (b.toWin !== null && b.toWin > b.ceiling) {
    return `**Bid $${b.suggested}** (your max) — ${top.teamName} needs this player more and may bid ~$${top.estimate}, so you may lose this one. Don't chase past $${b.ceiling}.`;
  }
  return `**Bid $${b.suggested}** — enough to beat ${top.teamName}'s likely ~$${top.estimate}${
    b.competitors.length > 1 ? ` (${b.competitors.length} teams interested)` : ""
  }; cap it at $${b.ceiling}.`;
}
