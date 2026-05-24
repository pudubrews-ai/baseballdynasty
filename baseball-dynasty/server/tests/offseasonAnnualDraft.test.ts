// §1.2: Verify offseason annual draft succeeds and league transitions to season 2
// Uses the real offseason runner to exercise the full offseason→annual_draft path
// Regression gate for UNIQUE constraint fix in migration 005_draft_picks_unique_v2.sql

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 999 });
  leagueId = result.leagueId;

  // Run expansion draft (turbo)
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);

  // Generate and save schedule
  const { generateSchedule, saveSchedule } = await import('../sim/season.js');
  const schedule = generateSchedule(leagueId, 999);
  saveSchedule(leagueId, schedule);

  // Simulate all games (50 games only for speed)
  const { simulateGame } = await import('../sim/game.js');
  const gameSlice = schedule.slice(0, 50);
  for (const game of gameSlice) {
    const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.homeTeamId) as any;
    const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.awayTeamId) as any;
    if (homeTeam && awayTeam) {
      await simulateGame(
        game.gameNumber, homeTeam, awayTeam, game.gameNumber,
        game.dateMs, league.season_number, leagueId
      );
    }
  }

  // Mark remaining games as complete (fast path: skip simulation, just set standings manually)
  const remainingGames = schedule.slice(50);
  const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as { id: number }[];
  for (let i = 0; i < remainingGames.length; i++) {
    const g = remainingGames[i]!;
    const homeWon = i % 2 === 0;
    prepared(
      'INSERT INTO game_log (league_id, season_number, game_number, home_team_id, away_team_id, home_score, away_score, game_date, is_complete) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 1)'
    ).run(leagueId, g.gameNumber, g.homeTeamId, g.awayTeamId, homeWon ? 5 : 2, homeWon ? 2 : 5, g.dateMs);
    if (homeWon) {
      prepared('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + 5, runs_allowed = runs_allowed + 2 WHERE id = ?').run(g.homeTeamId);
      prepared('UPDATE teams SET losses = losses + 1, runs_scored = runs_scored + 2, runs_allowed = runs_allowed + 5 WHERE id = ?').run(g.awayTeamId);
    } else {
      prepared('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + 5, runs_allowed = runs_allowed + 2 WHERE id = ?').run(g.awayTeamId);
      prepared('UPDATE teams SET losses = losses + 1, runs_scored = runs_scored + 2, runs_allowed = runs_allowed + 5 WHERE id = ?').run(g.homeTeamId);
    }
  }

  // Mark all games as scheduled
  prepared('UPDATE leagues SET current_game_number = ? WHERE id = ?').run(schedule.length, leagueId);

  // Run playoffs
  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', leagueId);
  const { runPlayoffs } = await import('../sim/playoffs.js');
  await runPlayoffs(leagueId);

  // Run offseason (the full offseason runner includes annual draft)
  const { runOffseason } = await import('../sim/offseason.js');
  const offseasonLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  await runOffseason(offseasonLeague, true); // isTurbo=true
}, 300000);

describe('Offseason → Season 2 (§1.2)', () => {
  it('annual draft picks exist for season 1 with is_expansion_draft=0 (no UNIQUE conflict)', async () => {
    const { prepared } = await import('../db.js');
    const annualPicks = prepared(
      'SELECT COUNT(*) as cnt FROM draft_picks WHERE league_id = ? AND season_number = 1 AND is_expansion_draft = 0'
    ).get(leagueId) as { cnt: number };
    // 20 teams × 30 rounds = 600 picks
    expect(annualPicks.cnt).toBe(600);
  });

  it('expansion draft picks and annual draft picks coexist at season_number=1 without collision', async () => {
    const { prepared } = await import('../db.js');
    const expansionPicks = prepared(
      'SELECT COUNT(*) as cnt FROM draft_picks WHERE league_id = ? AND season_number = 1 AND is_expansion_draft = 1'
    ).get(leagueId) as { cnt: number };
    const annualPicks = prepared(
      'SELECT COUNT(*) as cnt FROM draft_picks WHERE league_id = ? AND season_number = 1 AND is_expansion_draft = 0'
    ).get(leagueId) as { cnt: number };
    expect(expansionPicks.cnt).toBe(600);
    expect(annualPicks.cnt).toBe(600);
  });

  it('league advances to season 2 after offseason', async () => {
    const { prepared } = await import('../db.js');
    const league = prepared('SELECT season_number, phase FROM leagues WHERE id = ?').get(leagueId) as { season_number: number; phase: string };
    expect(league.season_number).toBe(2);
    expect(league.phase).toBe('regular_season');
  });
});
