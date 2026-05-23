// Tick loop engine — controls simulation speed and phase management
// D17: Server boot always paused
// D28: State machine guards
// D29: In-flight LLM call completes before pause

import { getDb, prepared, getActiveLeague, updateCache, getCachedState, type LeagueRow, type TeamRow } from '../db.js';
import { generateWorld } from './worldgen.js';
import { runExpansionDraft } from './draft.js';
import { validatePostDraftRosters } from './worldgen.js';
import { generateSchedule, saveSchedule, getNextGame, isSeasonComplete, shouldFireTradeDeadline, fireTradeDeadline } from './season.js';
import { simulateGame } from './game.js';
import { runPlayoffs } from './playoffs.js';
import { runOffseason } from './offseason.js';
import { getLlmStatus } from '../services/llm.js';
import type { LeagueStateSnapshot, SimSpeed } from '../../shared/types.js';
import type { NewLeagueBodyType } from '../../shared/schemas.js';

let currentLeagueId: number | null = null;
let simRunning = false;
let currentSpeed: SimSpeed = 'paused';
let tickTimeout: NodeJS.Timeout | null = null;
let draftRunning = false;

const TICK_INTERVALS: Record<SimSpeed, number> = {
  paused: 0,
  normal: 800,
  fast: 100,
  turbo: 0, // immediate via setImmediate
};

// D17: Server boot — restore active league, force paused
export async function initEngine(): Promise<void> {
  const league = getActiveLeague();
  if (league) {
    currentLeagueId = league.id;
    currentSpeed = 'paused';
    // Force paused on restart
    prepared('UPDATE leagues SET sim_speed = ? WHERE id = ?').run('paused', league.id);
    await refreshCache(league.id);
    console.log(`[engine] Restored league ${league.id} (${league.name}), phase: ${league.phase}, forced paused`);

    // D17: If last phase was offseason, restore checkpoint
    if (league.phase === 'offseason' && league.offseason_step && league.offseason_step !== 'done') {
      console.log(`[engine] Mid-offseason restart detected at step: ${league.offseason_step}`);
    }
  } else {
    console.log('[engine] No active league found');
  }
}

// Build the LeagueStateSnapshot from DB
async function refreshCache(leagueId: number): Promise<LeagueStateSnapshot> {
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow | undefined;
  if (!league) throw new Error('League not found');

  const snapshot: LeagueStateSnapshot = {
    leagueId: league.id,
    phase: league.phase as LeagueStateSnapshot['phase'],
    seasonNumber: league.season_number,
    currentGameDate: league.current_game_date,
    currentGameNumber: league.current_game_number,
    simSpeed: (league.sim_speed as SimSpeed) ?? 'paused',
    lastPickId: league.last_pick_id,
    lastGameId: league.last_game_id,
    llmStatus: getLlmStatus(),
    worldgenSeed: league.worldgen_seed,
  };

  updateCache(leagueId, snapshot);
  return snapshot;
}

export async function getActiveLeagueState(
  sincePickId: number = 0,
  sinceGameId: number = 0
): Promise<object | null> {
  const league = getActiveLeague();
  if (!league) return null;

  const cached = getCachedState(league.id);
  if (!cached) {
    return await refreshCache(league.id);
  }

  // Build delta response
  const picks = sincePickId > 0
    ? prepared(`
        SELECT dp.*, p.first_name, p.last_name, p.position, p.overall_rating, p.age, p.potential
        FROM draft_picks dp
        LEFT JOIN players p ON p.id = dp.player_id
        WHERE dp.league_id = ? AND dp.id > ?
        ORDER BY dp.id ASC
        LIMIT 50
      `).all(league.id, sincePickId)
    : [];

  const games = sinceGameId > 0
    ? prepared(`
        SELECT gl.*, ht.name as home_team_name, ht.city as home_city, at2.name as away_team_name, at2.city as away_city
        FROM game_log gl
        JOIN teams ht ON ht.id = gl.home_team_id
        JOIN teams at2 ON at2.id = gl.away_team_id
        WHERE gl.league_id = ? AND gl.id > ? AND gl.is_complete = 1
        ORDER BY gl.id ASC
        LIMIT 50
      `).all(league.id, sinceGameId)
    : [];

  return {
    ...cached,
    simSpeed: currentSpeed, // Use in-memory speed (most up to date)
    picksDelta: picks,
    gamesDelta: games,
  };
}

// D16: Create new league
export async function startNewLeague(options: NewLeagueBodyType): Promise<{ leagueId: number; worldgenSeed: number }> {
  const existing = getActiveLeague();
  if (existing) {
    throw new Error('LEAGUE_EXISTS');
  }

  const wgOptions: { seed?: number; leagueName?: string } = {};
  if (options.seed !== undefined) wgOptions.seed = options.seed;
  if (options.leagueName !== undefined) wgOptions.leagueName = options.leagueName;
  const { leagueId, worldgenSeed } = await generateWorld(wgOptions);

  currentLeagueId = leagueId;
  currentSpeed = 'paused';
  await refreshCache(leagueId);

  return { leagueId, worldgenSeed };
}

// D16: Delete current league
export async function deleteCurrentLeague(): Promise<void> {
  const league = getActiveLeague();
  if (!league) return;

  // Archive current league
  prepared('UPDATE leagues SET archived = 1 WHERE id = ?').run(league.id);

  // Prune old archives — keep only last 3
  const archives = prepared('SELECT id FROM leagues WHERE archived = 1 ORDER BY id DESC').all() as Array<{ id: number }>;
  if (archives.length > 3) {
    const toDelete = archives.slice(3);
    for (const arch of toDelete) {
      prepared('DELETE FROM league_state_cache WHERE league_id = ?').run(arch.id);
      // Note: don't cascade-delete players/teams in v0.1.0 for simplicity
    }
  }

  stopTick();
  currentLeagueId = null;
  currentSpeed = 'paused';
}

// D28: Set simulation speed with state machine guards
export async function setSimSpeed(speed: SimSpeed): Promise<void> {
  const league = getActiveLeague();
  if (!league) throw new Error('NO_ACTIVE_LEAGUE');

  const prevSpeed = currentSpeed;
  currentSpeed = speed;
  prepared('UPDATE leagues SET sim_speed = ? WHERE id = ?').run(speed, league.id);
  await refreshCache(league.id);

  if (speed === 'paused') {
    // D29: Pause is honored after in-flight LLM completes — handled by the tick loop
    stopTick();
  } else if (prevSpeed === 'paused') {
    // Start ticking
    startTick(league);
  }
}

// D28: Advance one step (only valid when paused)
export async function advanceSim(): Promise<void> {
  const league = getActiveLeague();
  if (!league) throw new Error('NO_ACTIVE_LEAGUE');
  if (currentSpeed !== 'paused') throw new Error('NOT_PAUSED');

  const validPhases = ['expansion_draft', 'regular_season', 'playoffs', 'annual_draft'];
  if (!validPhases.includes(league.phase)) throw new Error('INVALID_PHASE');

  await runOneTick(league);
}

function stopTick(): void {
  simRunning = false;
  if (tickTimeout) {
    clearTimeout(tickTimeout);
    tickTimeout = null;
  }
}

function startTick(league: LeagueRow): void {
  if (simRunning) return;
  simRunning = true;
  scheduleTick(league);
}

function scheduleTick(league: LeagueRow): void {
  if (!simRunning || currentSpeed === 'paused') return;

  if (currentSpeed === 'turbo') {
    // Use setImmediate for turbo — yields every 5 games
    setImmediate(() => runTickLoop(league));
  } else {
    const interval = TICK_INTERVALS[currentSpeed];
    tickTimeout = setTimeout(() => runTickLoop(league), interval);
  }
}

let turboGameCount = 0;

async function runTickLoop(league: LeagueRow): Promise<void> {
  if (!simRunning || currentSpeed === 'paused') return;

  try {
    const currentLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(league.id) as LeagueRow | undefined;
    if (!currentLeague) return;

    await runOneTick(currentLeague);

    // D11: yield every 5 games in turbo to allow HTTP requests
    if (currentSpeed === 'turbo') {
      turboGameCount++;
      if (turboGameCount % 5 === 0) {
        await new Promise<void>(r => setImmediate(r));
      }
    }

    // currentSpeed may have changed since function entered; re-check as SimSpeed
    if (simRunning && (currentSpeed as string) !== 'paused') {
      scheduleTick(currentLeague);
    }
  } catch (err) {
    console.error('[engine] Tick error:', err);
    simRunning = false;
  }
}

async function runOneTick(league: LeagueRow): Promise<void> {
  const isTurbo = currentSpeed === 'turbo';

  switch (league.phase) {
    case 'expansion_draft':
    case 'annual_draft':
      await runDraftTick(league, isTurbo);
      break;
    case 'regular_season':
      await runGameTick(league);
      break;
    case 'playoffs':
      await runPlayoffTick(league);
      break;
    case 'offseason':
      await runOffseasonTick(league, isTurbo);
      break;
    default:
      break;
  }

  await refreshCache(league.id);
}

let draftPromise: Promise<void> | null = null;

async function runDraftTick(league: LeagueRow, isTurbo: boolean): Promise<void> {
  if (draftRunning) return; // Already running

  draftRunning = true;
  try {
    if (league.phase === 'expansion_draft') {
      await runExpansionDraft(league, isTurbo, async (_pickId, _round, _pick) => {
        await refreshCache(league.id);
        if (currentSpeed === 'paused') {
          throw new Error('DRAFT_PAUSED'); // Will be caught and draft resumes later
        }
      });
      validatePostDraftRosters(league.id);

      // Generate schedule and transition to regular season
      const newSchedule = generateSchedule(league.id, league.worldgen_seed);
      saveSchedule(league.id, newSchedule);
      prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('regular_season', league.id);
      console.log('[engine] Expansion draft complete, transitioning to regular season');
    } else if (league.phase === 'annual_draft') {
      const { runAnnualDraft } = await import('./draft.js');
      await runAnnualDraft(league, isTurbo);
      prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('regular_season', league.id);
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'DRAFT_PAUSED') {
      console.log('[engine] Draft paused');
    } else {
      console.error('[engine] Draft tick error:', err);
    }
  } finally {
    draftRunning = false;
    simRunning = false; // Draft handles its own pacing
  }
}

async function runGameTick(league: LeagueRow): Promise<void> {
  const nextGame = getNextGame(league.id);
  if (!nextGame) {
    // Season complete
    prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', league.id);
    console.log('[engine] Regular season complete, transitioning to playoffs');
    return;
  }

  // Check trade deadline
  if (shouldFireTradeDeadline(league.id, league.season_number)) {
    fireTradeDeadline(league.id, league.season_number);
  }

  const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(nextGame.homeTeamId) as TeamRow | undefined;
  const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(nextGame.awayTeamId) as TeamRow | undefined;

  if (!homeTeam || !awayTeam) {
    console.error(`[engine] Missing team for game ${nextGame.gameNumber}`);
    return;
  }

  await simulateGame(
    nextGame.gameNumber,
    homeTeam,
    awayTeam,
    nextGame.gameNumber,
    nextGame.dateMs,
    league.season_number,
    league.id
  );

  // Check if season complete after this game
  if (isSeasonComplete(league.id)) {
    prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', league.id);
    console.log('[engine] Regular season complete after game', nextGame.gameNumber);
  }
}

async function runPlayoffTick(league: LeagueRow): Promise<void> {
  try {
    await runPlayoffs(league.id);
  } catch (err) {
    console.error('[engine] Playoff error:', err);
  }
}

async function runOffseasonTick(league: LeagueRow, isTurbo: boolean): Promise<void> {
  try {
    await runOffseason(league, isTurbo);
  } catch (err) {
    console.error('[engine] Offseason error:', err);
  }
}

// initEngine is already exported at the function declaration above
