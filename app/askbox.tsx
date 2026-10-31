"use client";

// Ask: plain-English questions about your team. With a Claude key saved on
// this device (menu → Claude for Ask), any question goes to Claude, which
// answers with the app's own numbers and remembers the conversation for
// follow-ups. Without one, the built-in answers handle the common questions.

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Analysis } from "@/lib/advisor";
import { ask as askBuiltIn, type AskAnswer } from "@/lib/ask";
import { askClaude, ClaudeError, CLAUDE_MODEL_NAME, getClaudeKey, KEY_EVENT, type ClaudeTurn } from "@/lib/claude";
import { lastName } from "@/lib/names";
import { Faceoff } from "./faceoff";
import { useOpenPlayer } from "./playerctx";

const EXAMPLES = ["Who should I drop?", "Gibbs or Taylor?", "Is Taylor getting traded?", "Should I pick up Goodson?"];
const CLAUDE_EXAMPLES = [
  "How does my matchup next week look?",
  "Who should I target in a trade?",
  "Is my RB depth good enough for the playoffs?",
];

function useClaudeKey() {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setKey(getClaudeKey());
    sync();
    window.addEventListener(KEY_EVENT, sync);
    return () => window.removeEventListener(KEY_EVENT, sync);
  }, []);
  return key;
}

/** Claude's answers use a little markdown: "- " bullets and **bold**. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <b key={i} className="font-extrabold text-ink-100">
        {part.slice(2, -2)}
      </b>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length)
      blocks.push(
        <ul key={blocks.length} className="flex list-disc flex-col gap-1 pl-5 marker:text-ink-500">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
    bullets = [];
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^[-*•]\s+/.test(t)) bullets.push(t.replace(/^[-*•]\s+/, ""));
    else {
      flush();
      if (t) blocks.push(<p key={blocks.length}>{inline(t.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flush();
  return <div className="flex flex-col gap-2 text-[14px] leading-snug text-ink-200">{blocks}</div>;
}

export function AskBox({ a }: { a: Analysis }) {
  const claudeKey = useClaudeKey();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ q: string; a: AskAnswer } | null>(null);
  const [turns, setTurns] = useState<ClaudeTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Only the latest question's answer is shown, even if an earlier one finishes later.
  const latest = useRef(0);
  const openPlayer = useOpenPlayer();

  // A different league or week starts a new conversation.
  const [convoFor, setConvoFor] = useState(`${a.league.league_id}:${a.week}`);
  if (convoFor !== `${a.league.league_id}:${a.week}`) {
    setConvoFor(`${a.league.league_id}:${a.week}`);
    setTurns([]);
    setRes(null);
    setError(null);
  }

  const ask = (text: string) => {
    const id = ++latest.current;
    setError(null);
    if (claudeKey) {
      setQ("");
      setBusy("Thinking…");
      askClaude(a, text, turns, (label) => id === latest.current && setBusy(label), claudeKey)
        .then((answer) => {
          if (id !== latest.current) return;
          setTurns((t) => [...t, { question: text, answer }]);
        })
        .catch((e) => {
          if (id !== latest.current) return;
          setQ(text);
          setError(e instanceof ClaudeError ? e.message : "Something went wrong asking Claude. Try again.");
        })
        .finally(() => {
          if (id === latest.current) setBusy(null);
        });
      return;
    }
    setQ(text);
    setBusy("Checking…");
    askBuiltIn(a, text)
      .then((ans) => {
        if (id === latest.current) setRes({ q: text, a: ans });
      })
      .catch(() => {
        if (id === latest.current)
          setRes({
            q: text,
            a: { title: "Something went wrong", tone: "neutral", lines: ["Try asking again."], players: [] },
          });
      })
      .finally(() => {
        if (id === latest.current) setBusy(null);
      });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim() && !busy) ask(q.trim());
  };
  const clear = () => {
    latest.current++;
    setRes(null);
    setTurns([]);
    setError(null);
    setBusy(null);
    setQ("");
  };

  const tone = res?.a.tone === "good" ? "text-mint-400" : res?.a.tone === "bad" ? "text-rose-400" : "text-ink-100";
  const examples = claudeKey ? CLAUDE_EXAMPLES : EXAMPLES;
  const idle = !busy && !res && !turns.length && !error;
  return (
    <section className="mt-2 rounded-2xl border border-ink-700 bg-ink-900 p-3">
      {turns.length > 0 && (
        <div className="mb-3 flex flex-col gap-3 border-b border-ink-800 pb-3" aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="self-end rounded-2xl rounded-br-md bg-ink-800 px-3 py-1.5 text-[13.5px] font-bold">
                {t.question}
              </div>
              <Markdown text={t.answer} />
            </div>
          ))}
          <div className="flex items-center justify-between text-[11px] font-bold text-ink-400">
            <span>{CLAUDE_MODEL_NAME} · answers from the app&apos;s numbers</span>
            <button onClick={clear} className="px-1 text-ink-400">
              Clear
            </button>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <span className="pl-1 text-lg" aria-hidden>
          💬
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            turns.length ? "Ask a follow-up…" : claudeKey ? "Ask anything about your league" : "Ask: “Gibbs or Taylor?”"
          }
          enterKeyHint="send"
          aria-label="Ask about your team"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] font-semibold placeholder:font-medium placeholder:text-ink-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!q.trim() || !!busy}
          className="shrink-0 rounded-full bg-mint-400 px-3.5 py-1.5 text-xs font-black text-ink-950 disabled:opacity-30"
        >
          Ask
        </button>
      </form>
      {busy && (
        <div className="mt-3 flex items-center gap-2 text-sm font-bold text-ink-400" aria-busy="true">
          <span className="h-2 w-2 animate-pulse rounded-full bg-mint-400" />
          {busy}
        </div>
      )}
      {error && !busy && (
        <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-[13px] font-bold text-rose-400">{error}</p>
      )}
      {idle && (
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
          {examples.map((x) => (
            <button
              key={x}
              onClick={() => ask(x)}
              className="shrink-0 rounded-full border border-ink-700 px-2.5 py-1 text-xs font-bold text-ink-300"
            >
              {x}
            </button>
          ))}
        </div>
      )}
      {res && !busy && !claudeKey && (
        <div className="mt-3 border-t border-ink-800 pt-3" aria-live="polite">
          <div className={`text-[17px] font-black ${tone}`}>{res.a.title}</div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13.5px] leading-snug text-ink-300">
            {res.a.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {res.a.sources && res.a.sources.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {res.a.sources.map((s, i) => {
                const head = (
                  <>
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-ink-400">
                      {s.stance && (
                        <span
                          className={`rounded-full px-1.5 py-px text-[10px] font-extrabold uppercase ${
                            s.stance === "rumor" ? "bg-hot/15 text-hot" : "bg-mint-400/15 text-mint-400"
                          }`}
                        >
                          {s.stance === "rumor" ? "Rumor" : "Cooling"}
                        </span>
                      )}
                      {s.date} · {s.source}
                    </span>
                    <span className="block text-[13px] leading-snug font-semibold text-ink-100">{s.title}</span>
                  </>
                );
                return (
                  <li key={i}>
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-xl bg-ink-850 px-3 py-2 hover:bg-ink-800"
                      >
                        {head}
                      </a>
                    ) : (
                      <div className="rounded-xl bg-ink-850 px-3 py-2">{head}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {res.a.compare && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none text-sm font-extrabold text-mint-400">
                Compare side by side <span className="inline-block transition group-open:rotate-90">›</span>
              </summary>
              <div className="mt-3">
                <Faceoff x={res.a.compare[0]} y={res.a.compare[1]} />
              </div>
            </details>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {res.a.players.map((p) => (
              <button
                key={p.id}
                onClick={() => openPlayer?.(p)}
                className="rounded-full bg-ink-800 px-2.5 py-1 text-xs font-bold hover:bg-ink-700"
              >
                {lastName(p.name)} details ›
              </button>
            ))}
            <button onClick={clear} className="px-2 text-xs font-bold text-ink-400">
              Clear
            </button>
          </div>
          <p className="mt-2.5 text-[11.5px] text-ink-400">
            Want any question answered, like &ldquo;how does next week look?&rdquo; Add a Claude key in the menu (tap
            your avatar).
          </p>
        </div>
      )}
    </section>
  );
}
