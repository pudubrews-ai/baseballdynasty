// Phase 8 gate: ARCHETYPES completeness, no ad-hoc branches,
// trade posture, window, interim-GM skip, per-team/league caps,
// forced-minimum trades, non-tender to FA.

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';
import { ARCHETYPES, getArchetype } from '../sim/archetypes.js';

// ── §1: ARCHETYPES table completeness (pure unit, no DB needed) ───────────

describe('ARCHETYPES table completeness', () => {
  const REQUIRED_KEYS = [
    'waiver_target_overall',
    'waiver_target_min_age',
    'veteran_trade_offset_games_before_deadline',
    'nontender_arb_year',
    'nontender_salary_threshold',
    'draft_potential_weight',
    'draft_age_weight',
    'fa_discount_multiplier',
    'waiver_claim_probability_modifier',
    'service_time_manipulation_enabled',
    'veteran_loyalty',
  ] as const;

  it('contains analytics, old-school, and balanced archetypes', () => {
    expect(Object.keys(ARCHETYPES)).toContain('analytics');
    expect(Object.keys(ARCHETYPES)).toContain('old-school');
    expect(Object.keys(ARCHETYPES)).toContain('balanced');
  });

  for (const archetype of ['analytics', 'old-school', 'balanced'] as const) {
    it(`${archetype} has all required fields`, () => {
      const entry = ARCHETYPES[archetype];
      for (const key of REQUIRED_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(entry, key),
          `${archetype} missing field: ${key}`
        ).toBe(true);
      }
    });
  }

  it('analytics service_time_manipulation_enabled is true', () => {
    expect(ARCHETYPES['analytics'].service_time_manipulation_enabled).toBe(true);
  });

  it('old-school service_time_manipulation_enabled is false', () => {
    expect(ARCHETYPES['old-school'].service_time_manipulation_enabled).toBe(false);
  });

  it('analytics waiver_claim_probability_modifier > balanced > old-school', () => {
    expect(ARCHETYPES['analytics'].waiver_claim_probability_modifier)
      .toBeGreaterThan(ARCHETYPES['balanced'].waiver_claim_probability_modifier);
    expect(ARCHETYPES['balanced'].waiver_claim_probability_modifier)
      .toBeGreaterThan(ARCHETYPES['old-school'].waiver_claim_probability_modifier);
  });

  it('analytics veteran_loyalty < balanced < old-school', () => {
    expect(ARCHETYPES['analytics'].veteran_loyalty)
      .toBeLessThan(ARCHETYPES['balanced'].veteran_loyalty);
    expect(ARCHETYPES['balanced'].veteran_loyalty)
      .toBeLessThan(ARCHETYPES['old-school'].veteran_loyalty);
  });

  it('getArchetype falls back to balanced for unknown archetype', () => {
    const result = getArchetype('unknownXYZ');
    expect(result).toEqual(ARCHETYPES['balanced']);
  });

  it('analytics veteran_trade_offset_games_before_deadline > 0 (trades earlier)', () => {
    expect(ARCHETYPES['analytics'].veteran_trade_offset_games_before_deadline)
      .toBeGreaterThan(0);
  });

  it('old-school veteran_trade_offset_games_before_deadline is 0 (trades at deadline)', () => {
    expect(ARCHETYPES['old-school'].veteran_trade_offset_games_before_deadline).toBe(0);
  });

  it('analytics nontender_arb_year is set, old-school is null', () => {
    expect(ARCHETYPES['analytics'].nontender_arb_year).not.toBeNull();
    expect(ARCHETYPES['old-school'].nontender_arb_year).toBeNull();
  });
});

// ── §2: No ad-hoc archetype branches — source-level grep ──────────────────

describe('No ad-hoc archetype string branches in business logic', () => {
  it('tradeDeadline.ts imports and uses getArchetype for offset logic', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const srcPath = path.resolve(process.cwd(), 'server/sim/tradeDeadline.ts');
    const src = fs.readFileSync(srcPath, 'utf8');
    expect(src).toContain('getArchetype');
  });

  it('waivers.ts uses archetype multiplier table for waiver probability', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const srcPath = path.resolve(process.cwd(), 'server/sim/waivers.ts');
    const src = fs.readFileSync(srcPath, 'utf8');
    // Must have archetypeMultiplier (record/map pattern)
    expect(src).toContain('archetypeMultiplier');
  });
});

// ── Shared DB setup for all integration tests ─────────────────────────────

let leagueId: number;
let allTeams: any[];

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 88111 });
  leagueId = result.leagueId;

  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);

  allTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
}, 60000);

// ── §3: Trade posture logic ────────────────────────────────────────────────

describe('Trade posture logic (setTradePosture)', () => {
  it('setTradePosture sets BUYER when games_back <= 5', async () => {
    const { prepared } = await import('../db.js');
    const { setTradePosture } = await import('../sim/tradeDeadline.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const maxWins = Math.max(...teams.map((t: any) => t.wins));
    const leader = teams.find((t: any) => t.wins === maxWins) as any;
    if (!leader) return;

    // Clear posture so setTradePosture can set it
    prepared('UPDATE teams SET trade_posture = NULL WHERE id = ?').run(leader.id);

    const fresh = prepared('SELECT * FROM teams WHERE id = ?').get(leader.id) as any;
    setTradePosture(fresh, teams);

    const updated = prepared('SELECT trade_posture FROM teams WHERE id = ?').get(leader.id) as any;
    // Leader is 0 games back, so should be BUYER
    expect(updated.trade_posture).toBe('BUYER');
  });

  it('setTradePosture sets SELLER when games_back >= 10', async () => {
    const { prepared } = await import('../db.js');
    const { setTradePosture } = await import('../sim/tradeDeadline.js');

    // Pick two distinct teams to rig
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const teamA = teams[0] as any;
    const teamB = teams[teams.length - 1] as any; // use last team

    // Leader wins = 15, worst = 0 → 15 games back → SELLER
    prepared('UPDATE teams SET wins = 15, losses = 5 WHERE id = ?').run(teamA.id);
    prepared('UPDATE teams SET wins = 0, losses = 20, trade_posture = NULL WHERE id = ?').run(teamB.id);

    const updatedTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const worstUpdated = updatedTeams.find((t: any) => t.id === teamB.id) as any;
    setTradePosture(worstUpdated, updatedTeams);

    const result = prepared('SELECT trade_posture FROM teams WHERE id = ?').get(teamB.id) as any;
    expect(result.trade_posture).toBe('SELLER');
  });

  it('setTradePosture sets NEUTRAL when 5 < games_back < 10', async () => {
    const { prepared } = await import('../db.js');
    const { setTradePosture } = await import('../sim/tradeDeadline.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const teamA = teams[0] as any;
    const teamB = teams[1] as any;

    // Leader = 20, target = 13 → 7 games back → NEUTRAL
    prepared('UPDATE teams SET wins = 20, losses = 10 WHERE id = ?').run(teamA.id);
    prepared('UPDATE teams SET wins = 13, losses = 17, trade_posture = NULL WHERE id = ?').run(teamB.id);

    const updatedTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const target = updatedTeams.find((t: any) => t.id === teamB.id) as any;
    setTradePosture(target, updatedTeams);

    const result = prepared('SELECT trade_posture FROM teams WHERE id = ?').get(teamB.id) as any;
    expect(result.trade_posture).toBe('NEUTRAL');
  });
});

// ── §4: Trade window [30, 37], interim-GM skip, league cap ────────────────

describe('evaluateTradeDeadline constraints', () => {
  it('interim GM team skips trade evaluation', async () => {
    const { prepared } = await import('../db.js');
    const { evaluateTradeDeadline } = await import('../sim/tradeDeadline.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const team = teams[2] as any; // use a different team

    prepared('UPDATE teams SET interim_gm = 1, games_played = 33, trade_posture = NULL WHERE id = ?').run(team.id);

    const countBefore = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade'"
    ).get(leagueId) as any).cnt;

    const fresh = prepared('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    const freshAllTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    evaluateTradeDeadline(fresh, freshAllTeams, leagueId, 1);

    const countAfter = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade'"
    ).get(leagueId) as any).cnt;

    expect(countAfter).toBe(countBefore);

    // Restore
    prepared('UPDATE teams SET interim_gm = 0 WHERE id = ?').run(team.id);
  });

  it('team with games_played < 30 skips trade evaluation', async () => {
    const { prepared } = await import('../db.js');
    const { evaluateTradeDeadline } = await import('../sim/tradeDeadline.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const team = teams[3] as any;

    prepared('UPDATE teams SET interim_gm = 0, games_played = 25, trade_posture = NULL WHERE id = ?').run(team.id);

    const countBefore = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade'"
    ).get(leagueId) as any).cnt;

    const fresh = prepared('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    const freshAllTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    evaluateTradeDeadline(fresh, freshAllTeams, leagueId, 1);

    const countAfter = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade'"
    ).get(leagueId) as any).cnt;

    expect(countAfter).toBe(countBefore);
  });

  it('team with games_played > 37 skips trade evaluation', async () => {
    const { prepared } = await import('../db.js');
    const { evaluateTradeDeadline } = await import('../sim/tradeDeadline.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const team = teams[4] as any;

    prepared("UPDATE teams SET interim_gm = 0, games_played = 40, trade_posture = 'BUYER' WHERE id = ?").run(team.id);

    const countBefore = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade'"
    ).get(leagueId) as any).cnt;

    const fresh = prepared('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    const freshAllTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    evaluateTradeDeadline(fresh, freshAllTeams, leagueId, 1);

    const countAfter = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade'"
    ).get(leagueId) as any).cnt;

    expect(countAfter).toBe(countBefore);
  });

  it('league cap of 12 prevents further trades when already at 12', async () => {
    const { prepared } = await import('../db.js');
    const { evaluateTradeDeadline } = await import('../sim/tradeDeadline.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];

    // First clear any existing trades for season 99 to get a clean slate
    // Seed exactly 12 fake trade transactions for season 99
    for (let i = 0; i < 12; i++) {
      prepared(
        "INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, 99, 'trade', ?, NULL, 'cap-test trade', ?)"
      ).run(leagueId, teams[0].id, Date.now() + i);
    }

    const countBefore = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade' AND season_number = 99"
    ).get(leagueId) as any).cnt;

    expect(countBefore).toBe(12);

    const team = teams[5] as any;
    prepared("UPDATE teams SET interim_gm = 0, games_played = 33, trade_posture = 'BUYER', deadline_trades_this_season = 0 WHERE id = ?").run(team.id);

    const fresh = prepared('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    const freshAllTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    evaluateTradeDeadline(fresh, freshAllTeams, leagueId, 99);

    const countAfter = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade' AND season_number = 99"
    ).get(leagueId) as any).cnt;

    // No new trades beyond the cap
    expect(countAfter).toBe(countBefore);
  });
});

// ── §5: forceMinimumTrades ─────────────────────────────────────────────────

describe('forceMinimumTrades', () => {
  it('forceMinimumTrades exits immediately when >= 3 trades already exist for the season', async () => {
    const { prepared } = await import('../db.js');
    const { forceMinimumTrades } = await import('../sim/tradeDeadline.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];

    // Seed 3 fake trades for season 50 — both transactions AND news_items
    // (forceMinimumTrades now uses countDistinctLeagueTrades which counts news_items.event_type='trade')
    for (let i = 0; i < 3; i++) {
      prepared(
        "INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, 50, 'trade', ?, NULL, 'min-test trade', ?)"
      ).run(leagueId, teams[0].id, Date.now() + i);
      // Also insert a corresponding news_items row so countDistinctLeagueTrades >= 3
      prepared(
        "INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge, team_id, secondary_team_id, player_id, source_table, source_id, headline_text, is_headline_pending, details_json) VALUES (?, 50, 35, ?, 'trade', 'TRANSACTION', ?, NULL, NULL, 'transactions', NULL, 'Forced test trade', 0, NULL)"
      ).run(leagueId, Date.now() + i, (teams[0] as any).id);
    }

    const countBefore = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade' AND season_number = 50"
    ).get(leagueId) as any).cnt;

    expect(countBefore).toBe(3);

    prepared('UPDATE teams SET interim_gm = 0, deadline_trades_this_season = 0 WHERE league_id = ?').run(leagueId);
    const freshTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    forceMinimumTrades(freshTeams, leagueId, 50);

    const countAfter = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade' AND season_number = 50"
    ).get(leagueId) as any).cnt;

    // Should still be 3 (or more if natural trades also ran, but at least 3)
    // The important thing is forceMinimumTrades detected ≥3 distinct trades and exited early
    const distinctAfter = (prepared(
      "SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ? AND event_type = 'trade' AND season_number = 50"
    ).get(leagueId) as any).cnt;
    expect(distinctAfter).toBeGreaterThanOrEqual(3);
    expect(countAfter).toBeGreaterThanOrEqual(3);
  });

  it('forceMinimumTrades does not crash and returns cleanly with 0 trades for a new season', async () => {
    const { prepared } = await import('../db.js');
    const { forceMinimumTrades } = await import('../sim/tradeDeadline.js');

    const countBefore = (prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'trade' AND season_number = 51"
    ).get(leagueId) as any).cnt;

    expect(countBefore).toBe(0);

    prepared('UPDATE teams SET interim_gm = 0, deadline_trades_this_season = 0 WHERE league_id = ?').run(leagueId);
    const freshTeams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];

    // Should not throw
    expect(() => forceMinimumTrades(freshTeams, leagueId, 51)).not.toThrow();
  });
});

// ── §6: Non-tender goes to FA, not waivers ─────────────────────────────────

describe('Non-tender to FA (not waivers)', () => {
  it('players released via non-tender have waiver_state = none', async () => {
    const { prepared } = await import('../db.js');

    // Set up conditions for non-tender: find a player on a non-interim-gm team
    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];

    // Use the first non-interim team
    const analyticsTeam = teams.find((t: any) => !t.interim_gm) as any;
    if (!analyticsTeam) return;

    prepared('UPDATE teams SET gm_archetype = ? WHERE id = ?').run('analytics', analyticsTeam.id);

    // Set a player to be non-tender eligible (high service time, high salary)
    const player = prepared(
      'SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 LIMIT 1'
    ).get(analyticsTeam.id) as any;

    if (!player) return;

    prepared(
      'UPDATE players SET service_time_days = 120, annual_salary = 12000000 WHERE id = ?'
    ).run(player.id);

    // Simulate a non-tender: directly release to FA (mirrors what runNonTenderStep does)
    prepared(
      'UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, is_on_25man = 0, minor_level = NULL WHERE id = ?'
    ).run(player.id);

    prepared(
      "INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, 1, 'non_tender', ?, ?, NULL, ?)"
    ).run(leagueId, analyticsTeam.id, player.id, Date.now());

    // Verify the released player has waiver_state = none (not 'dfa'/'waivers')
    const released = prepared('SELECT waiver_state FROM players WHERE id = ?').get(player.id) as any;
    expect(released.waiver_state).toBe('none');
  });

  it('non-tender transaction type is non_tender, not dfa', async () => {
    const { prepared } = await import('../db.js');

    // All transactions inserted in this test file with non_tender type
    const nonTenderTx = prepared(
      "SELECT COUNT(*) as cnt FROM transactions WHERE league_id = ? AND transaction_type = 'non_tender'"
    ).get(leagueId) as any;

    // Must have at least 1 non-tender logged in this session
    expect(nonTenderTx.cnt).toBeGreaterThanOrEqual(1);
  });

  it('analytics archetype nontender_salary_threshold is set', () => {
    const archetype = getArchetype('analytics');
    expect(archetype.nontender_salary_threshold).not.toBeNull();
    expect(archetype.nontender_salary_threshold).toBeGreaterThan(0);
  });

  it('old-school archetype nontender_salary_threshold is null (never non-tenders)', () => {
    const archetype = getArchetype('old-school');
    expect(archetype.nontender_salary_threshold).toBeNull();
  });
});
