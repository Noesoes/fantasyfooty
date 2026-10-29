"use client";

// Shared "open this player's sheet" hook, so any player line in the app can be
// tapped. The sheet itself lives in playersheet.tsx; null outside of it.

import { createContext, useContext } from "react";
import type { PlayerAnalysis } from "@/lib/advisor";

export const PlayerSheetContext = createContext<((p: PlayerAnalysis) => void) | null>(null);
/** Open the player sheet for a player (null when there's no sheet on the page). */
export const useOpenPlayer = () => useContext(PlayerSheetContext);
