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

// =========================================================
// v0.5.0 Section 6: Every-5-game cadence functions
// =========================================================

// 6a. Streak evaluation — rolls hot/cold for each active (non-injured) 25-man player.
// Uses seeded PRNG. Writes only changed rows. Never mutates overall_rating.
function evaluateStreaks(leagueId: number, gameNumber: number, seed: number): void {
  const players = prepared(
    `SELECT id, overall_rating, streak_type, streak_games_remaining, is_injured
     FROM players
     WHERE league_id = ? AND is_on_25man = 1 AND is_injured = 0 AND team_id IS NOT NULL`
  ).all(leagueId) as Array<{
    id: number; overall_rating: number; streak_type: string | null;
    streak_games_remaining: number; is_injured: number;
  }>;

  const rng = _seedFor('streaks', seed ^ gameNumber);

  for (const player of players) {
    // If already streaking and has remaining games, don't re-roll (decrement is done in game.ts)
    if (player.streak_type !== null && player.streak_games_remaining > 0) continue;

    // 8% hot, 8% cold, 84% neutral (Section 4c thresholds)
    const roll = rng();
    const wasStreaking = player.streak_type !== null;
    let newType: string | null = null;
    let newGames = 0;

    if (roll < 0.08) {
      newType = 'hot';
      newGames = Math.floor(rng() * 4) + 3; // 3-6 games
    } else if (roll < 0.16) {
      newType = 'cold';
      newGames = Math.floor(rng() * 4) + 3; // 3-6 games
    }
    // else neutral — clear any expired streak

    if (newType !== player.streak_type || newGames !== player.streak_games_remaining) {
      prepared(
        'UPDATE players SET streak_type = ?, streak_games_remaining = ? WHERE id = ?'
      ).run(newType, newGames, player.id);

      // Emit news for notable streaks (overall >= 75 only — avoid noise)
      if (newType !== null && player.overall_rating >= 75 && !wasStreaking) {
        // Don't re-fire if was already in same streak; leagueId scoped news
        try {
          const teamRow = prepared('SELECT team_id, first_name, last_name FROM players WHERE id = ?').get(player.id) as {
            team_id: number | null; first_name: string; last_name: string;
          } | undefined;
          if (teamRow?.team_id) {
            const league = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
            if (league) {
              insertNewsItem({
                leagueId, seasonNumber: league.season_number, gameNumber,
                eventType: newType === 'hot' ? 'streak_hot' : 'streak_cold',
                teamId: teamRow.team_id,
                playerId: player.id,
                headlineText: newType === 'hot'
                  ? `${teamRow.first_name} ${teamRow.last_name} is on fire — entering hot streak`
                  : `${teamRow.first_name} ${teamRow.last_name} in a slump — cold streak begins`,
              });
            }
          }
        } catch (_e) { /* non-critical */ }
      }
    }
  }
}

// 6b. Live award race update — UPSERT award_races, emit lead-change news once per game.
// Tie-break: value DESC, player_id ASC (X-F6a / X-N1 determinism).
function updateAwardRaces(leagueId: number, gameNumber: number): void {
  const league = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
  if (!league) return;

  const conferences = ['American', 'National'] as const;
  const awards = ['mvp', 'cy_young', 'roy'] as const;

  for (const conference of conferences) {
    for (const award of awards) {
      // Build ranking based on season_stats + players in this conference
      let sql: string;
      if (award === 'mvp') {
        // MVP: batters by (hits + (hr * 4) + (rbi_est * 2)) — approximate WAR proxy
        sql = `
          SELECT ss.player_id,
                 (ss.hits + ss.home_runs * 4 + CAST(ss.at_bats * 0.25 AS INTEGER)) AS value
          FROM season_stats ss
          JOIN players p ON p.id = ss.player_id
          JOIN teams t ON t.id = p.team_id
          WHERE ss.league_id = ? AND ss.season_number = ?
            AND t.conference = ?
            AND p.team_id IS NOT NULL
            AND ss.at_bats > 30
          ORDER BY value DESC, ss.player_id ASC
          LIMIT 5
        `;
      } else if (award === 'cy_young') {
        // Cy Young: pitchers by wins + (strikeouts / 10) − (earned_runs / 3)
        sql = `
          SELECT ss.player_id,
                 (ss.wins + CAST(ss.strikeouts_pitching / 10 AS INTEGER) - CAST(ss.earned_runs / 3 AS INTEGER)) AS value
          FROM season_stats ss
          JOIN players p ON p.id = ss.player_id
          JOIN teams t ON t.id = p.team_id
          WHERE ss.league_id = ? AND ss.season_number = ?
            AND t.conference = ?
            AND p.team_id IS NOT NULL
            AND (p.position = 'SP' OR p.position = 'RP' OR p.position = 'CL')
            AND ss.innings_pitched > 20
          ORDER BY value DESC, ss.player_id ASC
          LIMIT 5
        `;
      } else {
        // ROY: minimum service_time = 1 (first year), best stats overall
        sql = `
          SELECT ss.player_id,
                 (ss.hits + ss.home_runs * 4 + ss.wins * 3) AS value
          FROM season_stats ss
          JOIN players p ON p.id = ss.player_id
          JOIN teams t ON t.id = p.team_id
          WHERE ss.league_id = ? AND ss.season_number = ?
            AND t.conference = ?
            AND p.team_id IS NOT NULL
            AND (p.service_time IS NULL OR p.service_time <= 1)
          ORDER BY value DESC, ss.player_id ASC
          LIMIT 5
        `;
      }

      const rows = prepared(sql).all(leagueId, league.season_number, conference) as Array<{
        player_id: number; value: number;
      }>;

      if (rows.length === 0) continue;

      const leader = rows[0];
      const second = rows[1] ?? null;

      // Read current race leader (for lead-change detection)
      // award_races table uses 'league' column (not 'conference') — matches migration 014
      const existing = prepared(
        `SELECT leader_player_id, leader_value FROM award_races WHERE league_id = ? AND season_number = ? AND award_type = ? AND league = ?`
      ).get(leagueId, league.season_number, award, conference) as {
        leader_player_id: number | null; leader_value: number | null;
      } | undefined;

      // Detect lead change (compare player_id, not value — X-F6a/X-N1)
      const prevLeaderId = existing?.leader_player_id ?? null;
      const leaderChanged = leader && prevLeaderId !== null && prevLeaderId !== leader.player_id;

      // UPSERT award_races (column 'league' maps to conference value)
      prepared(
        `INSERT INTO award_races (league_id, season_number, award_type, league, leader_player_id, leader_value, second_player_id, second_value, last_updated_game)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(league_id, season_number, award_type, league)
         DO UPDATE SET leader_player_id = excluded.leader_player_id,
                       leader_value = excluded.leader_value,
                       second_player_id = excluded.second_player_id,
                       second_value = excluded.second_value,
                       last_updated_game = excluded.last_updated_game`
      ).run(
        leagueId, league.season_number, award, conference,
        leader?.player_id ?? null, leader?.value ?? 0,
        second?.player_id ?? null, second?.value ?? 0,
        gameNumber
      );

      // Emit lead-change news (once per real lead change, gated by last_updated_game)
      if (leaderChanged && leader && (existing?.leader_player_id ?? null) !== null) {
        try {
          const newLeaderRow = prepared(
            'SELECT first_name, last_name, team_id FROM players WHERE id = ?'
          ).get(leader.player_id) as { first_name: string; last_name: string; team_id: number | null } | undefined;
          const prevLeaderRow = prepared(
            'SELECT first_name, last_name FROM players WHERE id = ?'
          ).get(prevLeaderId) as { first_name: string; last_name: string } | undefined;

          if (newLeaderRow && prevLeaderRow) {
            const awardLabel = award === 'mvp' ? `${conference.substring(0, 2)} MVP`
              : award === 'cy_young' ? `${conference.substring(0, 2)} Cy Young`
              : `${conference.substring(0, 2)} ROY`;
            insertNewsItem({
              leagueId, seasonNumber: league.season_number, gameNumber,
              eventType: 'award_leader_change',
              teamId: newLeaderRow.team_id ?? null,
              playerId: leader.player_id,
              headlineText: `${newLeaderRow.first_name} ${newLeaderRow.last_name} takes ${awardLabel} lead from ${prevLeaderRow.first_name} ${prevLeaderRow.last_name}`,
            });
          }
        } catch (_e) { /* non-critical */ }
      }
    }
  }
}

// 6c. Record-chasing milestone checks (rescaled for 50-game season — X-F7b)
// Single-season thresholds:
//   HR: alert at 40 HR with 15+ games remaining
//   Wins (pitchers): alert at 12 wins with 10+ games remaining
//   AVG: alert at .360 with 20+ games remaining
// Career thresholds (unchanged):
//   HR: 490→500, 585→600, 680→700
//   Hits: 2950→3000
//   Wins: 290→300
//   K: 2950→3000
function checkRecordChasers(leagueId: number, gameNumber: number, leagueGamesInSeason: number): void {
  const league = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
  if (!league) return;

  const gamesRemaining = Math.max(0, leagueGamesInSeason - gameNumber);

  // Single-season HR chasers
  if (gamesRemaining >= 15) {
    const hrChasers = prepared(
      `SELECT ss.player_id, ss.home_runs, p.first_name, p.last_name, p.team_id
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       WHERE ss.league_id = ? AND ss.season_number = ?
         AND ss.home_runs >= 40 AND p.team_id IS NOT NULL`
    ).all(leagueId, league.season_number) as Array<{
      player_id: number; home_runs: number; first_name: string; last_name: string; team_id: number;
    }>;

    for (const p of hrChasers) {
      try {
        insertNewsItem({
          leagueId, seasonNumber: league.season_number, gameNumber,
          eventType: 'record_watch', teamId: p.team_id, playerId: p.player_id,
          headlineText: `Record Watch — ${p.first_name} ${p.last_name} has ${p.home_runs} HR with ${gamesRemaining} games remaining`,
        });
      } catch (_e) { /* non-critical */ }
    }
  }

  // Single-season win chasers (pitchers)
  if (gamesRemaining >= 10) {
    const winChasers = prepared(
      `SELECT ss.player_id, ss.wins, p.first_name, p.last_name, p.team_id
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       WHERE ss.league_id = ? AND ss.season_number = ?
         AND ss.wins >= 12 AND p.team_id IS NOT NULL
         AND (p.position = 'SP' OR p.position = 'RP')`
    ).all(leagueId, league.season_number) as Array<{
      player_id: number; wins: number; first_name: string; last_name: string; team_id: number;
    }>;

    for (const p of winChasers) {
      try {
        insertNewsItem({
          leagueId, seasonNumber: league.season_number, gameNumber,
          eventType: 'record_watch', teamId: p.team_id, playerId: p.player_id,
          headlineText: `Record Watch — ${p.first_name} ${p.last_name} has ${p.wins} wins with ${gamesRemaining} games remaining`,
        });
      } catch (_e) { /* non-critical */ }
    }
  }

  // Career HR milestones
  const careerHrMilestones = [490, 585, 680];
  for (const threshold of careerHrMilestones) {
    const chasers = prepared(
      `SELECT p.id, p.first_name, p.last_name, p.team_id, p.career_hr
       FROM players p
       WHERE p.league_id = ? AND p.career_hr >= ? AND p.career_hr < ? + 20
         AND p.team_id IS NOT NULL`
    ).all(leagueId, threshold, threshold) as Array<{
      id: number; first_name: string; last_name: string; team_id: number; career_hr: number;
    }>;
    const target = threshold === 490 ? 500 : threshold === 585 ? 600 : 700;
    for (const p of chasers) {
      const needed = target - p.career_hr;
      try {
        insertNewsItem({
          leagueId, seasonNumber: league.season_number, gameNumber,
          eventType: 'record_watch', teamId: p.team_id, playerId: p.id,
          headlineText: `Record Watch — ${p.first_name} ${p.last_name} needs ${needed} HR to reach ${target} career home runs`,
        });
      } catch (_e) { /* non-critical */ }
    }
  }

  // Career hits milestone (2950→3000)
  const hitChasers = prepared(
    `SELECT p.id, p.first_name, p.last_name, p.team_id, p.career_hits
     FROM players p
     WHERE p.league_id = ? AND p.career_hits >= 2950 AND p.career_hits < 3020
       AND p.team_id IS NOT NULL`
  ).all(leagueId) as Array<{
    id: number; first_name: string; last_name: string; team_id: number; career_hits: number;
  }>;
  for (const p of hitChasers) {
    const needed = 3000 - p.career_hits;
    if (needed > 0) {
      try {
        insertNewsItem({
          leagueId, seasonNumber: league.season_number, gameNumber,
          eventType: 'record_watch', teamId: p.team_id, playerId: p.id,
          headlineText: `Record Watch — ${p.first_name} ${p.last_name} needs ${needed} hits to reach 3,000 career hits`,
        });
      } catch (_e) { /* non-critical */ }
    }
  }

  // Career wins milestone (290→300) — pitchers
  const winMilestoneChasers = prepared(
    `SELECT p.id, p.first_name, p.last_name, p.team_id, p.career_wins
     FROM players p
     WHERE p.league_id = ? AND p.career_wins >= 290 AND p.career_wins < 310
       AND p.team_id IS NOT NULL
       AND (p.position = 'SP' OR p.position = 'RP')`
  ).all(leagueId) as Array<{
    id: number; first_name: string; last_name: string; team_id: number; career_wins: number;
  }>;
  for (const p of winMilestoneChasers) {
    const needed = 300 - p.career_wins;
    if (needed > 0) {
      try {
        insertNewsItem({
          leagueId, seasonNumber: league.season_number, gameNumber,
          eventType: 'record_watch', teamId: p.team_id, playerId: p.id,
          headlineText: `Record Watch — ${p.first_name} ${p.last_name} needs ${needed} wins to reach 300 career wins`,
        });
      } catch (_e) { /* non-critical */ }
    }
  }

  // Career strikeout milestone (2950→3000)
  const kChasers = prepared(
    `SELECT p.id, p.first_name, p.last_name, p.team_id, p.career_k
     FROM players p
     WHERE p.league_id = ? AND p.career_k >= 2950 AND p.career_k < 3020
       AND p.team_id IS NOT NULL`
  ).all(leagueId) as Array<{
    id: number; first_name: string; last_name: string; team_id: number; career_k: number;
  }>;
  for (const p of kChasers) {
    const needed = 3000 - p.career_k;
    if (needed > 0) {
      try {
        insertNewsItem({
          leagueId, seasonNumber: league.season_number, gameNumber,
          eventType: 'record_watch', teamId: p.team_id, playerId: p.id,
          headlineText: `Record Watch — ${p.first_name} ${p.last_name} needs ${needed} strikeouts to reach 3,000 career strikeouts`,
        });
      } catch (_e) { /* non-critical */ }
    }
  }
}

// 6d. Rule 5 game-30 return check (one-shot, uses rule5_return_checked flag — Section 5c)
// If a Rule 5 player has not appeared in 30 games and the flag is not set, offer return.
function checkRule5Returns(leagueId: number, gameNumber: number): void {
  if (gameNumber < 30) return;

  const league = prepared('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number } | undefined;
  if (!league) return;

  // Players who were Rule 5 drafted this season and haven't been checked yet
  const candidates = prepared(
    `SELECT p.id, p.first_name, p.last_name, p.team_id, p.rule5_from_team_id,
            p.appearances_this_season
     FROM players p
     WHERE p.league_id = ? AND p.rule5_drafted = 1
       AND p.rule5_return_checked = 0
       AND p.team_id IS NOT NULL`
  ).all(leagueId) as Array<{
    id: number; first_name: string; last_name: string; team_id: number | null;
    rule5_from_team_id: number | null; appearances_this_season: number;
  }>;

  for (const player of candidates) {
    // Mark as checked (one-shot gate — X-F5c)
    prepared('UPDATE players SET rule5_return_checked = 1 WHERE id = ?').run(player.id);

    // If fewer than 10 appearances (hasn't contributed on 25-man), offer return
    if (player.appearances_this_season < 10 && player.rule5_from_team_id !== null) {
      // Return player to original team — move back
      prepared(
        `UPDATE players SET team_id = ?, is_on_mlb_roster = 0, is_on_25man = 0,
         minor_level = 'AAA', rule5_drafted = 0, rule5_from_team_id = NULL
         WHERE id = ?`
      ).run(player.rule5_from_team_id, player.id);

      // Insert transaction record
      try {
        prepared(
          `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, details_json, narrative, created_at)
           VALUES (?, ?, 'rule5_return', ?, ?, ?, ?, ?)`
        ).run(
          leagueId, league.season_number, player.team_id, player.id,
          JSON.stringify({ returned_to_team_id: player.rule5_from_team_id }),
          `${player.first_name} ${player.last_name} returned to original org`,
          Date.now()
        );

        insertNewsItem({
          leagueId, seasonNumber: league.season_number, gameNumber,
          eventType: 'rule5_draft', teamId: player.team_id ?? null, playerId: player.id,
          headlineText: `${player.first_name} ${player.last_name} returned to original organization (Rule 5)`,
        });
      } catch (_e) { /* non-critical */ }
    }
  }
}

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

  // v0.5.0 Section 6: Every-5-game cadence — streaks, award races, record chasers, Rule 5 return
  if (gameNumber % 5 === 0) {
    // 6a. Streak evaluation
    try {
      const leagueRowForSeed = prepared('SELECT worldgen_seed FROM leagues WHERE id = ?').get(leagueId) as { worldgen_seed: number } | undefined;
      const streakSeed = (leagueRowForSeed?.worldgen_seed ?? 12345) ^ gameNumber;
      evaluateStreaks(leagueId, gameNumber, streakSeed);
    } catch (err) {
      console.warn('[rosterMaintenance] Streak evaluation error:', err);
    }

    // 6b. Live award race update
    try {
      updateAwardRaces(leagueId, gameNumber);
    } catch (err) {
      console.warn('[rosterMaintenance] Award races update error:', err);
    }

    // 6c. Record-chasing milestones (50-game season, so leagueGamesInSeason = 250 total; ~50 per team)
    // Each team plays 50 home + 50 away = 50 games (20 teams × 50 games / 2 matchups)
    const LEAGUE_TOTAL_GAMES = 250; // 20 teams × 50 games / 2 = 250 games total in schedule
    try {
      checkRecordChasers(leagueId, gameNumber, LEAGUE_TOTAL_GAMES);
    } catch (err) {
      console.warn('[rosterMaintenance] Record chasers error:', err);
    }

    // 6d. Rule 5 game-30 return check (one-shot flag)
    try {
      checkRule5Returns(leagueId, gameNumber);
    } catch (err) {
      console.warn('[rosterMaintenance] Rule 5 return check error:', err);
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
