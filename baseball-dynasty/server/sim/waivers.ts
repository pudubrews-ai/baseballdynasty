// Waiver Wire System — Phase 5 (v0.2.0)
// Per [AB-03 RULING]: range-based expiry, idempotent claims, survives skips/turbo.
// Per [AB-04 RULING]: DFA immediately vacates 40-man slot, team_id RETAINED during window.
// Per [CB-07 RULING]: claim resolution in ONE db.transaction(), idempotent WHERE guard.

import { getDb, prepared, type PlayerRow, type TeamRow } from '../db.js';
import { seedFor } from './prng.js';
import { insertRosterNewsItem, insertTransactionNewsItem } from './news.js';

// Count players on the 40-man roster (is_on_mlb_roster=1) for a team
export function count40Man(teamId: number): number {
  return (prepared(
    'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_mlb_roster = 1'
  ).get(teamId) as { cnt: number }).cnt;
}

// DFA a player: immediately vacates 40-man slot, enters waiver limbo.
// AB-04: set is_on_25man=0, is_on_mlb_roster=0, waiver_state='dfa',
//        dfa_team_id=<team>, claim_game_window_end=<team>.games_played + 3.
//        team_id is RETAINED during waiver window.
export function dfaPlayer(
  playerId: number,
  teamId: number,
  teamGamesPlayed: number,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber?: number
): void {
  prepared(
    `UPDATE players
     SET is_on_25man = 0,
         is_on_mlb_roster = 0,
         waiver_state = 'dfa',
         dfa_team_id = ?,
         claim_game_window_end = ?
     WHERE id = ?`
  ).run(teamId, teamGamesPlayed + 3, playerId);

  const gameNumForTx = currentGameNumber ?? (prepared(
    'SELECT current_game_number FROM leagues WHERE id = ?'
  ).get(leagueId) as { current_game_number: number } | undefined)?.current_game_number ?? 0;

  const txResult = prepared(
    `INSERT INTO transactions
       (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at)
     VALUES (?, ?, 'dfa', ?, ?, NULL, ?, ?)`
  ).run(leagueId, seasonNumber, teamId, playerId, gameNumForTx, Date.now());

  // §1.1(a): Insert DFA news item
  const gameNum = currentGameNumber ?? (prepared(
    'SELECT current_game_number FROM leagues WHERE id = ?'
  ).get(leagueId) as { current_game_number: number } | undefined)?.current_game_number ?? 0;

  insertRosterNewsItem({
    leagueId,
    seasonNumber,
    gameNumber: gameNum,
    eventType: 'dfa',
    teamId,
    playerId,
    sourceTable: 'transactions',
    sourceId: txResult.lastInsertRowid as number,
  });
}

// Find the best DFA candidate for a team by archetype (AB-04 RULING §3 trigger 2).
// Called when count40Man >= 40 and a call-up is needed.
// analytics → lowest overall_rating on 40-man who is in minors (is_on_mlb_roster=1, minor_level IS NOT NULL)
// old-school → youngest minor-optioned player with options
// balanced → same as analytics
export function findDfaCandidate(teamId: number, gmArchetype: string): PlayerRow | undefined {
  if (gmArchetype === 'old-school') {
    return prepared(
      `SELECT * FROM players
       WHERE team_id = ? AND is_on_mlb_roster = 1 AND minor_level IS NOT NULL
         AND options_remaining > 0
       ORDER BY age ASC, overall_rating ASC
       LIMIT 1`
    ).get(teamId) as PlayerRow | undefined;
  }
  // analytics / balanced: lowest overall
  return prepared(
    `SELECT * FROM players
     WHERE team_id = ? AND is_on_mlb_roster = 1 AND minor_level IS NOT NULL
       AND options_remaining > 0
     ORDER BY overall_rating ASC, age DESC
     LIMIT 1`
  ).get(teamId) as PlayerRow | undefined;
}

// Compute a team's waiver claim score for a given player (§6 formula).
// Returns a number; claim if >= 0.6 (after multiplying by archetype modifier).
function computeClaimScore(
  claimerTeam: TeamRow,
  player: PlayerRow,
  gamesBack: number,
  leagueId: number,
  currentGameNumber: number,
  worldgenSeed: number
): number {
  const archetype = claimerTeam.gm_archetype ?? 'balanced';

  // Base interest by archetype
  let baseInterest: number;
  if (archetype === 'analytics') {
    baseInterest = player.overall_rating >= 50 && player.overall_rating <= 65 ? 0.7 : 0.2;
  } else if (archetype === 'old-school') {
    baseInterest = player.overall_rating >= 60 && player.age >= 28 ? 0.5 : 0.2;
  } else {
    // balanced
    baseInterest = player.overall_rating >= 55 ? 0.4 : 0.2;
  }

  // Position need bonus: +0.3 if claimer has 0-1 players at that position (is_on_25man)
  const posCount = (prepared(
    'SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_25man = 1 AND position = ?'
  ).get(claimerTeam.id, player.position) as { cnt: number }).cnt;
  const posNeedBonus = posCount <= 1 ? 0.3 : 0;

  // Market size modifier
  let marketModifier = 0;
  const marketSize = claimerTeam.market_size;
  if (archetype === 'analytics' && (marketSize === 'small' || marketSize === 'medium')) {
    marketModifier = 0.3;
  } else if (archetype === 'old-school' && (marketSize === 'large' || marketSize === 'mega')) {
    marketModifier = 0.1;
  }

  // Contender modifier: +0.2 if games_back <= 5
  const contenderMod = gamesBack <= 5 ? 0.2 : 0;

  // Random jitter (seeded, deterministic)
  const jitterRng = seedFor(
    `waiver_claim_${leagueId}_${currentGameNumber}_${claimerTeam.id}_${player.id}`,
    worldgenSeed
  );
  const jitter = (jitterRng() * 0.10) - 0.05; // uniform [-0.05, 0.05]

  // Archetype claim probability multiplier (from ARCHETYPES table concept)
  const archetypeMultipliers: Record<string, number> = {
    analytics: 1.3,
    'old-school': 0.8,
    balanced: 1.0,
  };
  const archetypeMultiplier = archetypeMultipliers[archetype] ?? 1.0;

  const rawScore = baseInterest + posNeedBonus + marketModifier + contenderMod + jitter;
  return rawScore * archetypeMultiplier;
}

// League-wide waiver sweep. Runs every tick (cheap, indexed).
// AB-03: range check (>=), not equality, so skipped ticks are handled.
// CB-07: claim resolution in ONE db.transaction(), idempotent WHERE guard.
export function processWaivers(leagueId: number): void {
  const db = getDb();

  // Get league for seed and game number
  const league = prepared(
    'SELECT id, worldgen_seed, current_game_number, season_number FROM leagues WHERE id = ?'
  ).get(leagueId) as { id: number; worldgen_seed: number; current_game_number: number; season_number: number } | undefined;

  if (!league) return;

  // Find all active waiver entries
  const waiverPlayers = prepared(
    `SELECT p.* FROM players p
     WHERE p.league_id = ? AND p.waiver_state IN ('dfa','waivers')
       AND p.dfa_team_id IS NOT NULL AND p.claim_game_window_end IS NOT NULL`
  ).all(leagueId) as PlayerRow[];

  if (waiverPlayers.length === 0) return;

  // Get all teams for standings computation (for claim order)
  const teams = prepared(
    'SELECT * FROM teams WHERE league_id = ?'
  ).all(leagueId) as TeamRow[];

  for (const player of waiverPlayers) {
    if (!player.dfa_team_id || player.claim_game_window_end === null) continue;

    // Check if window has expired: use DFA team's games_played
    const dfaTeam = teams.find(t => t.id === player.dfa_team_id);
    if (!dfaTeam) continue;

    if (dfaTeam.games_played < player.claim_game_window_end) {
      // Window still open — not yet expired
      continue;
    }

    // Window expired — attempt claim or release to FA
    resolveWaiverEntry(
      db,
      player,
      dfaTeam,
      teams,
      league.current_game_number,
      league.worldgen_seed,
      leagueId,
      league.season_number
    );
  }
}

function resolveWaiverEntry(
  db: ReturnType<typeof import('../db.js').getDb>,
  player: PlayerRow,
  dfaTeam: TeamRow,
  allTeams: TeamRow[],
  currentGameNumber: number,
  worldgenSeed: number,
  leagueId: number,
  seasonNumber: number
): void {
  // Compute games back for all teams (relative to best record)
  const maxWins = Math.max(...allTeams.map(t => t.wins));
  const gamesBackMap = new Map<number, number>(
    allTeams.map(t => [t.id, maxWins - t.wins])
  );

  // Claim order: reverse standings (worst team first)
  // Sort: wins ASC, (runs_scored - runs_allowed) ASC, team_id ASC
  const eligibleClaimers = allTeams
    .filter(t => t.id !== player.dfa_team_id)
    .sort((a, b) => {
      if (a.wins !== b.wins) return a.wins - b.wins; // fewest wins first
      const runDiffA = a.runs_scored - a.runs_allowed;
      const runDiffB = b.runs_scored - b.runs_allowed;
      if (runDiffA !== runDiffB) return runDiffA - runDiffB;
      return a.id - b.id; // tie-break by team_id ASC
    });

  let claimingTeam: TeamRow | null = null;

  for (const claimer of eligibleClaimers) {
    const gamesBack = gamesBackMap.get(claimer.id) ?? 0;
    const score = computeClaimScore(
      claimer,
      player,
      gamesBack,
      leagueId,
      currentGameNumber,
      worldgenSeed
    );
    if (score >= 0.6) {
      claimingTeam = claimer;
      break;
    }
  }

  // Execute in ONE transaction (CB-07)
  const resolveTransaction = db.transaction(() => {
    if (claimingTeam) {
      // Idempotent guard: only proceed if player is still on waivers
      const result = db.prepare(
        `UPDATE players
         SET team_id = ?,
             is_on_mlb_roster = 1,
             is_on_25man = 0,
             minor_level = 'AAA',
             waiver_state = 'none',
             dfa_team_id = NULL,
             claim_game_window_end = NULL
         WHERE id = ? AND waiver_state IN ('dfa','waivers')`
      ).run(claimingTeam.id, player.id);

      if (result.changes === 0) return; // already resolved

      // Log claim transaction
      const claimTxResult = db.prepare(
        `INSERT INTO transactions
           (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
         VALUES (?, ?, 'waiver_claim', ?, ?, NULL, ?)`
      ).run(leagueId, seasonNumber, claimingTeam.id, player.id, Date.now());

      // §1.1(a): Insert waiver claim news item (§4.2: pass dfa_team_id as secondaryTeamId)
      insertTransactionNewsItem({
        leagueId,
        seasonNumber,
        gameNumber: currentGameNumber,
        eventType: 'waiver_claim',
        teamId: claimingTeam.id,
        secondaryTeamId: player.dfa_team_id ?? null,
        playerId: player.id,
        sourceTable: 'transactions',
        sourceId: claimTxResult.lastInsertRowid as number,
      });

      console.log(
        `[waivers] ${player.first_name} ${player.last_name} claimed by team ${claimingTeam.id} (${claimingTeam.name})`
      );
    } else {
      // Unclaimed — release to FA
      // Only generate a notable release log if overall_rating >= 65 (spec edge case)
      const result = db.prepare(
        `UPDATE players
         SET team_id = NULL,
             is_on_mlb_roster = 0,
             is_on_25man = 0,
             minor_level = NULL,
             waiver_state = 'none',
             dfa_team_id = NULL,
             claim_game_window_end = NULL
         WHERE id = ? AND waiver_state IN ('dfa','waivers')`
      ).run(player.id);

      if (result.changes === 0) return; // already resolved

      if (player.overall_rating >= 65) {
        db.prepare(
          `INSERT INTO transactions
             (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at)
           VALUES (?, ?, 'waiver_expired', NULL, ?, NULL, ?)`
        ).run(leagueId, seasonNumber, player.id, Date.now());
      }

      console.log(
        `[waivers] ${player.first_name} ${player.last_name} unclaimed — released to FA (overall: ${player.overall_rating})`
      );
    }
  });

  resolveTransaction();
}
