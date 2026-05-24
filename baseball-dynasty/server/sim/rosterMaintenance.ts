// Roster Maintenance Hook — Phase 5/6 (v0.2.0)
// Per [AB-18 RULING]: runs as a SIBLING transaction after simulateGame, every tick including skips.
// Per [AB-01 RULING]: per-team cadence gates use teams.games_played.
//
// Order of operations (§4 spec):
// 1. Service-time batch (league-wide, when gameNumber % 10 === 0, gated by last_service_time_update_game)
// 2. Waiver sweep processWaivers (league-wide, every tick)
// 3. For each of {homeTeamId, awayTeamId}:
//    a. Send-down eval (if games_played - last_call_up_check_game >= 5)
//    b. Call-up eval (same gate)
//    c. Firing eval
//    d. Trade posture / deadline
// 4. Prospect dev tick (league-wide, when gameNumber % 10 === 0)
// 5. Roster invariant check
//
// AB-18: Crash-gap acceptance — if crash between game commit and maintenance commit,
// next tick re-evaluates conditions (all maintenance is cadence/range-based, idempotent).

import { getDb, prepared, type TeamRow } from '../db.js';
import { processWaivers } from './waivers.js';
import { evaluateCallUps } from './callup.js';
import { evaluateSendDowns } from './sendDown.js';
import { accrueServiceTime } from './serviceTime.js';
import { runProspectDev } from './prospectDev.js';
import { evaluateTradeDeadline, setTradePosture } from './tradeDeadline.js';
import { evaluateFirings } from './firings.js';

// Roster invariant: each team should have exactly 25 on is_on_25man=1 (hard cap after cuts).
// During regular season, log warnings for violations. Auto-trim >25, auto-promote <25.
function checkRosterInvariant(leagueId: number): void {
  const league = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
  if (!league) return;

  const counts = prepared(
    `SELECT team_id, COUNT(*) as cnt FROM players WHERE league_id = ? AND is_on_25man = 1 GROUP BY team_id`
  ).all(leagueId) as Array<{ team_id: number; cnt: number }>;

  for (const v of counts) {
    if (v.cnt > 25) {
      console.warn(
        `[rosterMaintenance] Invariant violation: team ${v.team_id} has ${v.cnt} on 25-man (expected 25) — trimming`
      );
      // Trim: remove lowest-rated players over 25
      let excess = v.cnt - 25;
      while (excess > 0) {
        const lowest = prepared(
          `SELECT * FROM players WHERE team_id = ? AND is_on_25man = 1 ORDER BY overall_rating ASC LIMIT 1`
        ).get(v.team_id) as { id: number; options_remaining: number; overall_rating: number } | undefined;
        if (!lowest) break;
        if ((lowest.options_remaining ?? 0) > 0) {
          prepared(
            `UPDATE players SET is_on_25man = 0, minor_level = 'AAA', options_remaining = options_remaining - 1 WHERE id = ?`
          ).run(lowest.id);
        } else {
          prepared(
            `UPDATE players SET is_on_25man = 0, is_on_mlb_roster = 0, team_id = NULL, minor_level = NULL WHERE id = ?`
          ).run(lowest.id);
        }
        excess--;
      }
    } else if (v.cnt < 25) {
      // Auto-promote reserves from 40-man or minors
      let deficit = 25 - v.cnt;
      while (deficit > 0) {
        const fromMinors = prepared(
          `SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND is_on_25man = 0 AND minor_level IS NOT NULL
           ORDER BY overall_rating DESC LIMIT 1`
        ).get(v.team_id) as { id: number } | undefined;
        if (fromMinors) {
          prepared('UPDATE players SET is_on_25man = 1, minor_level = NULL WHERE id = ?').run(fromMinors.id);
          deficit--;
          continue;
        }
        // No more 40-man reserves — leave short
        break;
      }
    }
  }
}

// Main entry point — called from engine.ts:runGameTick AFTER simulateGame returns.
// Unconditional: runs even on skipped-game ticks (AB-18/AB-03).
export function runRosterMaintenance(
  leagueId: number,
  homeTeamId: number,
  awayTeamId: number,
  gameNumber: number
): void {
  const db = getDb();

  // Step 1: Service-time batch (league-wide, only when gameNumber % 10 === 0)
  // CB-08: additive-only, gated by last_service_time_update_game.
  if (gameNumber % 10 === 0) {
    try {
      accrueServiceTime(leagueId, gameNumber);
    } catch (err) {
      console.warn('[rosterMaintenance] Service time error:', err);
    }
  }

  // Step 2: Waiver sweep (every tick, league-wide, cheap indexed query)
  try {
    processWaivers(leagueId);
  } catch (err) {
    console.warn('[rosterMaintenance] Waiver sweep error:', err);
  }

  // Step 3: Per-team maintenance (only for teams that just played)
  const league = prepared(
    'SELECT season_number FROM leagues WHERE id = ?'
  ).get(leagueId) as { season_number: number } | undefined;

  if (league) {
    for (const teamId of [homeTeamId, awayTeamId]) {
      try {
        const team = prepared('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow | undefined;
        if (!team) continue;

        // AB-01: 5-game per-team cadence for call-ups/send-downs
        const callUpDue = team.games_played - team.last_call_up_check_game >= 5;
        if (callUpDue) {
          // §1.1 (iter-3 fix): Evaluate FIRST so evaluators read the accumulated window,
          // THEN reset for the next 5-game cycle.
          // (Previous order reset before evaluate, making recent_* always 0 at eval time.)
          evaluateSendDowns(team, leagueId, league.season_number, gameNumber);
          evaluateCallUps(team, leagueId, league.season_number, gameNumber);
          // Note: last_call_up_check_game is updated inside evaluateCallUps

          // §2.7: Reset recent_* windows AFTER evaluation (sliding window approximation)
          // This makes recent stats reflect only the last ~5 games, not season totals
          try {
            prepared(
              `UPDATE season_stats
               SET recent_ab = 0, recent_hits = 0, recent_hr = 0, recent_walks = 0,
                   recent_er = 0, recent_ip = 0, recent_starts = 0
               WHERE league_id = ? AND season_number = ?
                 AND player_id IN (SELECT id FROM players WHERE team_id = ?)`
            ).run(leagueId, league.season_number, teamId);
          } catch (err) {
            console.warn(`[rosterMaintenance] recent_* reset error for team ${teamId}:`, err);
          }
        }

        // Firing evaluation (Phase 9): every tick (cadence is gated inside evaluateFirings)
        try {
          evaluateFirings(team, leagueId, league.season_number, gameNumber);
        } catch (err) {
          console.warn(`[rosterMaintenance] Firing eval error for team ${teamId}:`, err);
        }

        // Trade posture / deadline evaluation
        try {
          if (team.games_played >= 30) {
            const allTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
            if (!team.trade_posture) {
              setTradePosture(team, allTeams);
            }
            evaluateTradeDeadline(team, allTeams, leagueId, league.season_number);
          }
        } catch (err) {
          console.warn(`[rosterMaintenance] Trade deadline eval error for team ${teamId}:`, err);
        }
      } catch (err) {
        console.warn(`[rosterMaintenance] Per-team maintenance error for team ${teamId}:`, err);
      }
    }
  }

  // Step 4: Roster invariant check
  try {
    checkRosterInvariant(leagueId);
  } catch (err) {
    console.warn('[rosterMaintenance] Invariant check error:', err);
  }

  // Step 4: Prospect dev tick (league-wide, only when gameNumber % 10 === 0)
  if (gameNumber % 10 === 0) {
    try {
      runProspectDev(leagueId, gameNumber);
    } catch (err) {
      console.warn('[rosterMaintenance] Prospect dev error:', err);
    }
  }
  // Step 5: Firings — evaluateFirings called per-team above (Phase 9).
}
