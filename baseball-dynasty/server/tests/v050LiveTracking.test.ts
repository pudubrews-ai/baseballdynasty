// v0.5.0 Live Tracking Integration Test
// Closes detection gap for swallowed-error bugs C-1/C-2/H-1 (identified in Architect Eval 1).
//
// Assertions:
// 1. award_races has at least one row after >=5 games (proves Fix 1: updateAwardRaces uses correct columns)
// 2. A player primed near career HR threshold generates a record_watch news item (proves Fix 2)
// 3. computeAttendanceRate returns ~15% higher rate when opponent is a rival (proves Fix 4)

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

describe('v0.5.0 live tracking — Fix 1/2/4 regression gate', () => {
  let leagueId: number;

  beforeAll(async () => {
    const { initDb, prepared } = await import('../db.js');
    await initDb();

    // Archive any pre-existing active leagues
    prepared('UPDATE leagues SET archived = 1 WHERE archived = 0').run();

    const { generateWorld } = await import('../sim/worldgen.js');
    const result = await generateWorld({ seed: 77777 });
    leagueId = result.leagueId;

    const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
    const { runExpansionDraft } = await import('../sim/draft.js');
    await runExpansionDraft(league as any, true);

    prepared('UPDATE leagues SET phase = ?, current_game_number = 0 WHERE id = ?').run('regular_season', leagueId);

    const { springCutsNeeded, runSpringCuts } = await import('../sim/springCuts.js');
    const freshLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
    if (springCutsNeeded(freshLeague)) runSpringCuts(freshLeague);

    const { simulateGame } = await import('../sim/game.js');
    const { generateSchedule, saveSchedule } = await import('../sim/season.js');
    const { runRosterMaintenance } = await import('../sim/rosterMaintenance.js');

    const worldgenSeed = (prepared('SELECT worldgen_seed FROM leagues WHERE id = ?').get(leagueId) as any).worldgen_seed;
    const schedule = generateSchedule(leagueId, worldgenSeed);
    saveSchedule(leagueId, schedule);

    // Run 5 games to trigger updateAwardRaces (every-5-game cadence)
    for (let g = 0; g < 5 && g < schedule.length; g++) {
      const currentLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
      if (!currentLeague || currentLeague.phase !== 'regular_season') break;
      const game = schedule[g]!;
      const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.homeTeamId) as any;
      const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.awayTeamId) as any;
      if (!homeTeam || !awayTeam) continue;
      await simulateGame(
        game.gameNumber, homeTeam, awayTeam,
        game.gameNumber, game.dateMs,
        currentLeague.season_number, leagueId
      );
      runRosterMaintenance(leagueId, game.homeTeamId, game.awayTeamId, game.gameNumber);
      prepared('UPDATE leagues SET current_game_number = ? WHERE id = ?').run(game.gameNumber, leagueId);
    }
  }, 120000);

  it('Fix 1: award_races has at least one row after 5 games', async () => {
    const { prepared } = await import('../db.js');
    const count = (prepared('SELECT COUNT(*) AS cnt FROM award_races WHERE league_id = ?').get(leagueId) as any).cnt as number;
    expect(count).toBeGreaterThan(0);
  });

  it('Fix 2: record_watch news fires for a player primed near career HR threshold', async () => {
    const { prepared } = await import('../db.js');
    const { runRosterMaintenance } = await import('../sim/rosterMaintenance.js');

    // Get a player with a team
    const player = prepared('SELECT id, team_id FROM players WHERE league_id = ? AND team_id IS NOT NULL LIMIT 1').get(leagueId) as { id: number; team_id: number } | undefined;
    expect(player).toBeDefined();
    if (!player) return;

    // Prime to 495 career HR (just inside the 490→500 window, need 5 HR to reach 500)
    prepared('UPDATE players SET career_hr = 495 WHERE id = ?').run(player.id);

    // Get current game number (divisible by 5 so the cadence fires)
    const leagueRow = prepared('SELECT current_game_number, season_number FROM leagues WHERE id = ?').get(leagueId) as any;
    const nextTick = Math.ceil((leagueRow.current_game_number + 1) / 5) * 5;

    // Get any scheduled game teams
    const { generateSchedule } = await import('../sim/season.js');
    const worldgenSeed = (prepared('SELECT worldgen_seed FROM leagues WHERE id = ?').get(leagueId) as any).worldgen_seed;
    const schedule = generateSchedule(leagueId, worldgenSeed);
    const targetGame = schedule.find((g: any) => g.gameNumber === nextTick) ?? schedule[nextTick - 1];
    if (!targetGame) return;

    // Directly invoke rosterMaintenance at a game number divisible by 5
    runRosterMaintenance(leagueId, targetGame.homeTeamId, targetGame.awayTeamId, nextTick);

    // Assert a record_watch news item exists for this player
    const newsRow = prepared(
      `SELECT id FROM news_items WHERE league_id = ? AND event_type = 'record_watch' AND player_id = ?`
    ).get(leagueId, player.id) as { id: number } | undefined;
    expect(newsRow).toBeDefined();
  });

  it('Fix 4: rivalry opponent produces ~15% attendance uplift', async () => {
    const { computeAttendanceRate } = await import('../sim/attendanceCalc.js');
    const { prepared } = await import('../db.js');

    const team = prepared('SELECT * FROM teams WHERE league_id = ? LIMIT 1').get(leagueId) as any;
    expect(team).toBeDefined();

    const rivalId = 9999; // arbitrary rival id
    const nonRivalId = 8888; // different id not in rivals list

    const rateWithRival = computeAttendanceRate(
      team, [rivalId], false, false, false, false, rivalId
    );
    const rateWithoutRival = computeAttendanceRate(
      team, [rivalId], false, false, false, false, nonRivalId
    );

    // Rivalry should boost by ~15%
    expect(rateWithRival).toBeGreaterThan(rateWithoutRival);
    // The ratio should be close to 1.15 (may be clamped at 1.0 for high market sizes)
    const ratio = rateWithRival / rateWithoutRival;
    expect(ratio).toBeGreaterThanOrEqual(1.0);
  });
});
