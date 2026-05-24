// §6.5: Playoff isolation test — playoff games must NOT update regular-season standings
// AB-xx regression gate: isPlayoff=true prevents teams.wins contamination

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 55555 });
  leagueId = result.leagueId;

  // Run expansion draft
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);

  // Generate and save schedule
  const { generateSchedule, saveSchedule } = await import('../sim/season.js');
  const schedule = generateSchedule(leagueId, 55555);
  saveSchedule(leagueId, schedule);

  // Simulate all 500 regular season games
  const { simulateGame } = await import('../sim/game.js');
  for (const game of schedule) {
    const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.homeTeamId) as any;
    const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.awayTeamId) as any;
    if (homeTeam && awayTeam) {
      await simulateGame(
        game.gameNumber, homeTeam, awayTeam, game.gameNumber,
        game.dateMs, league.season_number, leagueId
      );
    }
  }

  // Mark league as playoffs phase
  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', leagueId);
}, 300000);

describe('Playoff isolation (§6.5 / §2.4)', () => {
  it('teams.wins is unchanged after playoffs run', async () => {
    const { prepared } = await import('../db.js');

    // Capture wins snapshot before playoffs
    const beforeSnapshot = (prepared('SELECT id, wins, losses FROM teams WHERE league_id = ? ORDER BY id').all(leagueId) as Array<{ id: number; wins: number; losses: number }>)
      .map(t => ({ id: t.id, wins: t.wins, losses: t.losses }));

    // Run playoffs
    const { runPlayoffs } = await import('../sim/playoffs.js');
    await runPlayoffs(leagueId);

    // Capture wins snapshot after playoffs
    const afterSnapshot = (prepared('SELECT id, wins, losses FROM teams WHERE league_id = ? ORDER BY id').all(leagueId) as Array<{ id: number; wins: number; losses: number }>)
      .map(t => ({ id: t.id, wins: t.wins, losses: t.losses }));

    // Wins and losses must be identical (playoffs don't count toward regular season record)
    for (let i = 0; i < beforeSnapshot.length; i++) {
      const before = beforeSnapshot[i]!;
      const after = afterSnapshot.find(t => t.id === before.id)!;
      expect(after.wins, `Team ${before.id} wins changed during playoffs`).toBe(before.wins);
      expect(after.losses, `Team ${before.id} losses changed during playoffs`).toBe(before.losses);
    }
  }, 120000);

  it('playoff_series table has exactly 7 rows for the season', async () => {
    const { prepared } = await import('../db.js');
    const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;

    const seriesCount = (prepared(
      'SELECT COUNT(*) as cnt FROM playoff_series WHERE league_id = ? AND season_number = ?'
    ).get(leagueId, league.season_number) as { cnt: number }).cnt;

    // 4 DS + 2 CS + 1 WS = 7 series
    expect(seriesCount).toBe(7);
  }, 10000);

  it('season_narratives has champion recorded', async () => {
    const { prepared } = await import('../db.js');
    const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;

    const narrative = prepared(
      'SELECT * FROM season_narratives WHERE league_id = ? AND season_number = ?'
    ).get(leagueId, league.season_number) as { champion_team_id: number } | undefined;

    expect(narrative).toBeDefined();
    expect(narrative?.champion_team_id).toBeGreaterThan(0);
  }, 10000);

  it('regular season total wins across all teams sums correctly', async () => {
    const { prepared } = await import('../db.js');

    const teams = prepared('SELECT wins, losses FROM teams WHERE league_id = ?').all(leagueId) as Array<{ wins: number; losses: number }>;
    const totalWins = teams.reduce((s, t) => s + t.wins, 0);
    const totalLosses = teams.reduce((s, t) => s + t.losses, 0);

    // Every game has exactly 1 win and 1 loss recorded
    expect(totalWins).toBe(500);
    expect(totalLosses).toBe(500);
  }, 10000);
});
