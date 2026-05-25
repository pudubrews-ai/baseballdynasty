// Player Personality Depth — Step 13
// Chemistry, malcontent, trade demand, loyalty discount, work-ethic aging.
// Chemistry is server-only (A-5/I-1): never submitted by client, never written by client.
//
// Determinism (L2): ALL per-season rolls use seedFor(label, worldgen_seed ^ season ^ player_id)
// gated by teams.personality_rolls_done_season so re-entered offseason doesn't re-roll.

import { getDb, prepared, type TeamRow, type PlayerRow } from '../db.js';
import { seedFor } from './prng.js';
import { insertNewsItem } from './news.js';
import { setGmConfidence } from './franchise.js';

// ─────────────────────────────────────────────────────────────────────────────
// Chemistry calculation (per team, every 10 games, single aggregate query)
// chemistry_score = avg(leadership, 25-man) × 0.4
//                 + avg(coachability, 25-man) × 0.3
//                 + win_streak_modifier × 0.2
//                 + veteran_core_bonus × 0.1
// Clamped to [0, 100].
// ─────────────────────────────────────────────────────────────────────────────

function winStreakModifier(wins: number, losses: number): number {
  // Simple win streak proxy: if W > L, positive modifier; else negative
  const gp = wins + losses;
  if (gp === 0) return 50; // neutral
  const pct = wins / gp;
  // Map 0.0→0, 0.5→50, 1.0→100
  return Math.round(pct * 100);
}

function veteranCoreBonus(leagueId: number, teamId: number, _gameNumber: number): number {
  // Bonus if 3+ players with seasons_with_current_team >= 5
  const result = prepared(
    `SELECT COUNT(*) as cnt FROM players
     WHERE league_id = ? AND team_id = ? AND is_on_25man = 1
       AND seasons_with_current_team >= 5`
  ).get(leagueId, teamId) as { cnt: number } | undefined;
  return (result?.cnt ?? 0) >= 3 ? 15 : 0; // +15 bonus if veteran core present
}

export function recalcChemistry(
  leagueId: number,
  teamId: number,
  gameNumber: number
): void {
  const db = getDb();

  // Check cadence: last_chemistry_calc_game
  const team = prepared('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow | undefined;
  if (!team) return;
  if (gameNumber - (team.last_chemistry_calc_game ?? 0) < 10) return;

  // Single aggregate query (I-2)
  const stats = prepared(
    `SELECT AVG(leadership) as avg_lead, AVG(coachability) as avg_coach
     FROM players
     WHERE league_id = ? AND team_id = ? AND is_on_25man = 1`
  ).get(leagueId, teamId) as { avg_lead: number | null; avg_coach: number | null } | undefined;

  const avgLead = stats?.avg_lead ?? 50;
  const avgCoach = stats?.avg_coach ?? 50;
  const winMod = winStreakModifier(team.wins, team.losses);
  const vetBonus = veteranCoreBonus(leagueId, teamId, gameNumber);

  const rawScore = avgLead * 0.4 + avgCoach * 0.3 + winMod * 0.2 + vetBonus * 0.1;
  const chemistry = Math.max(0, Math.min(100, Math.round(rawScore)));

  db.prepare('UPDATE teams SET chemistry_score = ?, last_chemistry_calc_game = ? WHERE id = ?')
    .run(chemistry, gameNumber, teamId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chemistry win-prob modifier (applied in winProbability via morale_effect_bp)
// >75 +2%, 50-75 0%, 25-49 -1%, <25 -3%
// This is applied to the TEAM level, not via morale_effect_bp (which is per-player).
// Return basis points to add to win probability.
// ─────────────────────────────────────────────────────────────────────────────

export function chemistryWinProbEffect(chemistryScore: number): number {
  if (chemistryScore > 75) return 200;   // +2%
  if (chemistryScore >= 50) return 0;    // neutral
  if (chemistryScore >= 25) return -100; // -1%
  return -300;                            // -3%
}

// ─────────────────────────────────────────────────────────────────────────────
// Malcontent roll (5%/season): leadership < 30 AND overall < 75
// Gate: personality_rolls_done_season (per team, set after all rolls this season)
// ─────────────────────────────────────────────────────────────────────────────

export function rollMalcontent(
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  worldgenSeed: number,
  team: TeamRow
): void {
  const db = getDb();
  // Skip if already rolled this season
  if ((team.personality_rolls_done_season ?? 0) >= seasonNumber) return;

  const players = prepared(
    `SELECT id, leadership, overall_rating, first_name, last_name, team_id
     FROM players
     WHERE league_id = ? AND team_id = ? AND is_on_25man = 1
       AND leadership < 30 AND overall_rating < 75 AND is_malcontent = 0`
  ).all(leagueId, team.id) as Array<{
    id: number; leadership: number; overall_rating: number;
    first_name: string; last_name: string; team_id: number;
  }>;

  for (const player of players) {
    const rng = seedFor(`malcontent_${seasonNumber}_${player.id}`, worldgenSeed);
    if (rng() < 0.05) {
      db.prepare('UPDATE players SET is_malcontent = 1 WHERE id = ?').run(player.id);

      insertNewsItem({
        leagueId,
        seasonNumber,
        gameNumber,
        eventType: 'manager_fired', // closest "clubhouse unrest" event type
        teamId: team.id,
        playerId: player.id,
        headlineText: `${player.first_name} ${player.last_name} is becoming a clubhouse malcontent`,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Malcontent maintenance: GM confidence -5 if malcontent not moved within 10 games
// ─────────────────────────────────────────────────────────────────────────────

export function checkMalcontentPressure(
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  team: TeamRow
): void {
  const malcontents = prepared(
    'SELECT id FROM players WHERE league_id = ? AND team_id = ? AND is_malcontent = 1 AND is_on_25man = 1'
  ).all(leagueId, team.id) as Array<{ id: number }>;

  if (malcontents.length > 0) {
    // Pressure builds after 10 games — signal GM confidence hit
    if (team.games_played % 10 === 0) {
      setGmConfidence(leagueId, -5);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade demand roll (15%/season): overall 80+, leadership < 40, team chemistry < 30,
// team 10+ games under .500
// ─────────────────────────────────────────────────────────────────────────────

export function rollTradeDemand(
  leagueId: number,
  seasonNumber: number,
  gameNumber: number,
  worldgenSeed: number,
  team: TeamRow
): void {
  const db = getDb();
  if ((team.personality_rolls_done_season ?? 0) >= seasonNumber) return;

  const tenUnder = Math.max(0, team.losses - team.wins) >= 10;
  if (!tenUnder || (team.chemistry_score ?? 50) >= 30) return;

  const stars = prepared(
    `SELECT id, leadership, overall_rating, first_name, last_name
     FROM players
     WHERE league_id = ? AND team_id = ? AND overall_rating >= 80
       AND leadership < 40 AND trade_demand_active = 0`
  ).all(leagueId, team.id) as Array<{
    id: number; leadership: number; overall_rating: number;
    first_name: string; last_name: string;
  }>;

  for (const player of stars) {
    const rng = seedFor(`trade_demand_${seasonNumber}_${player.id}`, worldgenSeed);
    if (rng() < 0.15) {
      db.prepare('UPDATE players SET trade_demand_active = 1 WHERE id = ?').run(player.id);

      insertNewsItem({
        leagueId,
        seasonNumber,
        gameNumber,
        eventType: 'manager_fired',
        teamId: team.id,
        playerId: player.id,
        headlineText: `${player.first_name} ${player.last_name} has requested a trade`,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade demand penalty: if not traded within 15 games, all ratings -3
// ─────────────────────────────────────────────────────────────────────────────

export function applyTradeDemandPenalties(leagueId: number, gameNumber: number): void {
  // Find malcontent players still on same team after 15 games — heuristic:
  // all active trade_demand players who have been demanding for a full 15-game window
  // (simplified: apply penalty if trade_demand_active=1 and games_played mod 15 = 0)
  const db = getDb();
  const demanders = prepared(
    `SELECT p.id, t.games_played FROM players p
     JOIN teams t ON t.id = p.team_id
     WHERE p.league_id = ? AND p.trade_demand_active = 1`
  ).all(leagueId) as Array<{ id: number; games_played: number }>;

  for (const p of demanders) {
    if (p.games_played > 0 && p.games_played % 15 === 0) {
      db.prepare(
        `UPDATE players
         SET contact = MAX(20, contact - 3), power = MAX(20, power - 3),
             speed = MAX(20, speed - 3), fielding = MAX(20, fielding - 3),
             overall_rating = MAX(20, overall_rating - 3)
         WHERE id = ? AND trade_demand_active = 1`
      ).run(p.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark personality rolls done for a team this season (set at start of season)
// ─────────────────────────────────────────────────────────────────────────────

export function markPersonalityRollsDone(leagueId: number, seasonNumber: number): void {
  prepared('UPDATE teams SET personality_rolls_done_season = ? WHERE league_id = ?')
    .run(seasonNumber, leagueId);
}
