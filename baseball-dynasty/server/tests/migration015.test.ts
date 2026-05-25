// Migration 015 regression test — widen news_items.badge CHECK to include 'RIVALRY'.
//
// Strategy: apply migrations 001-013 to get a DB with the old 6-badge constraint
// (no RIVALRY), insert representative data, then apply 015 and verify:
//   1. The constraint now includes 'RIVALRY'.
//   2. Inserting badge='RIVALRY' succeeds (no throw).
//   3. Pre-existing rows are preserved (no data loss).
//   4. All six original badge values still insert successfully.

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../migrations');

let db: Database.Database;
let leagueId: number;
let teamId: number;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  // Apply migrations 001-013 only — this leaves news_items with the old 6-badge
  // constraint (ROSTER, TRANSACTION, FRONT OFFICE, INJURY, MILESTONE, GAME) and
  // no RIVALRY. This is the "drifted" state: a DB that applied version 14 before
  // the RIVALRY edit landed (or never applied 014 at all).
  const files = readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort()
    .filter((f: string) => {
      const match = f.match(/^(\d+)/);
      const ver = match ? parseInt(match[1]!, 10) : 0;
      return ver >= 1 && ver <= 13;
    });

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec(sql);
  }

  // Insert a league so we can create news_items rows.
  db.prepare(`
    INSERT INTO leagues (name, season_number, phase, sim_speed, current_game_date, current_game_number,
      last_pick_id, last_game_id, worldgen_seed, archived, created_at)
    VALUES ('Test League', 1, 'regular_season', 'paused', 0, 10, 0, 0, 42, 0, ?)
  `).run(Date.now());

  leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;

  // Insert a minimal team so FK references are valid.
  db.prepare(`
    INSERT INTO teams (league_id, name, city, state_province, region, market_size, conference, division,
      gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, manager_name, manager_style,
      owner_name, owner_personality, owner_age, job_security, wins, losses, payroll_budget, current_payroll, revenue)
    VALUES (?, 'Wanderers', 'Portland', 'OR', 'West', 'small', 'NL', 'West',
      'Bob Smith', 'rebuild', 'aggressive', 'hitting', 'Mike Jones', 'balanced',
      'Alice Brown', 'moderate', 60, 5, 0, 0, 50000000, 25000000, 30000000)
  `).run(leagueId);

  teamId = (db.prepare('SELECT id FROM teams WHERE league_id = ?').get(leagueId) as { id: number }).id;

  // Insert one row for each of the 6 original badge values.
  const preBadges = ['ROSTER', 'TRANSACTION', 'FRONT OFFICE', 'INJURY', 'MILESTONE', 'GAME'];
  for (const badge of preBadges) {
    db.prepare(`
      INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge)
      VALUES (?, 1, 5, ?, 'test_event', ?)
    `).run(leagueId, Date.now(), badge);
  }

  // Confirm RIVALRY is rejected by the old constraint (proves the drift scenario).
  expect(() => {
    db.prepare(`
      INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge)
      VALUES (?, 1, 5, ?, 'rivalry_game', 'RIVALRY')
    `).run(leagueId, Date.now());
  }).toThrow();

  // Now apply migration 015 — the fix.
  const migration015 = readFileSync(join(migrationsDir, '015_news_badge_rivalry.sql'), 'utf8');
  db.exec(migration015);
});

describe('Migration 015 — widen news_items.badge CHECK to include RIVALRY', () => {
  it('constraint definition now contains RIVALRY', () => {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='news_items'")
      .get() as { sql: string };
    expect(row.sql).toContain("'RIVALRY'");
  });

  it('inserting badge=RIVALRY does not throw', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge, team_id, source_table, source_id)
        VALUES (?, 1, 10, ?, 'rivalry_game', 'RIVALRY', ?, 'game_log', 999)
      `).run(leagueId, Date.now(), teamId);
    }).not.toThrow();
  });

  it('pre-migration rows are preserved (no data loss)', () => {
    // 6 pre-migration rows should all still be present.
    const count = (db
      .prepare("SELECT COUNT(*) as cnt FROM news_items WHERE event_type = 'test_event'")
      .get() as { cnt: number }).cnt;
    expect(count).toBe(6);
  });

  it('all six original badge values still insert successfully after migration', () => {
    const originalBadges = ['ROSTER', 'TRANSACTION', 'FRONT OFFICE', 'INJURY', 'MILESTONE', 'GAME'];
    for (const badge of originalBadges) {
      expect(() => {
        db.prepare(`
          INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge)
          VALUES (?, 1, 20, ?, 'post_migration_test', ?)
        `).run(leagueId, Date.now(), badge);
      }).not.toThrow();
    }
  });

  it('RIVALRY badge row is queryable and has expected event_type', () => {
    const row = db
      .prepare("SELECT event_type, badge FROM news_items WHERE badge = 'RIVALRY' LIMIT 1")
      .get() as { event_type: string; badge: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.badge).toBe('RIVALRY');
    expect(row!.event_type).toBe('rivalry_game');
  });

  it('invalid badge value is still rejected after migration', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge)
        VALUES (?, 1, 5, ?, 'test', 'INVALID_BADGE')
      `).run(leagueId, Date.now());
    }).toThrow();
  });
});
