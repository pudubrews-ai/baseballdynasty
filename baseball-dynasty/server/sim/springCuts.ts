// Spring Training Cuts — Phase 4 (v0.2.0)
// Per [AB-08 RULING]: atomic with spring_cuts_done_season, respects position minimums.
// Per [AB-14 RULING]: spring releases go directly to FA (NOT waivers).
// Spec: each team trims from 40-man to exactly 25 on is_on_25man=1.

import { getDb, prepared, type LeagueRow, type TeamRow, type PlayerRow } from '../db.js';
import { insertTransactionNewsItem, insertRosterNewsItem } from './news.js';

// Position minimums that must be preserved on the 25-man (matches worldgen checks)
const POSITION_MINIMUMS: Array<{ pos: string; min: number }> = [
  { pos: 'C',  min: 1 },
  { pos: 'SS', min: 1 },
  { pos: 'CF', min: 1 },
  { pos: 'SP', min: 2 },
  { pos: 'CL', min: 1 },
];

const TARGET_25MAN = 25;

// Check whether spring cuts need to run for this league/season.
// AB-08: run when phase='regular_season', current_game_number=0,
// and spring_cuts_done_season IS NULL or < season_number.
export function springCutsNeeded(league: LeagueRow): boolean {
  if (league.phase !== 'regular_season') return false;
  if (league.current_game_number !== 0) return false;
  return (
    league.spring_cuts_done_season === null ||
    league.spring_cuts_done_season < league.season_number
  );
}

// Returns all 25-man players for a team, ordered for cut priority.
// analytics GM: cuts by lowest overall_rating first.
// old-school GM: cuts by lowest age first (protect veterans; cut youngest).
// balanced: cuts by lowest overall_rating first (same as analytics).
function getCutCandidates(
  teamId: number,
  gmArchetype: string
): PlayerRow[] {
  const orderBy =
    gmArchetype === 'old-school'
      ? 'p.age ASC, p.overall_rating ASC'  // cut youngest first (loyalty to veterans)
      : 'p.overall_rating ASC, p.age DESC'; // cut lowest value first

  return prepared(
    `SELECT p.* FROM players p
     WHERE p.team_id = ? AND p.is_on_25man = 1
     ORDER BY ${orderBy}`
  ).all(teamId) as PlayerRow[];
}

// Count how many players a team has at each position on the 25-man.
function buildPosMap(teamId: number): Map<string, number> {
  const rows = prepared(
    'SELECT position, COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1 GROUP BY position'
  ).all(teamId) as Array<{ position: string; cnt: number }>;
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.position, r.cnt);
  return map;
}

// Check if removing a player at `position` from the 25-man would violate position minimums.
function wouldViolateMinimum(position: string, posMap: Map<string, number>): boolean {
  for (const { pos, min } of POSITION_MINIMUMS) {
    if (pos !== position) continue;
    const current = posMap.get(position) ?? 0;
    if (current - 1 < min) return true;
  }
  return false;
}

// Execute spring training cuts for all teams in the league.
// AB-08: runs in ONE db.transaction() with the spring_cuts_done_season write.
// AB-14: releases go directly to FA (team_id=NULL, NOT waivers).
export function runSpringCuts(league: LeagueRow): void {
  const db = getDb();

  const doSpringCuts = db.transaction(() => {
    const leagueId: number = league.id;

    const teams = prepared(
      'SELECT * FROM teams WHERE league_id = ?'
    ).all(leagueId) as TeamRow[];

    for (const team of teams) {
      runSpringCutsForTeam(team, league.season_number, leagueId);
    }

    // Mark spring cuts done for this season (atomic with cuts)
    prepared(
      'UPDATE leagues SET spring_cuts_done_season = ? WHERE id = ?'
    ).run(league.season_number, leagueId);

    console.log(`[springCuts] Season ${league.season_number} spring cuts complete`);
  });

  doSpringCuts();
}

function runSpringCutsForTeam(
  team: TeamRow,
  seasonNumber: number,
  leagueId: number
): void {
  // Count current 25-man roster
  const current25Man = (prepared(
    'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1'
  ).get(team.id) as { cnt: number }).cnt;

  // Step 1: if over 25, cut excess players first (before repair so repair doesn't fight trim)
  if (current25Man > TARGET_25MAN) {
    const excess = current25Man - TARGET_25MAN;
    const cutCandidates = getCutCandidates(team.id, team.gm_archetype ?? 'balanced');

    let cutsMade = 0;

    for (const player of cutCandidates) {
      if (cutsMade >= excess) break;

      // Build current position map to check minimums
      const posMap = buildPosMap(team.id);

      // Do not cut if it would violate position minimums
      if (wouldViolateMinimum(player.position, posMap)) {
        continue;
      }

      const hasOptions = (player.options_remaining ?? 3) > 0;
      const isReleaseable =
        player.overall_rating < 45 &&
        player.potential === 'D' &&
        player.age >= 24;

      if (isReleaseable) {
        // Release directly to FA pool
        releaseToFa(player, team.id, seasonNumber, leagueId);
        cutsMade++;
      } else if (hasOptions) {
        // Send down to AAA — stays on 40-man (is_on_mlb_roster=1), off 25-man
        prepared(
          `UPDATE players
           SET is_on_25man = 0,
               minor_level = 'AAA',
               options_remaining = options_remaining - 1
           WHERE id = ?`
        ).run(player.id);

        // Log transaction
        const scSendResult = prepared(
          `INSERT INTO transactions
             (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
           VALUES (?, ?, 'send_down', ?, ?, ?, ?)`
        ).run(
          leagueId,
          seasonNumber,
          team.id,
          player.id,
          null,
          Date.now()
        );

        // §1.1(b): Insert spring cuts send-down news item
        insertRosterNewsItem({
          leagueId,
          seasonNumber,
          gameNumber: 0,
          eventType: 'send_down',
          teamId: team.id,
          playerId: player.id,
          sourceTable: 'transactions',
          sourceId: scSendResult.lastInsertRowid as number,
        });

        cutsMade++;
      } else {
        // options_remaining = 0 and not releasable by rule a:
        // AB-14: spring cuts never use waivers — release to FA directly
        releaseToFa(player, team.id, seasonNumber, leagueId);
        cutsMade++;
      }
    }
  }

  // Step 2: repair position minimums (may push count above 25 if team was short on a position)
  repairPositionMinimums(team, seasonNumber, leagueId);

  // Step 3: trim back to exactly 25 if repair pushed us over
  // (Always run — handles cases where team started at exactly 25 but repair added players)
  let postRepair25Man = (prepared(
    'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1'
  ).get(team.id) as { cnt: number }).cnt;

  while (postRepair25Man > TARGET_25MAN) {
    const posMap = buildPosMap(team.id);
    // Get all players on 25-man, ordered by priority to cut (lowest rating first)
    const trimCandidates = prepared(
      `SELECT * FROM players
       WHERE team_id = ? AND is_on_25man = 1
       ORDER BY overall_rating ASC, age ASC`
    ).all(team.id) as PlayerRow[];

    // Find first non-minimum-protected candidate
    const overage = trimCandidates.find(p => !wouldViolateMinimum(p.position, posMap));

    if (!overage) {
      // All remaining are minimum-protected — accept the slight overcount
      break;
    }

    const hasOptions = (overage.options_remaining ?? 3) > 0;
    if (hasOptions) {
      prepared(
        `UPDATE players SET is_on_25man = 0, minor_level = 'AAA', options_remaining = options_remaining - 1 WHERE id = ?`
      ).run(overage.id);
      const sdResult = prepared(
        `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, 'send_down', ?, ?, NULL, ?)`
      ).run(leagueId, seasonNumber, team.id, overage.id, Date.now());
      insertRosterNewsItem({
        leagueId, seasonNumber, gameNumber: 0, eventType: 'send_down',
        teamId: team.id, playerId: overage.id,
        sourceTable: 'transactions', sourceId: sdResult.lastInsertRowid as number,
      });
    } else {
      releaseToFa(overage, team.id, seasonNumber, leagueId);
    }

    postRepair25Man--;
  }

  // Step 4: fill up to 25 if we are short
  fillTo25(team, seasonNumber, leagueId);

  const final25Man = (prepared(
    'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1'
  ).get(team.id) as { cnt: number }).cnt;

  console.log(
    `[springCuts] Team ${team.id} (${team.name}): ${current25Man} → ${final25Man} on 25-man`
  );
}

// Fill team up to exactly 25 on the 25-man, promoting from 40-man then minors then FA.
function fillTo25(team: TeamRow, seasonNumber: number, leagueId: number): void {
  let count = (prepared(
    'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1'
  ).get(team.id) as { cnt: number }).cnt;

  if (count >= TARGET_25MAN) return;

  // First try 40-man reserves (on mlb roster but not 25-man)
  while (count < TARGET_25MAN) {
    const from40 = prepared(
      `SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND is_on_25man = 0 AND minor_level IS NOT NULL
       ORDER BY overall_rating DESC LIMIT 1`
    ).get(team.id) as PlayerRow | undefined;

    if (from40) {
      prepared('UPDATE players SET is_on_25man = 1, minor_level = NULL WHERE id = ?').run(from40.id);
      prepared(
        `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, 'call_up', ?, ?, NULL, ?)`
      ).run(leagueId, seasonNumber, team.id, from40.id, Date.now());
      count++;
      continue;
    }

    // Try any minors player on this team
    const fromMinors = prepared(
      `SELECT * FROM players WHERE team_id = ? AND minor_level IS NOT NULL AND waiver_state = 'none'
       ORDER BY overall_rating DESC LIMIT 1`
    ).get(team.id) as PlayerRow | undefined;

    if (fromMinors) {
      prepared('UPDATE players SET is_on_mlb_roster = 1, is_on_25man = 1, minor_level = NULL WHERE id = ?').run(fromMinors.id);
      prepared(
        `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, 'call_up', ?, ?, NULL, ?)`
      ).run(leagueId, seasonNumber, team.id, fromMinors.id, Date.now());
      count++;
      continue;
    }

    // Try FA
    const fromFa = prepared(
      `SELECT * FROM players WHERE league_id = ? AND team_id IS NULL AND is_drafted = 1
       ORDER BY overall_rating DESC LIMIT 1`
    ).get(leagueId) as PlayerRow | undefined;

    if (fromFa) {
      prepared('UPDATE players SET team_id = ?, is_on_mlb_roster = 1, is_on_25man = 1, minor_level = NULL WHERE id = ?').run(team.id, fromFa.id);
      prepared(
        `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, 'signing', ?, ?, NULL, ?)`
      ).run(leagueId, seasonNumber, team.id, fromFa.id, Date.now());
      count++;
      continue;
    }

    console.warn(`[springCuts] Team ${team.id} cannot reach 25 — no more players available (have ${count})`);
    break;
  }
}

// Repair position minimums after cuts by promoting from 40-man reserves or free agents.
// This is the spring-cuts analogue of validatePostDraftRosters for the 25-man.
function repairPositionMinimums(
  team: TeamRow,
  seasonNumber: number,
  leagueId: number
): void {
  for (const { pos, min } of POSITION_MINIMUMS) {
    const have = (prepared(
      'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1 AND position = ?'
    ).get(team.id, pos) as { cnt: number }).cnt;

    if (have >= min) continue;

    const deficit = min - have;
    console.warn(
      `[springCuts] Team ${team.id} (${team.name}) has ${have}/${min} ${pos} — repairing`
    );

    for (let i = 0; i < deficit; i++) {
      // Try to promote from own 40-man reserves (is_on_mlb_roster=1, is_on_25man=0)
      const from40Man = prepared(
        `SELECT id FROM players
         WHERE team_id = ? AND position = ? AND is_on_mlb_roster = 1 AND is_on_25man = 0
         ORDER BY overall_rating DESC LIMIT 1`
      ).get(team.id, pos) as { id: number } | undefined;

      if (from40Man) {
        prepared(
          'UPDATE players SET is_on_25man = 1, minor_level = NULL WHERE id = ?'
        ).run(from40Man.id);
        continue;
      }

      // Try minors pool of same team
      const fromMinors = prepared(
        `SELECT id FROM players
         WHERE team_id = ? AND position = ? AND is_on_mlb_roster = 0 AND minor_level IS NOT NULL
         ORDER BY overall_rating DESC LIMIT 1`
      ).get(team.id, pos) as { id: number } | undefined;

      if (fromMinors) {
        prepared(
          'UPDATE players SET is_on_mlb_roster = 1, is_on_25man = 1, minor_level = NULL WHERE id = ?'
        ).run(fromMinors.id);
        prepared(
          `INSERT INTO transactions
             (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
           VALUES (?, ?, 'call_up', ?, ?, ?, ?)`
        ).run(leagueId, seasonNumber, team.id, fromMinors.id, null, Date.now());
        continue;
      }

      // Try any FA in the league pool
      const fromFa = prepared(
        `SELECT id FROM players
         WHERE league_id = ? AND team_id IS NULL AND position = ? AND is_drafted = 1
         ORDER BY overall_rating DESC LIMIT 1`
      ).get(leagueId, pos) as { id: number } | undefined;

      if (fromFa) {
        prepared(
          'UPDATE players SET team_id = ?, is_on_mlb_roster = 1, is_on_25man = 1, minor_level = NULL WHERE id = ?'
        ).run(team.id, fromFa.id);
        prepared(
          `INSERT INTO transactions
             (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
           VALUES (?, ?, 'signing', ?, ?, ?, ?)`
        ).run(leagueId, seasonNumber, team.id, fromFa.id, null, Date.now());
        continue;
      }

      console.warn(
        `[springCuts] Cannot repair ${pos} deficit for team ${team.id} — no players available`
      );
    }
  }
}

function releaseToFa(
  player: PlayerRow,
  _originalTeamId: number,
  seasonNumber: number,
  leagueId: number
): void {
  // Release to FA pool: team_id=NULL, off roster entirely, waiver_state stays 'none'
  prepared(
    `UPDATE players
     SET team_id = NULL,
         is_on_mlb_roster = 0,
         is_on_25man = 0,
         minor_level = NULL,
         waiver_state = 'none',
         dfa_team_id = NULL,
         claim_game_window_end = NULL
     WHERE id = ?`
  ).run(player.id);

  // Log release transaction
  const releaseResult = prepared(
    `INSERT INTO transactions
       (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
     VALUES (?, ?, 'release', ?, ?, ?, ?)`
  ).run(
    leagueId,
    seasonNumber,
    null,              // team_id null (released)
    player.id,
    null,
    Date.now()
  );

  // §1.1(b): Insert spring cut release news item
  insertTransactionNewsItem({
    leagueId,
    seasonNumber,
    gameNumber: 0,
    eventType: 'release',
    teamId: null,
    playerId: player.id,
    sourceTable: 'transactions',
    sourceId: releaseResult.lastInsertRowid as number,
  });
}
