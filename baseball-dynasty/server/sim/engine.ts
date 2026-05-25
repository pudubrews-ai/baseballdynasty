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
import { springCutsNeeded, runSpringCuts } from './springCuts.js';
import { runRosterMaintenance } from './rosterMaintenance.js';
import { forceMinimumTrades } from './tradeDeadline.js';
import { getLlmStatus, resetNewsCallsThisSeason } from '../services/llm.js';
import { insertGameNewsItem, insertNewsItem, insertMilestoneNewsItem, fillPendingHeadlines, fillPendingTransactionFlavors } from './news.js';
import { scrubError } from '../util/scrub.js';
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

// §2.3: Per-pick delays for draft pacing — must honor currentSpeed
export function getDraftPickDelay(): number {
  switch (currentSpeed) {
    case 'paused': return 0;
    case 'normal': return 1500;  // spec: 1400-1600ms
    case 'fast':   return 200;   // spec: 180-220ms
    case 'turbo':  return 0;     // immediate
    default:       return 1500;
  }
}

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

// §1.1: Export isPaused for cooperative draft cancellation (no throw-based control flow)
export function isPaused(): boolean {
  return currentSpeed === 'paused';
}

// Build the LeagueStateSnapshot from DB
export async function refreshCache(leagueId: number): Promise<LeagueStateSnapshot> {
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow | undefined;
  if (!league) throw new Error('League not found');

  // §2.14: Map internal DB phases to API-exposed phase values
  function mapPhase(dbPhase: string): LeagueStateSnapshot['phase'] {
    switch (dbPhase) {
      case 'expansion_draft':
      case 'annual_draft':
        return 'draft';
      case 'regular_season': return 'regular_season';
      case 'playoffs': return 'playoffs';
      case 'offseason': return 'offseason';
      default:
        throw new Error(`[engine] Unrecognized DB phase: ${dbPhase}`);
    }
  }

  // §1.1: Map DB phase to subPhase for UI title distinction
  function mapSubPhase(dbPhase: string): 'expansion' | 'annual' | null {
    if (dbPhase === 'expansion_draft') return 'expansion';
    if (dbPhase === 'annual_draft') return 'annual';
    return null;
  }

  // Compute waiverCount and lastNewsId for v0.2.0
  const waiverCountRow = prepared(
    "SELECT COUNT(*) as cnt FROM players WHERE league_id = ? AND waiver_state IN ('dfa','waivers')"
  ).get(league.id) as { cnt: number } | undefined;
  const waiverCount = waiverCountRow?.cnt ?? 0;

  const lastNewsRow = prepared(
    'SELECT MAX(id) as maxId FROM news_items WHERE league_id = ?'
  ).get(league.id) as { maxId: number | null } | undefined;
  const lastNewsId = lastNewsRow?.maxId ?? 0;

  // v0.3.0: franchise state
  const { getFranchiseState } = await import('./franchise.js');
  const franchiseState = getFranchiseState(league.id);
  const ownedTeamId: number | null = franchiseState?.owned_team_id ?? null;
  const selectionResolved: boolean = franchiseState?.selection_resolved === 1;

  const snapshot: LeagueStateSnapshot = {
    leagueId: league.id,
    phase: mapPhase(league.phase),
    subPhase: mapSubPhase(league.phase),
    seasonNumber: league.season_number,
    season: league.season_number, // §2.2 Iter-5: alias per spec G0-4
    currentGameDate: league.current_game_date,
    currentGameNumber: league.current_game_number,
    simSpeed: (league.sim_speed as SimSpeed) ?? 'paused',
    lastPickId: league.last_pick_id,
    lastGameId: league.last_game_id,
    llmStatus: getLlmStatus(),
    worldgenSeed: league.worldgen_seed,
    waiverCount,
    lastNewsId,
    ownedTeamId,
    selectionResolved,
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

  currentSpeed = speed;
  prepared('UPDATE leagues SET sim_speed = ? WHERE id = ?').run(speed, league.id);
  await refreshCache(league.id);

  if (speed === 'paused') {
    // D29: Pause is honored after in-flight LLM completes — handled by the tick loop
    stopTick();
  } else if (!simRunning) {
    // Restart tick loop whenever speed is non-paused and engine is not currently running (§2.10)
    // This handles the case where draft completed (simRunning=false) and user now sets a speed
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
    console.error('[engine] Tick error:', scrubError(err).message);
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
      // AB-08: spring cuts run as first regular-season event; no game simmed on this tick
      if (springCutsNeeded(league)) {
        runSpringCuts(league);
        break;
      }
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
        // §1.1: No throw — cooperative pause via isPaused() in draft loop
        // Skip per-pick cache refresh in turbo for performance (§2.4)
        if (currentSpeed !== 'turbo') {
          await refreshCache(league.id);
        }
      });
      validatePostDraftRosters(league.id);

      // §2.4: After turbo draft, refresh cache once
      await refreshCache(league.id);

      // Generate schedule and transition to regular season
      const newSchedule = generateSchedule(league.id, league.worldgen_seed);
      saveSchedule(league.id, newSchedule);
      prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('regular_season', league.id);
      console.log('[engine] Expansion draft complete, transitioning to regular season');
    } else if (league.phase === 'annual_draft') {
      const { runAnnualDraft } = await import('./draft.js');
      await runAnnualDraft(league, isTurbo, async (_pickId, _round, _pick) => {
        // §1.1: No throw — cooperative pause via isPaused() in draft loop
        // Skip per-pick cache refresh in turbo for performance (§2.4)
        if (currentSpeed !== 'turbo') {
          await refreshCache(league.id);
        }
      });
      // §2.4: After turbo annual draft, refresh cache once
      await refreshCache(league.id);
      prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('regular_season', league.id);
    }
  } catch (err) {
    // §1.1: DRAFT_PAUSED no longer thrown; cooperative pause exits draft loop cleanly
    // (kept for safety in case of unexpected throw)
    if (err instanceof Error && err.message === 'DRAFT_PAUSED') {
      console.log('[engine] Draft paused (legacy path)');
      simRunning = false;
    } else {
      console.error('[engine] Draft tick error:', scrubError(err).message);
      simRunning = false;
    }
  } finally {
    draftRunning = false;
    // §2.10: Only set simRunning=false if paused.
    // If draft completed naturally at non-paused speed, leave simRunning=true
    // so the tick loop continues into regular_season.
    if (currentSpeed === 'paused') {
      simRunning = false;
    }
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
    // AB-12: force minimum 3 trades after the deadline marker fires
    try {
      const allTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(league.id) as TeamRow[];
      forceMinimumTrades(allTeams, league.id, league.season_number);
    } catch (err) {
      console.warn('[engine] Force minimum trades error:', err);
    }
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

  // §1.1(f): Insert game result news item (score-only, no LLM, immediate)
  // §1.2(a): Also read notable_events_json to emit INJURY and MILESTONE news items.
  try {
    const gameRow = prepared(
      'SELECT id, home_score, away_score, notable_events_json FROM game_log WHERE league_id = ? AND game_number = ? AND season_number = ? ORDER BY id DESC LIMIT 1'
    ).get(league.id, nextGame.gameNumber, league.season_number) as {
      id: number; home_score: number; away_score: number; notable_events_json: string | null;
    } | undefined;
    if (gameRow) {
      insertGameNewsItem({
        leagueId: league.id,
        seasonNumber: league.season_number,
        gameNumber: nextGame.gameNumber,
        homeTeamId: nextGame.homeTeamId,
        awayTeamId: nextGame.awayTeamId,
        homeScore: gameRow.home_score,
        awayScore: gameRow.away_score,
        homeTeamName: `${homeTeam.city} ${homeTeam.name}`,
        awayTeamName: `${awayTeam.city} ${awayTeam.name}`,
      });

      // §1.2(a): Surface injury + milestone NotableEvents into the news feed
      if (gameRow.notable_events_json) {
        try {
          const events = JSON.parse(gameRow.notable_events_json) as Array<{
            type: string;
            playerId?: number;
            description?: string;
            recoveryGames?: number; // AB-10 Part A: IL stint length
          }>;
          for (const ev of events) {
            if (!ev.playerId) continue;
            // Resolve team_id from players table (CB: structured columns only, never raw description)
            const playerRow = prepared('SELECT team_id FROM players WHERE id = ?').get(ev.playerId) as { team_id: number | null } | undefined;
            const teamId = playerRow?.team_id ?? null;
            if (ev.type === 'milestone') {
              insertMilestoneNewsItem({
                leagueId: league.id,
                seasonNumber: league.season_number,
                gameNumber: nextGame.gameNumber,
                playerId: ev.playerId,
                teamId: teamId ?? nextGame.homeTeamId,
                sourceTable: 'game_log',
                sourceId: gameRow.id,
              });
            } else if (ev.type === 'injury') {
              // Step 10 (L6 double-write fix): game.ts already wrote injury fields atomically
              // inside the game transaction (is_injured, is_on_25man, injury_type, injury_tier,
              // rehab_games_remaining, career_injuries, injury_return_game). Do NOT write again here.
              // Only insert the news item.
              insertNewsItem({
                leagueId: league.id,
                seasonNumber: league.season_number,
                gameNumber: nextGame.gameNumber,
                eventType: 'injury',
                playerId: ev.playerId,
                teamId: teamId,
                sourceTable: 'game_log',
                sourceId: gameRow.id,
              });
            }
          }
        } catch (err) {
          console.warn('[engine] notable-events news insert error:', scrubError(err).message);
        }
      }
    }
  } catch (err) {
    console.warn('[engine] Game news insert error:', scrubError(err).message);
  }

  // AB-18/AB-03: roster maintenance runs AFTER simulateGame, unconditionally
  // (including skipped-game ticks — the hook is here, not in simulateGame).
  // Crash-gap acceptance: if crash here, next tick re-evaluates idempotent conditions.
  runRosterMaintenance(league.id, nextGame.homeTeamId, nextGame.awayTeamId, nextGame.gameNumber);

  // §1.1(g): Fill pending headlines once per game tick (async, non-blocking)
  fillPendingHeadlines(league.id).catch(err =>
    console.warn('[engine] fillPendingHeadlines error:', scrubError(err).message)
  );

  // §1.1(h): Fill pending transaction flavors once per game tick
  fillPendingTransactionFlavors(league.id).catch(err =>
    console.warn('[engine] fillPendingTransactionFlavors error:', scrubError(err).message)
  );

  // Check if season complete after this game
  if (isSeasonComplete(league.id)) {
    prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', league.id);
    console.log('[engine] Regular season complete after game', nextGame.gameNumber);
    // Flush trailing pending headlines at phase transition (AB-07)
    fillPendingHeadlines(league.id).catch(err =>
      console.warn('[engine] Phase transition fillPendingHeadlines error:', scrubError(err).message)
    );
  }
}

async function runPlayoffTick(league: LeagueRow): Promise<void> {
  try {
    await runPlayoffs(league.id);
    // Flush pending headlines at each playoff tick
    fillPendingHeadlines(league.id).catch(err =>
      console.warn('[engine] Playoff fillPendingHeadlines error:', scrubError(err).message)
    );
  } catch (err) {
    console.error('[engine] Playoff error:', scrubError(err).message);
  }
}

async function runOffseasonTick(league: LeagueRow, isTurbo: boolean): Promise<void> {
  try {
    await runOffseason(league, isTurbo);
    // Flush pending headlines at offseason phase (AB-07 phase transition flush)
    await fillPendingHeadlines(league.id);
    await fillPendingTransactionFlavors(league.id);
    // Reset news call season cap at offseason→new-season boundary (CB-5)
    const freshLeague = prepared('SELECT phase, offseason_step FROM leagues WHERE id = ?').get(league.id) as { phase: string; offseason_step: string | null } | undefined;
    if (freshLeague?.phase === 'regular_season') {
      // Offseason just completed (transitioned to regular_season)
      resetNewsCallsThisSeason();
    }
  } catch (err) {
    console.error('[engine] Offseason error:', scrubError(err).message);
  }
}

// initEngine is already exported at the function declaration above
