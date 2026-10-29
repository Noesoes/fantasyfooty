"use client";

// "Install" button: puts the site on the phone's home screen like an app.
// Chrome/Edge/Android hand us an install prompt; iPhone Safari doesn't, so
// there we show the two taps it takes. Hidden once installed.

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isInstalled() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline h-4 w-4 align-[-3px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" strokeLinecap="round" />
    </svg>
  );
}

export function InstallButton() {
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (isInstalled()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection after hydration
    if (isIos()) setMode("ios");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
      setMode("prompt");
    };
    const onInstalled = () => setMode("hidden");
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("appinstalled", onInstalled);
    return () => {
      removeEventListener("beforeinstallprompt", onPrompt);
      removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;

  async function install() {
    if (mode === "ios") {
      setHelp(true);
      return;
    }
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setMode("hidden");
    setPrompt(null);
  }

  return (
    <>
      <button
        onClick={install}
        title="Install the app on your home screen"
        aria-label="Install app"
        className="display flex h-9 shrink-0 rounded-lg items-center gap-1.5 bg-ink-800 px-3 text-sm font-bold text-mint-400 transition hover:bg-ink-700"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 " fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="hidden  whitespace-nowrap min-[400px]:inline">Get app</span>
      </button>

      {help && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/70 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setHelp(false)}
        >
          <div
            role="dialog"
            aria-label="Add to Home Screen"
            className="w-full max-w-sm border border-ink-700 bg-ink-900 p-5 shadow-2xl"
            style={{ marginBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="display border-l-4 border-mint-400 pl-3 text-xl leading-none font-bold">
                Put PrimeTime on your home screen
              </h2>
              <button
                onClick={() => setHelp(false)}
                aria-label="Close"
                className="-mt-1 px-2 text-xl leading-none text-ink-400 hover:text-ink-100"
              >
                ×
              </button>
            </div>
            <ol className="mt-4 flex flex-col gap-3 text-sm">
              {[
                <>
                  Tap <b>Share</b> <ShareIcon /> in Safari&apos;s toolbar
                </>,
                <>
                  Scroll down and tap <b>Add to Home Screen</b>
                </>,
                <>
                  Tap <b>Add</b>. PrimeTime opens full screen from its icon, like any app.
                </>,
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="glow w-5 shrink-0 font-mono text-2xl leading-none font-black text-mint-400">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-ink-400">No App Store needed, and it updates itself.</p>
          </div>
        </div>
      )}
    </>
  );
}
