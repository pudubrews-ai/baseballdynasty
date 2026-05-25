// Simultaneous Event Priority dispatcher — Step 15
// Called once per regular-season game tick from engine.ts:runGameTick,
// synchronously, BEFORE simulateGame runs (tragedy check) and AFTER simulateGame
// returns (all other checks), BEFORE scheduleTick re-arms.
//
// Priority order (B-1 / spec §Step-15):
//   1. Tragedy        — if fires: pause sim; defer ALL other events; return true
//   2. Gambling ban   — sweep roster for gambling_ban=1 players still on teams
//   3. PED third      — sweep roster for ped_offenses>=3 players; skip if gambling fired (B-3)
//   4. Relocation     — queue threat flag only (H-1: resolution deferred to season end)
//   5. Injury / suspension — handled in game.ts (injuries) and rosterMaintenance (suspensions)
//   6. Minor-league cascade — handled in rosterMaintenance (per-team cadence, sibling txn)
//
// The dispatcher is fully synchronous and timer-free (G5/G12 inspect for async escapes).
// All probability rolls use seedFor.
//
// Returns: DispatcherResult with tragedyFired flag.
// Caller (engine.ts) calls setSimSpeed('paused') when tragedyFired=true.

import { prepared, type LeagueRow, type TeamRow } from '../db.js';
import { scrubError } from '../util/scrub.js';
import { rollAndResolveTragedy } from './tragedy.js';
import { checkGamblingBanThisTick, checkPedThirdOffenseThisTick } from './suspensions.js';
import { checkRelocationThreat, setRelocationThreat } from './sales.js';

export interface DispatcherResult {
  tragedyFired: boolean;
}

/**
 * runDispatcher — the single ordered between-tick event handler.
 * Call this BEFORE simulateGame on the current tick so tragedy can defer the game.
 * Items 2-6 are evaluated after simulateGame completes (engine.ts sequences these).
 *
 * In practice engine.ts calls this once, checks tragedyFired, and if false
 * proceeds to simulateGame → rosterMaintenance (which handles priorities 5-6).
 *
 * @param league       Current league row (fresh from DB)
 * @param gameNumber   Current game number (from schedule)
 * @param homeTeamId   Home team for this tick
 * @param awayTeamId   Away team for this tick
 * @returns            DispatcherResult with tragedyFired flag
 */
export function runDispatcher(
  league: LeagueRow,
  gameNumber: number,
  homeTeamId: number,
  awayTeamId: number
): DispatcherResult {
  const leagueId = league.id;
  const seasonNumber = league.season_number;
  const worldgenSeed = league.worldgen_seed;

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 1: Tragedy
  // At most one tragedy per tick (B-2). If one fires, pause and defer everything else.
  // engine.ts calls setSimSpeed('paused') after this returns tragedyFired=true
  // (circular-import guard — tragedy.ts does NOT import engine.ts).
  // ─────────────────────────────────────────────────────────────────────────
  try {
    const hadTragedy = rollAndResolveTragedy(leagueId, seasonNumber, gameNumber, worldgenSeed);
    if (hadTragedy) {
      // All lower-priority events are deferred to the next tick
      return { tragedyFired: true };
    }
  } catch (err) {
    console.warn('[dispatcher] Tragedy roll error:', scrubError(err).message);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 2: Gambling ban sweep
  // Processes before PED (B-3). Sweeps any player with gambling_ban=1 still on
  // a roster (enforces removal if rollSuspensions at game 1 left stragglers).
  // ─────────────────────────────────────────────────────────────────────────
  let gamblingBanFiredThisTick = false;
  try {
    gamblingBanFiredThisTick = checkGamblingBanThisTick(leagueId, seasonNumber, gameNumber, worldgenSeed);
  } catch (err) {
    console.warn('[dispatcher] Gambling ban check error:', scrubError(err).message);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 3: PED third offense sweep
  // Skip if a gambling ban already fired this tick (B-3: only one lifetime-ban removal per tick).
  // ─────────────────────────────────────────────────────────────────────────
  if (!gamblingBanFiredThisTick) {
    try {
      checkPedThirdOffenseThisTick(leagueId, seasonNumber, gameNumber, worldgenSeed);
    } catch (err) {
      console.warn('[dispatcher] PED third offense check error:', scrubError(err).message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 4: Relocation threat (queue only — H-1: resolve at season end)
  // Check all teams for relocation conditions every 5 games to avoid per-game overhead.
  // The actual resolution happens in the 'relocation_resolve' offseason step.
  // ─────────────────────────────────────────────────────────────────────────
  if (gameNumber % 5 === 0) {
    try {
      const allTeams = prepared(
        'SELECT * FROM teams WHERE league_id = ? AND relocation_threat_active = 0'
      ).all(leagueId) as TeamRow[];

      for (const team of allTeams) {
        if (checkRelocationThreat(team, leagueId, seasonNumber)) {
          setRelocationThreat(team.id, leagueId, seasonNumber, gameNumber);
        }
      }
    } catch (err) {
      console.warn('[dispatcher] Relocation threat check error:', scrubError(err).message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 5: Injury / Suspension
  // Injuries are handled atomically inside game.ts simulateGame (already done).
  // Suspension decrements + brawl evaluation are handled in rosterMaintenance.ts
  // (called by engine.ts immediately after this dispatcher returns).
  // ─────────────────────────────────────────────────────────────────────────
  // (delegated to rosterMaintenance — no action here)

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 6: Minor-league cascade (last — after all roster changes settle)
  // Per-team cadence (every 5 games_played) and sibling-transaction requirement
  // are both enforced inside rosterMaintenance.ts. No action here.
  // ─────────────────────────────────────────────────────────────────────────
  // (delegated to rosterMaintenance — no action here)

  // Suppress unused-var warnings for homeTeamId/awayTeamId (available for future use)
  void homeTeamId;
  void awayTeamId;

  return { tragedyFired: false };
}
