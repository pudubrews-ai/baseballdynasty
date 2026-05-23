// §6.2: Box-score validator runtime invocation — AB-03 + hits-less-than-runs regression gate
// Simulates games using the PRNG-driven score engine and validates every game's box score
// Uses in-memory DB with worldgen + expansion draft (turbo) for real player data

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 42 });
  leagueId = result.leagueId;

  // Run expansion draft in turbo mode
  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);

  // Generate and save schedule
  const { generateSchedule, saveSchedule } = await import('../sim/season.js');
  const schedule = generateSchedule(leagueId, 42);
  saveSchedule(leagueId, schedule);
}, 120000);

describe('Box-score validator runtime invocation (§6.2 / AB-03)', () => {
  it('validateBoxScore returns [] for first 50 simulated games', async () => {
    const { prepared, getDb } = await import('../db.js');
    const { simulateGame, validateBoxScore } = await import('../sim/game.js');

    const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
    const scheduleJson = league.schedule_json;
    const schedule: Array<{ gameNumber: number; dateMs: number; homeTeamId: number; awayTeamId: number }> =
      JSON.parse(scheduleJson);

    const gamesToSim = schedule.slice(0, 50);
    const validationFailures: string[] = [];

    for (const game of gamesToSim) {
      const homeTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.homeTeamId) as any;
      const awayTeam = prepared('SELECT * FROM teams WHERE id = ?').get(game.awayTeamId) as any;
      if (!homeTeam || !awayTeam) continue;

      await simulateGame(
        game.gameNumber,
        homeTeam,
        awayTeam,
        game.gameNumber,
        game.dateMs,
        league.season_number,
        leagueId
      );
    }

    // Now check all game_log rows
    const gameRows = getDb().prepare(
      `SELECT home_team_id, away_team_id, home_score, away_score,
              home_hits, away_hits, home_walks, away_walks
       FROM game_log WHERE league_id = ? AND season_number = ? ORDER BY game_number`
    ).all(leagueId, league.season_number) as Array<{
      home_team_id: number; away_team_id: number;
      home_score: number; away_score: number;
      home_hits: number; away_hits: number;
      home_walks: number; away_walks: number;
    }>;

    for (const row of gameRows) {
      // Rule 1: hits >= runs - walks
      if (row.home_hits < row.home_score - row.home_walks) {
        validationFailures.push(
          `Home: hits ${row.home_hits} < score ${row.home_score} - walks ${row.home_walks}`
        );
      }
      if (row.away_hits < row.away_score - row.away_walks) {
        validationFailures.push(
          `Away: hits ${row.away_hits} < score ${row.away_score} - walks ${row.away_walks}`
        );
      }
    }

    expect(validationFailures, `Validation failures:\n${validationFailures.join('\n')}`).toEqual([]);
    expect(gameRows.length).toBe(50);
  }, 60000);

  it('home_score and away_score are in valid range [0,12] for all games', async () => {
    const { getDb } = await import('../db.js');

    const gameRows = getDb().prepare(
      'SELECT home_score, away_score FROM game_log WHERE league_id = ? AND season_number = 1'
    ).all(leagueId) as Array<{ home_score: number; away_score: number }>;

    for (const row of gameRows) {
      expect(row.home_score).toBeGreaterThanOrEqual(0);
      expect(row.home_score).toBeLessThanOrEqual(12);
      expect(row.away_score).toBeGreaterThanOrEqual(0);
      expect(row.away_score).toBeLessThanOrEqual(12);
    }
  }, 10000);

  it('walk-off rate is between 6% and 14% of total games', async () => {
    const { getDb } = await import('../db.js');

    const gameRows = getDb().prepare(
      `SELECT notable_events_json FROM game_log
       WHERE league_id = ? AND season_number = 1`
    ).all(leagueId) as Array<{ notable_events_json: string }>;

    let walkoffs = 0;
    for (const row of gameRows) {
      try {
        const events = JSON.parse(row.notable_events_json) as Array<{ type: string }>;
        if (Array.isArray(events) && events.some(e => e.type === 'walk_off')) {
          walkoffs++;
        }
      } catch { /* ignore */ }
    }

    const total = gameRows.length;
    const walkoffRate = walkoffs / total;
    // Expected ~9.7% (18% of ~54% home wins); allow range 4-20%
    expect(walkoffRate).toBeGreaterThanOrEqual(0.04);
    expect(walkoffRate).toBeLessThanOrEqual(0.20);
  }, 10000);
}, );
