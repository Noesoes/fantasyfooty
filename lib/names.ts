// Short names for players: "Kyle Pitts Sr." -> "Pitts", "Ollie Gordon II" -> "Gordon".

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

/** A player's last name, skipping suffixes like Jr., Sr. and II. */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] ?? name;
}
