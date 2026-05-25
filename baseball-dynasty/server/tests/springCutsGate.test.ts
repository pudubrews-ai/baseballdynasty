// §5.5 — Spring-cut gate exactly-25 (covers AB-04)
// After spring cuts (before any regular-season tick), every team must have exactly 25
// on is_on_25man=1. Also tests the surplus-position cut path added in §2.1.

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

  // Transition to regular_season
  prepared('UPDATE leagues SET phase = ?, current_game_number = 0 WHERE id = ?').run('regular_season', leagueId);

  // Deliberately push some teams over 25 on 25-man to stress-test the gate
  // by setting extra players to is_on_25man=1 (simulating a worldgen edge case)
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
  for (const team of teams.slice(0, 4)) {
    // Find a player in minors (not on 25-man) and force them onto 25-man
    const minorPlayer = prepared(
      'SELECT id FROM players WHERE team_id = ? AND is_on_25man = 0 AND minor_level IS NOT NULL LIMIT 1'
    ).get((team as any).id) as any;
    if (minorPlayer) {
      prepared('UPDATE players SET is_on_25man = 1 WHERE id = ?').run(minorPlayer.id);
    }
  }

  // Now run spring cuts — they must trim to exactly 25
  const { springCutsNeeded, runSpringCuts } = await import('../sim/springCuts.js');
  const freshLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  if (springCutsNeeded(freshLeague)) runSpringCuts(freshLeague);
}, 120000);

describe('Spring-cut gate: exactly 25 on 25-man after cuts (§5.5 / AB-04)', () => {
  it('every team has exactly 25 players on is_on_25man=1', async () => {
    const { prepared } = await import('../db.js');

    const counts = prepared(
      `SELECT team_id, COUNT(*) as cnt FROM players
       WHERE league_id = ? AND is_on_25man = 1
       GROUP BY team_id`
    ).all(leagueId) as Array<{ team_id: number; cnt: number }>;

    // Every team should have been accounted for
    expect(counts.length).toBeGreaterThan(0);
    for (const v of counts) {
      expect(
        v.cnt,
        `Team ${v.team_id} has ${v.cnt} players on 25-man (expected exactly 25)`
      ).toBe(25);
    }
  });

  it('spring cuts did run (spring_cuts_done_season is set)', async () => {
    const { prepared } = await import('../db.js');
    const league = prepared('SELECT spring_cuts_done_season, season_number FROM leagues WHERE id = ?').get(leagueId) as any;
    expect(league.spring_cuts_done_season).toBe(league.season_number);
  });

  it('all send-down and release transactions from spring cuts have valid player_ids', async () => {
    const { prepared } = await import('../db.js');
    const txns = prepared(
      "SELECT player_id FROM transactions WHERE league_id = ? AND transaction_type IN ('send_down', 'release')"
    ).all(leagueId) as any[];
    // Spring cuts produce these; they should all have valid player_ids
    for (const tx of txns) {
      expect(tx.player_id).toBeGreaterThan(0);
    }
  });
});
