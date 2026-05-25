// Streak/last10 helper — v0.3.0 §4
// Used by /api/standings and /api/watch.

import { prepared } from '../db.js';

export function computeTeamStreak(
  leagueId: number,
  teamId: number,
  seasonNumber: number
): { streak: string; last10: string } {
  const rows = prepared(
    `SELECT home_team_id, away_team_id, home_score, away_score
     FROM game_log
     WHERE league_id = ? AND season_number = ? AND is_complete = 1
       AND (home_team_id = ? OR away_team_id = ?)
     ORDER BY id DESC
     LIMIT 20`
  ).all(leagueId, seasonNumber, teamId, teamId) as Array<{
    home_team_id: number;
    away_team_id: number;
    home_score: number;
    away_score: number;
  }>;

  if (rows.length === 0) return { streak: '-', last10: '0-0' };

  // Determine win/loss for each row
  const results: boolean[] = rows.map(r => {
    if (r.home_team_id === teamId) {
      return r.home_score > r.away_score;
    } else {
      return r.away_score > r.home_score;
    }
  });

  // streak: leading run of same result from most recent
  const firstResult = results[0]!;
  let streakCount = 0;
  for (const r of results) {
    if (r === firstResult) streakCount++;
    else break;
  }
  const streak = `${firstResult ? 'W' : 'L'}${streakCount}`;

  // last10: first 10 results
  const last10Games = results.slice(0, 10);
  const wins = last10Games.filter(Boolean).length;
  const losses = last10Games.length - wins;
  const last10 = `${wins}-${losses}`;

  return { streak, last10 };
}
