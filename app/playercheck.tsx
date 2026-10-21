"use client";

// Player check: search any free agent and get a verdict on picking him up,
// with the reasons for and against.

import { forwardRef, useMemo, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { evaluatePickup, searchFreeAgents, type PickupVerdict } from "@/lib/pickup";
import { Card, Headshot, PlayerLine } from "./ui";

const VERDICT_STYLE: Record<PickupVerdict, string> = {
  "Pick up": "prime-gradient text-ink-950",
  Stream: "bg-violet text-white",
  Stash: "bg-amber-400 text-ink-950",
  Pass: "bg-rose-500 text-white",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-ink-700 bg-ink-850 px-2 py-1.5 sm:px-3 sm:py-2">
      <div className="truncate text-[9px] font-bold tracking-wider text-ink-400 uppercase sm:text-[10px]">{label}</div>
      <div className="font-mono text-base font-bold tabular-nums sm:text-lg">{value}</div>
    </div>
  );
}

function PickupReportView({ a, p, onClose }: { a: Analysis; p: PlayerAnalysis; onClose: () => void }) {
  const r = useMemo(() => evaluatePickup(a, p), [a, p]);
  return (
    <div className="mt-4 border border-ink-700 bg-ink-900/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PlayerLine p={p} size={48} />
        <div className="flex items-center gap-2">
          <span className={`display -skew-x-12 px-3 py-1 text-lg font-black ${VERDICT_STYLE[r.verdict]}`}>
            <span className="block skew-x-12">{r.verdict}</span>
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="px-2 text-xl leading-none text-ink-400 hover:text-ink-100"
          >
            ×
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold text-ink-100">{r.headline}</p>

      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5 sm:gap-2">
        <Stat label={`Week ${a.week}`} value={p.onBye ? "BYE" : p.weekScore.toFixed(1)} />
        <Stat label="Rest of season" value={`${p.rosValue.toFixed(1)}/g`} />
        <Stat label={p.recentGames ? `Last ${p.recentGames}` : "Last 3"} value={p.recentAvg?.toFixed(1) ?? "—"} />
        <Stat label="Snaps" value={p.snapShare === null ? "—" : `${Math.round(p.snapShare * 100)}%`} />
        <Stat label="Adds (3 days)" value={p.trendingAdds ? p.trendingAdds.toLocaleString() : "—"} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="display mb-2 text-sm font-bold tracking-wider text-mint-400 uppercase">Why pick him up</h3>
          {r.pros.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {r.pros.map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="shrink-0 font-black text-mint-400">✓</span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">Nothing stands out.</p>
          )}
        </div>
        <div>
          <h3 className="display mb-2 text-sm font-bold tracking-wider text-rose-300 uppercase">Why not</h3>
          {r.cons.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {r.cons.map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="shrink-0 font-black text-rose-300">✕</span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">No red flags.</p>
          )}
        </div>
      </div>

      {r.verdict !== "Pass" && (r.drop || r.bid !== null || r.claim) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-700/60 pt-3 text-xs">
          {r.drop && (
            <span className="flex items-center gap-1.5 bg-ink-800 py-0.5 pr-2 pl-0.5">
              <Headshot p={r.drop} size={22} />
              <span>
                Drop <b>{r.drop.name}</b>
              </span>
            </span>
          )}
          {r.bid !== null && (
            <span className="bg-ink-800 px-2 py-1">
              Bid <b className="font-mono text-mint-400">${r.bid}</b>
              {a.waiver.budgetLeft !== null && <span className="text-ink-400"> of ${a.waiver.budgetLeft} left</span>}
            </span>
          )}
          {r.claim && <span className="text-ink-400">Also one of your recommended claims below.</span>}
        </div>
      )}
    </div>
  );
}

export const PlayerCheck = forwardRef<
  HTMLElement,
  { a: Analysis; selected: PlayerAnalysis | null; onSelect: (p: PlayerAnalysis | null) => void }
>(function PlayerCheck({ a, selected, onSelect }, ref) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<string | null>(null);
  const positions = useMemo(
    () => ["QB", "RB", "WR", "TE", "K", "DEF"].filter((x) => a.freeAgentPool.some((p) => p.position === x)),
    [a],
  );
  const browsing = query.trim().length > 0 || pos !== null;
  const results = browsing ? searchFreeAgents(a, query, pos, 8) : [];
  return (
    <Card title="Player check" action={<span className="text-xs text-ink-400">should I pick him up?</span>}>
      <section ref={ref} className="scroll-mt-24">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Phones: bring the card to the top so the results list isn't hidden below the keyboard.
              onFocus={(e) => {
                const card = e.currentTarget.closest("section");
                if (card && window.innerWidth < 640) card.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              placeholder="Search free agents by name or team…"
              aria-label="Search free agents"
              className="w-full border border-ink-700 bg-ink-850 py-2.5 pr-3 pl-9 text-sm text-ink-100 placeholder:text-ink-400 focus:border-mint-400 focus:outline-none"
            />
          </div>
          <div className="flex gap-1">
            {positions.map((x) => (
              <button
                key={x}
                onClick={() => setPos(pos === x ? null : x)}
                className={`display px-2.5 py-1.5 text-xs font-bold transition ${
                  pos === x ? "bg-mint-400 text-ink-950" : "bg-ink-800 text-ink-400 hover:text-ink-100"
                }`}
              >
                {x}
              </button>
            ))}
          </div>
        </div>

        {browsing && (
          <ul className="mt-2 divide-y divide-ink-700/50 border border-ink-700">
            {results.length === 0 ? (
              <li className="px-3 py-3 text-sm text-ink-400">
                No free agent matches &ldquo;{query}&rdquo;{pos ? ` at ${pos}` : ""}. He may be on someone&apos;s
                roster.
              </li>
            ) : (
              results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      onSelect(p);
                      setQuery("");
                      setPos(null);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-ink-800"
                  >
                    <div className="min-w-0 flex-1">
                      <PlayerLine p={p} size={30} />
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm font-bold tabular-nums">
                        {p.onBye ? "BYE" : p.weekScore.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-ink-400">{p.rosValue.toFixed(1)}/g ROS</div>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}

        {!browsing && !selected && (
          <p className="mt-3 text-xs text-ink-400">
            Type a name (or pick a position) to look up anyone on your league&apos;s waiver wire, or tap a player in
            Best available below. You&apos;ll get a verdict with the reasons for and against adding him.
          </p>
        )}
        {selected && <PickupReportView a={a} p={selected} onClose={() => onSelect(null)} />}
      </section>
    </Card>
  );
});
