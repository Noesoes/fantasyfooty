// Primary color for each NFL team (Sleeper abbreviations), for team-tinted
// headers. Hex without the leading #.

export const TEAM_COLORS: Record<string, string> = {
  ARI: "97233f",
  ATL: "a71930",
  BAL: "241773",
  BUF: "00338d",
  CAR: "0085ca",
  CHI: "0b162a",
  CIN: "fb4f14",
  CLE: "311d00",
  DAL: "003594",
  DEN: "fb4f14",
  DET: "0076b6",
  GB: "203731",
  HOU: "03202f",
  IND: "002c5f",
  JAX: "006778",
  KC: "e31837",
  LAC: "0080c6",
  LAR: "003594",
  LV: "000000",
  MIA: "008e97",
  MIN: "4f2683",
  NE: "002244",
  NO: "d3bc8d",
  NYG: "0b2265",
  NYJ: "125740",
  PHI: "004c54",
  PIT: "ffb612",
  SEA: "002244",
  SF: "aa0000",
  TB: "d50a0a",
  TEN: "4b92db",
  WAS: "5a1414",
};

export const teamColor = (team: string | null | undefined) =>
  team && TEAM_COLORS[team] ? `#${TEAM_COLORS[team]}` : null;
