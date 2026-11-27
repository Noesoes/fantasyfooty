"use client";

// Moves -> Injury watch: starting RBs and WRs around the NFL who are out, and
// the teammates in line for their work, with where each one is in your league.

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useMemo, useState } from "react";
import type { Analysis } from "@/lib/advisor";
import { buildInjuryWatch, type Beneficiary } from "@/lib/injurywatch";
import { teamLogoUrl } from "@/lib/sleeper";
import { Card, Empty, PlayerLine } from "../ui";

function OwnerTag({ b }: { b: Beneficiary }) {
  const cls = b.free
    ? "bg-mint-400/15 text-mint-400"
    : b.owner === "you"
      ? "bg-violet/15 text-violet"
      : "bg-ink-700 text-ink-300";
  return (
    <span className={`max-w-[9rem] truncate rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${cls}`}>
      {b.free ? "Free agent" : b.owner === "you" ? "Yours" : b.owner}
    </span>
  );
}

export function InjuryWatchTab({ a }: { a: Analysis }) {
  const items = useMemo(() => buildInjuryWatch(a), [a]);
  const [freeOnly, setFreeOnly] = useState(false);
  const shown = items
    .map((it) => ({ ...it, next: freeOnly ? it.next.filter((n) => n.free) : it.next }))
    .filter((it) => it.next.length > 0 || !freeOnly);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-xl font-black tracking-tight">Injury watch</h2>
        <p className="mt-1 text-[13px] leading-snug text-ink-400">
          Starting RBs and top-two WRs around the NFL who are out for week {a.week}, and the teammates in line for their
          carries and targets.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={freeOnly}
            onChange={(e) => setFreeOnly(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-mint-400)]"
          />
          Free agents only
        </label>
      </section>

      {shown.length === 0 ? (
        <Empty>
          {freeOnly
            ? "No free agents are in line for a starter's work right now."
            : "No starting RBs or WRs are out right now."}
        </Empty>
      ) : (
        shown.map((it) => (
          <Card key={`${it.team}-${it.position}`}>
            <div className="flex items-center gap-2.5">
              <img src={teamLogoUrl(it.team)} alt="" className="h-7 w-7 object-contain" />
              <span className="text-[15px] font-black">
                {it.team} {it.position}s
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {it.out.map((o) => (
                <li
                  key={o.player.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-rose-500/10 px-3 py-2"
                >
                  <div className="min-w-0">
                    <PlayerLine p={o.player} size={32} />
                    <span className="mt-0.5 ml-[44px] block text-[11.5px] font-bold text-rose-400">
                      {o.role} · {o.player.injury}
                      {o.player.injuryBodyPart ? ` (${o.player.injuryBodyPart})` : ""}
                    </span>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm font-black">{o.player.seasonAvg}</span>
                    <span className="block text-[10px] text-ink-400">pts/g lost</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[10.5px] font-extrabold tracking-wider text-mint-400 uppercase">Next up</div>
            {it.next.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-400">No healthy teammate projects for real work.</p>
            ) : (
              <ul className="mt-1 flex flex-col divide-y divide-ink-700/60">
                {it.next.map((n) => (
                  <li key={n.player.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <PlayerLine p={n.player} size={32} />
                      <span className="mt-1 ml-[44px] flex flex-wrap items-center gap-1.5">
                        <OwnerTag b={n} />
                        {n.player.usage && (
                          <span className="text-[11px] text-ink-400">
                            {it.position === "RB"
                              ? `${Math.round(n.player.usage.carryShare * 100)}% of carries`
                              : `${Math.round(n.player.usage.targetShare * 100)}% of targets`}{" "}
                            lately
                          </span>
                        )}
                      </span>
                    </div>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-lg font-black">{n.player.weekScore}</span>
                      {n.bump !== null && n.bump > 0 ? (
                        <span className="block text-[11px] font-bold text-mint-400">+{n.bump} vs avg</span>
                      ) : (
                        <span className="block text-[10px] text-ink-400">expected</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))
      )}
      <p className="px-1 text-[11px] text-ink-400">
        Starters are each team&apos;s top RB and top two WRs by points per game this season. &ldquo;Expected&rdquo; is
        this week&apos;s projection (Sleeper already shifts work to backups when a starter is out); &ldquo;vs avg&rdquo;
        is how much more than his season average that is. Tap a player for his matchup, workload and pickup verdict.
      </p>
    </div>
  );
}
