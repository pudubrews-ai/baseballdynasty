// Playoff bracket generation and series simulation
// D18: Tiebreakers: H2H → intra-div → run diff → coin flip

import { getDb, prepared, type TeamRow, type LeagueRow } from '../db.js';
import { seedFor, randInt } from './prng.js';
import { simulateGame } from './game.js';

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

  // 5. Deterministic coin flip via tiebreaker seed
  return rng() > 0.5 ? 1 : -1;
}

export function buildPlayoffBracket(leagueId: number): PlayoffSeed[] {
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;
  const teams = prepared('SELECT * FROM teams WHERE league_id = ? ORDER BY wins DESC').all(leagueId) as TeamRow[];

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

  // Division Series (best-of-5): 1v4 and 2v3 per conference
  const americanSeeds = seeds.filter(s => s.conference === 'American');
  const nationalSeeds = seeds.filter(s => s.conference === 'National');

  const amerDS1winner = await runSeries(leagueId, americanSeeds[0]!, americanSeeds[3]!, 5, 'American DS');
  const amerDS2winner = await runSeries(leagueId, americanSeeds[1]!, americanSeeds[2]!, 5, 'American DS');
  const natDS1winner = await runSeries(leagueId, nationalSeeds[0]!, nationalSeeds[3]!, 5, 'National DS');
  const natDS2winner = await runSeries(leagueId, nationalSeeds[1]!, nationalSeeds[2]!, 5, 'National DS');

  if (!amerDS1winner || !amerDS2winner || !natDS1winner || !natDS2winner) {
    console.error('[playoffs] DS failed to produce winners');
    return;
  }

  // Championship Series (best-of-7)
  const amerCSWinner = await runSeries(leagueId, amerDS1winner, amerDS2winner, 7, 'American CS');
  const natCSWinner = await runSeries(leagueId, natDS1winner, natDS2winner, 7, 'National CS');

  if (!amerCSWinner || !natCSWinner) {
    console.error('[playoffs] CS failed to produce winners');
    return;
  }

  // World Series (best-of-7)
  const worldSeriesWinner = await runSeries(leagueId, amerCSWinner, natCSWinner, 7, 'World Series');

  if (!worldSeriesWinner) {
    console.error('[playoffs] World Series failed to produce a winner');
    return;
  }

  // Record champion
  const winnerId = worldSeriesWinner.teamId;
  prepared('INSERT OR REPLACE INTO season_narratives (league_id, season_number, champion_team_id) VALUES (?, ?, ?)')
    .run(leagueId, league.season_number, winnerId);

  console.log(`[playoffs] Season ${league.season_number} champion: ${worldSeriesWinner.teamName} (team ${winnerId})`);

  // Transition to offseason
  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('offseason', leagueId);
  prepared('UPDATE leagues SET offseason_step = ? WHERE id = ?').run('retirement', leagueId);
}

async function runSeries(
  leagueId: number,
  seed1: PlayoffSeed,
  seed2: PlayoffSeed,
  bestOf: number,
  seriesName: string
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

    const preGameNum = league.current_game_number;
    await simulateGame(
      gameNum, homeTeam, awayTeam, gameNum,
      league.current_game_date, league.season_number, leagueId
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
    }
  }

  const winner = wins1 >= winsNeeded ? seed1 : seed2;
  console.log(`[playoffs] ${seriesName}: ${seed1.teamName} vs ${seed2.teamName} → ${winner.teamName}`);
  return winner;
}
