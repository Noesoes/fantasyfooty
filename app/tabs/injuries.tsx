"use client";

// Home -> Injuries: chance to play, practice reports and replacements.

import { useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { buildInjuryReport, type InjuryReport, type InjuryRow, type Verdict } from "@/lib/injuries";
import { Card, Empty, PlayerLine } from "../ui";
import { lastName } from "@/lib/names";
import { BigStat, timeAgo, useAsync } from "./shared";

const VERDICT_STYLE: Record<Verdict, { text: string; bar: string; chip: string }> = {
  Playing: { text: "text-mint-400", bar: "bg-mint-400", chip: "bg-mint-400 text-ink-950" },
  Likely: { text: "text-lime-400", bar: "bg-lime-400", chip: "bg-lime-400 text-ink-950" },
  "Toss-up": { text: "text-amber-300", bar: "bg-amber-400", chip: "bg-amber-400 text-ink-950" },
  Unlikely: { text: "text-rose-300", bar: "bg-rose-400", chip: "bg-rose-400 text-white" },
  Out: { text: "text-rose-400", bar: "bg-rose-500", chip: "bg-rose-500 text-white" },
  Bye: { text: "text-ink-400", bar: "bg-ink-600", chip: "bg-ink-600 text-ink-100" },
};

export function Injuries({ a }: { a: Analysis }) {
  const [refresh, setRefresh] = useState(0);
  const { data: r, error } = useAsync<InjuryReport>(() => buildInjuryReport(a), [a, refresh]);
  if (error) return <Empty>Couldn&apos;t load injury reports: {error}</Empty>;
  if (!r) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="skeleton h-24" />
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
    );
  }
  const myStarters = r.rows.filter((x) => x.side === "mine" && x.starter);
  const bench = r.rows.filter((x) => x.side === "mine" && !x.starter);
  const opp = r.rows.filter((x) => x.side === "opponent");
  const atRisk = myStarters.filter((x) => x.probability < 0.6).length;

  // Healthy bench fallback for an at-risk starter at the same position.
  const risky = new Set(r.rows.filter((x) => x.side === "mine" && x.probability < 0.85).map((x) => x.player.id));
  const starters = new Set(a.currentLineup.map((s) => s.player?.id));
  // Healthy bench player at the same position, else the best free agent.
  const pivot = (row: InjuryRow) => {
    const fits = (p: PlayerAnalysis) =>
      !risky.has(p.id) && p.weekScore > 0 && p.eligible.some((e) => row.player.eligible.includes(e));
    const fromBench = a.roster
      .filter((p) => !starters.has(p.id) && fits(p))
      .sort((x, y) => y.weekScore - x.weekScore)[0];
    if (fromBench) return { player: fromBench, freeAgent: false };
    const fa = row.player.eligible
      .flatMap((pos) => a.streamersByPosition[pos] ?? [])
      .filter((p) => fits(p) && !p.injury)
      .sort((x, y) => y.weekScore - x.weekScore)[0];
    return fa ? { player: fa, freeAgent: true } : undefined;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <BigStat
          label="Healthy starters"
          value={`${r.healthyStarters}/${r.totalStarters}`}
          sub="starters with no injury concern this week"
          tone={
            r.healthyStarters === r.totalStarters ? "good" : r.healthyStarters >= r.totalStarters - 1 ? "mid" : "bad"
          }
        />
        <BigStat
          label="Starters at risk"
          value={String(atRisk)}
          sub={atRisk ? "under 60% to play — have a backup ready" : "nobody in your lineup is in real doubt"}
          tone={atRisk ? "bad" : "good"}
        />
        <div className="flex flex-col justify-between gap-2 rounded-2xl border border-ink-700 bg-ink-900 p-4">
          <div className="display text-[11px] font-bold tracking-wider text-ink-400">Sources</div>
          <div className="text-xs text-ink-300">
            Sleeper news feed
            {r.espnAvailable && r.espnAsOf
              ? ` + ESPN injury report (as of ${new Date(r.espnAsOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`
              : " (ESPN report unavailable right now)"}
          </div>
          <button
            onClick={() => setRefresh((n) => n + 1)}
            className="display self-start rounded-lg bg-ink-800 px-3 py-1 text-sm font-bold text-ink-100 hover:bg-ink-700"
          >
            <span className="block ">↻ Refresh reports</span>
          </button>
        </div>
      </div>

      <InjurySection title="Your starters" rows={myStarters} pivot={pivot} empty="All your starters are healthy. ✅" />
      {bench.length > 0 && <InjurySection title="Your bench & IR" rows={bench} />}
      {a.opponent && (
        <InjurySection
          title={`${a.opponent.teamName}'s starters`}
          rows={opp}
          empty="Your opponent's lineup has no injury concerns."
        />
      )}
      <p className="text-xs text-ink-400">
        Play chances are rules of thumb from the official designation, this week&apos;s practice reports, news and
        Sleeper&apos;s projections — not a guarantee. Final word comes with inactives, 90 minutes before kickoff.
      </p>
    </div>
  );
}

function ArticleBox({ article: x }: { article: InjuryRow["article"] }) {
  const cta =
    x.kind === "article"
      ? `Read the full story on ${x.source}`
      : x.kind === "player-page"
        ? `Read it on ${x.source}`
        : "Search Google News";
  return (
    <a
      href={x.url}
      target="_blank"
      rel="noreferrer"
      className="group mt-3 block border-l-4 border-mint-400 bg-ink-900/70 px-3 py-2.5 transition hover:bg-ink-800"
    >
      <div className="flex items-center justify-between gap-3 text-[10px] font-bold tracking-wider text-ink-400 uppercase">
        <span>
          {x.kind === "search" ? (
            "No recent article"
          ) : (
            <>
              Latest update · {x.source}
              {x.published !== null && (
                <span className={x.stale ? "text-amber-300" : ""}> · {timeAgo(x.published)}</span>
              )}
            </>
          )}
        </span>
        <span className="text-mint-400" aria-hidden>
          ↗
        </span>
      </div>
      {x.kind !== "search" && (
        <div className="mt-1 text-sm leading-snug font-semibold text-ink-100 group-hover:text-mint-300">{x.title}</div>
      )}
      {x.summary && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-300">{x.summary}</p>}
      <div className="mt-1.5 text-[11px] font-bold text-mint-400 group-hover:underline">{cta} →</div>
    </a>
  );
}

function InjurySection({
  title,
  rows,
  pivot,
  empty,
}: {
  title: string;
  rows: InjuryRow[];
  pivot?: (r: InjuryRow) => { player: PlayerAnalysis; freeAgent: boolean } | undefined;
  empty?: string;
}) {
  return (
    <Card title={title} action={<span className="text-xs text-ink-400">{rows.length} on the report</span>}>
      {rows.length === 0 ? (
        <Empty>{empty ?? "Nothing to report."}</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const v = VERDICT_STYLE[r.verdict];
            const backup = pivot && r.probability < 0.6 && r.verdict !== "Bye" ? pivot(r) : undefined;
            return (
              <li key={r.player.id} className="rounded-xl bg-ink-850 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <PlayerLine
                    p={r.player}
                    sub={r.bodyPart ? <span className="text-ink-300">{r.bodyPart}</span> : undefined}
                  />
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className={`font-mono text-3xl leading-none font-black tabular-nums ${v.text}`}>
                        {r.verdict === "Bye" ? "—" : `${Math.round(r.probability * 100)}%`}
                      </div>
                      <div className="display text-[10px] font-bold tracking-wider text-ink-400">to play</div>
                    </div>
                    <span className={`display rounded-lg px-2.5 py-1 text-sm font-extrabold ${v.chip}`}>
                      <span className="block ">{r.verdict}</span>
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-1.5 bg-ink-700">
                  <div className={`h-full ${v.bar}`} style={{ width: `${Math.max(2, r.probability * 100)}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {r.designation && (
                    <span className="display bg-ink-700 px-2 py-0.5 font-bold text-ink-100">{r.designation}</span>
                  )}
                  {r.practice.map((n) => (
                    <span
                      key={n.day}
                      title={`${n.day}: ${n.level}`}
                      className={`display px-2 py-0.5 font-bold ${
                        n.level === "Full"
                          ? "bg-mint-400/15 text-mint-300"
                          : n.level === "Limited"
                            ? "bg-amber-400/15 text-amber-300"
                            : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {n.day.slice(0, 3)} {n.level === "Limited" ? "LP" : n.level === "Full" ? "FP" : "DNP"}
                    </span>
                  ))}
                  {r.locked && (
                    <span className="display bg-ink-700 px-2 py-0.5 font-bold text-ink-300">🔒 Game started</span>
                  )}
                </div>
                {r.reasons.length > 0 && <p className="mt-2 text-xs text-ink-300">{r.reasons.join(" · ")}</p>}
                <ArticleBox article={r.article} />
                {backup && (
                  <p className="mt-2 text-xs font-semibold text-mint-300">
                    {r.verdict === "Out"
                      ? `Start ${backup.player.name} instead`
                      : `Backup plan: start ${backup.player.name}`}{" "}
                    ({backup.player.position}, {backup.player.weekScore.toFixed(1)} proj
                    {backup.freeAgent ? ", free agent — add them first" : ""})
                    {r.verdict === "Out" ? "." : ` if ${lastName(r.player.name)} is ruled out.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// --- Roster ----------------------------------------------------------------
