// Playoff bracket generation and series simulation
// D18: Tiebreakers: H2H → intra-div → run diff → coin flip
// Architect-locked v0.1.0 series lengths:
// Division Series = best-of-5 (first to 3)
// Championship Series = best-of-7 (first to 4)
// World Series = best-of-7 (first to 4)

import { getDb, prepared, type TeamRow, type LeagueRow } from '../db.js';
import { seedFor, randInt } from './prng.js';
import { simulateGame } from './game.js';
import { refreshCache } from './engine.js';

export interface PlayoffSeed {
  teamId: number;
  teamName: string;
  wins: number;
  losses: number;
  conference: string;
  seed: number;
}

export interface PlayoffSeries {
  homeTeamId: number;
  awayTeamId: number;
  homeSeed: number;
  awaySeed: number;
  round: number; // 1=WildCard/DS, 2=CS, 3=World Series
  bestOf: number;
  homeWins: number;
  awayWins: number;
  isComplete: boolean;
  winnerId: number | null;
}

// §4.4: Memoized tiebreaker — prevents non-deterministic sort due to repeated comparator calls
let tiebreakerCache: Map<string, number> = new Map();

function pairKey(a: TeamRow, b: TeamRow): string {
  const lo = Math.min(a.id, b.id);
  const hi = Math.max(a.id, b.id);
  return `${lo}_${hi}`;
}

export function clearTiebreakerCache(): void {
  tiebreakerCache = new Map();
}

// D18: Compare two teams for playoff seeding
function compareTeams(a: TeamRow, b: TeamRow, league: LeagueRow, rng: () => number): number {
  // 1. Win percentage
  const aPct = a.wins / Math.max(1, a.wins + a.losses);
  const bPct = b.wins / Math.max(1, b.wins + b.losses);
  if (Math.abs(aPct - bPct) > 0.001) return bPct - aPct; // higher pct first

  // 2. Head-to-head W/L
  const h2h = prepared(
    `SELECT
       SUM(CASE WHEN home_team_id = ? AND home_score > away_score THEN 1 WHEN away_team_id = ? AND away_score > home_score THEN 1 ELSE 0 END) as a_wins,
       SUM(CASE WHEN home_team_id = ? AND home_score > away_score THEN 1 WHEN away_team_id = ? AND away_score > home_score THEN 1 ELSE 0 END) as b_wins
     FROM game_log
     WHERE league_id = ? AND is_complete = 1 AND season_number = ?
     AND ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))`
  ).get(a.id, a.id, b.id, b.id, league.id, league.season_number, a.id, b.id, b.id, a.id) as { a_wins: number; b_wins: number } | undefined;

  if (h2h && h2h.a_wins !== h2h.b_wins) return h2h.b_wins - h2h.a_wins; // fewer wins = worse

  // 3. Intra-division record (approximate via run differential in division)
  // For simplicity in v0.1.0, skip to run differential

  // 4. Run differential
  const aRD = a.runs_scored - a.runs_allowed;
  const bRD = b.runs_scored - b.runs_allowed;
  if (aRD !== bRD) return bRD - aRD; // higher RD first

  // 5. Memoized coin flip — prevents non-deterministic sort behavior (§4.4)
  const key = pairKey(a, b);
  if (!tiebreakerCache.has(key)) {
    tiebreakerCache.set(key, rng() > 0.5 ? 1 : -1);
  }
  const cached = tiebreakerCache.get(key)!;
  // Flip sign if (a,b) is in reversed order from (lo,hi)
  return a.id < b.id ? cached : -cached;
}

export function buildPlayoffBracket(leagueId: number): PlayoffSeed[] {
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;
  const teams = prepared('SELECT * FROM teams WHERE league_id = ? ORDER BY wins DESC').all(leagueId) as TeamRow[];

  // Clear tiebreaker cache at start of each bracket build (§4.4)
  clearTiebreakerCache();

  const rng = seedFor('tiebreaker', league.worldgen_seed ^ league.season_number);

  // Split by conference
  const american = teams.filter(t => t.conference === 'American').sort((a, b) => compareTeams(a, b, league, rng));
  const national = teams.filter(t => t.conference === 'National').sort((a, b) => compareTeams(a, b, league, rng));

  const seeds: PlayoffSeed[] = [];

  // Each conference: top 2 division winners + 2 wildcards
  function seedConference(confTeams: TeamRow[], conf: string): void {
    const eastDiv = confTeams.filter(t => t.division.includes('East'));
    const westDiv = confTeams.filter(t => t.division.includes('West'));

    const eastWinner = eastDiv[0];
    const westWinner = westDiv[0];
    if (!eastWinner || !westWinner) return;

    const divWinners = [eastWinner, westWinner].sort((a, b) => compareTeams(a, b, league, rng));
    const wildcards = confTeams.filter(t => t.id !== divWinners[0]?.id && t.id !== divWinners[1]?.id)
      .sort((a, b) => compareTeams(a, b, league, rng))
      .slice(0, 2);

    const confSeeds = [...divWinners, ...wildcards];
    confSeeds.forEach((team, i) => {
      seeds.push({
        teamId: team.id,
        teamName: `${team.city} ${team.name}`,
        wins: team.wins,
        losses: team.losses,
        conference: conf,
        seed: i + 1,
      });
    });
  }

  seedConference(american, 'American');
  seedConference(national, 'National');

  return seeds;
}

export async function runPlayoffs(leagueId: number): Promise<void> {
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;
  const seeds = buildPlayoffBracket(leagueId);

  console.log(`[playoffs] Starting playoffs for season ${league.season_number}`);

  // §2.2: Ensure phase is set to playoffs (defensive)
  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', leagueId);

  // §2.6: Guaranteed 500ms of phase='playoffs' in cache before any series starts
  await refreshCache(leagueId);
  await new Promise(r => setTimeout(r, 500));

  // Division Series (best-of-5): 1v4 and 2v3 per conference
  const americanSeeds = seeds.filter(s => s.conference === 'American');
  const nationalSeeds = seeds.filter(s => s.conference === 'National');

  const amerDS1winner = await runSeries(leagueId, americanSeeds[0]!, americanSeeds[3]!, 5, 'DS', 'American', league.season_number);
  // §2.6: 250ms inter-series yield + explicit cache refresh so /api/state can observe playoffs phase
  await refreshCache(leagueId);
  await new Promise(r => setTimeout(r, 250));
  const amerDS2winner = await runSeries(leagueId, americanSeeds[1]!, americanSeeds[2]!, 5, 'DS', 'American', league.season_number);
  await refreshCache(leagueId);
  await new Promise(r => setTimeout(r, 250));
  const natDS1winner = await runSeries(leagueId, nationalSeeds[0]!, nationalSeeds[3]!, 5, 'DS', 'National', league.season_number);
  await refreshCache(leagueId);
  await new Promise(r => setTimeout(r, 250));
  const natDS2winner = await runSeries(leagueId, nationalSeeds[1]!, nationalSeeds[2]!, 5, 'DS', 'National', league.season_number);
  await refreshCache(leagueId);
  await new Promise(r => setTimeout(r, 250));

  if (!amerDS1winner || !amerDS2winner || !natDS1winner || !natDS2winner) {
    console.error('[playoffs] DS failed to produce winners');
    return;
  }

  // Championship Series (best-of-7)
  const amerCSWinner = await runSeries(leagueId, amerDS1winner, amerDS2winner, 7, 'CS', 'American', league.season_number);
  await refreshCache(leagueId);
  await new Promise(r => setTimeout(r, 250));
  const natCSWinner = await runSeries(leagueId, natDS1winner, natDS2winner, 7, 'CS', 'National', league.season_number);
  await refreshCache(leagueId);
  await new Promise(r => setTimeout(r, 250));

  if (!amerCSWinner || !natCSWinner) {
    console.error('[playoffs] CS failed to produce winners');
    return;
  }

  // World Series (best-of-7)
  const worldSeriesWinner = await runSeries(leagueId, amerCSWinner, natCSWinner, 7, 'WS', null, league.season_number);

  if (!worldSeriesWinner) {
    console.error('[playoffs] World Series failed to produce a winner');
    return;
  }

  // Record champion with procedural MVP (§5.4)
  const winnerId = worldSeriesWinner.teamId;
  const mvp = pickSeasonMVP(leagueId, league.season_number, winnerId);
  prepared('INSERT OR REPLACE INTO season_narratives (league_id, season_number, champion_team_id, mvp_player_id) VALUES (?, ?, ?, ?)')
    .run(leagueId, league.season_number, winnerId, mvp?.id ?? null);

  console.log(`[playoffs] Season ${league.season_number} champion: ${worldSeriesWinner.teamName} (team ${winnerId})`);

  // Transition to offseason
  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('offseason', leagueId);
  prepared('UPDATE leagues SET offseason_step = ? WHERE id = ?').run('season_archive', leagueId);
}

async function runSeries(
  leagueId: number,
  seed1: PlayoffSeed,
  seed2: PlayoffSeed,
  bestOf: number,
  roundName: string,
  conference: string | null,
  seasonNumber: number
): Promise<PlayoffSeed | null> {
  if (!seed1 || !seed2) return null;

  const winsNeeded = Math.ceil(bestOf / 2);
  let wins1 = 0;
  let wins2 = 0;
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;
  const team1 = prepared('SELECT * FROM teams WHERE id = ?').get(seed1.teamId) as TeamRow;
  const team2 = prepared('SELECT * FROM teams WHERE id = ?').get(seed2.teamId) as TeamRow;

  let gameNum = league.current_game_number;

  while (wins1 < winsNeeded && wins2 < winsNeeded) {
    gameNum++;
    // Alternate home/away: seed1 (higher seed) has home field in odd games
    const isHome1 = (wins1 + wins2) % 2 === 0;
    const homeTeam = isHome1 ? team1 : team2;
    const awayTeam = isHome1 ? team2 : team1;

    await simulateGame(
      gameNum, homeTeam, awayTeam, gameNum,
      league.current_game_date, league.season_number, leagueId,
      true // isPlayoff — don't update regular-season standings (§2.4)
    );

    // Check who won
    const game = prepared('SELECT * FROM game_log WHERE league_id = ? AND game_number = ? ORDER BY id DESC LIMIT 1')
      .get(leagueId, gameNum) as { home_score: number; away_score: number; home_team_id: number } | undefined;

    if (game) {
      const homeWon = game.home_score > game.away_score;
      if (homeTeam.id === seed1.teamId) {
        if (homeWon) wins1++;
        else wins2++;
      } else {
        if (homeWon) wins2++;
        else wins1++;
      }
    } else {
      // §guard: game was skipped (no roster/pitcher) — award procedural home win to avoid infinite loop
      console.warn(`[playoffs] Game ${gameNum} not in game_log (skipped); awarding procedural home win`);
      if (homeTeam.id === seed1.teamId) wins1++;
      else wins2++;
    }
  }

  const winner = wins1 >= winsNeeded ? seed1 : seed2;
  const seriesLabel = conference ? `${conference} ${roundName}` : roundName;
  console.log(`[playoffs] ${seriesLabel}: ${seed1.teamName} vs ${seed2.teamName} → ${winner.teamName}`);

  // Record series result in playoff_series table (§2.4 Fix step D)
  prepared(
    'INSERT INTO playoff_series (league_id, season_number, round_name, conference, team1_id, team2_id, winner_team_id, team1_wins, team2_wins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(leagueId, seasonNumber, roundName, conference, seed1.teamId, seed2.teamId, winner.teamId, wins1, wins2, Date.now());

  return winner;
}

// §5.4: Procedural MVP selection — hitter if winning OPS > 0.950, else pitcher
function pickSeasonMVP(leagueId: number, seasonNumber: number, winnerId: number): { id: number } | null {
  // Check top hitter OPS on winning team
  const topHitter = prepared(
    `SELECT p.id,
       (CAST(ss.hits AS REAL) / NULLIF(ss.at_bats, 0) +
        (CAST(ss.hits + ss.walks AS REAL) / NULLIF(ss.at_bats + ss.walks, 0))) as ops
     FROM season_stats ss
     JOIN players p ON p.id = ss.player_id
     WHERE ss.league_id = ? AND ss.season_number = ? AND ss.team_id = ? AND ss.at_bats >= 50
     ORDER BY ops DESC LIMIT 1`
  ).get(leagueId, seasonNumber, winnerId) as { id: number; ops: number } | undefined;

  if (topHitter && topHitter.ops > 0.950) {
    return { id: topHitter.id };
  }

  // Fall back to lowest ERA pitcher
  const topPitcher = prepared(
    `SELECT p.id
     FROM season_stats ss
     JOIN players p ON p.id = ss.player_id
     WHERE ss.league_id = ? AND ss.season_number = ? AND ss.team_id = ? AND ss.innings_pitched >= 20
     ORDER BY (CAST(ss.earned_runs AS REAL) * 9.0 / ss.innings_pitched) ASC LIMIT 1`
  ).get(leagueId, seasonNumber, winnerId) as { id: number } | undefined;

  return topPitcher ?? topHitter ?? null;
}
