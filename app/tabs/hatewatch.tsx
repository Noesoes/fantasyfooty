"use client";

// Games -> Hate Watch: everyone else's lineup mistakes, live. Bench players
// who outscored the starters they sat behind, starters still sweating it out,
// big games wasted on benches, and the league's hall of shame.

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useEffect, useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { buildHateWatch, type Blunder, type HateWatch } from "@/lib/hatewatch";
import { lastName } from "@/lib/names";
import { avatarUrl } from "@/lib/sleeper";
import { Card, Empty, PlayerLine } from "../ui";
import { useAsync } from "./shared";

function TeamTag({ name, avatar, vsYou }: { name: string; avatar: string | null; vsYou: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
      {avatar ? (
        <img src={avatarUrl(avatar)} alt="" className="h-6 w-6 shrink-0 rounded-full" />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-700 text-[11px] font-black">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate">{name}</span>
      {vsYou && (
        <span className="shrink-0 rounded-full bg-hot/15 px-2 py-0.5 text-[10.5px] font-extrabold text-hot">
          Your opponent
        </span>
      )}
    </span>
  );
}

function BlunderCard({ b }: { b: Blunder }) {
  return (
    <article className="rounded-2xl bg-ink-850 p-4">
      <div className="flex items-center justify-between gap-2">
        <TeamTag name={b.teamName} avatar={b.avatar} vsYou={b.vsYou} />
        <span className="shrink-0 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-black text-rose-400">
          −{b.cost} pts
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] font-bold tracking-wider text-mint-400 uppercase">On their bench</span>
            <PlayerLine p={b.benched} size={34} />
          </div>
          <span className="shrink-0 font-mono text-2xl font-black text-mint-400">{b.benchedPts}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] font-bold tracking-wider text-rose-400 uppercase">Started at {b.slot}</span>
            <PlayerLine p={b.started} size={34} />
          </div>
          <span className="shrink-0 font-mono text-2xl font-black text-rose-400">{b.startedPts}</span>
        </div>
      </div>
    </article>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export function HateWatchTab({ a }: { a: Analysis }) {
  const [week, setWeek] = useState(a.week);
  // While the current week is being played, re-check every two minutes.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (week !== a.week) return;
    const t = setInterval(() => setTick((n) => n + 1), 120_000);
    return () => clearInterval(t);
  }, [week, a.week]);
  const { data: h, error } = useAsync<HateWatch>(() => buildHateWatch(a, week), [a, week, tick]);
  const lastWeek = a.week - 1;

  const header = (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight">Hate Watch 😈</h2>
          <p className="mt-0.5 text-[13px] text-ink-400">Your leaguemates&apos; lineup mistakes, as they happen.</p>
        </div>
        {lastWeek >= 1 && (
          <div className="flex shrink-0 gap-1 rounded-full bg-ink-850 p-1 text-xs font-extrabold">
            {[
              { w: a.week, label: "This week" },
              { w: lastWeek, label: "Last week" },
            ].map((o) => (
              <button
                key={o.w}
                onClick={() => setWeek(o.w)}
                className={`rounded-full px-2.5 py-1 ${week === o.w ? "bg-ink-700 text-ink-100" : "text-ink-400"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  if (error)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Empty>Couldn&apos;t load the week&apos;s scoring: {error}</Empty>
      </div>
    );
  if (!h || h.week !== week)
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        {header}
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    );
  if (!h.started)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Empty>No points on the board yet for week {h.week}. Check back once games kick off.</Empty>
      </div>
    );

  const final = h.blunders.filter((b) => !b.pending);
  const pending = h.blunders.filter((b) => b.pending);
  const shame = h.shame.filter((s) => s.left > 0);
  const maxLeft = Math.max(1, ...shame.map((s) => s.left));
  return (
    <div className="flex flex-col gap-4">
      {header}

      <Card title={`Bench blunders${final.length ? ` · ${final.length}` : ""}`}>
        {final.length === 0 ? (
          <p className="text-sm text-ink-400">
            Nobody has benched the wrong guy yet{week === a.week ? " this week" : ""}.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-ink-400">
              Bench players who outscored a starter they could have replaced.
            </p>
            <div className="flex flex-col gap-3">
              {final.map((b, i) => (
                <BlunderCard key={i} b={b} />
              ))}
            </div>
          </>
        )}
      </Card>

      {pending.length > 0 && (
        <Card title="Sweating it out">
          <p className="mb-3 text-[13px] text-ink-400">
            Their bench is already ahead; the starter hasn&apos;t played yet.
          </p>
          <ul className="flex flex-col gap-2">
            {pending.map((b, i) => (
              <li key={i} className="rounded-2xl bg-ink-850 px-3.5 py-3 text-[13.5px] leading-snug">
                <TeamTag name={b.teamName} avatar={b.avatar} vsYou={b.vsYou} />
                <p className="mt-1.5 text-ink-300">
                  <b className="text-mint-400">{lastName(b.benched.name)}</b> has {b.benchedPts} on the bench.{" "}
                  <b className="text-ink-100">{lastName(b.started.name)}</b> needs {b.cost} to catch up
                  {b.kickoff ? ` (plays ${when(b.kickoff)})` : ""}.
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {h.monsters.length > 0 && (
        <Card title="Bench monsters">
          <p className="mb-3 text-[13px] text-ink-400">Big games ({">"}15 pts) wasted on a bench.</p>
          <ul className="flex flex-col divide-y divide-ink-700/60">
            {h.monsters.map((m) => (
              <li key={m.player.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <PlayerLine p={m.player} size={34} />
                  <span className="mt-0.5 ml-[46px] block truncate text-[11.5px] font-bold text-ink-400">
                    {m.teamName}
                    {m.vsYou ? " · your opponent" : ""}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-xl font-black text-mint-400">{m.pts}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {shame.length > 0 && (
        <Card title="Hall of shame">
          <p className="mb-3 text-[13px] text-ink-400">
            Points left on the bench{week === a.week ? " so far (finished games only)" : ""}.
          </p>
          <ol className="flex flex-col gap-2.5">
            {shame.map((s, i) => (
              <li key={s.rosterId}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-center font-mono text-sm font-black text-ink-400">{i + 1}</span>
                    <TeamTag name={s.teamName} avatar={s.avatar} vsYou={s.vsYou} />
                  </span>
                  <span className="shrink-0 font-mono text-sm font-black text-rose-400">−{s.left}</span>
                </div>
                <div className="mt-1.5 ml-7 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full rounded-full bg-rose-400" style={{ width: `${(s.left / maxLeft) * 100}%` }} />
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
