// Renders an Analysis as Markdown, for the weekly GitHub issue / job summary.

import { describeMatchup, type Analysis, type PlayerAnalysis } from "./advisor";

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
  if (a.waivers.length === 0) {
    lines.push("No free agent is clearly better than what you already have.");
  } else {
    for (const w of a.waivers) {
      const drop = w.dropFor ? `, drop ${tag(w.dropFor)}` : "";
      lines.push(`- **Add** ${tag(w.player)}${drop} — ${w.reason}`);
    }
  }
  lines.push("");

  lines.push("## Drop candidates");
  if (a.drops.length === 0) {
    lines.push("Nobody on your bench is an obvious cut.");
  } else {
    for (const d of a.drops) lines.push(`- ${tag(d.player)} — ${d.reason}`);
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
