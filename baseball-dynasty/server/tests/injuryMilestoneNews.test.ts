// §5.3 — INJURY + MILESTONE organic news (covers AB-11 / AB-02a)
// Iter-4 REWRITE: removed all manual force-sets (injury_prone=10, career_hr=99, career_hits=1999)
// and the synthetic-injection fallback. Events must arise naturally from the real sim loop.
//
// With the AB-11 fix (injury_prone range widened to 3-9, game.ts trigger at >=7):
//   ~43% of worldgen players qualify as injury-prone, and each game has a 5% chance per batter.
// With the milestone fix (age-scaled career_hr/career_hits seeded at worldgen):
//   veterans (age 28+) sit near the 100-HR/2000-hit thresholds and cross them in normal play.
//
// Strategy: worldgen a fresh league, run the REAL engine tick loop (runGameTick), NO UPDATE overrides.
// Assert ORGANIC events appear after multi-season sim. This test FAILS against ebd4637 (dead-band
// injury_prone mismatch + career stats always 0) and PASSES after the §1.2 fixes.

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 42 });
  leagueId = result.leagueId;

  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league as any, true);

  prepared('UPDATE leagues SET phase = ?, current_game_number = 0 WHERE id = ?').run('regular_season', leagueId);

  const { springCutsNeeded, runSpringCuts } = await import('../sim/springCuts.js');
  const freshLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  if (springCutsNeeded(freshLeague)) runSpringCuts(freshLeague);

  // Verify: NO manual force-sets at all. The fix must produce organic events.

  // Run the real sim loop via simulateGame + news wiring (same path as production engine).
  const { simulateGame } = await import('../sim/game.js');
  const { generateSchedule, saveSchedule } = await import('../sim/season.js');
  const { runRosterMaintenance } = await import('../sim/rosterMaintenance.js');
  const { insertGameNewsItem, insertNewsItem, insertMilestoneNewsItem } = await import('../sim/news.js');

  const schedLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const schedule = generateSchedule(leagueId, schedLeague.worldgen_seed);
  saveSchedule(leagueId, schedule);

  // Run up to 160 games — enough for injuries (each game ~43% of batters have 5% chance,
  // ~20 batters per game → ~0.43 * 20 * 0.05 ≈ 0.43 expected injuries per game).
  // Milestones: age-seeded veterans near thresholds cross them in first 100-game stretch.
  for (let g = 0; g < Math.min(160, schedule.length); g++) {
    const game = schedule[g]!;
    const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.homeTeamId) as any;
    const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.awayTeamId) as any;
    if (!homeTeam || !awayTeam) continue;

    const currentLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
    if (!currentLeague) break;

    await simulateGame(
      game.gameNumber, homeTeam, awayTeam, game.gameNumber,
      game.dateMs, currentLeague.season_number, leagueId
    );

    // Wire notable events into news_items (mirrors engine.ts:runGameTick notable-events wiring)
    const gameRow = prepared(
      'SELECT id, home_score, away_score, notable_events_json FROM game_log WHERE league_id = ? AND game_number = ? AND season_number = ? ORDER BY id DESC LIMIT 1'
    ).get(leagueId, game.gameNumber, currentLeague.season_number) as any;

    if (gameRow) {
      insertGameNewsItem({
        leagueId,
        seasonNumber: currentLeague.season_number,
        gameNumber: game.gameNumber,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeScore: gameRow.home_score,
        awayScore: gameRow.away_score,
        homeTeamName: `${homeTeam.city} ${homeTeam.name}`,
        awayTeamName: `${awayTeam.city} ${awayTeam.name}`,
      });

      if (gameRow.notable_events_json) {
        try {
          const events = JSON.parse(gameRow.notable_events_json) as Array<{ type: string; playerId?: number }>;
          for (const ev of events) {
            if (!ev.playerId) continue;
            const playerRow = prepared('SELECT team_id FROM players WHERE id = ?').get(ev.playerId) as any;
            const teamId = playerRow?.team_id ?? null;
            if (ev.type === 'milestone') {
              insertMilestoneNewsItem({
                leagueId,
                seasonNumber: currentLeague.season_number,
                gameNumber: game.gameNumber,
                playerId: ev.playerId,
                teamId: teamId ?? game.homeTeamId,
                sourceTable: 'game_log',
                sourceId: gameRow.id,
              });
            } else if (ev.type === 'injury') {
              insertNewsItem({
                leagueId,
                seasonNumber: currentLeague.season_number,
                gameNumber: game.gameNumber,
                eventType: 'injury',
                playerId: ev.playerId,
                teamId,
                sourceTable: 'game_log',
                sourceId: gameRow.id,
              });
            }
          }
        } catch (_) {}
      }
    }

    // Run roster maintenance every game (mirrors engine tick behavior)
    runRosterMaintenance(leagueId, game.homeTeamId, game.awayTeamId, game.gameNumber);
    prepared('UPDATE leagues SET current_game_number = ? WHERE id = ?').run(game.gameNumber, leagueId);
  }

  // Fill pending headlines — multiple passes to handle up to 100+ items (10 per pass)
  // Procedural fallback fires when LLM is unavailable (test environment has no API key).
  const { fillPendingHeadlines } = await import('../sim/news.js');
  for (let pass = 0; pass < 20; pass++) {
    await fillPendingHeadlines(leagueId);
  }
}, 300000);

describe('ORGANIC INJURY news items — no force-sets (§5.3 / AB-11)', () => {
  it('news_items contains ≥1 row with badge=INJURY arising from real play', async () => {
    const { prepared } = await import('../db.js');
    const cnt = (prepared(
      "SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ? AND badge = 'INJURY'"
    ).get(leagueId) as any).cnt;
    expect(cnt, 'Expected ≥1 organic INJURY news item. Worldgen injury_prone range should be 3-9 and game.ts trigger at >=7 (AB-11 fix).').toBeGreaterThanOrEqual(1);
  });

  it('INJURY items have non-empty headline_text after filler and is_headline_pending=0', async () => {
    const { prepared } = await import('../db.js');
    const rows = prepared(
      "SELECT headline_text, is_headline_pending FROM news_items WHERE league_id = ? AND badge = 'INJURY' LIMIT 3"
    ).all(leagueId) as any[];
    for (const row of rows) {
      expect(row.is_headline_pending).toBe(0);
      expect(row.headline_text).toBeTruthy();
      expect((row.headline_text as string).length).toBeGreaterThan(0);
    }
  });
});

describe('ORGANIC MILESTONE news items — no force-sets (§5.3 / AB-11)', () => {
  it('news_items contains ≥1 row with badge=MILESTONE arising from real play', async () => {
    const { prepared } = await import('../db.js');
    const cnt = (prepared(
      "SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ? AND badge = 'MILESTONE'"
    ).get(leagueId) as any).cnt;
    expect(cnt, 'Expected ≥1 organic MILESTONE news item. Age-scaled career stats should seed veterans near thresholds (AB-11 §1.2b fix).').toBeGreaterThanOrEqual(1);
  });

  it('MILESTONE items have non-empty headline_text after filler and is_headline_pending=0', async () => {
    const { prepared } = await import('../db.js');
    const rows = prepared(
      "SELECT headline_text, is_headline_pending FROM news_items WHERE league_id = ? AND badge = 'MILESTONE' LIMIT 3"
    ).all(leagueId) as any[];
    for (const row of rows) {
      expect(row.is_headline_pending).toBe(0);
      expect(row.headline_text).toBeTruthy();
      expect((row.headline_text as string).length).toBeGreaterThan(0);
    }
  });
});
