"use client";

// Pieces of the game center that also show up elsewhere: your stake in a
// game, highlight clips and the full box score.

import { useState } from "react";
import type { GamePlayer, Stake } from "@/lib/gamecenter";
import type { BoxCategory, Highlight } from "@/lib/gamedetail";
import type { Game } from "@/lib/scoreboard";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .trim();

/** Your players named in a highlight headline (full name, or last name when it's distinctive). */
export function playersIn(text: string, players: GamePlayer[]): GamePlayer[] {
  const t = ` ${norm(text)} `;
  return players.filter((p) => {
    const full = norm(p.player.name);
    const last = full.split(" ").slice(-1)[0];
    return t.includes(` ${full} `) || (last.length >= 5 && t.includes(` ${last} `));
  });
}

// --- Stake --------------------------------------------------------------------

/** What this game means for your fantasy matchup. */
export function StakeStrip({ s, winNow, compact }: { s: Stake; winNow: number | null; compact?: boolean }) {
  const net = s.mine + s.mineLeft - (s.theirs + s.theirsLeft);
  const up = s.winIfGood !== null && winNow !== null ? Math.round((s.winIfGood - winNow) * 100) : null;
  const down = s.winIfBad !== null && winNow !== null ? Math.round((winNow - s.winIfBad) * 100) : null;
  const side = (label: string, pts: number, left: number, tone: string) => (
    <span className="whitespace-nowrap">
      <span className="text-ink-400">{label} </span>
      <b className={`font-mono tabular-nums ${tone}`}>{pts.toFixed(1)}</b>
      {left >= 0.1 && <span className="text-ink-400"> +{left.toFixed(1)} to come</span>}
    </span>
  );
  return (
    <div className={`flex flex-col gap-1 ${compact ? "text-[11px]" : "text-xs"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="display text-[10px] font-black tracking-wider text-violet uppercase">Your stake</span>
        {(s.mine > 0 || s.mineLeft > 0) && side("You", s.mine, s.mineLeft, "text-mint-400")}
        {(s.theirs > 0 || s.theirsLeft > 0) && side("Opp", s.theirs, s.theirsLeft, "text-rose-300")}
        <span className={`ml-auto font-mono font-bold tabular-nums ${net >= 0 ? "text-mint-400" : "text-rose-300"}`}>
          {net >= 0 ? "+" : ""}
          {net.toFixed(1)} net
        </span>
      </div>
      {up !== null && down !== null && (up >= 1 || down >= 1) && (
        <div className="text-ink-300">
          A big game here: <b className="text-mint-400">+{up}%</b> win chance · a dud:{" "}
          <b className="text-rose-300">−{down}%</b>
          {!compact && winNow !== null && <span className="text-ink-400"> (now {pct(winNow)})</span>}
        </div>
      )}
    </div>
  );
}

// --- Highlights ---------------------------------------------------------------

export function Highlights({ list, players }: { list: Highlight[]; players: GamePlayer[] }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  if (!list.length) return null;
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1" data-noswipe>
      {list.map((h) => {
        const mine = playersIn(h.headline, players);
        return (
          <div key={h.id} className="w-60 shrink-0 snap-start">
            <div className="relative aspect-video overflow-hidden bg-ink-900">
              {playing === h.id && (h.video || h.hls) && !failed.has(h.id) ? (
                <video
                  poster={h.thumbnail ?? undefined}
                  controls
                  autoPlay
                  playsInline
                  className="h-full w-full bg-black"
                >
                  {/* The browser plays the first one it supports: the stream on iPhone, the MP4 elsewhere. */}
                  {h.hls && (
                    <source
                      src={h.hls}
                      type="application/vnd.apple.mpegurl"
                      onError={() => !h.video && setFailed((f) => new Set(f).add(h.id))}
                    />
                  )}
                  {h.video && (
                    // Errors land on the last <source> once nothing could play.
                    <source src={h.video} type="video/mp4" onError={() => setFailed((f) => new Set(f).add(h.id))} />
                  )}
                </video>
              ) : (
                <button
                  onClick={() =>
                    (h.video || h.hls) && !failed.has(h.id)
                      ? setPlaying(h.id)
                      : h.page && window.open(h.page, "_blank", "noopener")
                  }
                  className="group relative block h-full w-full"
                  aria-label={`Play: ${h.headline}`}
                >
                  {h.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element -- remote ESPN thumbnail in a static export
                    <img src={h.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-ink-950/25 transition group-hover:bg-ink-950/10">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-950/80 text-lg text-white">
                      ▶
                    </span>
                  </span>
                  {h.duration > 0 && (
                    <span className="absolute right-1.5 bottom-1.5 bg-ink-950/85 px-1 font-mono text-[10px] text-white">
                      {Math.floor(h.duration / 60)}:{String(h.duration % 60).padStart(2, "0")}
                    </span>
                  )}
                </button>
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-ink-100">{h.headline}</p>
            {failed.has(h.id) && h.page && (
              <a href={h.page} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-mint-400">
                Can&apos;t play here — watch on ESPN ↗
              </a>
            )}
            {mine.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {mine.map((p) => (
                  <span
                    key={p.player.id}
                    className={`display px-1 text-[10px] font-black ${
                      p.role === "opponent" ? "bg-rose-500/15 text-rose-300" : "bg-mint-400 text-ink-950"
                    }`}
                  >
                    {p.role === "opponent" ? "OPP" : "YOURS"} · {p.player.name.split(" ").slice(-1)[0]}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Box score ----------------------------------------------------------------

const color = (c: string | null) => (c ? `#${c}` : "var(--color-ink-500)");

export function BoxScore({ g, box, players }: { g: Game; box: Record<string, BoxCategory[]>; players: GamePlayer[] }) {
  const [team, setTeam] = useState(g.away);
  const cats = box[team] ?? [];
  const yours = new Map(players.map((p) => [norm(p.player.name), p]));
  if (!Object.keys(box).length)
    return <p className="text-sm text-ink-400">The box score fills in once the game starts.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5 text-xs font-bold">
        {[g.away, g.home].map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`display flex items-center gap-1.5 px-3 py-1 transition ${team === t ? "bg-ink-100 text-ink-950" : "bg-ink-800 text-ink-400 hover:text-ink-100"}`}
          >
            <span className="h-3 w-1" style={{ backgroundColor: color(t === g.home ? g.homeColor : g.awayColor) }} />
            {t}
          </button>
        ))}
      </div>
      {cats.map((c) => (
        <section key={c.name}>
          <h3 className="display mb-1.5 text-xs font-bold tracking-wider text-ink-400 uppercase">{c.name}</h3>
          <div className="-mx-4 overflow-x-auto px-4" data-noswipe>
            <table className="w-full min-w-max text-xs tabular-nums">
              <thead>
                <tr className="text-[10px] tracking-wider text-ink-400 uppercase">
                  <th className="sticky left-0 bg-ink-850 pr-3 pb-1 text-left font-semibold">Player</th>
                  {c.labels.map((l) => (
                    <th key={l} className="px-1.5 pb-1 text-right font-semibold">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => {
                  const p = yours.get(norm(r.name));
                  return (
                    <tr key={r.id || r.name} className={`border-t border-ink-800 ${p ? "bg-mint-400/10" : ""}`}>
                      <td className="sticky left-0 max-w-36 truncate bg-ink-850 py-1.5 pr-3 font-semibold">
                        {p && (
                          <span
                            className={`mr-1 inline-block h-2 w-2 rounded-full ${p.role === "opponent" ? "bg-rose-400" : "bg-mint-400"}`}
                          />
                        )}
                        {r.name}
                      </td>
                      {r.stats.map((v, i) => (
                        <td key={i} className="px-1.5 py-1.5 text-right font-mono text-ink-300">
                          {v}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {c.totals && c.rows.length > 1 && (
                  <tr className="border-t border-ink-700 font-bold">
                    <td className="sticky left-0 bg-ink-850 py-1.5 pr-3">Team</td>
                    {c.totals.map((v, i) => (
                      <td key={i} className="px-1.5 py-1.5 text-right font-mono">
                        {v}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-[11px] text-ink-400">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-mint-400" />
        your players ·<span className="mx-1 inline-block h-2 w-2 rounded-full bg-rose-400" />
        your opponent&apos;s. Swipe tables sideways for more columns.
      </p>
    </div>
  );
}

/** "Snaps 45/62 (73%)" from this game's stats, or the recent share as a fallback. */
export function snapText(p: GamePlayer): string | null {
  const snaps = p.stats.off_snp;
  const team = p.stats.tm_off_snp;
  if (snaps && team) return `Snaps ${snaps}/${team} (${pct(snaps / team)})`;
  if (p.player.snapShare !== null && p.player.position !== "K") return `${pct(p.player.snapShare)} of snaps lately`;
  return null;
}
