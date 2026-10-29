"use client";

// Light/dark switch. The inline script in layout.tsx applies the saved theme
// before first paint; this mirrors it and flips it.

import { useEffect, useState } from "react";

export function ThemeToggle({ labeled = false }: { labeled?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    // The inline script in layout.tsx already applied the theme; mirror it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with the DOM after hydration
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    // Match the phone's status bar to the theme.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "light" ? "#eef0fb" : "#0a0b14");
    try {
      localStorage.setItem("theme", next);
    } catch {
      // The toggle still works for this visit.
    }
  }
  if (labeled) {
    return (
      <button
        onClick={toggle}
        className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-ink-700 bg-ink-900 px-3 py-3 text-sm font-extrabold"
      >
        {theme === "light" ? "☾ Dark mode" : "☀︎ Light mode"}
      </button>
    );
  }
  return (
    <button
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Dark mode" : "Light mode"}
      className="flex h-9 w-10 rounded-lg items-center justify-center bg-ink-800 text-ink-300 transition hover:bg-ink-700 hover:text-mint-400"
    >
      {theme === "light" ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4 " fill="currentColor" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4 " fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
