"use client"; // Error boundaries must be Client Components

// Shown if a screen crashes: try again, reload, or copy the error details to
// send along. The details stay on this device unless you share them.

import { useEffect, useState } from "react";
import { errorReport, logError } from "@/lib/errorlog";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    logError(error);
  }, [error]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(errorReport());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/15 text-2xl font-black text-rose-400">
        !
      </div>
      <h1 className="text-2xl font-black">Something broke</h1>
      <p className="text-sm text-ink-300">
        That screen hit an error. Your saved rules and settings are fine. Try again, or reload the app.
      </p>
      <div className="flex w-full gap-2">
        <button onClick={() => retry()} className="flex-1 rounded-2xl bg-mint-400 py-3 text-sm font-black text-ink-950">
          Try again
        </button>
        <button
          onClick={() => location.reload()}
          className="flex-1 rounded-2xl border border-ink-700 bg-ink-900 py-3 text-sm font-extrabold"
        >
          Reload
        </button>
      </div>
      <button onClick={copy} className="text-xs font-bold text-ink-400 underline underline-offset-4">
        {copied ? "Copied — paste it to whoever's fixing it" : "Copy error details"}
      </button>
    </div>
  );
}
