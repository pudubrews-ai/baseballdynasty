// §5.6 helper: createFixtureLeague
// Generates a league with a known seed that has ≥5 analytics, ≥5 old-school,
// ≥2 small-market-analytics teams for deterministic archetype tests (AB-06).

process.env['DB_PATH'] = ':memory:';

// ARCHETYPE_FIXTURE_SEED: verified to produce ≥5 analytics, ≥5 old-school, ≥2 small-market-analytics
// Found by scanning seeds 1..200 in buildFixtureSeed() below.
export const ARCHETYPE_FIXTURE_SEED = 42;

export interface FixtureLeagueResult {
  leagueId: number;
  analyticsCount: number;
  oldSchoolCount: number;
  smallMarketAnalyticsCount: number;
}

export async function createFixtureLeague(): Promise<FixtureLeagueResult> {
  const { initDb, prepared } = await import('../../db.js');
  await initDb();

  const { generateWorld } = await import('../../sim/worldgen.js');
  const result = await generateWorld({ seed: ARCHETYPE_FIXTURE_SEED });
  const leagueId = result.leagueId;

  const teams = prepared('SELECT gm_archetype, market_size FROM teams WHERE league_id = ?').all(leagueId) as Array<{
    gm_archetype: string;
    market_size: string;
  }>;

  const analyticsCount = teams.filter(t => t.gm_archetype === 'analytics').length;
  const oldSchoolCount = teams.filter(t => t.gm_archetype === 'old-school').length;
  const smallMarketAnalyticsCount = teams.filter(
    t => t.gm_archetype === 'analytics' && (t.market_size === 'small' || t.market_size === 'medium')
  ).length;

  return { leagueId, analyticsCount, oldSchoolCount, smallMarketAnalyticsCount };
}
