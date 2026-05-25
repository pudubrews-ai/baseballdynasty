// Tragedy system — Step 11
// Rolls per-player/manager between game ticks. At most ONE tragedy per tick (B-2).
// Event flow:
//   1. Synchronously: write procedural fallback, insert pinned news, set memorial flags,
//      apply morale effects, skip 3 game numbers, call setSimSpeed('paused').
//   2. Fire-and-forget via setImmediate: call callTragedy() LLM, update news item if passes denylist.
//
// Tragedies do NOT fire during active playoff series (L1).
// Tragedy victim who is suspended/on-rehab: clear suspension + rehab slots (B-4).
// News badge: 'FRONT OFFICE' (no 'TRAGEDY' badge — would require table swap).
// "Pinned for 5 games" ordering handled in /api/news route (not here).

import { getDb, prepared } from '../db.js';
import { seedFor, randInt } from './prng.js';
import { callTragedy } from '../services/llm.js';

// ─────────────────────────────────────────────────────────────────────────────
// Probability model (per spec §7)
// ─────────────────────────────────────────────────────────────────────────────

const LEAGUE_GAMES_PER_SEASON = 500;  // 20 teams × 50 games / 2 = 500 total game ticks per season
const PLAYER_BASE_PROB = 0.0001 / LEAGUE_GAMES_PER_SEASON;   // 0.01% per player per season
const MANAGER_BASE_PROB = 0.00025 / LEAGUE_GAMES_PER_SEASON; // 0.025% per manager per season

function playerTragProb(age: number, isOnMlbRoster: boolean): number {
  let p = PLAYER_BASE_PROB;
  // Age bracket (mutually exclusive, per spec)
  if (age <= 22)      p *= 1.5;
  else if (age <= 32) p *= 1.0;
  else if (age <= 37) p *= 1.2;
  else                p *= 1.8;  // 38+
  // Roster level
  if (isOnMlbRoster) p *= 1.3;
  else               p *= 0.7;   // Rookie/A per spec
  return p;
}

function managerTragProb(age: number): number {
  let p = MANAGER_BASE_PROB;
  if (age < 50)       p *= 0.7;
  else if (age <= 65) p *= 1.0;
  else                p *= 2.0;  // 65+
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural fallback obituary
// ─────────────────────────────────────────────────────────────────────────────

function fallbackObituary(playerName: string, teamName: string, position: string, age: number): string {
  return `The ${teamName} and the baseball community mourn the passing of ${playerName}, ${position}, age ${age}. He will be remembered always. His number will be retired in his honor.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply morale effect to the team's 25-man roster players
// player death → win prob -3% for 10 games: set morale_effect_bp = -300 for 10 games
// manager death → +2% "play for him" for 15 games: set morale_effect_bp = +200 for 15 games
// ─────────────────────────────────────────────────────────────────────────────

function applyTeamMoraleEffect(
  db: ReturnType<typeof getDb>,
  teamId: number,
  moraleBp: number,
  durationGames: number,
  currentGameNumber: number
): void {
  db.prepare(
    `UPDATE players
     SET morale_effect_bp = ?, morale_effect_until_game = ?
     WHERE team_id = ? AND is_on_25man = 1`
  ).run(moraleBp, currentGameNumber + durationGames, teamId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3-game league pause (L4)
// Advance current_game_number by 3 — leaves a gap in game_log.
// getNextGame uses schedule ORDER BY game_number, so after the gap it finds the next
// scheduled game normally (schedule rows are pre-generated; gap is in game_log only).
// ─────────────────────────────────────────────────────────────────────────────

function applyThreeGamePause(db: ReturnType<typeof getDb>, leagueId: number): void {
  db.prepare(
    'UPDATE leagues SET current_game_number = current_game_number + 3 WHERE id = ?'
  ).run(leagueId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — called from dispatcher (Step 15) between game ticks
// Returns true if a tragedy was resolved this tick (so dispatcher can stop processing others)
// ─────────────────────────────────────────────────────────────────────────────

export function rollAndResolveTragedy(
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  worldgenSeed: number
): boolean {
  const db = getDb();

  // Roll per player (B-2: resolve only the first — sort by lowest player_id for determinism)
  const players = prepared(
    `SELECT id, first_name, last_name, age, position, team_id, is_on_mlb_roster, is_on_25man,
            memorial, tragedy_victim
     FROM players
     WHERE league_id = ? AND memorial = 0 AND tragedy_victim = 0`
  ).all(leagueId) as Array<{
    id: number; first_name: string; last_name: string; age: number; position: string;
    team_id: number | null; is_on_mlb_roster: number; is_on_25man: number;
    memorial: number; tragedy_victim: number;
  }>;

  // Sort by id for determinism (B-2)
  players.sort((a, b) => a.id - b.id);

  for (const player of players) {
    const rng = seedFor(`tragedy_${player.id}`, worldgenSeed ^ seasonNumber ^ gameNumber);
    const prob = playerTragProb(player.age, player.is_on_mlb_roster === 1);

    if (rng() < prob) {
      // TRAGEDY — resolve synchronously (J-3)
      resolveTragedy(db, leagueId, seasonNumber, gameNumber, worldgenSeed, {
        playerId: player.id,
        playerName: `${player.first_name} ${player.last_name}`,
        teamId: player.team_id,
        age: player.age,
        position: player.position,
        isManager: false,
      });
      return true; // B-2: only one per tick
    }
  }

  // Roll per manager (managers are stored as name strings on teams, not as separate entities)
  // Manager tragedy probability is per team. Use team manager_name as proxy.
  const teams = prepared(
    'SELECT id, manager_name, city, name, wins, losses FROM teams WHERE league_id = ?'
  ).all(leagueId) as Array<{
    id: number; manager_name: string | null; city: string; name: string;
    wins: number; losses: number;
  }>;

  teams.sort((a, b) => a.id - b.id); // deterministic order
  for (const team of teams) {
    if (!team.manager_name) continue;
    // Seed with team id for manager (no separate manager_id)
    const rng = seedFor(`tragedy_mgr_${team.id}`, worldgenSeed ^ seasonNumber ^ gameNumber);
    const prob = managerTragProb(55); // proxy age 55 (no manager age stored); applies ×1.0 bracket per spec
    if (rng() < prob) {
      resolveTragedy(db, leagueId, seasonNumber, gameNumber, worldgenSeed, {
        playerId: null,
        playerName: team.manager_name,
        teamId: team.id,
        age: 55, // proxy (no manager age stored)
        position: 'Manager',
        isManager: true,
      });
      return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve a single tragedy synchronously
// ─────────────────────────────────────────────────────────────────────────────

interface TragicSubject {
  playerId: number | null;
  playerName: string;
  teamId: number | null;
  age: number;
  position: string;
  isManager: boolean;
}

function resolveTragedy(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  worldgenSeed: number,
  subject: TragicSubject
): void {
  // Fetch team name
  const team = subject.teamId
    ? prepared('SELECT city, name FROM teams WHERE id = ?').get(subject.teamId) as { city: string; name: string } | undefined
    : undefined;
  const teamName = team ? `${team.city} ${team.name}` : 'their organization';

  // Procedural fallback obituary (always written first — J-3)
  const obituary = fallbackObituary(subject.playerName, teamName, subject.position, subject.age);

  // 1. Set player memorial flags
  if (subject.playerId !== null) {
    // Deterministic retired number (seeded O-6)
    const rng = seedFor(`retired_number_${subject.playerId}`, worldgenSeed);
    const retiredNumber = randInt(rng, 0, 99);

    prepared(
      `UPDATE players
       SET memorial = 1, tragedy_victim = 1, retired_number = ?,
           suspension_games_remaining = 0, rehab_games_remaining = 0,
           is_on_mlb_roster = 0, is_on_25man = 0, minor_level = NULL,
           team_id = NULL
       WHERE id = ?`
    ).run(retiredNumber, subject.playerId);
  }

  // 2. Update league: memorial_patch_season
  prepared(
    'UPDATE leagues SET memorial_patch_season = ? WHERE id = ?'
  ).run(seasonNumber, leagueId);

  // 3. Apply morale effects to the team's 25-man roster
  if (subject.teamId) {
    if (subject.isManager) {
      // Manager death: +2% "play for him" for 15 games
      applyTeamMoraleEffect(db, subject.teamId, 200, 15, gameNumber);
      // Set bench-coach interim flag (mark manager_name as 'Interim' + bench coach)
      // N1: strip any existing [EJECTED]/[INTERIM] prefix before prepending to avoid accretion
      prepared("UPDATE teams SET manager_name = '[INTERIM] ' || REPLACE(REPLACE(COALESCE(manager_name, 'Unknown'), '[EJECTED] ', ''), '[INTERIM] ', '') WHERE id = ?")
        .run(subject.teamId);
    } else {
      // Player death: -3% win prob for 10 games
      applyTeamMoraleEffect(db, subject.teamId, -300, 10, gameNumber);
    }
  }

  // 4. Insert pinned news item with fallback (badge = 'FRONT OFFICE', never empty — J-3)
  // NF-1: set pinned_until_game = gameNumber + 5 so tragedy item stays top of /api/news for 5 ticks
  const newsResult = db.prepare(
    `INSERT INTO news_items
       (league_id, season_number, game_number, created_at, event_type, badge,
        team_id, player_id, headline_text, is_headline_pending, details_json, pinned_until_game)
     VALUES (?, ?, ?, ?, 'manager_resigned', 'FRONT OFFICE', ?, ?, ?, 0, ?, ?)`
  ).run(
    leagueId, seasonNumber, gameNumber, Date.now(),
    subject.teamId, subject.playerId,
    obituary,
    JSON.stringify({ tragedy: true, subject_name: subject.playerName, team_name: teamName }),
    gameNumber + 5
  );
  const newsItemId = newsResult.lastInsertRowid as number;

  // 5. Apply 3-game league pause (L4)
  applyThreeGamePause(db, leagueId);

  // 6. setSimSpeed is called by engine.ts after this function returns (to avoid circular import)
  // The engine checks the return value of rollAndResolveTragedy and calls setSimSpeed.
  console.log(`[tragedy] ${subject.isManager ? 'Manager' : 'Player'} tragedy: ${subject.playerName} (game ${gameNumber})`);

  // 7. Fire-and-forget LLM upgrade (J-1, J-2: bypasses enqueue, breaker, cap)
  setImmediate(() => {
    upgradeObituary(newsItemId, subject, teamName).catch(err => {
      console.warn('[tragedy] obituary upgrade error:', err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upgrade the stored obituary with the LLM version (fire-and-forget)
// ─────────────────────────────────────────────────────────────────────────────

async function upgradeObituary(
  newsItemId: number,
  subject: TragicSubject,
  teamName: string
): Promise<void> {
  const llmObituary = await callTragedy({
    playerName: subject.playerName,
    teamName,
    age: subject.age,
    position: subject.position,
  });

  if (llmObituary) {
    // Update the stored obituary text in place
    prepared(
      'UPDATE news_items SET headline_text = ? WHERE id = ?'
    ).run(llmObituary, newsItemId);
    console.log(`[tragedy] Obituary upgraded for news item ${newsItemId}`);
  }
  // If null: keep the procedural fallback (already written)
}
