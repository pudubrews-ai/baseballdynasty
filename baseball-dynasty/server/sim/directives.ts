// Owner Directives helpers — v0.3.0 §7
// Cooldown checks, recording, resolution.

import { getDb, prepared } from '../db.js';
import { setGmConfidence, getFranchiseState } from './franchise.js';
import { insertNewsItem } from './news.js';

export function hasDirectiveThisSeason(
  leagueId: number,
  season: number,
  type: string
): boolean {
  const row = prepared(
    'SELECT COUNT(*) as cnt FROM owner_directives WHERE league_id = ? AND season_number = ? AND directive_type = ?'
  ).get(leagueId, season, type) as { cnt: number };
  return row.cnt > 0;
}

export function countDirectiveThisSeason(
  leagueId: number,
  season: number,
  type: string
): number {
  const row = prepared(
    'SELECT COUNT(*) as cnt FROM owner_directives WHERE league_id = ? AND season_number = ? AND directive_type = ?'
  ).get(leagueId, season, type) as { cnt: number };
  return row.cnt;
}

export function recordDirective(
  leagueId: number,
  season: number,
  type: string,
  issuedGame: number,
  targetPlayerId: number | null = null
): number {
  const result = getDb().prepare(
    `INSERT INTO owner_directives
       (league_id, season_number, directive_type, issued_game, target_player_id, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(leagueId, season, type, issuedGame, targetPlayerId, Date.now());
  return result.lastInsertRowid as number;
}

// Resolve target_player directives for the owned team each tick.
// Called from rosterMaintenance after per-team loop.
export function resolveDirectives(
  leagueId: number,
  season: number,
  currentGameNumber: number
): void {
  const fs = getFranchiseState(leagueId);
  if (!fs || fs.owned_team_id == null) return;

  const ownedTeamId = fs.owned_team_id;

  const pending = prepared(
    `SELECT * FROM owner_directives
     WHERE league_id = ? AND season_number = ? AND directive_type = 'target_player' AND resolved = 0`
  ).all(leagueId, season) as Array<{
    id: number;
    target_player_id: number | null;
    issued_game: number;
  }>;

  const db = getDb();

  for (const directive of pending) {
    if (directive.target_player_id == null) continue;

    // Check if player is now on the owned team
    const player = prepared(
      'SELECT id, first_name, last_name, team_id, is_injured FROM players WHERE id = ?'
    ).get(directive.target_player_id) as {
      id: number; first_name: string; last_name: string;
      team_id: number | null; is_injured: number;
    } | undefined;

    if (!player) {
      db.prepare('UPDATE owner_directives SET resolved = 1, outcome = ? WHERE id = ?')
        .run('player_not_found', directive.id);
      continue;
    }

    const playerName = `${player.first_name} ${player.last_name}`;

    if (player.team_id === ownedTeamId) {
      // Acquired
      db.prepare('UPDATE owner_directives SET resolved = 1, outcome = ? WHERE id = ?')
        .run('acquired', directive.id);
      const league = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
      insertNewsItem({
        leagueId,
        seasonNumber: season,
        gameNumber: currentGameNumber,
        eventType: 'milestone',
        teamId: ownedTeamId,
        headlineText: `${playerName} acquired — owner's wish granted.`,
        detailsJson: JSON.stringify({ kind: 'directive_acquired', playerId: player.id }),
      });
    } else if (player.is_injured === 1) {
      // Cancelled due to injury
      db.prepare('UPDATE owner_directives SET resolved = 1, outcome = ? WHERE id = ?')
        .run('cancelled_injury', directive.id);
      insertNewsItem({
        leagueId,
        seasonNumber: season,
        gameNumber: currentGameNumber,
        eventType: 'milestone',
        teamId: ownedTeamId,
        headlineText: `${playerName} injured — acquisition target cancelled.`,
        detailsJson: JSON.stringify({ kind: 'directive_cancelled_injury', playerId: player.id }),
      });
    } else if (currentGameNumber - directive.issued_game >= 10) {
      // Missed window
      db.prepare('UPDATE owner_directives SET resolved = 1, outcome = ? WHERE id = ?')
        .run('missed', directive.id);
      setGmConfidence(leagueId, -5);
      insertNewsItem({
        leagueId,
        seasonNumber: season,
        gameNumber: currentGameNumber,
        eventType: 'milestone',
        teamId: ownedTeamId,
        headlineText: `GM could not land ${playerName} within the window.`,
        detailsJson: JSON.stringify({ kind: 'directive_missed', playerId: player.id }),
      });
    }
    // else: still in window, not yet resolved
  }
}
