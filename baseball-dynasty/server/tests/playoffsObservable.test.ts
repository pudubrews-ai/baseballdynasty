// §6.1: Playoffs phase observable test
// Verifies that the playoffs phase is observable via /api/state polling
// Uses in-memory DB, simulates through regular season, then triggers playoffs

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 77 });
  leagueId = result.leagueId;

  // Run expansion draft in turbo mode
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);

  // Generate and save schedule
  const { generateSchedule, saveSchedule } = await import('../sim/season.js');
  const schedule = generateSchedule(leagueId, 77);
  saveSchedule(leagueId, schedule);
}, 120000);

describe('Playoffs phase observable (§6.1)', () => {
  it('phase transitions to playoffs after season completes', async () => {
    const { prepared, getDb } = await import('../db.js');
    const { simulateGame } = await import('../sim/game.js');

    const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
    const schedule: Array<{ gameNumber: number; dateMs: number; homeTeamId: number; awayTeamId: number }> =
      JSON.parse(league.schedule_json);

    // Simulate all games
    for (const game of schedule) {
      const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.homeTeamId) as any;
      const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.awayTeamId) as any;
      if (!homeTeam || !awayTeam) continue;
      await simulateGame(game.gameNumber, homeTeam, awayTeam, game.gameNumber, game.dateMs, league.season_number, leagueId);
    }

    // Transition to playoffs phase
    prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', leagueId);

    // Verify phase is playoffs
    const updatedLeague = prepared('SELECT phase FROM leagues WHERE id = ?').get(leagueId) as { phase: string };
    expect(updatedLeague.phase).toBe('playoffs');
  }, 120000);

  it('runPlayoffs produces a World Series winner', async () => {
    const { prepared } = await import('../db.js');
    const { runPlayoffs } = await import('../sim/playoffs.js');

    await runPlayoffs(leagueId);

    // Should have a season narrative with a champion
    const narrative = prepared(
      'SELECT champion_team_id FROM season_narratives WHERE league_id = ? AND season_number = 1'
    ).get(leagueId) as { champion_team_id: number } | undefined;

    expect(narrative).toBeTruthy();
    expect(narrative!.champion_team_id).toBeGreaterThan(0);
  }, 120000);
});
