// Service Time System — Phase 6 (v0.2.0)
// Per [AB-05 RULING]: SERVICE_YEAR_GAMES=30, FREE_AGENT_SERVICE_GAMES=180.
// Per [AB-20 RULING]: additive-only, 10-game batch, no double-apply on restart.
// Per [CB-08 RULING]: ADDITIVE-ONLY (no subtraction path).

import { prepared } from '../db.js';

// AB-05: Service time constants
export const SERVICE_YEAR_GAMES = 30;
export const FREE_AGENT_SERVICE_GAMES = 6 * SERVICE_YEAR_GAMES; // 180

// Accrue service time for all is_on_25man=1 players in the league.
// Called when gameNumber % 10 === 0, gated by last_service_time_update_game.
// CB-08: additive-only; reads actual elapsed games from DB.
export function accrueServiceTime(leagueId: number, currentGameNumber: number): void {
  // Get the current league record for the last update game number
  const league = prepared(
    'SELECT id FROM leagues WHERE id = ?'
  ).get(leagueId) as { id: number } | undefined;
  if (!league) return;

  // Get the last update game number from teams (take min across teams to be safe)
  // Actually, per AB-20: service time uses last_service_time_update_game per team.
  // We update it per team in the team loop.

  // Get teams in the league
  const teams = prepared(
    'SELECT id, last_service_time_update_game FROM teams WHERE league_id = ?'
  ).all(leagueId) as Array<{ id: number; last_service_time_update_game: number }>;

  for (const team of teams) {
    const lastUpdate = team.last_service_time_update_game ?? 0;
    if (currentGameNumber <= lastUpdate) continue; // already updated

    const elapsed = currentGameNumber - lastUpdate;
    if (elapsed <= 0) continue;

    // CB-08: additive-only — no subtraction path
    // Add elapsed games to service_time_days for all is_on_25man=1 players on this team
    prepared(
      `UPDATE players
       SET service_time_days = MAX(0, service_time_days + ?)
       WHERE team_id = ? AND is_on_25man = 1 AND league_id = ?`
    ).run(elapsed, team.id, leagueId);

    // Update last_service_time_update_game
    prepared(
      'UPDATE teams SET last_service_time_update_game = ? WHERE id = ?'
    ).run(currentGameNumber, team.id);
  }

  // Set free_agent_eligible flag for players reaching the threshold
  prepared(
    `UPDATE players
     SET free_agent_eligible = 1
     WHERE league_id = ? AND service_time_days >= ? AND free_agent_eligible = 0`
  ).run(leagueId, FREE_AGENT_SERVICE_GAMES);
}
