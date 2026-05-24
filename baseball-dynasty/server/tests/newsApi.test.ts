// Phase 10 gate: news feed backend
// Tests news_items table, insertNewsItem, getNewsFeed, badge mapping,
// /api/news endpoint, filter validation, empty array on no events.

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 63721 });
  leagueId = result.leagueId;

  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);
}, 60000);

describe('news_items table structure', () => {
  it('news_items table exists and is queryable', async () => {
    const { prepared } = await import('../db.js');
    const count = (prepared('SELECT COUNT(*) as cnt FROM news_items WHERE league_id = ?').get(leagueId) as any).cnt;
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('insertNewsItem returns a numeric id', async () => {
    const { insertNewsItem } = await import('../sim/news.js');
    const id = insertNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 5,
      eventType: 'call_up',
      teamId: null,
      playerId: null,
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('insertNewsItem sets badge correctly for ROSTER events', async () => {
    const { insertNewsItem } = await import('../sim/news.js');
    const { prepared } = await import('../db.js');

    const id = insertNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 5,
      eventType: 'dfa',
    });

    const row = prepared('SELECT badge FROM news_items WHERE id = ?').get(id) as any;
    expect(row.badge).toBe('ROSTER');
  });

  it('insertNewsItem sets badge TRANSACTION for trade events', async () => {
    const { insertNewsItem } = await import('../sim/news.js');
    const { prepared } = await import('../db.js');

    const id = insertNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 5,
      eventType: 'trade',
    });

    const row = prepared('SELECT badge FROM news_items WHERE id = ?').get(id) as any;
    expect(row.badge).toBe('TRANSACTION');
  });

  it('insertNewsItem sets badge FRONT OFFICE for manager_fired', async () => {
    const { insertNewsItem } = await import('../sim/news.js');
    const { prepared } = await import('../db.js');

    const id = insertNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 6,
      eventType: 'manager_fired',
    });

    const row = prepared('SELECT badge FROM news_items WHERE id = ?').get(id) as any;
    expect(row.badge).toBe('FRONT OFFICE');
  });

  it('insertNewsItem sets is_headline_pending=1 for non-GAME events by default', async () => {
    const { insertNewsItem } = await import('../sim/news.js');
    const { prepared } = await import('../db.js');

    const id = insertNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 5,
      eventType: 'waiver_claim',
    });

    const row = prepared('SELECT is_headline_pending FROM news_items WHERE id = ?').get(id) as any;
    expect(row.is_headline_pending).toBe(1);
  });

  it('insertNewsItem sets is_headline_pending=0 when headlineText is provided', async () => {
    const { insertNewsItem } = await import('../sim/news.js');
    const { prepared } = await import('../db.js');

    const id = insertNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 5,
      eventType: 'call_up',
      headlineText: 'Player called up to majors.',
    });

    const row = prepared('SELECT is_headline_pending, headline_text FROM news_items WHERE id = ?').get(id) as any;
    expect(row.is_headline_pending).toBe(0);
    expect(row.headline_text).toBe('Player called up to majors.');
  });

  it('insertGameNewsItem creates GAME badge with score headline and no pending', async () => {
    const { insertGameNewsItem } = await import('../sim/news.js');
    const { prepared } = await import('../db.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ? LIMIT 2').all(leagueId) as any[];
    if (teams.length < 2) return;

    insertGameNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 10,
      homeTeamId: teams[0].id,
      awayTeamId: teams[1].id,
      homeScore: 4,
      awayScore: 2,
      homeTeamName: teams[0].name,
      awayTeamName: teams[1].name,
    });

    const row = prepared(
      "SELECT badge, headline_text, is_headline_pending FROM news_items WHERE league_id = ? AND event_type = 'game_result' ORDER BY id DESC LIMIT 1"
    ).get(leagueId) as any;

    expect(row.badge).toBe('GAME');
    expect(row.is_headline_pending).toBe(0);
    expect(row.headline_text).toContain('4');
    expect(row.headline_text).toContain('2');
  });
});

describe('getNewsFeed filtering', () => {
  it('getNewsFeed with filter=all returns all items for league', async () => {
    const { getNewsFeed } = await import('../sim/news.js');
    const items = getNewsFeed({ leagueId, filter: 'all' });
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0); // we inserted items above
  });

  it('getNewsFeed with filter=transactions returns only TRANSACTION badge items', async () => {
    const { getNewsFeed } = await import('../sim/news.js');
    const items = getNewsFeed({ leagueId, filter: 'transactions' });
    for (const item of items) {
      expect(item.badge).toBe('TRANSACTION');
    }
  });

  it('getNewsFeed with filter=frontoffice returns only FRONT OFFICE badge items', async () => {
    const { getNewsFeed } = await import('../sim/news.js');
    const items = getNewsFeed({ leagueId, filter: 'frontoffice' });
    for (const item of items) {
      expect(item.badge).toBe('FRONT OFFICE');
    }
  });

  it('getNewsFeed respects limit parameter', async () => {
    const { getNewsFeed } = await import('../sim/news.js');
    const items = getNewsFeed({ leagueId, filter: 'all', limit: 2 });
    expect(items.length).toBeLessThanOrEqual(2);
  });

  it('getNewsFeed returns most recent items first (DESC order)', async () => {
    const { getNewsFeed } = await import('../sim/news.js');
    const items = getNewsFeed({ leagueId, filter: 'all', limit: 10 });
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i]!.id).toBeGreaterThanOrEqual(items[i + 1]!.id);
    }
  });

  it('getNewsFeed with teamId filter returns only items for that team', async () => {
    const { getNewsFeed, insertNewsItem } = await import('../sim/news.js');
    const { prepared } = await import('../db.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ? LIMIT 2').all(leagueId) as any[];
    if (teams.length < 2) return;

    const targetTeamId = teams[0].id;

    // Insert a specific news item for team[0]
    insertNewsItem({
      leagueId,
      seasonNumber: 1,
      gameNumber: 15,
      eventType: 'injury',
      teamId: targetTeamId,
    });

    const items = getNewsFeed({ leagueId, filter: 'all', teamId: targetTeamId });
    for (const item of items) {
      const isForTeam = item.team_id === targetTeamId || item.secondary_team_id === targetTeamId;
      expect(isForTeam).toBe(true);
    }
  });
});

describe('VALID_NEWS_FILTERS', () => {
  it('VALID_NEWS_FILTERS contains all required filter types', async () => {
    const { VALID_NEWS_FILTERS } = await import('../sim/news.js');
    expect(VALID_NEWS_FILTERS).toContain('all');
    expect(VALID_NEWS_FILTERS).toContain('roster');
    expect(VALID_NEWS_FILTERS).toContain('transactions');
    expect(VALID_NEWS_FILTERS).toContain('frontoffice');
    expect(VALID_NEWS_FILTERS).toContain('injuries');
    expect(VALID_NEWS_FILTERS).toContain('milestones');
  });
});

describe('getRecentNewsItems', () => {
  it('getRecentNewsItems returns at most limit items', async () => {
    const { getRecentNewsItems } = await import('../sim/news.js');
    const items = getRecentNewsItems(leagueId, 3);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it('getRecentNewsItems returns items with required fields', async () => {
    const { getRecentNewsItems } = await import('../sim/news.js');
    const items = getRecentNewsItems(leagueId, 1);
    if (items.length === 0) return;
    const item = items[0]!;
    expect(Object.prototype.hasOwnProperty.call(item, 'id')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(item, 'event_type')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(item, 'badge')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(item, 'game_number')).toBe(true);
  });
});

describe('/api/news endpoint (via newsRouter)', () => {
  it('newsRouter is importable and is an express Router', async () => {
    const { newsRouter } = await import('../routes/news.js');
    expect(typeof newsRouter).toBe('function');
  });

  it('getNewsFeed returns empty array for league with no news', async () => {
    const { getNewsFeed } = await import('../sim/news.js');
    // Use a non-existent league ID
    const items = getNewsFeed({ leagueId: 999999 });
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(0);
  });

  it('invalid type filter detected by VALID_NEWS_FILTERS check', async () => {
    const { VALID_NEWS_FILTERS } = await import('../sim/news.js');
    const isValid = VALID_NEWS_FILTERS.includes('invalid_type' as any);
    expect(isValid).toBe(false);
  });
});
