// Links that come from outside feeds (news, video) are only used when they are
// plain https URLs, so a bad feed can't inject javascript: or data: links.

export function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
