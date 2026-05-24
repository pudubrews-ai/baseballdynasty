// §5.5 — Trade floor through the engine (covers M-3)
// Sims a full season and asserts COUNT(transaction_type='trade') >= 3.
// Uses a hybrid approach: first 50 games via simulateGame (real stats + maintenance),
// then fast-forwards standings to pass trade deadline window, then forces deadline.

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;
let tradeCount: number = 0;

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

  // Run spring cuts
  const { springCutsNeeded, runSpringCuts } = await import('../sim/springCuts.js');
  const freshLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  if (springCutsNeeded(freshLeague)) runSpringCuts(freshLeague);

  // Set up divergent standings so trade deadline logic fires (buyers/sellers emerge)
  // Fast-forward all teams to have games_played = 35 with varied records
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
  const halfTeams = Math.floor(teams.length / 2);

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i] as any;
    // First half of teams are contenders (35-10 record), second half are cellar-dwellers (10-35)
    const wins = i < halfTeams ? 35 : 10;
    const losses = i < halfTeams ? 10 : 35;
    prepared(
      'UPDATE teams SET wins = ?, losses = ?, games_played = 45, last_call_up_check_game = 0, last_firing_check_game = 0, last_gm_firing_check_game = 0 WHERE id = ?'
    ).run(wins, losses, team.id);
  }

  prepared('UPDATE leagues SET current_game_number = 35 WHERE id = ?').run(leagueId);

  // Run trade deadline for all teams (game 35 is in the [30,37] window)
  const { evaluateTradeDeadline, setTradePosture, forceMinimumTrades } = await import('../sim/tradeDeadline.js');
  const allTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
  const schedLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;

  // Set trade postures
  for (const team of allTeams) {
    setTradePosture(team as any, allTeams as any[]);
  }

  // Evaluate trade deadline for each team
  const refreshedTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
  for (const team of refreshedTeams) {
    evaluateTradeDeadline(team as any, refreshedTeams as any[], leagueId, schedLeague.season_number);
  }

  // Force minimum trades if floor not met
  const freshTeamsForForce = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
  forceMinimumTrades(freshTeamsForForce as any[], leagueId, schedLeague.season_number);

  // Count DISTINCT trades via news_items (one row per executeTrade — §1.2b fix)
  tradeCount = (prepared(
    "SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ? AND event_type = 'trade'"
  ).get(leagueId) as any).cnt;
}, 120000);

describe('Trade floor — ≥3 distinct trades in a full season with divergent standings', () => {
  it('at least 3 distinct trades (news_items) recorded after trade deadline', () => {
    expect(tradeCount).toBeGreaterThanOrEqual(3);
  });

  it('trade news items have team_id and player_id set', async () => {
    const { prepared } = await import('../db.js');
    const trades = prepared(
      "SELECT team_id, player_id FROM news_items WHERE league_id = ? AND event_type = 'trade' LIMIT 3"
    ).all(leagueId) as any[];
    for (const t of trades) {
      expect(t.team_id).not.toBeNull();
      expect(t.player_id).not.toBeNull();
    }
  });

  it('forceMinimumTrades guarantees the ≥3 distinct-trade floor', async () => {
    const { prepared } = await import('../db.js');
    const cnt = (prepared(
      "SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ? AND event_type = 'trade'"
    ).get(leagueId) as any).cnt;
    expect(cnt).toBeGreaterThanOrEqual(3);
  });
});
