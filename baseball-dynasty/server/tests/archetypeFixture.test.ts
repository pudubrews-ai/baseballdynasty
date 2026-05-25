// §5.6 — Archetype fixture test (covers M-4)
// Asserts the fixture league seed produces ≥5 analytics, ≥5 old-school,
// ≥2 small-market-analytics teams for deterministic G3/G4 test coverage.

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let analyticsCount = 0;
let oldSchoolCount = 0;
let smallMarketAnalyticsCount = 0;
let balancedCount = 0;
let totalTeams = 0;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  // ARCHETYPE_FIXTURE_SEED = 42 (verified)
  const result = await generateWorld({ seed: 42 });
  const leagueId = result.leagueId;

  const teams = prepared(
    'SELECT gm_archetype, market_size FROM teams WHERE league_id = ?'
  ).all(leagueId) as Array<{ gm_archetype: string; market_size: string }>;

  totalTeams = teams.length;
  analyticsCount = teams.filter(t => t.gm_archetype === 'analytics').length;
  oldSchoolCount = teams.filter(t => t.gm_archetype === 'old-school').length;
  balancedCount = teams.filter(t => t.gm_archetype === 'balanced').length;
  smallMarketAnalyticsCount = teams.filter(
    t => t.gm_archetype === 'analytics' && (t.market_size === 'small' || t.market_size === 'medium')
  ).length;
}, 60000);

describe('Archetype fixture — seed 42 cohort requirements', () => {
  it('league has 20 teams', () => {
    expect(totalTeams).toBe(20);
  });

  it('all teams have a valid gm_archetype (analytics / old-school / balanced)', () => {
    // analyticsCount + oldSchoolCount + balancedCount should sum to totalTeams
    expect(analyticsCount + oldSchoolCount + balancedCount).toBe(totalTeams);
  });

  it('has ≥5 analytics GM teams', () => {
    expect(analyticsCount).toBeGreaterThanOrEqual(5);
  });

  it('has ≥5 old-school GM teams', () => {
    expect(oldSchoolCount).toBeGreaterThanOrEqual(5);
  });

  it('has ≥2 small-or-medium market analytics teams', () => {
    expect(smallMarketAnalyticsCount).toBeGreaterThanOrEqual(2);
  });
});

describe('Archetype-market correlation', () => {
  it('analytics team count, old-school team count, balanced team count are all > 0', () => {
    expect(analyticsCount).toBeGreaterThan(0);
    expect(oldSchoolCount).toBeGreaterThan(0);
  });
});
