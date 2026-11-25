"use client";

// "Next 4 games" on the player sheet: opponent, how that defense treats his
// position, and Sleeper's projection for each week, with an overall verdict.

import { useEffect, useState } from "react";
import type { Analysis, MatchupGrade, PlayerAnalysis } from "@/lib/advisor";
import { playerOutlook, type Outlook } from "@/lib/outlook";

const GRADE_STYLE: Record<MatchupGrade, { label: string; cls: string }> = {
  great: { label: "Great", cls: "bg-mint-400/20 text-mint-400" },
  good: { label: "Good", cls: "bg-lime-400/20 text-lime-500" },
  neutral: { label: "Neutral", cls: "bg-ink-700 text-ink-300" },
  tough: { label: "Tough", cls: "bg-amber-300/20 text-amber-400" },
  brutal: { label: "Brutal", cls: "bg-rose-500/15 text-rose-400" },
};

const VERDICT_STYLE: Record<Outlook["verdict"], string> = {
  Favorable: "text-mint-400",
  Neutral: "text-ink-300",
  Tough: "text-rose-400",
};

const posWord = (pos: string) => (pos === "DEF" ? "D/STs" : pos === "K" ? "kickers" : `${pos}s`);

export function NextGames({ a, p }: { a: Analysis; p: PlayerAnalysis }) {
  const [o, setO] = useState<Outlook | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    playerOutlook(a, p)
      .then((r) => live && setO(r))
      .catch(() => live && setO(null));
    return () => {
      live = false;
    };
  }, [a, p]);

  if (o === null) return null;
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-bold">Next {o?.weeks.length ?? 4} games</h3>
        {o && <span className={`text-xs font-extrabold ${VERDICT_STYLE[o.verdict]}`}>{o.verdict} stretch</span>}
      </div>
      {!o ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-10 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {o.weeks.map((w) => (
              <li
                key={w.week}
                className="grid grid-cols-[3rem_1fr_auto_3rem] items-center gap-2 rounded-xl bg-ink-850 px-3 py-2"
              >
                <span className="text-[11px] font-extrabold text-ink-400 uppercase">
                  {w.week === a.week ? "This wk" : `Wk ${w.week}`}
                </span>
                {w.opponent ? (
                  <span className="min-w-0">
                    <span className="block text-[14px] font-extrabold">
                      {w.home ? "vs" : "@"} {w.opponent}
                    </span>
                    {w.allowed !== null && (
                      <span className="block truncate text-[11px] text-ink-400">
                        Allows {w.allowed} to {posWord(p.position)} (avg {w.average})
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-[14px] font-extrabold text-ink-400">Bye</span>
                )}
                {w.grade ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${GRADE_STYLE[w.grade].cls}`}>
                    {GRADE_STYLE[w.grade].label}
                  </span>
                ) : (
                  <span />
                )}
                <span className="text-right font-mono text-[15px] font-black">
                  {w.opponent ? (w.projected ?? "–") : "0"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-400">
            Right column: Sleeper&apos;s projected points in your scoring. Matchup is how that defense has done against{" "}
            {posWord(p.position)} this season.
          </p>
        </>
      )}
    </section>
  );
}
