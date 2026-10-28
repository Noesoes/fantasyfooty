"use client";

// "Your rules": tell the advisor which of your players you won't trade or
// drop, and who backs up whom. Stored per league on this device; changing a
// rule re-runs the analysis with it.

import { createContext, useContext, useState } from "react";
import type { Analysis, PlayerAnalysis } from "@/lib/advisor";
import { isNoDrop, isNoTrade, type PlayerRule, type Prefs } from "@/lib/prefs";
import { Card, Headshot, PosBadge } from "./ui";

interface RulesApi {
  prefs: Prefs;
  setRule: (playerId: string, rule: PlayerRule | null) => void;
}

const RulesContext = createContext<RulesApi>({ prefs: {}, setRule: () => {} });
export const RulesProvider = RulesContext.Provider;
export const useRules = () => useContext(RulesContext);

const last = (name: string) => name.split(" ").slice(-1)[0];

/** One-tap "Not trading him" / "Keep him" chip for trade and waiver cards. */
export function RuleChip({ p, kind }: { p: PlayerAnalysis; kind: "noTrade" | "noDrop" }) {
  const { prefs, setRule } = useRules();
  const on = kind === "noTrade" ? isNoTrade(prefs, p.id) : isNoDrop(prefs, p.id);
  const label = kind === "noTrade" ? `Not trading ${last(p.name)}` : `Keep ${last(p.name)}`;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setRule(p.id, { ...prefs[p.id], [kind]: !on });
      }}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
        on
          ? "border-violet bg-violet/20 text-ink-100"
          : "border-ink-600 text-ink-300 hover:border-violet hover:text-ink-100"
      }`}
    >
      {on ? "✓" : "🚫"} {label}
    </button>
  );
}

function describe(rule: PlayerRule, a: Analysis): string {
  if (rule.backupFor) {
    const starter = a.roster.find((p) => p.id === rule.backupFor)?.name ?? "a starter";
    return `Your backup for ${starter} — never traded or dropped`;
  }
  if (rule.noTrade && rule.noDrop) return "Untouchable — never traded or dropped";
  if (rule.noTrade) return "Not for trade";
  return "Don't drop";
}

/** The rules card: every rule you've set, plus a form to add one. */
export function RulesCard({ a }: { a: Analysis }) {
  const { prefs, setRule } = useRules();
  const [playerId, setPlayerId] = useState("");
  const [kind, setKind] = useState<"untouchable" | "noTrade" | "noDrop" | "backup">("noTrade");
  const [starterId, setStarterId] = useState("");
  const mine = [...a.roster].sort((x, y) => x.position.localeCompare(y.position) || y.rosValue - x.rosValue);
  const rules = Object.entries(prefs)
    .map(([id, rule]) => ({ p: a.roster.find((x) => x.id === id), rule }))
    .filter((r): r is { p: PlayerAnalysis; rule: PlayerRule } => !!r.p);
  const chosen = a.roster.find((p) => p.id === playerId);
  const starters = mine.filter(
    (p) => p.id !== playerId && (!chosen || p.eligible.some((e) => chosen.eligible.includes(e))),
  );

  const add = () => {
    if (!playerId) return;
    const rule: PlayerRule =
      kind === "untouchable"
        ? { noTrade: true, noDrop: true }
        : kind === "backup"
          ? { backupFor: starterId || undefined }
          : { [kind]: true };
    if (kind === "backup" && !starterId) return;
    setRule(playerId, rule);
    setPlayerId("");
    setStarterId("");
  };

  return (
    <Card title="Your rules">
      <p className="mb-3 text-xs text-ink-400">
        Tell the advisor what you&apos;ve already decided. It won&apos;t suggest trading or dropping these players, and
        it remembers who backs up whom.
      </p>
      {rules.length > 0 && (
        <ul className="mb-4 flex flex-col divide-y divide-ink-700/60">
          {rules.map(({ p, rule }) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <Headshot p={p} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <PosBadge pos={p.position} />
                  <span className="truncate">{p.name}</span>
                </div>
                <div className="text-xs text-violet">{describe(rule, a)}</div>
              </div>
              <button
                onClick={() => setRule(p.id, null)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                aria-label={`Remove rule for ${p.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
          aria-label="Player"
        >
          <option value="">Pick a player…</option>
          {mine.map((p) => (
            <option key={p.id} value={p.id}>
              {p.position} · {p.name}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
          aria-label="Rule"
        >
          <option value="noTrade">Don&apos;t suggest trading him</option>
          <option value="noDrop">Don&apos;t suggest dropping him</option>
          <option value="untouchable">Untouchable (neither)</option>
          <option value="backup">He&apos;s my backup for…</option>
        </select>
        {kind === "backup" && (
          <select
            value={starterId}
            onChange={(e) => setStarterId(e.target.value)}
            className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm"
            aria-label="Starter he backs up"
          >
            <option value="">Which starter?</option>
            {starters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.position} · {p.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={add}
          disabled={!playerId || (kind === "backup" && !starterId)}
          className="rounded-lg bg-mint-400 px-4 py-2 text-sm font-bold text-ink-950 disabled:opacity-40"
        >
          Add rule
        </button>
      </div>
    </Card>
  );
}
