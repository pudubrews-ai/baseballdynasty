// Send-Down System — Phase 6 (v0.2.0)
// Per [AB-02 RULING]: MLB-side triggers are real stats; AAA-side is rating-only.
// Per [AB-04 RULING]: no options → DFA instead of send-down.

import { getDb, prepared, type TeamRow, type PlayerRow } from '../db.js';
import { dfaPlayer } from './waivers.js';
import { insertRosterNewsItem } from './news.js';

// Evaluate and execute send-downs for a team.
// Called from rosterMaintenance at 5-game per-team cadence (shared with call-ups).
export function evaluateSendDowns(
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number = 0
): void {
  const db = getDb();

  const sendDownTx = db.transaction(() => {
    // Trigger 1: Player recent OPS < .560 over recent_ab >= 20 AND AAA replacement rated higher
    const lowOpsPlayers = prepared(
      `SELECT p.*, ss.recent_ab, ss.recent_hits, ss.recent_hr, ss.recent_walks
       FROM players p
       LEFT JOIN season_stats ss ON ss.player_id = p.id AND ss.season_number = ?
       WHERE p.team_id = ? AND p.is_on_25man = 1
         AND p.position NOT IN ('SP','RP','CL')
         AND ss.recent_ab >= 20`
    ).all(seasonNumber, team.id) as Array<PlayerRow & { recent_ab: number; recent_hits: number; recent_hr: number; recent_walks: number }>;

    for (const player of lowOpsPlayers) {
      if (player.recent_ab === 0) continue;
      const recentOps = (player.recent_hits + player.recent_hr + player.recent_walks) / player.recent_ab;
      if (recentOps >= 0.560) continue;

      // Check AAA replacement
      const aaaReplacement = prepared(
        `SELECT * FROM players
         WHERE team_id = ? AND minor_level = 'AAA' AND position = ?
           AND waiver_state = 'none'
         ORDER BY overall_rating DESC
         LIMIT 1`
      ).get(team.id, player.position) as PlayerRow | undefined;

      // AB-10 Part B: within-5 band — a struggling regular can be optioned for an equal/lesser
      // AAA replacement. Development closes the gap; strictly-greater was never reachable.
      if (!aaaReplacement || aaaReplacement.overall_rating < player.overall_rating - 5) continue;

      // Send down or DFA
      executeSendDown(player, team, leagueId, seasonNumber, db, currentGameNumber);
      break; // One send-down per eval pass to avoid cascade
    }

    // Trigger 2: SP recent ERA > 6.50 over recent_starts >= 4 AND AAA replacement available
    const highEraSps = prepared(
      `SELECT p.*, ss.recent_er, ss.recent_ip, ss.recent_starts
       FROM players p
       LEFT JOIN season_stats ss ON ss.player_id = p.id AND ss.season_number = ?
       WHERE p.team_id = ? AND p.is_on_25man = 1 AND p.position = 'SP'
         AND ss.recent_starts >= 4 AND ss.recent_ip > 0`
    ).all(seasonNumber, team.id) as Array<PlayerRow & { recent_er: number; recent_ip: number; recent_starts: number }>;

    for (const sp of highEraSps) {
      const recentEra = sp.recent_ip > 0 ? (sp.recent_er / sp.recent_ip) * 9 : 0;
      if (recentEra <= 6.5) continue;

      const aaaSp = prepared(
        `SELECT * FROM players
         WHERE team_id = ? AND minor_level = 'AAA' AND position = 'SP'
           AND waiver_state = 'none'
         ORDER BY overall_rating DESC
         LIMIT 1`
      ).get(team.id) as PlayerRow | undefined;

      if (!aaaSp) continue;

      executeSendDown(sp, team, leagueId, seasonNumber, db, currentGameNumber);
      break;
    }
  });

  try {
    sendDownTx();
  } catch (err) {
    console.warn(`[sendDown] Send-down eval error for team ${team.id}:`, err);
  }
}

function executeSendDown(
  player: PlayerRow,
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  db: ReturnType<typeof import('../db.js').getDb>,
  currentGameNumber: number = 0
): void {
  if ((player.options_remaining ?? 0) > 0) {
    // Options remaining: send to AAA (stays on 40-man)
    db.prepare(
      `UPDATE players
       SET is_on_25man = 0,
           minor_level = 'AAA',
           options_remaining = options_remaining - 1
       WHERE id = ?`
    ).run(player.id);

    const sdResult = db.prepare(
      `INSERT INTO transactions
         (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
       VALUES (?, ?, 'send_down', ?, ?, NULL, ?)`
    ).run(leagueId, seasonNumber, team.id, player.id, Date.now());

    // §1.1(a): Insert send-down news item
    insertRosterNewsItem({
      leagueId,
      seasonNumber,
      gameNumber: currentGameNumber,
      eventType: 'send_down',
      teamId: team.id,
      playerId: player.id,
      sourceTable: 'transactions',
      sourceId: sdResult.lastInsertRowid as number,
    });

    console.log(`[sendDown] ${player.first_name} ${player.last_name} sent down to AAA`);
  } else {
    // No options remaining: DFA instead (AB-04 trigger 1)
    // dfaPlayer now writes its own DFA news item — do NOT double-insert here
    dfaPlayer(player.id, team.id, team.games_played, leagueId, seasonNumber, currentGameNumber);
    console.log(`[sendDown] ${player.first_name} ${player.last_name} DFA'd (no options remaining)`);
  }
}
