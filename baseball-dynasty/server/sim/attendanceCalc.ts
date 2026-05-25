// v0.5.0: Shared attendance rate computation (X-F12a — Critical).
// Used by BOTH watch.ts (live per-game crowd-fill) and offseason.ts (season average).
// A single source of truth for attendance modifiers prevents silent divergence.

import type { TeamRow } from '../db.js';

/**
 * Compute the attendance rate (0.0 - 1.0) for a team in a given context.
 * Clamp to [0.35, 1.0].
 *
 * @param team - The team row (market_size, wins, losses, new_stadium_honeymoon_seasons_remaining)
 * @param rivalOpponentIds - Set of team IDs considered rivals (for rivalry_game_modifier)
 * @param isPlayoffRace - True if team is within 5 games of a playoff spot
 * @param isNewStadiumHoneymoon - True if team is in new stadium honeymoon (overrides the column check)
 * @param hasStarPlayer - True if team has any player with overall_rating >= 85
 * @param isRivalryGame - True for a specific game that is a rivalry matchup (not season average)
 * @param opponentTeamId - Optional opponent team ID; when provided, checked against rivalOpponentIds
 */
export function computeAttendanceRate(
  team: TeamRow,
  rivalOpponentIds: number[],
  isPlayoffRace: boolean,
  isNewStadiumHoneymoon: boolean,
  hasStarPlayer: boolean,
  isRivalryGame: boolean = false,
  opponentTeamId?: number
): number {
  // Base attendance rate from market size
  const baseRates: Record<string, number> = {
    mega: 0.85, large: 0.75, medium: 0.65, small: 0.55,
  };
  const baseRate = baseRates[team.market_size] ?? 0.65;

  // Winning modifier
  const totalGames = (team.wins ?? 0) + (team.losses ?? 0);
  const winPct = totalGames > 0 ? (team.wins ?? 0) / totalGames : 0.5;
  let winningModifier = 1.0;
  if (winPct > 0.55) winningModifier = 1.08;
  else if (winPct < 0.45) winningModifier = 0.92;

  // Rivalry modifier: +15% for rivalry matchups
  const rivalryActive = isRivalryGame ||
    (opponentTeamId !== undefined && rivalOpponentIds.includes(opponentTeamId));
  const rivalryModifier = rivalryActive ? 1.15 : 1.0;

  // Playoff race modifier: +10% when within 5 games of a playoff spot
  const playoffRaceModifier = isPlayoffRace ? 1.10 : 1.0;

  // New stadium honeymoon: +20% first 2 seasons
  const honeymoonModifier = (isNewStadiumHoneymoon ||
    (team.new_stadium_honeymoon_seasons_remaining ?? 0) > 0) ? 1.20 : 1.0;

  // Star player bonus: +5% attendance if team has overall >= 85 player
  const starBonus = hasStarPlayer ? 0.05 : 0.0;

  const rate = Math.max(0.35, Math.min(1.0,
    baseRate * winningModifier * rivalryModifier * playoffRaceModifier * honeymoonModifier + starBonus
  ));

  return rate;
}
