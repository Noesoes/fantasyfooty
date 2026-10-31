// A small error log kept on this device only. Nothing is sent anywhere: when
// something breaks, the crash screen and the settings sheet let you copy the
// log to share it. Also lists and clears everything the app stores locally.

const LOG_KEY = "error-log";
const MAX = 20;

export interface LoggedError {
  at: number;
  message: string;
  /** First few stack lines (no data, just code locations). */
  stack: string | null;
  /** Which screen was open (the URL hash). */
  where: string;
}

export function logError(err: unknown, where = typeof location !== "undefined" ? location.hash : "") {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const entry: LoggedError = {
      at: Date.now(),
      message: e.message.slice(0, 300),
      stack: e.stack ? e.stack.split("\n").slice(0, 6).join("\n") : null,
      where,
    };
    const log = readErrors();
    log.unshift(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, MAX)));
  } catch {
    // Logging must never break the app.
  }
}

export function readErrors(): LoggedError[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.message === "string") : [];
  } catch {
    return [];
  }
}

/** Plain-text report for pasting into a message. */
export function errorReport(extra?: LoggedError): string {
  const list = extra ? [extra, ...readErrors()] : readErrors();
  const lines = [
    `Prime Time error report · ${new Date().toISOString()}`,
    `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
    "",
  ];
  for (const e of list.slice(0, 10)) {
    lines.push(`[${new Date(e.at).toISOString()}] ${e.where || "/"} ${e.message}`);
    if (e.stack) lines.push(e.stack, "");
  }
  return lines.join("\n");
}

/** Catch errors outside React rendering (failed promises, event handlers). */
export function installErrorLogging(): () => void {
  const onError = (e: ErrorEvent) => logError(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => logError(e.reason);
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  return () => {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}

// Everything the app keeps in this browser (prefixes and exact keys).
const PREFIXES = ["rules:", "seen:", "pins:", "plan:"];
const KEYS = ["sleeper-advisor", "theme", "claude-api-key", LOG_KEY];

/** Remove the app's saved data from this device (username, rules, checklists, pins, snapshots, error log). */
export function clearLocalData(keepTheme = true) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (PREFIXES.some((p) => k.startsWith(p)) || (KEYS.includes(k) && !(keepTheme && k === "theme"))) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}
