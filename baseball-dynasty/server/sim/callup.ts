// Call-Up System — Phase 6 (v0.2.0)
// Per [AB-02 RULING]: rating-based triggers (no minor-league game stats).
// Per [AB-01 RULING]: 5-game per-team cadence via games_played.
// Per [AB-05 RULING]: service time manipulation for analytics GM with potential A/B.

import { getDb, prepared, type TeamRow, type PlayerRow } from '../db.js';
import { count40Man, dfaPlayer, findDfaCandidate } from './waivers.js';
import { seedFor } from './prng.js';
import { insertRosterNewsItem } from './news.js';

// AB-05: service-time constants
export const FREE_AGENT_SERVICE_GAMES = 180;
export const SERVICE_YEAR_GAMES = 30;
// Manipulation band: [FREE_AGENT_SERVICE_GAMES - 23, FREE_AGENT_SERVICE_GAMES)
const MANIPULATION_LOWER = FREE_AGENT_SERVICE_GAMES - 23; // 157

// Find the best available player at a position from the minor-league pipeline.
// Source order: AAA → AA → A → waiver wire → FA. Returns undefined if none found.
function findMinorLeaguer(
  teamId: number,
  leagueId: number,
  position: string,
  pitcherNeeded: boolean
): PlayerRow | undefined {
  const posFilter = pitcherNeeded
    ? `AND p.position IN ('SP','RP','CL')`
    : `AND p.position = '${position}'`;

  // AAA first, then AA, then A
  for (const level of ['AAA', 'AA', 'A']) {
    const player = prepared(
      `SELECT * FROM players p
       WHERE p.team_id = ? AND p.minor_level = ? ${posFilter}
         AND p.waiver_state = 'none'
       ORDER BY p.overall_rating DESC, p.potential DESC
       LIMIT 1`
    ).get(teamId, level) as PlayerRow | undefined;
    if (player) return player;
  }

  // Check waiver wire
  const fromWaivers = prepared(
    `SELECT * FROM players p
     WHERE p.league_id = ? AND p.waiver_state IN ('dfa','waivers') ${posFilter}
     ORDER BY p.overall_rating DESC
     LIMIT 1`
  ).get(leagueId) as PlayerRow | undefined;
  if (fromWaivers) return fromWaivers;

  // Check free agents
  const fromFa = prepared(
    `SELECT * FROM players p
     WHERE p.league_id = ? AND p.team_id IS NULL AND p.is_drafted = 1 ${posFilter}
     ORDER BY p.overall_rating DESC
     LIMIT 1`
  ).get(leagueId) as PlayerRow | undefined;
  return fromFa;
}

// Promote a player to the MLB 25-man roster.
// Handles 40-man cap (DFA a candidate if at 40), sets service time start.
function promotePlayer(
  player: PlayerRow,
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number,
  db: ReturnType<typeof import('../db.js').getDb>
): void {
  // Check 40-man cap
  if (count40Man(team.id) >= 40) {
    // Find a DFA candidate and DFA them first (AB-04 trigger 2)
    const candidate = findDfaCandidate(team.id, team.gm_archetype ?? 'balanced');
    if (candidate) {
      dfaPlayer(candidate.id, team.id, team.games_played, leagueId, seasonNumber);
    } else {
      console.warn(`[callup] Team ${team.id} at 40-man cap, no DFA candidate found`);
      return; // Cannot promote
    }
  }

  // Promote player
  db.prepare(
    `UPDATE players
     SET is_on_mlb_roster = 1,
         is_on_25man = 1,
         minor_level = NULL,
         team_id = ?,
         first_mlb_call_up_game = CASE WHEN first_mlb_call_up_game IS NULL THEN ? ELSE first_mlb_call_up_game END,
         waiver_state = 'none',
         dfa_team_id = NULL,
         claim_game_window_end = NULL
     WHERE id = ?`
  ).run(team.id, currentGameNumber, player.id);

  // Log call-up transaction
  const callUpResult = db.prepare(
    `INSERT INTO transactions
       (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
     VALUES (?, ?, 'call_up', ?, ?, NULL, ?)`
  ).run(leagueId, seasonNumber, team.id, player.id, Date.now());

  // §1.1(a): Insert call-up news item
  insertRosterNewsItem({
    leagueId,
    seasonNumber,
    gameNumber: currentGameNumber,
    eventType: 'call_up',
    teamId: team.id,
    playerId: player.id,
    sourceTable: 'transactions',
    sourceId: callUpResult.lastInsertRowid as number,
  });
}

// Evaluate and execute call-ups for a team.
// Called from rosterMaintenance at 5-game per-team cadence.
export function evaluateCallUps(
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number
): void {
  const db = getDb();

  const league = prepared('SELECT worldgen_seed FROM leagues WHERE id = ?').get(leagueId) as { worldgen_seed: number } | undefined;
  if (!league) return;

  const callUpTx = db.transaction(() => {
    // Trigger 1: roster < 25 (restore-to-25 trigger; fires whenever a send-down/DFA opens a slot)
    // §1.3: Changed from < 23 (unreachable without injuries) to < 25 (restore-to-full)
    const active25Man = (prepared(
      'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1'
    ).get(team.id) as { cnt: number }).cnt;

    if (active25Man < 25) {
      // Call up best available from pipeline — roster is short, promote anyone
      // Priority: positions with fewest players first (SP/RP/CL for game coverage)
      const posCounts = prepared(
        'SELECT position, COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1 GROUP BY position'
      ).all(team.id) as Array<{ position: string; cnt: number }>;
      const posMap = new Map(posCounts.map(r => [r.position, r.cnt]));

      // Priority order: SP first (needed for sims), then other positions
      const priorityOrder = ['SP', 'RP', 'CL', 'C', 'SS', 'CF', '1B', '2B', '3B', 'LF', 'RF', 'DH'];
      const sortedByNeed = priorityOrder.map(pos => ({
        pos,
        have: posMap.get(pos) ?? 0,
      })).sort((a, b) => a.have - b.have);

      let promoted = false;
      for (const { pos } of sortedByNeed) {
        const prospect = findMinorLeaguer(team.id, leagueId, pos, false);
        if (prospect) {
          if (shouldManipulate(prospect, team, currentGameNumber)) {
            db.prepare(
              'UPDATE players SET manipulation_delay_until_game = ? WHERE id = ?'
            ).run(currentGameNumber + Math.floor(Math.random() * 11) + 10, prospect.id);
            continue;
          }
          promotePlayer(prospect, team, leagueId, seasonNumber, currentGameNumber, db);
          promoted = true;
          break;
        }
      }

      if (!promoted) {
        // No prospects available — try best overall from any position
        const bestProspect = prepared(
          `SELECT * FROM players
           WHERE team_id = ? AND minor_level IS NOT NULL AND waiver_state = 'none'
           ORDER BY overall_rating DESC
           LIMIT 1`
        ).get(team.id) as PlayerRow | undefined;

        if (bestProspect) {
          if (!shouldManipulate(bestProspect, team, currentGameNumber)) {
            promotePlayer(bestProspect, team, leagueId, seasonNumber, currentGameNumber, db);
          }
        } else {
          console.warn(`[callup] Team ${team.id} roster short (${active25Man}/23) but no eligible minor leaguers`);
        }
      }
    }

    // Trigger 2: worst MLB position starter rated >= 5 below best AAA at same position
    const mlbPositionPlayers = prepared(
      `SELECT p.*, COALESCE(
        CAST(ss.recent_hits AS REAL) / NULLIF(ss.recent_ab, 0), 0
       ) as recent_ops_approx
       FROM players p
       LEFT JOIN season_stats ss ON ss.player_id = p.id AND ss.season_number = ?
       WHERE p.team_id = ? AND p.is_on_25man = 1
         AND p.position NOT IN ('SP','RP','CL')
       ORDER BY recent_ops_approx ASC
       LIMIT 3`
    ).all(seasonNumber, team.id) as PlayerRow[];

    for (const mlbPlayer of mlbPositionPlayers) {
      const bestAaa = prepared(
        `SELECT * FROM players
         WHERE team_id = ? AND minor_level = 'AAA' AND position = ?
           AND waiver_state = 'none'
         ORDER BY overall_rating DESC
         LIMIT 1`
      ).get(team.id, mlbPlayer.position) as PlayerRow | undefined;

      if (bestAaa && bestAaa.overall_rating >= mlbPlayer.overall_rating + 5) {
        // Send down the MLB player and call up AAA prospect
        if (shouldManipulate(bestAaa, team, currentGameNumber)) {
          db.prepare(
            'UPDATE players SET manipulation_delay_until_game = ? WHERE id = ?'
          ).run(currentGameNumber + Math.floor(Math.random() * 11) + 10, bestAaa.id);
          continue;
        }
        // The actual send-down will be handled by evaluateSendDowns
        promotePlayer(bestAaa, team, leagueId, seasonNumber, currentGameNumber, db);
        break;
      }
    }

    // Trigger 3: SP with recent ERA > 7.00 AND AAA SP available
    const mlbSps = prepared(
      `SELECT p.*, ss.recent_er, ss.recent_ip, ss.recent_starts
       FROM players p
       LEFT JOIN season_stats ss ON ss.player_id = p.id AND ss.season_number = ?
       WHERE p.team_id = ? AND p.is_on_25man = 1 AND p.position = 'SP'
         AND ss.recent_starts >= 3 AND ss.recent_ip > 0`
    ).all(seasonNumber, team.id) as Array<PlayerRow & { recent_er: number; recent_ip: number; recent_starts: number }>;

    for (const sp of mlbSps) {
      const recentEra = sp.recent_ip > 0 ? (sp.recent_er / sp.recent_ip) * 9 : 0;
      if (recentEra > 7.0) {
        const aaasp = prepared(
          `SELECT * FROM players
           WHERE team_id = ? AND minor_level = 'AAA' AND position = 'SP'
             AND waiver_state = 'none'
           ORDER BY overall_rating DESC
           LIMIT 1`
        ).get(team.id) as PlayerRow | undefined;

        if (aaasp && aaasp.overall_rating >= sp.overall_rating) {
          if (!shouldManipulate(aaasp, team, currentGameNumber)) {
            promotePlayer(aaasp, team, leagueId, seasonNumber, currentGameNumber, db);
            break;
          }
        }
      }
    }

    // Trigger 4: AAA prospect rated >= MLB starter + 5 at same position
    const aaaProspects = prepared(
      `SELECT * FROM players
       WHERE team_id = ? AND minor_level = 'AAA' AND waiver_state = 'none'
         AND (manipulation_delay_until_game IS NULL OR manipulation_delay_until_game <= ?)
       ORDER BY overall_rating DESC
       LIMIT 5`
    ).all(team.id, currentGameNumber) as PlayerRow[];

    for (const prospect of aaaProspects) {
      const mlbStarter = prepared(
        `SELECT * FROM players
         WHERE team_id = ? AND is_on_25man = 1 AND position = ?
         ORDER BY overall_rating ASC
         LIMIT 1`
      ).get(team.id, prospect.position) as PlayerRow | undefined;

      if (mlbStarter && prospect.overall_rating >= mlbStarter.overall_rating + 5) {
        if (!shouldManipulate(prospect, team, currentGameNumber)) {
          promotePlayer(prospect, team, leagueId, seasonNumber, currentGameNumber, db);
          break;
        }
      }
    }

    // Update last call-up check game
    db.prepare('UPDATE teams SET last_call_up_check_game = ? WHERE id = ?').run(team.games_played, team.id);
  });

  try {
    callUpTx();
  } catch (err) {
    console.warn(`[callup] Call-up eval error for team ${team.id}:`, err);
  }
}

// Check if a call-up should be delayed due to service time manipulation (AB-05).
function shouldManipulate(
  prospect: PlayerRow,
  team: TeamRow,
  currentGameNumber: number
): boolean {
  if ((team.gm_archetype ?? 'balanced') !== 'analytics') return false;
  if (!['A', 'B'].includes(prospect.potential)) return false;

  const stDays = prospect.service_time_days ?? 0;
  if (stDays >= MANIPULATION_LOWER && stDays < FREE_AGENT_SERVICE_GAMES) {
    return true;
  }

  // Also respect existing delay
  if (prospect.manipulation_delay_until_game !== null &&
      prospect.manipulation_delay_until_game > currentGameNumber) {
    return true;
  }

  return false;
}
