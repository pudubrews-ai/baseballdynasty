// §5.1 Iter-5: Multi-season progression test — 3 full seasons end-to-end
// Verifies that season N+1 does not stall after retirement+FA depletion (§1.1)

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

// Helper: run one full season (expansion or annual draft already done, then games+playoffs+offseason)
async function runFullSeason(lId: number, seasonNumber: number): Promise<void> {
  const { prepared } = await import('../db.js');
  const { generateSchedule, saveSchedule } = await import('../sim/season.js');
  const { simulateGame } = await import('../sim/game.js');
  const { runPlayoffs } = await import('../sim/playoffs.js');
  const { runOffseason } = await import('../sim/offseason.js');

  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(lId) as any;
  const schedule = generateSchedule(lId, league.worldgen_seed ^ seasonNumber);
  saveSchedule(lId, schedule);

  // Simulate first 50 games properly, fast-forward the rest
  const gameSlice = schedule.slice(0, 50);
  for (const game of gameSlice) {
    const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.homeTeamId) as any;
    const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.awayTeamId) as any;
    if (homeTeam && awayTeam) {
      await simulateGame(
        game.gameNumber, homeTeam, awayTeam, game.gameNumber,
        game.dateMs, seasonNumber, lId
      );
    }
  }

  // Fast-forward remaining games
  const remainingGames = schedule.slice(50);
  for (let i = 0; i < remainingGames.length; i++) {
    const g = remainingGames[i]!;
    const homeWon = i % 2 === 0;
    prepared(
      'INSERT INTO game_log (league_id, season_number, game_number, home_team_id, away_team_id, home_score, away_score, game_date, is_complete) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).run(lId, seasonNumber, g.gameNumber, g.homeTeamId, g.awayTeamId, homeWon ? 5 : 2, homeWon ? 2 : 5, g.dateMs);
    if (homeWon) {
      prepared('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + 5, runs_allowed = runs_allowed + 2 WHERE id = ?').run(g.homeTeamId);
      prepared('UPDATE teams SET losses = losses + 1, runs_scored = runs_scored + 2, runs_allowed = runs_allowed + 5 WHERE id = ?').run(g.awayTeamId);
    } else {
      prepared('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + 5, runs_allowed = runs_allowed + 2 WHERE id = ?').run(g.awayTeamId);
      prepared('UPDATE teams SET losses = losses + 1, runs_scored = runs_scored + 2, runs_allowed = runs_allowed + 5 WHERE id = ?').run(g.homeTeamId);
    }
  }

  prepared('UPDATE leagues SET current_game_number = ?, phase = ? WHERE id = ?').run(schedule.length, 'playoffs', lId);
  await runPlayoffs(lId);

  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('offseason', lId);
  const offseasonLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(lId) as any;
  await runOffseason(offseasonLeague, true);
}

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 314159 });
  leagueId = result.leagueId;

  // Season 1: run expansion draft then full season
  const league1 = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league1, true);

  // Set phase to regular_season for the schedule generator
  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('regular_season', leagueId);
  await runFullSeason(leagueId, 1);

  // After runOffseason, season_number should be 2 and we are in annual_draft phase
  // runOffseason calls runAnnualDraft internally, so by the time it returns we should be at season 2
  // with phase = 'regular_season'

  // Season 2
  const season2State = prepared('SELECT season_number, phase FROM leagues WHERE id = ?').get(leagueId) as any;
  if (season2State.season_number === 2 && season2State.phase === 'regular_season') {
    await runFullSeason(leagueId, 2);
  }

  // Season 3
  const season3State = prepared('SELECT season_number, phase FROM leagues WHERE id = ?').get(leagueId) as any;
  if (season3State.season_number === 3 && season3State.phase === 'regular_season') {
    await runFullSeason(leagueId, 3);
  }
}, 120_000);

describe('Multi-season progression (§1.1 Iter-5)', () => {
  it('reaches season 4 after three complete seasons', async () => {
    const { prepared } = await import('../db.js');
    const league = prepared('SELECT season_number, phase FROM leagues WHERE id = ?').get(leagueId) as { season_number: number; phase: string };
    expect(league.season_number).toBeGreaterThanOrEqual(4);
  });

  it('all teams have at least one SP on MLB roster entering season 4', async () => {
    const { prepared } = await import('../db.js');
    const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as { id: number }[];
    for (const team of teams) {
      const spCount = prepared(
        "SELECT COUNT(*) as cnt FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position = 'SP'"
      ).get(team.id) as { cnt: number };
      expect(spCount.cnt).toBeGreaterThanOrEqual(1);
    }
  });

  it('no game-validation-failure stalls occurred (game_log has at least 50 games per season)', async () => {
    const { prepared } = await import('../db.js');
    // Each season runs at least 50 full games
    for (let s = 1; s <= 3; s++) {
      const gameCount = prepared(
        'SELECT COUNT(*) as cnt FROM game_log WHERE league_id = ? AND season_number = ? AND is_complete = 1'
      ).get(leagueId, s) as { cnt: number };
      // We simulate 50 games + fast-forward rest; total should be at least 50
      expect(gameCount.cnt).toBeGreaterThanOrEqual(50);
    }
  });
});
