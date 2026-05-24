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

import { getDb, prepared, getActiveLeague } from '../db.js';
import { processWaivers } from './waivers.js';

// Roster invariant: each team should have <= 25 on is_on_25man=1 (hard cap after cuts).
// During regular season, we log a warning if any team exceeds 25.
function checkRosterInvariant(leagueId: number): void {
  const violations = prepared(
    `SELECT team_id, COUNT(*) as cnt
     FROM players
     WHERE league_id = ? AND is_on_25man = 1
     GROUP BY team_id
     HAVING cnt > 25`
  ).all(leagueId) as Array<{ team_id: number; cnt: number }>;

  for (const v of violations) {
    console.warn(
      `[rosterMaintenance] Invariant violation: team ${v.team_id} has ${v.cnt} on 25-man (expected <=25)`
    );
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

  // Step 1: Waiver sweep (every tick, league-wide, cheap indexed query)
  // Note: per AB-18, each step runs in its own transaction or is folded into one.
  // We run the waiver sweep and per-team maintenance in the same call but each
  // module manages its own transactions internally.
  try {
    processWaivers(leagueId);
  } catch (err) {
    console.warn('[rosterMaintenance] Waiver sweep error:', err);
  }

  // Step 2: Roster invariant check
  try {
    checkRosterInvariant(leagueId);
  } catch (err) {
    console.warn('[rosterMaintenance] Invariant check error:', err);
  }

  // Steps 3-4 (call-ups, send-downs, firings, prospect dev) will be added in Phases 6-7.
}
