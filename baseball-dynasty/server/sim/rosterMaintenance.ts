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

import { getDb, prepared, type TeamRow, type LeagueRow } from '../db.js';
import { processWaivers } from './waivers.js';
import { evaluateCallUps } from './callup.js';
import { evaluateSendDowns } from './sendDown.js';
import { accrueServiceTime } from './serviceTime.js';
import { runProspectDev } from './prospectDev.js';
import { evaluateTradeDeadline, setTradePosture } from './tradeDeadline.js';
import { evaluateFirings } from './firings.js';
import { getFranchiseState, setGmConfidence } from './franchise.js';
import { resolveDirectives } from './directives.js';
import { insertNewsItem } from './news.js';
import { runCascadeEval, updateMinorStandings } from './cascade.js';
import { seedFor as _seedFor } from './prng.js';
import { decrementSuspensions } from './suspensions.js';
import { recalcChemistry, checkMalcontentPressure, applyTradeDemandPenalties } from './personality.js';
import { reaggravationRisk } from './injury.js';

// AB-NULL §4.3: One-time self-heal for carried-over DBs with stale is_on_25man on null-team players.
// Called once per runRosterMaintenance invocation — cheap (no-op if already clean).
function cleanupPhantom25man(leagueId: number): void {
  prepared(
    `UPDATE players SET is_on_25man = 0 WHERE league_id = ? AND team_id IS NULL AND is_on_25man = 1`
  ).run(leagueId);
}

// Roster invariant: each team should have exactly 25 on is_on_25man=1 (hard cap after cuts).
// During regular season, log warnings for violations. Auto-trim >25, auto-promote <25.
function checkRosterInvariant(leagueId: number, currentGameNumber: number = 0): void {
  const league = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
  if (!league) return;

  // AB-NULL FIX §2.1: scope to real teams (team_id IS NOT NULL) so retired/FA players
  // with stale is_on_25man=1 never form a null group that reports or loops forever.
  const counts = prepared(
    `SELECT team_id, COUNT(*) as cnt FROM players
     WHERE league_id = ? AND is_on_25man = 1 AND team_id IS NOT NULL
     GROUP BY team_id`
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
           AND (last_send_down_game IS NULL OR ? - last_send_down_game >= 5)
           ORDER BY overall_rating DESC LIMIT 1`
        ).get(v.team_id, currentGameNumber) as { id: number } | undefined;
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

  // AB-NULL §4.3: Self-heal stale is_on_25man=1 rows for null-team players (cheap, no-op if clean).
  try {
    cleanupPhantom25man(leagueId);
  } catch (err) {
    console.warn('[rosterMaintenance] Phantom 25man cleanup error:', err);
  }

  // Step 1: Service-time batch (league-wide, only when gameNumber % 10 === 0)
  // CB-08: additive-only, gated by last_service_time_update_game.
  if (gameNumber % 10 === 0) {
    try {
      accrueServiceTime(leagueId, gameNumber);
    } catch (err) {
      console.warn('[rosterMaintenance] Service time error:', err);
    }

    // Step 13: Chemistry recalc (per-team clock gated inside recalcChemistry)
    // malcontent pressure check, and trade demand penalty check
    try {
      const allTeamsForChem = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
      const leagueForPersonality = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
      const seasonForPersonality = leagueForPersonality?.season_number ?? 1;
      for (const t of allTeamsForChem) {
        recalcChemistry(leagueId, t.id, gameNumber);
        // NF-2: call checkMalcontentPressure every 10 games (GM confidence -5 if malcontent not moved)
        checkMalcontentPressure(leagueId, seasonForPersonality, gameNumber, t);
      }
      applyTradeDemandPenalties(leagueId, gameNumber);
    } catch (err) {
      console.warn('[rosterMaintenance] Chemistry/personality error:', err);
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

        // Step 12: Decrement suspension_games_remaining every game (no cadence gate)
        try {
          decrementSuspensions(leagueId, teamId, league.season_number, gameNumber);
        } catch (err) {
          console.warn(`[rosterMaintenance] Suspension decrement error for team ${teamId}:`, err);
        }

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

        // Step 8: Minor League Cascading — per-team clock (D-1)
        // Uses SEPARATE last_cascade_check_game clock (not the call-up clock).
        // Runs BEFORE checkRosterInvariant so settled cascade moves are respected (D-3).
        // MUST NOT be inside runProspectDev's transaction — sibling transaction only (D-2).
        const cascadeDue = team.games_played - (team.last_cascade_check_game ?? 0) >= 5;
        if (cascadeDue) {
          try {
            runCascadeEval(leagueId, teamId, league.season_number, gameNumber, team.gm_archetype ?? 'balanced');
            updateMinorStandings(leagueId, teamId, league.season_number, gameNumber);
            prepared('UPDATE teams SET last_cascade_check_game = ? WHERE id = ?').run(team.games_played, teamId);
          } catch (err) {
            console.warn(`[rosterMaintenance] Cascade eval error for team ${teamId}:`, err);
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

  // v0.3.0: GM confidence checkpoint + directive resolution for owned team
  if (league) {
    try {
      const fs = getFranchiseState(leagueId);
      if (fs && fs.owned_team_id != null) {
        const ownedTeamId = fs.owned_team_id;
        const ownedTeam = prepared('SELECT * FROM teams WHERE id = ?').get(ownedTeamId) as TeamRow | undefined;

        if (ownedTeam && (homeTeamId === ownedTeamId || awayTeamId === ownedTeamId)) {
          const gamesPlayed = ownedTeam.games_played;

          // 10-game confidence checkpoint (D12-REV)
          if (gamesPlayed - fs.last_confidence_checkpoint_game >= 10) {
            const margin = ownedTeam.wins - ownedTeam.losses;
            let delta = 0;
            if (margin > 0) delta = 2 * Math.floor(margin / 5);
            else if (margin < 0) delta = -1 * Math.floor((-margin) / 5);
            if (delta !== 0) setGmConfidence(leagueId, delta);
            prepared('UPDATE franchise_state SET last_confidence_checkpoint_game = ? WHERE league_id = ?')
              .run(gamesPlayed, leagueId);

            // Re-read confidence after update
            const fsUpdated = getFranchiseState(leagueId);
            const conf = fsUpdated?.gm_confidence ?? 100;

            // Resign trigger — L3: only emit once per season (dedupe across 10-game checkpoints)
            if (conf <= 0 && fsUpdated?.gm_resign_pending_season !== league.season_number) {
              const gmName = ownedTeam.gm_name ?? 'GM';
              insertNewsItem({
                leagueId, seasonNumber: league.season_number, gameNumber,
                eventType: 'gm_fired', teamId: ownedTeamId,
                headlineText: `${gmName} resigns, citing inability to operate with ownership interference.`,
                detailsJson: JSON.stringify({ reason: 'low_confidence_resignation' }),
              });
              prepared('UPDATE franchise_state SET gm_resign_pending_season = ? WHERE league_id = ?')
                .run(league.season_number, leagueId);
            }

            // Status update 80+ (<=1 per 10 games)
            if (conf >= 80 && gamesPlayed - (fsUpdated?.last_status_update_game ?? 0) >= 10) {
              const gmName = ownedTeam.gm_name ?? 'GM';
              insertNewsItem({
                leagueId, seasonNumber: league.season_number, gameNumber,
                eventType: 'milestone', teamId: ownedTeamId,
                headlineText: `${gmName}: The plan is working. We like where this club is headed.`,
                detailsJson: JSON.stringify({ kind: 'gm_status' }),
              });
              prepared('UPDATE franchise_state SET last_status_update_game = ? WHERE league_id = ?')
                .run(gamesPlayed, leagueId);
            }
          }

          // Directive resolution
          resolveDirectives(leagueId, league.season_number, gameNumber);
        }
      }
    } catch (err) {
      console.warn('[rosterMaintenance] Confidence/directive error:', err);
    }
  }

  // Step 10 + AB-10 Part A: Injury recovery sweep — teach about rehab (F-1, F-3)
  try {
    const db = getDb();

    // 1. Players whose IL stint has elapsed but who need rehab (rehab_games_remaining > 0):
    //    Move to AAA rehab (minor_level='AAA', is_injured stays 1 until rehab completes).
    //    DO NOT activate them yet.
    const rehabReady = prepared(
      `SELECT id, team_id, injury_type, injury_tier, rehab_games_remaining
       FROM players
       WHERE league_id = ? AND is_injured = 1 AND injury_return_game IS NOT NULL
         AND injury_return_game <= ? AND rehab_games_remaining > 0`
    ).all(leagueId, gameNumber) as Array<{
      id: number; team_id: number | null; injury_type: string | null;
      injury_tier: string | null; rehab_games_remaining: number;
    }>;

    for (const p of rehabReady) {
      // Place at AAA for rehab assignment (distinct from a real demotion)
      prepared(
        'UPDATE players SET minor_level = ?, is_on_mlb_roster = 0, is_on_25man = 0 WHERE id = ?'
      ).run('AAA', p.id);
    }

    // 2. Players already in rehab (minor_level='AAA', is_injured=1, rehab_games_remaining > 0):
    //    Decrement rehab_games_remaining each tick.
    //    Reaggravation check (seeded, skip for tier='day_to_day' or 'season_ending').
    const inRehab = prepared(
      `SELECT p.id, p.injury_tier, p.rehab_games_remaining, p.injury_return_game,
              COALESCE(t.medical_staff_rating, 5) as medical_staff_rating
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = ? AND p.is_injured = 1 AND p.minor_level = 'AAA'
         AND p.rehab_games_remaining > 0`
    ).all(leagueId) as Array<{
      id: number; injury_tier: string | null; rehab_games_remaining: number; injury_return_game: number | null;
      medical_staff_rating: number;
    }>;

    for (const p of inRehab) {
      // Skip reaggravation for DTD and season_ending (F-2)
      const tier = p.injury_tier;
      const skipReaggrav = tier === 'day_to_day' || tier === 'season_ending';

      let newRehab = p.rehab_games_remaining - 1;
      let newReturn = p.injury_return_game;

      if (!skipReaggrav) {
        // NF-3-rehab: use medical-staff-modified reaggravation risk (spec line 254)
        const rng = _seedFor('reaggrav', p.id ^ (gameNumber * 997));
        const risk = reaggravationRisk(p.medical_staff_rating);
        if (rng() < risk) {
          // Extend IL by 50% (apply to return_game, NOT to rehab_games past 15)
          const currentReturn = newReturn ?? gameNumber;
          const extension = Math.max(1, Math.floor((currentReturn - gameNumber) * 0.5));
          newReturn = currentReturn + extension;
          // Reset rehab timer (clamp to 15 per F-4)
          const tierRehabGames: Record<string, number> = {
            short_il: 3, standard_il: 5, long_il: 8
          };
          newRehab = Math.min(15, tierRehabGames[tier ?? 'standard_il'] ?? 5);
        }
      }

      if (newRehab <= 0) {
        // Rehab complete: activate to 25-man
        prepared(
          `UPDATE players
           SET rehab_games_remaining = 0, is_injured = 0, injury_return_game = NULL,
               minor_level = NULL, is_on_mlb_roster = 1, is_on_25man = 1
           WHERE id = ?`
        ).run(p.id);
      } else {
        // Still in rehab: decrement counter (clamped to 15 per F-4)
        prepared(
          'UPDATE players SET rehab_games_remaining = ?, injury_return_game = ? WHERE id = ?'
        ).run(Math.min(15, newRehab), newReturn, p.id);
      }
    }

    // 3. Players whose IL is done and rehab_games_remaining = 0 (no rehab needed):
    //    Activate directly (original AB-10 behavior).
    prepared(
      `UPDATE players
       SET is_injured = 0, injury_return_game = NULL,
           minor_level = CASE WHEN is_on_mlb_roster = 1 THEN 'AAA' ELSE minor_level END
       WHERE league_id = ? AND is_injured = 1 AND injury_return_game IS NOT NULL
         AND injury_return_game <= ? AND rehab_games_remaining = 0`
    ).run(leagueId, gameNumber);
  } catch (err) {
    console.warn('[rosterMaintenance] Injury recovery error:', err);
  }

  // Step 4: Roster invariant check
  try {
    checkRosterInvariant(leagueId, gameNumber);
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
