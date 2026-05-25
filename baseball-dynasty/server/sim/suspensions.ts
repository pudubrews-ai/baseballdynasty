// Suspension system — Step 12
// PED, gambling ban, brawl, dirty play, conduct suspensions.
// The roster-slot fix (G-1): suspended players KEEP is_on_25man=1 so they count against the cap.
// selectLineup/selectStartingPitcher in game.ts exclude suspension_games_remaining > 0.
//
// Priority order (B-3): gambling(#2) > PED-3rd(#3). If gambling fires, skip PED check.
// Transaction types 'suspended' and 'reinstated' are free-form (no CHECK on transactions table).

import { getDb, prepared, type PlayerRow } from '../db.js';
import { seedFor } from './prng.js';
import { insertNewsItem } from './news.js';

// ─────────────────────────────────────────────────────────────────────────────
// PED suspension model
// ─────────────────────────────────────────────────────────────────────────────

const PED_PROB_BASE = 0.002;          // 0.2%/player/season
const PED_PROB_AGING_MULT = 1.5;      // +50% weight for age 33+ with declining overall

const PED_DURATIONS = [50, 100, -1] as const; // offenses 1, 2, 3 (−1 = lifetime ban)

function pedProbability(age: number, overallRating: number): number {
  let p = PED_PROB_BASE;
  if (age >= 33 && overallRating < 75) p *= PED_AGING_MULT;
  return p;
}
// Note: PED_AGING_MULT referenced above
const PED_AGING_MULT = PED_PROB_AGING_MULT;

function pedSuspensionGames(pedOffenses: number): number {
  const idx = Math.min(pedOffenses, PED_DURATIONS.length - 1);
  return PED_DURATIONS[idx] ?? 50;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gambling ban model
// ─────────────────────────────────────────────────────────────────────────────

const GAMBLING_PROB_BASE = 0.0005; // 0.05%/player/season

// ─────────────────────────────────────────────────────────────────────────────
// HBP + Brawl model
// ─────────────────────────────────────────────────────────────────────────────

const HBP_PROB_PER_GAME = 0.12; // per-game seeded probability of HBP event

// ─────────────────────────────────────────────────────────────────────────────
// Main per-tick suspension rolls — called from dispatcher or maintenance
// seasonNumber needed to gate "once per season" rolls
// ─────────────────────────────────────────────────────────────────────────────

export function rollSuspensions(
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  worldgenSeed: number
): void {
  const db = getDb();
  const players = prepared(
    `SELECT id, age, overall_rating, ped_offenses, gambling_ban,
            suspension_games_remaining, team_id, first_name, last_name, position
     FROM players
     WHERE league_id = ? AND team_id IS NOT NULL
       AND gambling_ban = 0
       AND (is_on_25man = 1 OR minor_level IS NOT NULL)`
  ).all(leagueId) as Array<{
    id: number; age: number; overall_rating: number; ped_offenses: number; gambling_ban: number;
    suspension_games_remaining: number; team_id: number | null;
    first_name: string; last_name: string; position: string;
  }>;

  for (const player of players) {
    const playerName = `${player.first_name} ${player.last_name}`;

    // Priority #2: Gambling ban
    const gamblingRng = seedFor(`gambling_${seasonNumber}_${player.id}`, worldgenSeed);
    if (gamblingRng() < GAMBLING_PROB_BASE) {
      applyGamblingBan(db, leagueId, seasonNumber, gameNumber, player.id, playerName, player.team_id);
      continue; // B-3: gambling processed first, skip PED check this player
    }

    // Priority #3: PED
    if (player.ped_offenses < 3) { // only roll if not already lifetime banned
      const pedRng = seedFor(`ped_${seasonNumber}_${player.id}`, worldgenSeed);
      if (pedRng() < pedProbability(player.age, player.overall_rating)) {
        applyPedSuspension(db, leagueId, seasonNumber, gameNumber, player.id, playerName, player.team_id, player.ped_offenses);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply gambling ban (lifetime)
// ─────────────────────────────────────────────────────────────────────────────

function applyGamblingBan(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  playerId: number,
  playerName: string,
  teamId: number | null
): void {
  // Lifetime ban: set gambling_ban=1, remove from all rosters
  db.prepare(
    `UPDATE players
     SET gambling_ban = 1, suspension_games_remaining = 9999, suspension_type = 'gambling',
         is_on_25man = 0, is_on_mlb_roster = 0, team_id = NULL, minor_level = NULL
     WHERE id = ?`
  ).run(playerId);

  db.prepare(
    `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
     VALUES (?, ?, 'suspended', ?, ?, ?, ?)`
  ).run(leagueId, seasonNumber, teamId, playerId,
    `${playerName} has been permanently banned from baseball for gambling violations.`,
    Date.now());

  insertNewsItem({
    leagueId, seasonNumber, gameNumber,
    eventType: 'manager_fired', // closest available "nuclear" event type
    teamId,
    playerId,
    headlineText: `BREAKING: ${playerName} receives lifetime ban for gambling`,
  });

  console.log(`[suspensions] Gambling ban: ${playerName} (player ${playerId})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply PED suspension
// ─────────────────────────────────────────────────────────────────────────────

function applyPedSuspension(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  playerId: number,
  playerName: string,
  teamId: number | null,
  currentPedOffenses: number
): void {
  const newOffenses = currentPedOffenses + 1;
  const suspGames = pedSuspensionGames(newOffenses - 1); // 0-indexed

  if (suspGames === -1) {
    // Lifetime ban (3rd offense)
    db.prepare(
      `UPDATE players
       SET ped_offenses = ?, suspension_games_remaining = 9999, suspension_type = 'ped',
           is_on_25man = 0, is_on_mlb_roster = 0, team_id = NULL, minor_level = NULL,
           leadership = MAX(0, leadership - 10), coachability = MAX(0, coachability - 5)
       WHERE id = ?`
    ).run(newOffenses, playerId);

    db.prepare(
      `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
       VALUES (?, ?, 'suspended', ?, ?, ?, ?)`
    ).run(leagueId, seasonNumber, teamId, playerId,
      `${playerName} has received a lifetime ban for a third PED offense.`,
      Date.now());

    insertNewsItem({
      leagueId, seasonNumber, gameNumber,
      eventType: 'manager_fired',
      teamId, playerId,
      headlineText: `BREAKING: ${playerName} receives lifetime ban (3rd PED offense)`,
    });
  } else {
    // First or second offense: suspended but NOT removed from team
    // G-1: keep is_on_25man=1 so roster slot is held; exclude from lineup via suspension_games_remaining
    db.prepare(
      `UPDATE players
       SET ped_offenses = ?, suspension_games_remaining = ?, suspension_type = 'ped',
           leadership = MAX(0, leadership - 10), coachability = MAX(0, coachability - 5)
       WHERE id = ?`
    ).run(newOffenses, suspGames, playerId);

    db.prepare(
      `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
       VALUES (?, ?, 'suspended', ?, ?, ?, ?)`
    ).run(leagueId, seasonNumber, teamId, playerId,
      `${playerName} suspended ${suspGames} games for PED violation (offense #${newOffenses}).`,
      Date.now());

    insertNewsItem({
      leagueId, seasonNumber, gameNumber,
      eventType: 'injury', // closest event type for a roster-related event
      teamId, playerId,
      headlineText: `${playerName} suspended ${suspGames} games for PED violation`,
    });
  }

  console.log(`[suspensions] PED offense #${newOffenses}: ${playerName} — ${suspGames === -1 ? 'lifetime ban' : suspGames + ' games'}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Decrement suspension_games_remaining for players whose team played this tick
// Called from rosterMaintenance per-team loop
// ─────────────────────────────────────────────────────────────────────────────

export function decrementSuspensions(
  leagueId: number,
  teamId: number,
  seasonNumber: number,
  gameNumber: number
): void {
  const db = getDb();

  // Decrement for active (non-lifetime) suspensions
  const players = db.prepare(
    `SELECT id, first_name, last_name, suspension_games_remaining, suspension_type, gambling_ban
     FROM players
     WHERE league_id = ? AND team_id = ?
       AND suspension_games_remaining > 0 AND suspension_games_remaining < 9999`
  ).all(leagueId, teamId) as Array<{
    id: number; first_name: string; last_name: string;
    suspension_games_remaining: number; suspension_type: string | null; gambling_ban: number;
  }>;

  for (const player of players) {
    const newRemaining = player.suspension_games_remaining - 1;
    if (newRemaining <= 0) {
      // Reinstate
      db.prepare(
        'UPDATE players SET suspension_games_remaining = 0, suspension_type = NULL WHERE id = ?'
      ).run(player.id);

      db.prepare(
        `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
         VALUES (?, ?, 'reinstated', ?, ?, ?, ?)`
      ).run(leagueId, seasonNumber, teamId, player.id,
        `${player.first_name} ${player.last_name} reinstated from suspension.`,
        Date.now());
    } else {
      db.prepare(
        'UPDATE players SET suspension_games_remaining = ? WHERE id = ?'
      ).run(newRemaining, player.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HBP event generation — called from generateNotableEvents in game.ts
// Returns an HBP notable event with small probability, seeded
// ─────────────────────────────────────────────────────────────────────────────

export function maybeGenerateHbp(
  rng: () => number,
  teamId: number,
  gameNumber: number,
  leagueId: number
): { type: 'hbp'; teamId: number; count: number } | null {
  if (rng() < HBP_PROB_PER_GAME) {
    return { type: 'hbp', teamId, count: 1 };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brawl evaluation — checks recent HBP count (last 5 games)
// Called per-team in rosterMaintenance when callUpDue (every 5 games)
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateBrawl(
  leagueId: number,
  teamId: number,
  seasonNumber: number,
  gameNumber: number,
  worldgenSeed: number
): void {
  const db = getDb();

  // Count HBP events from game_log notable_events_json for this team in the last 5 games
  const recentGames = db.prepare(
    `SELECT notable_events_json FROM game_log
     WHERE league_id = ? AND season_number = ?
       AND (home_team_id = ? OR away_team_id = ?)
       AND game_number > ? - 5
     ORDER BY game_number DESC
     LIMIT 5`
  ).all(leagueId, seasonNumber, teamId, teamId, gameNumber) as Array<{ notable_events_json: string | null }>;

  let hbpCount = 0;
  for (const game of recentGames) {
    if (!game.notable_events_json) continue;
    try {
      const events = JSON.parse(game.notable_events_json) as Array<{ type?: string; teamId?: number }>;
      hbpCount += events.filter(e => e.type === 'hbp' && e.teamId === teamId).length;
    } catch { /* ignore parse errors */ }
  }

  if (hbpCount >= 3) {
    // Check if another HBP occurred this tick (seeded roll for brawl trigger)
    const rng = seedFor(`brawl_${teamId}_${gameNumber}`, worldgenSeed);
    if (rng() < 0.35) { // 35% chance of brawl when 3+ HBP in last 5 games
      triggerBrawl(db, leagueId, teamId, seasonNumber, gameNumber, worldgenSeed);
    }
  }
}

function triggerBrawl(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  teamId: number,
  seasonNumber: number,
  gameNumber: number,
  worldgenSeed: number
): void {
  const rng = seedFor(`brawl_players_${teamId}_${gameNumber}`, worldgenSeed);

  // Suspend 2-3 random players 3-5 games + manager 5-7 games
  const roster = db.prepare(
    `SELECT id, first_name, last_name FROM players
     WHERE team_id = ? AND is_on_25man = 1 AND suspension_games_remaining = 0
     LIMIT 20`
  ).all(teamId) as Array<{ id: number; first_name: string; last_name: string }>;

  const numSuspended = 2 + Math.floor(rng() * 2); // 2-3
  const shuffled = roster.sort(() => rng() - 0.5).slice(0, numSuspended);

  for (const p of shuffled) {
    const suspGames = 3 + Math.floor(rng() * 3); // 3-5 games
    db.prepare(
      `UPDATE players SET suspension_games_remaining = ?, suspension_type = 'brawl' WHERE id = ?`
    ).run(suspGames, p.id);

    db.prepare(
      `INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
       VALUES (?, ?, 'suspended', ?, ?, ?, ?)`
    ).run(leagueId, seasonNumber, teamId, p.id,
      `${p.first_name} ${p.last_name} suspended ${suspGames} games for role in brawl.`,
      Date.now());
  }

  // Manager suspended 5-7 games (mark in team name as interim flag)
  const managerSusp = 5 + Math.floor(rng() * 3);
  db.prepare("UPDATE teams SET manager_name = '[EJECTED] ' || COALESCE(manager_name, 'Manager') WHERE id = ?")
    .run(teamId);

  insertNewsItem({
    leagueId, seasonNumber, gameNumber,
    eventType: 'injury', // closest available type
    teamId,
    headlineText: `Brawl! ${numSuspended} players suspended, manager ejected for ${managerSusp} games`,
  });

  console.log(`[suspensions] Brawl: team ${teamId} — ${numSuspended} players suspended`);
}
