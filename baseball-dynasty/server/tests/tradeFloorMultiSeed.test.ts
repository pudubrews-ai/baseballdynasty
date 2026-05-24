// §5.4 — ≥3 distinct trades floor across multiple seeds (covers AB-02b)
// Verifies forceMinimumTrades produces ≥3 distinct trades (counted via news_items event_type='trade',
// one per executeTrade call) even on dry seeds like 11 where few AAA/AA prospects exist.

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

// Results keyed by seed
const seedResults: Map<number, number> = new Map();

// Helper: set up a league for a given seed, run trade deadline + force, return distinct trade count
async function runTradeFloorForSeed(seed: number): Promise<number> {
  // Each seed needs its own DB — but we only have one DB_PATH.
  // We instead run each seed sequentially in the same beforeAll with re-init.
  const { initDb, prepared } = await import('../db.js');

  // Re-initialize DB for each seed (in-memory: just re-run migrations)
  // The :memory: DB persists for this process, so we archive any existing league
  const existingLeague = prepared('SELECT id FROM leagues WHERE archived = 0 ORDER BY id DESC LIMIT 1').get() as any;
  if (existingLeague) {
    prepared('UPDATE leagues SET archived = 1 WHERE id = ?').run(existingLeague.id);
  }

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed });
  const lid = result.leagueId;

  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(lid) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league as any, true);

  prepared('UPDATE leagues SET phase = ?, current_game_number = 0 WHERE id = ?').run('regular_season', lid);

  const { springCutsNeeded, runSpringCuts } = await import('../sim/springCuts.js');
  const fl = prepared('SELECT * FROM leagues WHERE id = ?').get(lid) as any;
  if (springCutsNeeded(fl)) runSpringCuts(fl);

  // Set up divergent standings: half contenders, half rebuilders
  const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(lid) as any[];
  const halfTeams = Math.floor(teams.length / 2);
  for (let i = 0; i < teams.length; i++) {
    const team = teams[i] as any;
    const wins = i < halfTeams ? 35 : 10;
    const losses = i < halfTeams ? 10 : 35;
    prepared(
      'UPDATE teams SET wins = ?, losses = ?, games_played = 35, last_call_up_check_game = 0, last_firing_check_game = 0, last_gm_firing_check_game = 0 WHERE id = ?'
    ).run(wins, losses, team.id);
  }
  prepared('UPDATE leagues SET current_game_number = 35 WHERE id = ?').run(lid);

  const { evaluateTradeDeadline, setTradePosture, forceMinimumTrades } = await import('../sim/tradeDeadline.js');
  const allTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(lid) as any[];
  const schedLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(lid) as any;

  for (const team of allTeams) {
    setTradePosture(team as any, allTeams as any[]);
  }
  const refreshedTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(lid) as any[];
  for (const team of refreshedTeams) {
    evaluateTradeDeadline(team as any, refreshedTeams as any[], lid, schedLeague.season_number);
  }

  const freshTeamsForForce = prepared('SELECT * FROM teams WHERE league_id = ?').all(lid) as any[];
  forceMinimumTrades(freshTeamsForForce as any[], lid, schedLeague.season_number);

  // Count distinct trades via news_items (one row per executeTrade call)
  const distinctTrades = (prepared(
    "SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ? AND event_type = 'trade'"
  ).get(lid) as any).cnt;

  return distinctTrades;
}

beforeAll(async () => {
  const { initDb } = await import('../db.js');
  await initDb();

  // Test seeds: 42 (normal), 11 (dry seed — few AAA/AA prospects), 99 (another variant)
  for (const seed of [42, 11, 99]) {
    const count = await runTradeFloorForSeed(seed);
    seedResults.set(seed, count);
    console.log(`[tradeFloorMultiSeed] Seed ${seed}: ${count} distinct trades`);
  }
}, 300000);

describe('≥3 distinct trades floor across multiple seeds (§5.4 / AB-02b)', () => {
  it('seed 42: ≥3 distinct trades', () => {
    const count = seedResults.get(42) ?? 0;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('seed 11 (dry seed): ≥3 distinct trades despite few AAA/AA prospects', () => {
    const count = seedResults.get(11) ?? 0;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('seed 99: ≥3 distinct trades', () => {
    const count = seedResults.get(99) ?? 0;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('distinct trades counted via news_items (not raw transaction rows)', () => {
    // All seeds should report ≥3 distinct trades
    for (const [seed, count] of seedResults.entries()) {
      expect(count, `Seed ${seed} failed with ${count} distinct trades`).toBeGreaterThanOrEqual(3);
    }
  });
});
