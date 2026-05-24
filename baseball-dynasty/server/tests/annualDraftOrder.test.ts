// §6.6: Annual draft order test — worst regular-season team picks first
// Verifies the W/L reset fix (§2.6): draft order reads season 1 standings, not 0/0

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;
// Capture season 1 standings before offseason resets them
let season1Standings: Array<{ id: number; wins: number; losses: number }> = [];

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 33333 });
  leagueId = result.leagueId;

  // Run expansion draft
  let league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);

  // Generate and save schedule
  const { generateSchedule, saveSchedule } = await import('../sim/season.js');
  const schedule = generateSchedule(leagueId, 33333);
  saveSchedule(leagueId, schedule);

  // Simulate all 500 games
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

  // Capture standings before any resets
  season1Standings = prepared(
    'SELECT id, wins, losses FROM teams WHERE league_id = ? ORDER BY wins ASC, losses DESC'
  ).all(leagueId) as Array<{ id: number; wins: number; losses: number }>;

  // Run playoffs
  prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', leagueId);
  const { runPlayoffs } = await import('../sim/playoffs.js');
  await runPlayoffs(leagueId);

  // Advance the league to annual_draft phase manually
  // (simulates what the engine does through offseason steps)
  // We need to advance season_number so the annual draft picks don't clash with expansion draft picks
  // In production: retirement → development → free_agency → front_office → annual_draft
  // For the test: skip to the state where annual_draft is about to run
  // Advance to season 2 and set phase to annual_draft
  prepared('UPDATE leagues SET season_number = 2, phase = ?, offseason_step = ? WHERE id = ?')
    .run('annual_draft', 'annual_draft', leagueId);

  // Run the annual draft for season 2 — but draft order should reflect season 1 standings
  // Since we haven't reset wins yet (that happens in finalizeOffseason after annual_draft),
  // the standings are still from season 1
  league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runAnnualDraft } = await import('../sim/draft.js');
  await runAnnualDraft(league, true);
}, 300000);

describe('Annual draft order (§6.6 / §2.6)', () => {
  it('season 1 standings have wins distributed (not all 0)', () => {
    const totalWins = season1Standings.reduce((s, t) => s + t.wins, 0);
    expect(totalWins).toBe(500); // All 500 regular-season wins recorded in season 1
  });

  it('pick 1 of round 1 annual draft (season 2) is the team with fewest wins in season 1', async () => {
    const { prepared } = await import('../db.js');

    // The worst team from season 1 (captured before any reset)
    const worstTeamId = season1Standings[0]!.id;

    // Pick 1 of round 1 for season 2 annual draft should be the worst team from season 1
    const pick1 = prepared(
      'SELECT team_id FROM draft_picks WHERE league_id = ? AND season_number = 2 AND is_expansion_draft = 0 AND round = 1 AND pick_number = 1'
    ).get(leagueId) as { team_id: number } | undefined;

    expect(pick1).toBeDefined();
    expect(pick1?.team_id).toBe(worstTeamId);
  }, 10000);

  it('pick 20 of round 1 annual draft (season 2) is the team with most wins in season 1', async () => {
    const { prepared } = await import('../db.js');

    // The best team from season 1 (last in standings sorted worst-to-best)
    const bestTeamId = season1Standings[season1Standings.length - 1]!.id;

    const pick20 = prepared(
      'SELECT team_id FROM draft_picks WHERE league_id = ? AND season_number = 2 AND is_expansion_draft = 0 AND round = 1 AND pick_number = 20'
    ).get(leagueId) as { team_id: number } | undefined;

    expect(pick20).toBeDefined();
    expect(pick20?.team_id).toBe(bestTeamId);
  }, 10000);

  it('draft picks exist for season 2 annual draft (not season 1)', async () => {
    const { prepared } = await import('../db.js');

    const season2Picks = (prepared(
      'SELECT COUNT(*) as cnt FROM draft_picks WHERE league_id = ? AND season_number = 2 AND is_expansion_draft = 0'
    ).get(leagueId) as { cnt: number }).cnt;

    // 30 rounds × 20 teams = 600 picks
    expect(season2Picks).toBe(600);
  }, 10000);
});
