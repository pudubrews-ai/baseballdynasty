// Expansion draft and annual draft logic
// Expansion draft: snake order, 30 rounds, 20 teams = 600 total picks
// Annual draft: straight reverse-standings order

import { getDb, prepared, type PlayerRow, type LeagueRow, type TeamRow } from '../db.js';
import { seedFor, randInt, shuffle } from './prng.js';
import { callDraftPick } from '../services/llm.js';
import { getDraftPickDelay } from './engine.js';
import { NAME_POOLS, ORIGIN_DISTRIBUTION } from '../data/names.js';

export interface DraftPlayer {
  id: number;
  firstName: string;
  lastName: string;
  age: number;
  position: string;
  overallRating: number;
  potential: string;
  positionAdjustedValue: number;
  keyStrengths: string;
}

// §5.7: Smooth SP scarcity bonus (replaces the cliff at overall=70)
// sp_bonus = max(0, (overall - 60) * 0.6) → 0 at <60, +6 at 70, +12 at 80, +18 at 90
// Note: spec had a cliff at overall 70+, this is the corrected smooth version per §5.7
function spSmoothBonus(overall: number): number {
  return Math.max(0, (overall - 60) * 0.6);
}

export function positionAdjustedValue(player: PlayerRow): number {
  let scarcityBonus = 0;
  switch (player.position) {
    case 'C':  scarcityBonus = 5; break;
    case 'SS': scarcityBonus = 4; break;
    case 'CF': scarcityBonus = 3; break;
    case 'SP': scarcityBonus = spSmoothBonus(player.overall_rating); break; // smooth per §5.7
    case 'CL': scarcityBonus = 4; break;
    default:   scarcityBonus = 0;
  }

  let ageBonus = 0;
  if (player.age <= 24) ageBonus = 3;
  else if (player.age <= 28) ageBonus = 1;
  else if (player.age <= 32) ageBonus = 0;
  else ageBonus = -2;

  return player.overall_rating + scarcityBonus + ageBonus;
}

function getKeyStrengths(player: PlayerRow): string {
  const isPitcher = ['SP', 'RP', 'CL'].includes(player.position);
  const strengths: string[] = [];
  if (isPitcher) {
    if (player.pitching_velocity >= 70) strengths.push('velocity');
    if (player.pitching_control >= 70) strengths.push('control');
    if (player.pitching_stamina >= 70) strengths.push('stamina');
  } else {
    if (player.contact >= 70) strengths.push('contact');
    if (player.power >= 70) strengths.push('power');
    if (player.speed >= 70) strengths.push('speed');
    if (player.fielding >= 70) strengths.push('defense');
  }
  return strengths.slice(0, 3).join(', ') || 'versatile';
}

// Get the team's roster needs by position
function getRosterNeeds(teamId: number): Record<string, number> {
  const positions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'CL'];
  const counts = prepared(
    'SELECT position, COUNT(*) as cnt FROM players WHERE team_id = ? AND is_drafted = 1 GROUP BY position'
  ).all(teamId) as Array<{ position: string; cnt: number }>;
  const posMap = new Map<string, number>();
  for (const row of counts) posMap.set(row.position, row.cnt);
  const needs: Record<string, number> = {};
  for (const pos of positions) {
    needs[pos] = posMap.get(pos) ?? 0;
  }
  return needs;
}

// Find the position with the greatest need (fewest players, with weighted priority)
function getBiggestNeed(needs: Record<string, number>): string {
  const priority = ['C', 'SS', 'CF', 'SP', 'CL', '1B', '2B', '3B', 'LF', 'RF', 'RP', 'DH'];
  let best = 'SP';
  let bestCount = Infinity;
  for (const pos of priority) {
    const cnt = needs[pos] ?? 0;
    if (cnt < bestCount) {
      bestCount = cnt;
      best = pos;
    }
  }
  return best;
}

// Select top N available players by PAV — using scarcity estimate in SQL (§4.5)
function selectTopN(
  league_id: number,
  round: number,
  n: number = 10
): PlayerRow[] {
  // C4: Round gating
  const minOverall = round <= 15 ? 50 : 30;
  const maxOverall = round <= 15 ? 99 : 49;

  // Pull top 50 by estimated PAV (includes scarcity in SQL) so catchers/SSes/SPs aren't filtered out
  const players = prepared(
    `SELECT *, (overall_rating + CASE position
       WHEN 'C' THEN 5
       WHEN 'SS' THEN 4
       WHEN 'CF' THEN 3
       WHEN 'CL' THEN 4
       WHEN 'SP' THEN MAX(0, CAST((overall_rating - 60) AS REAL) * 0.6)
       ELSE 0
     END) as estimated_pav
     FROM players
     WHERE league_id = ? AND is_drafted = 0 AND overall_rating >= ? AND overall_rating <= ?
     ORDER BY estimated_pav DESC LIMIT 50`
  ).all(league_id, minOverall, maxOverall) as PlayerRow[];

  // Sort by full PAV (with age bonus) in JS and slice to top n
  players.sort((a, b) => positionAdjustedValue(b) - positionAdjustedValue(a));
  return players.slice(0, n);
}

// Procedural fallback: best available by position need
export function pickProcedural(teamId: number, leagueId: number, round: number): PlayerRow | null {
  const needs = getRosterNeeds(teamId);
  const neededPos = getBiggestNeed(needs);

  const minOverall = round <= 15 ? 50 : 30;
  const maxOverall = round <= 15 ? 99 : 49;

  // Try to fill biggest need first
  const byNeed = prepared(
    'SELECT * FROM players WHERE league_id = ? AND is_drafted = 0 AND position = ? AND overall_rating >= ? AND overall_rating <= ? ORDER BY overall_rating DESC LIMIT 1'
  ).get(leagueId, neededPos, minOverall, maxOverall) as PlayerRow | undefined;

  if (byNeed) return byNeed;

  // Fall back to best available overall
  return prepared(
    'SELECT * FROM players WHERE league_id = ? AND is_drafted = 0 AND overall_rating >= ? AND overall_rating <= ? ORDER BY overall_rating DESC LIMIT 1'
  ).get(leagueId, minOverall, maxOverall) as PlayerRow | null;
}

// §2.4: Synchronous version of draft pick for turbo mode (skips LLM, no async overhead)
// Returns the new pickId or null if no player available
function runDraftPickSync(
  db: ReturnType<typeof getDb>,
  league: LeagueRow,
  team: TeamRow,
  round: number,
  pickNumber: number,
  isExpansion: boolean
): number | null {
  const leagueId = league.id;
  const topPlayers = selectTopN(leagueId, round, 10);

  if (topPlayers.length === 0) {
    // Pool exhausted — generate replacement player synchronously
    const leagueRow = db.prepare('SELECT worldgen_seed FROM leagues WHERE id = ?').get(leagueId) as { worldgen_seed: number } | undefined;
    const rng = seedFor(`draft_fill_${team.id}_${round}_${pickNumber}`, leagueRow?.worldgen_seed ?? 0);
    const overall = randInt(rng, 30, 44);
    console.warn('[draft] Draft pool exhausted, generating replacement-level player');

    const insertResult = db.prepare(
      `INSERT INTO players (league_id, team_id, first_name, last_name, age, position, overall_rating, potential, contact, power, speed, fielding, arm, pitching_velocity, pitching_control, pitching_stamina, is_on_mlb_roster, annual_salary, contract_years_remaining, service_time, injury_prone, coachability, work_ethic, leadership, origin, birthplace_city, birthplace_country, is_drafted) VALUES (?, ?, 'Replacement', 'Player', 25, 'LF', ?, 'D', ?, ?, ?, ?, ?, ?, ?, ?, 0, 500000, 1, 0, 5, 5, 5, 5, 'us', '', 'USA', 1)`
    ).run(leagueId, team.id, overall, overall, overall, overall, overall, overall, overall, overall, overall);

    const playerId = insertResult.lastInsertRowid as number;
    const pickResult = db.prepare(
      'INSERT INTO draft_picks (league_id, season_number, round, pick_number, team_id, player_id, reasoning, is_expansion_draft, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(leagueId, league.season_number, round, pickNumber, team.id, playerId, 'Pool exhausted — generated replacement player', isExpansion ? 1 : 0, Date.now());

    return pickResult.lastInsertRowid as number;
  }

  const selectedPlayer = pickProcedural(team.id, leagueId, round);
  if (!selectedPlayer) return null;

  db.prepare('UPDATE players SET is_drafted = 1, team_id = ? WHERE id = ?').run(team.id, selectedPlayer.id);

  const pickResult = db.prepare(
    'INSERT INTO draft_picks (league_id, season_number, round, pick_number, team_id, player_id, reasoning, is_expansion_draft, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    leagueId,
    league.season_number,
    round,
    pickNumber,
    team.id,
    selectedPlayer.id,
    null,
    isExpansion ? 1 : 0,
    Date.now()
  );

  return pickResult.lastInsertRowid as number;
}

// v0.2.0 §2: Draft flavor sample set — deterministic 20-pick sample per draft
// Cache per (leagueId, season, isExpansion) key
const draftFlavorSampleCache = new Map<string, Set<string>>();

function getDraftFlavorSampleKey(leagueId: number, season: number, isExpansion: boolean): string {
  return `${leagueId}_${season}_${isExpansion ? 'exp' : 'ann'}`;
}

export function isInDraftFlavorSample(
  leagueId: number,
  season: number,
  isExpansion: boolean,
  round: number,
  pickNumber: number
): boolean {
  const cacheKey = getDraftFlavorSampleKey(leagueId, season, isExpansion);
  if (!draftFlavorSampleCache.has(cacheKey)) {
    // Build a deterministic set of 20 picks using reservoir sampling
    const seed = (leagueId ^ season) + (isExpansion ? 1000000 : 0);
    const rng = seedFor('draft_sample', seed);
    const totalPicks = isExpansion ? 600 : 600;
    const sampleSet = new Set<string>();
    // Reservoir sampling: pick 20 from totalPicks
    const indices: number[] = [];
    for (let i = 1; i <= 20; i++) indices.push(i);
    for (let i = 21; i <= totalPicks; i++) {
      const j = Math.floor(rng() * i) + 1;
      if (j <= 20) {
        indices[j - 1] = i;
      }
    }
    for (const idx of indices) {
      sampleSet.add(String(idx));
    }
    draftFlavorSampleCache.set(cacheKey, sampleSet);
  }
  const sampleSet = draftFlavorSampleCache.get(cacheKey)!;
  return sampleSet.has(String(pickNumber));
}

export async function runDraftPick(
  league: LeagueRow,
  team: TeamRow,
  round: number,
  pickNumber: number,
  isExpansion: boolean,
  isTurbo: boolean
): Promise<number | null> {
  const leagueId = league.id;
  const topPlayers = selectTopN(leagueId, round, 10);

  if (topPlayers.length === 0) {
    // Draft pool exhausted — generate a replacement-level player
    return await handleExhaustedPool(leagueId, team.id, round, pickNumber, isExpansion);
  }

  // v0.2.0 §2: Pick is ALWAYS procedural now (LLM restructure)
  let selectedPlayer: PlayerRow | null = pickProcedural(team.id, leagueId, round);
  if (!selectedPlayer) {
    selectedPlayer = topPlayers[0] ?? null; // safety
  }

  if (!selectedPlayer) return null;

  // LLM flavor text only — for sampled picks in non-turbo mode (LLM never chooses a player)
  let reasoning: string | null = null;
  if (!isTurbo && isInDraftFlavorSample(leagueId, league.season_number, isExpansion, round, pickNumber)) {
    const needsJson = JSON.stringify(getRosterNeeds(team.id));
    const playersJson = JSON.stringify(topPlayers.map((p, idx) => ({
      index: idx,
      name: `${p.first_name} ${p.last_name}`,
      age: p.age,
      position: p.position,
      overall_rating: p.overall_rating,
      potential: p.potential,
      key_strengths: getKeyStrengths(p),
    })));

    const llmResult = await callDraftPick(
      `${team.city} ${team.name}`,
      team.gm_philosophy,
      team.gm_risk_tolerance,
      team.gm_focus,
      needsJson,
      playersJson
    );
    // Use ONLY the reasoning string — the pickIndex from LLM is IGNORED (player is always procedural)
    reasoning = llmResult.ok ? llmResult.reasoning : null;
  }

  // Record the pick
  const db = getDb();
  const insertPick = db.transaction(() => {
    db.prepare('UPDATE players SET is_drafted = 1, team_id = ? WHERE id = ?').run(team.id, selectedPlayer!.id);

    const pickResult = db.prepare(
      'INSERT INTO draft_picks (league_id, season_number, round, pick_number, team_id, player_id, reasoning, is_expansion_draft, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      leagueId,
      league.season_number,
      round,
      pickNumber,
      team.id,
      selectedPlayer!.id,
      reasoning,
      isExpansion ? 1 : 0,
      Date.now()
    );

    const pickId = pickResult.lastInsertRowid as number;

    // Update last_pick_id on league
    db.prepare('UPDATE leagues SET last_pick_id = ? WHERE id = ?').run(pickId, leagueId);

    return pickId;
  });

  return insertPick() as number;
}

async function handleExhaustedPool(
  leagueId: number,
  teamId: number,
  round: number,
  pickNumber: number,
  isExpansion: boolean
): Promise<number | null> {
  console.warn('[draft] Draft pool exhausted, generating replacement-level player');
  // §4.1: Use deterministic seed (team_id + round + pickNumber + worldgen_seed)
  const leagueRow = prepared('SELECT worldgen_seed FROM leagues WHERE id = ?').get(leagueId) as { worldgen_seed: number } | undefined;
  const rng = seedFor(`draft_fill_${teamId}_${round}_${pickNumber}`, leagueRow?.worldgen_seed ?? 0);
  const overall = randInt(rng, 30, 44);

  const db = getDb();
  const insertResult = db.prepare(
    `INSERT INTO players (league_id, team_id, first_name, last_name, age, position, overall_rating, potential, contact, power, speed, fielding, arm, pitching_velocity, pitching_control, pitching_stamina, is_on_mlb_roster, annual_salary, contract_years_remaining, service_time, injury_prone, coachability, work_ethic, leadership, origin, birthplace_city, birthplace_country, is_drafted) VALUES (?, ?, 'Replacement', 'Player', 25, 'LF', ?, 'D', ?, ?, ?, ?, ?, ?, ?, ?, 0, 500000, 1, 0, 5, 5, 5, 5, 'us', '', 'USA', 1)`
  ).run(leagueId, teamId, overall, overall, overall, overall, overall, overall, overall, overall, overall);

  const playerId = insertResult.lastInsertRowid as number;
  const league = db.prepare('SELECT season_number FROM leagues WHERE id = ?').get(leagueId) as { season_number: number };

  const pickResult = db.prepare(
    'INSERT INTO draft_picks (league_id, season_number, round, pick_number, team_id, player_id, reasoning, is_expansion_draft, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(leagueId, league.season_number, round, pickNumber, teamId, playerId, 'Pool exhausted — generated replacement player', isExpansion ? 1 : 0, Date.now());

  db.prepare('UPDATE leagues SET last_pick_id = ? WHERE id = ?').run(pickResult.lastInsertRowid, leagueId);
  return pickResult.lastInsertRowid as number;
}

// Generate expansion draft order (snake)
export function generateExpansionDraftOrder(leagueId: number, seed: number): number[] {
  const teams = prepared('SELECT id FROM teams WHERE league_id = ? ORDER BY id').all(leagueId) as Array<{ id: number }>;
  const teamIds = teams.map(t => t.id);

  // Random shuffle for expansion draft (coin flip simulation)
  const rng = seedFor('draft_order', seed);
  shuffle(rng, teamIds);

  return teamIds;
}

// Generate annual draft order (reverse standings)
export function generateAnnualDraftOrder(leagueId: number): number[] {
  const teams = prepared(
    'SELECT id, wins, losses FROM teams WHERE league_id = ? ORDER BY wins ASC, losses DESC'
  ).all(leagueId) as Array<{ id: number; wins: number; losses: number }>;

  return teams.map(t => t.id);
}

// After expansion draft: assign top 25 to MLB, picks 26-30 to minors
export function assignRosterLevels(leagueId: number): void {
  const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as Array<{ id: number }>;

  for (const team of teams) {
    // Get all drafted players for this team, ordered by PAV desc
    const drafted = prepared(
      'SELECT p.* FROM players p WHERE p.team_id = ? AND p.is_drafted = 1 ORDER BY p.overall_rating DESC'
    ).all(team.id) as PlayerRow[];

    // AB-10 FIX §1.1a: Assign minor league levels by ROSTER RANK (not absolute rating).
    // Previously, rating-threshold gating left AAA empty (26th-40th best players rate below 60).
    // Rank-based assignment guarantees every team gets a populated AAA tier regardless of ratings.
    for (let i = 0; i < drafted.length; i++) {
      const player = drafted[i]!;
      if (i < 25) {
        // MLB 25-man active
        prepared('UPDATE players SET is_on_mlb_roster = 1, is_on_25man = 1, minor_level = NULL WHERE id = ?').run(player.id);
      } else if (i < 40) {
        // 40-man, optioned to AAA/AA by RANK (~7 AAA at ranks 26-32, ~8 AA at ranks 33-40)
        const level = i < 32 ? 'AAA' : 'AA';
        prepared('UPDATE players SET is_on_mlb_roster = 1, is_on_25man = 0, minor_level = ? WHERE id = ?').run(level, player.id);
      } else {
        // Pure minor leaguers (not on 40-man): AA/A/Rookie by rank-from-40
        const depth = i - 40;
        const level = depth < 10 ? 'AA' : depth < 30 ? 'A' : 'Rookie';
        prepared('UPDATE players SET is_on_mlb_roster = 0, is_on_25man = 0, minor_level = ? WHERE id = ?').run(level, player.id);
      }
    }
  }
}

// Export draft order for the API route (§2.9)
export function getExpansionDraftOrder(leagueId: number): number[] {
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow | undefined;
  if (!league) return [];
  return generateExpansionDraftOrder(leagueId, league.worldgen_seed);
}

// §3.2: Export annual draft order for the API route — branches on phase
export function getAnnualDraftOrder(leagueId: number): number[] {
  return generateAnnualDraftOrder(leagueId);
}

// Run the full expansion draft (resume-aware — §2.7)
export async function runExpansionDraft(
  league: LeagueRow,
  isTurbo: boolean,
  onPickComplete?: (pickId: number, round: number, pick: number) => Promise<void>
): Promise<void> {
  const leagueId = league.id;
  const teamOrder = generateExpansionDraftOrder(leagueId, league.worldgen_seed);
  const totalRounds = 30;
  const totalPicks = totalRounds * teamOrder.length;

  // Resume: find the last completed pick_number for this league+season
  const lastCompleted = prepared(
    'SELECT COALESCE(MAX(pick_number), 0) as max_pick FROM draft_picks WHERE league_id = ? AND season_number = ? AND is_expansion_draft = 1'
  ).get(leagueId, league.season_number) as { max_pick: number };

  const startPick = lastCompleted.max_pick + 1;

  if (isTurbo && startPick <= totalPicks) {
    // §2.4: Turbo path — wrap all picks in one transaction for maximum DB throughput
    const db = getDb();
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
    const teamMap = new Map<number, TeamRow>(teams.map(t => [t.id, t]));

    const turboTx = db.transaction(() => {
      let lastPickId: number | null = null;
      for (let pickNumber = startPick; pickNumber <= totalPicks; pickNumber++) {
        const round = Math.floor((pickNumber - 1) / teamOrder.length) + 1;
        const pickIdxInRound = (pickNumber - 1) % teamOrder.length;
        const orderForRound = round % 2 === 1 ? teamOrder : [...teamOrder].reverse();
        const teamId = orderForRound[pickIdxInRound]!;
        const team = teamMap.get(teamId);
        if (!team) continue;
        const pickId = runDraftPickSync(db, league, team, round, pickNumber, true);
        if (pickId) {
          lastPickId = pickId;
          db.prepare('UPDATE leagues SET last_pick_id = ? WHERE id = ?').run(pickId, leagueId);
        }
      }
      return lastPickId;
    });
    turboTx();

    // After turbo draft: assign roster levels
    assignRosterLevels(leagueId);
    return;
  }

  for (let pickNumber = startPick; pickNumber <= totalPicks; pickNumber++) {
    const round = Math.floor((pickNumber - 1) / teamOrder.length) + 1;
    const pickIdxInRound = (pickNumber - 1) % teamOrder.length;
    // Snake order: odd rounds forward, even rounds reversed
    const orderForRound = round % 2 === 1 ? teamOrder : [...teamOrder].reverse();
    const teamId = orderForRound[pickIdxInRound]!;
    const team = prepared('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow;

    const currentLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;

    const pickId = await runDraftPick(currentLeague, team, round, pickNumber, true, isTurbo);

    if (pickId && onPickComplete) {
      await onPickComplete(pickId, round, pickNumber); // §1.1: Must await to catch cooperative pause
    }

    // §1.1: Cooperative pause — check after callback completes and exit cleanly if paused
    const { isPaused } = await import('./engine.js');
    if (isPaused()) {
      console.log('[draft] Paused at pick', pickNumber);
      return; // Exit cleanly; engine's finally handles state
    }

    // §2.3: Honor currentSpeed for per-pick delay
    const delay = getDraftPickDelay();
    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // After draft: assign roster levels
  assignRosterLevels(leagueId);
}

// Run the annual draft (reverse standings, straight order) — resume-aware (§2.7)
export async function runAnnualDraft(
  league: LeagueRow,
  isTurbo: boolean,
  onPickComplete?: (pickId: number, round: number, pick: number) => Promise<void>
): Promise<void> {
  const leagueId = league.id;
  const teamOrder = generateAnnualDraftOrder(leagueId);
  const totalRounds = 30;
  const totalPicks = totalRounds * teamOrder.length;

  // Generate new players for the annual draft pool (only if not resuming)
  const existingPicks = prepared(
    'SELECT COUNT(*) as cnt FROM draft_picks WHERE league_id = ? AND season_number = ? AND is_expansion_draft = 0'
  ).get(leagueId, league.season_number) as { cnt: number };

  if (existingPicks.cnt === 0) {
    generateDraftClass(leagueId, league.worldgen_seed ^ league.season_number);
  }

  // Resume: find the last completed pick_number for this league+season
  const lastCompleted = prepared(
    'SELECT COALESCE(MAX(pick_number), 0) as max_pick FROM draft_picks WHERE league_id = ? AND season_number = ? AND is_expansion_draft = 0'
  ).get(leagueId, league.season_number) as { max_pick: number };

  const startPick = lastCompleted.max_pick + 1;

  if (isTurbo && startPick <= totalPicks) {
    // §2.4: Turbo path — wrap all picks in one transaction for maximum DB throughput
    const db = getDb();
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as TeamRow[];
    const teamMap = new Map<number, TeamRow>(teams.map(t => [t.id, t]));

    const turboTx = db.transaction(() => {
      let lastPickId: number | null = null;
      for (let pickNumber = startPick; pickNumber <= totalPicks; pickNumber++) {
        const round = Math.floor((pickNumber - 1) / teamOrder.length) + 1;
        const pickIdxInRound = (pickNumber - 1) % teamOrder.length;
        const teamId = teamOrder[pickIdxInRound]!;
        const team = teamMap.get(teamId);
        if (!team) continue;
        const pickId = runDraftPickSync(db, league, team, round, pickNumber, false);
        if (pickId) {
          lastPickId = pickId;
          db.prepare('UPDATE leagues SET last_pick_id = ? WHERE id = ?').run(pickId, leagueId);
        }
      }
      return lastPickId;
    });
    turboTx();

    assignRosterLevels(leagueId);
    return;
  }

  for (let pickNumber = startPick; pickNumber <= totalPicks; pickNumber++) {
    const round = Math.floor((pickNumber - 1) / teamOrder.length) + 1;
    const pickIdxInRound = (pickNumber - 1) % teamOrder.length;
    // Straight order per C5 (not snake)
    const teamId = teamOrder[pickIdxInRound]!;
    const team = prepared('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow;

    const currentLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;
    const pickId = await runDraftPick(currentLeague, team, round, pickNumber, false, isTurbo);

    if (pickId && onPickComplete) {
      await onPickComplete(pickId, round, pickNumber); // §1.1: Must await to catch cooperative pause
    }

    // §1.1: Cooperative pause — check after callback completes and exit cleanly if paused
    const { isPaused } = await import('./engine.js');
    if (isPaused()) {
      console.log('[draft] Paused at pick', pickNumber);
      return; // Exit cleanly; engine's finally handles state
    }

    // §2.3: Honor currentSpeed for per-pick delay
    const delay = getDraftPickDelay();
    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  assignRosterLevels(leagueId);
}

// AB-15: Generate 620 named prospects for annual draft (never flood with "Replacement Player")
function generateDraftClass(leagueId: number, seed: number): void {
  const rng = seedFor('draft_class', seed);
  const db = getDb();
  const POTENTIAL_DIST = [
    { grade: 'A', pct: 0.10 },
    { grade: 'B', pct: 0.25 },
    { grade: 'C', pct: 0.40 },
    { grade: 'D', pct: 0.25 },
  ];

  function pickPotential(): string {
    const roll = rng();
    let cumulative = 0;
    for (const tier of POTENTIAL_DIST) {
      cumulative += tier.pct;
      if (roll < cumulative) return tier.grade;
    }
    return 'C';
  }

  function pickRandomName(origin: string): { first: string; last: string; country: string } {
    const pool = (NAME_POOLS as Record<string, { first: string[]; last: string[]; country: string }>)[origin] ?? NAME_POOLS['us'];
    const firstIdx = Math.floor(rng() * pool.first.length);
    const lastIdx = Math.floor(rng() * pool.last.length);
    return {
      first: pool.first[firstIdx] ?? 'Alex',
      last: pool.last[lastIdx] ?? 'Smith',
      country: pool.country,
    };
  }

  // AB-15: 620 named prospects so pool never exhausts during 600-pick draft
  const DRAFT_CLASS_SIZE = 620;
  for (let i = 0; i < DRAFT_CLASS_SIZE; i++) {
    const overall = randInt(rng, 30, 65);
    const age = randInt(rng, 18, 22);
    const positions = ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'CL'];
    const position = positions[Math.floor(rng() * positions.length)] ?? 'LF';
    const sub = (base: number) => Math.max(1, Math.min(99, randInt(rng, base - 10, base + 10)));
    const potential = pickPotential();

    // Pick origin from distribution array
    const originRoll = rng();
    let originCumulative = 0;
    let origin: string = 'us';
    for (const entry of ORIGIN_DISTRIBUTION) {
      originCumulative += entry.pct;
      if (originRoll < originCumulative) {
        origin = entry.key;
        break;
      }
    }

    const { first, last, country } = pickRandomName(origin);

    // Set minor_level based on potential for freshly drafted prospects
    const minorLevel = overall >= 55 ? 'AA' : overall >= 45 ? 'A' : 'Rookie';

    db.prepare(
      `INSERT INTO players (league_id, team_id, first_name, last_name, age, position, overall_rating, potential, contact, power, speed, fielding, arm, pitching_velocity, pitching_control, pitching_stamina, is_on_mlb_roster, minor_level, annual_salary, contract_years_remaining, service_time, injury_prone, coachability, work_ethic, leadership, origin, birthplace_city, birthplace_country, is_drafted) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 575000, 6, 0, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      leagueId, first, last, age, position, overall, potential,
      sub(overall), sub(overall), sub(overall), sub(overall), sub(overall),
      sub(overall), sub(overall), sub(overall),
      minorLevel,
      randInt(rng, 1, 8),
      randInt(rng, 1, 10), randInt(rng, 1, 10), randInt(rng, 1, 10),
      origin, '', country
    );
  }
}
