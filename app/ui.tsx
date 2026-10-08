"use client";

/* eslint-disable @next/next/no-img-element -- remote Sleeper CDN images in a static export */

import { useState } from "react";
import { describeMatchup, type MatchupGrade, type PlayerAnalysis } from "@/lib/advisor";
import { playerPhotoUrl, teamLogoUrl } from "@/lib/sleeper";

const POS_COLOR: Record<string, string> = {
  QB: "bg-pos-qb/15 text-pos-qb ring-pos-qb/30",
  RB: "bg-pos-rb/15 text-pos-rb ring-pos-rb/30",
  WR: "bg-pos-wr/15 text-pos-wr ring-pos-wr/30",
  TE: "bg-pos-te/15 text-pos-te ring-pos-te/30",
  K: "bg-pos-k/15 text-pos-k ring-pos-k/30",
  DEF: "bg-pos-def/15 text-pos-def ring-pos-def/30",
};

const SLOT_LABEL: Record<string, string> = {
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  FLEX: "FLX",
};

export function PosBadge({ pos, className = "" }: { pos: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide ring-1 ring-inset ${
        POS_COLOR[pos] ?? "bg-ink-700 text-ink-300 ring-ink-600"
      } ${className}`}
    >
      {pos}
    </span>
  );
}

export function SlotBadge({ slot }: { slot: string }) {
  const pos = slot in POS_COLOR ? slot : null;
  return (
    <span
      className={`inline-flex h-7 w-11 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ring-1 ring-inset ${
        pos ? POS_COLOR[pos] : "bg-ink-700/60 text-ink-300 ring-ink-600"
      }`}
    >
      {SLOT_LABEL[slot] ?? slot}
    </span>
  );
}

export function Headshot({ p, size = 40 }: { p: PlayerAnalysis; size?: number }) {
  const [failed, setFailed] = useState(false);
  const isDef = p.position === "DEF";
  const src = isDef ? (p.team ? teamLogoUrl(p.team) : null) : playerPhotoUrl(p.id);
  const initials = p.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full bg-ink-700 ring-2 ring-ink-800"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className={`h-full w-full ${isDef ? "object-contain p-1" : "object-cover object-top"}`}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-ink-300">
          {initials}
        </span>
      )}
      {!isDef && p.team && (
        <img
          src={teamLogoUrl(p.team)}
          alt=""
          className="absolute -right-0.5 -bottom-0.5 rounded-full bg-ink-900 p-[1px]"
          style={{ width: size * 0.42, height: size * 0.42 }}
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
      )}
    </div>
  );
}

export function InjuryTag({ status }: { status: string | null }) {
  if (!status) return null;
  const minor = status === "Questionable";
  const label = status === "Questionable" ? "Q" : status === "Doubtful" ? "D" : status === "Out" ? "O" : status;
  return (
    <span
      title={status}
      className={`rounded px-1 text-[10px] leading-4 font-bold ${
        minor ? "bg-amber-400/20 text-amber-300" : "bg-rose-500/20 text-rose-300"
      }`}
    >
      {label}
    </span>
  );
}

const GRADE: Record<MatchupGrade, { color: string; bars: number; label: string }> = {
  great: { color: "bg-mint-400", bars: 5, label: "Great" },
  good: { color: "bg-lime-400", bars: 4, label: "Good" },
  neutral: { color: "bg-ink-300", bars: 3, label: "Neutral" },
  tough: { color: "bg-amber-400", bars: 2, label: "Tough" },
  brutal: { color: "bg-rose-500", bars: 1, label: "Brutal" },
};

export function MatchupChip({ p, compact }: { p: PlayerAnalysis; compact?: boolean }) {
  if (p.onBye) {
    return <span className="rounded-md bg-ink-700 px-2 py-0.5 text-[11px] font-semibold text-ink-300">BYE</span>;
  }
  if (!p.matchup) return <span className="text-xs text-ink-400">—</span>;
  const g = GRADE[p.matchup.grade];
  return (
    <span title={describeMatchup(p.matchup, p.position)} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-xs font-medium text-ink-300">
        {p.matchup.opponent === p.team ? "" : "vs "}
        {p.matchup.opponent}
      </span>
      <span className="flex items-end gap-[2px]" aria-label={`${g.label} matchup`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-sm ${i <= g.bars ? g.color : "bg-ink-600"}`}
            style={{ height: 4 + i * 2 }}
          />
        ))}
      </span>
      {!compact && <span className="text-[11px] text-ink-400">{g.label}</span>}
    </span>
  );
}

export function PlayerLine({
  p,
  size = 40,
  sub,
}: {
  p: PlayerAnalysis;
  size?: number;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Headshot p={p} size={size} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold text-ink-100">{p.name}</span>
          <InjuryTag status={p.injury} />
        </div>
        <div className="flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-400">
          <PosBadge pos={p.position} />
          <span>{p.team ?? "FA"}</span>
          {sub}
        </div>
      </div>
    </div>
  );
}

export function Points({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <span className={`font-mono text-base font-semibold tabular-nums ${muted ? "text-ink-400" : "text-ink-100"}`}>
      {value.toFixed(1)}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-ink-700/70 bg-ink-900/80 backdrop-blur ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-700/60 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-100 uppercase">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">{children}</p>;
}
