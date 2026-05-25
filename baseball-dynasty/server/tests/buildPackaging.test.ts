// §5.3 — Build packaging test (covers C-4, updated Iter-6 for AB-19)
// Asserts all 8 migrations/*.sql files exist in dist/server/server/migrations/
// (the path the runtime loader in dist/server/server/db.js actually reads).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SRC_MIGRATIONS = path.join(REPO_ROOT, 'baseball-dynasty', 'server', 'migrations');
// AB-19 fix: the runtime loader in dist/server/server/db.js reads __dirname/migrations,
// so SQL files must be at dist/server/server/migrations/ — not dist/server/migrations/.
const DIST_SERVER_SERVER = path.join(REPO_ROOT, 'baseball-dynasty', 'dist', 'server', 'server');
const DIST_DB_JS = path.join(DIST_SERVER_SERVER, 'db.js');
const DIST_MIGRATIONS = path.join(DIST_SERVER_SERVER, 'migrations');

describe('Build packaging — migrations in dist', () => {
  it('compiled db.js exists at dist/server/server/db.js', () => {
    const distExists = fs.existsSync(path.join(REPO_ROOT, 'baseball-dynasty', 'dist'));
    if (!distExists) {
      console.warn('[buildPackaging] dist/ not built — skipping');
      return;
    }
    expect(
      fs.existsSync(DIST_DB_JS),
      `db.js not found at ${DIST_DB_JS}`
    ).toBe(true);
  });

  it('migrations/ is a sibling of compiled db.js (runtime-read path)', () => {
    // This ties the test to the actual __dirname resolution of db.js,
    // not a hard-coded path guess. A future tsc layout change will break this test
    // before it silently breaks production.
    const distExists = fs.existsSync(path.join(REPO_ROOT, 'baseball-dynasty', 'dist'));
    if (!distExists) {
      console.warn('[buildPackaging] dist/ not built — skipping');
      return;
    }
    if (!fs.existsSync(DIST_DB_JS)) {
      console.warn('[buildPackaging] db.js not found — skipping sibling check');
      return;
    }
    const siblingMigrations = path.join(path.dirname(DIST_DB_JS), 'migrations');
    expect(
      fs.existsSync(siblingMigrations),
      `migrations/ must be a sibling of db.js at ${siblingMigrations}`
    ).toBe(true);
  });

  it('dist/server/server/migrations directory exists after build', () => {
    const exists = fs.existsSync(DIST_MIGRATIONS);
    // If not built yet, skip rather than fail so CI can handle it
    if (!exists) {
      console.warn('[buildPackaging] dist/server/server/migrations not found — run npm run build first');
    }
    // This test documents the requirement; it passes if built
    expect(exists || !fs.existsSync(path.join(REPO_ROOT, 'baseball-dynasty', 'dist'))).toBe(true);
  });

  it('all source migrations are copied to dist/server/server/migrations', () => {
    const distExists = fs.existsSync(DIST_MIGRATIONS);
    if (!distExists) {
      console.warn('[buildPackaging] Skipping dist check — dist not built');
      return;
    }

    const srcFiles = fs.readdirSync(SRC_MIGRATIONS).filter(f => f.endsWith('.sql'));
    expect(srcFiles.length).toBeGreaterThanOrEqual(8); // at least 8 migrations (001–008)

    for (const file of srcFiles) {
      const distFile = path.join(DIST_MIGRATIONS, file);
      expect(fs.existsSync(distFile), `${file} missing from dist/server/server/migrations`).toBe(true);
    }
  });

  it('source migrations directory has exactly 12 .sql files', () => {
    // Updated from 7 → 8 in v0.2.0 Iteration 5: migration 008_injury_return.sql added (AB-10 Part A)
    // Updated from 8 → 9 in v0.3.0: migration 009_v0_3_0_schema.sql added (franchise/owner state, game_number column, send-down cooldown)
    // Updated from 9 → 10 in v0.3.0 Iter-2: migration 010_directive_unique.sql added (L2 race backstop)
    // Updated from 10 → 11 in v0.4.0: migration 011_v0_4_0_schema.sql added (depth release)
    // Updated from 11 → 12 in v0.4.0 Iter-2: migration 012_v0_4_0_iter2.sql added (pinned_until_game, trade_demand_since_game)
    const srcFiles = fs.readdirSync(SRC_MIGRATIONS).filter(f => f.endsWith('.sql'));
    expect(srcFiles.length).toBe(12);
  });

  it('required migration files exist in source', () => {
    const required = [
      '001_init.sql',
      '002_playoff_series.sql',
      '003_draft_picks_unique.sql',
      '004_team_abbreviation.sql',
      '005_draft_picks_unique_v2.sql',
      '006_player_draft_index.sql',
      '007_v0_2_0_schema.sql',
      '008_injury_return.sql',
      '009_v0_3_0_schema.sql',
      '010_directive_unique.sql',
      '011_v0_4_0_schema.sql',
      '012_v0_4_0_iter2.sql',
    ];
    for (const f of required) {
      expect(fs.existsSync(path.join(SRC_MIGRATIONS, f)), `${f} missing from source`).toBe(true);
    }
  });
});
