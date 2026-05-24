// Phase 1 gate: migration007.test.ts
// Applies migration 007 to a v0.1.0 fixture DB and asserts all Phase 1 requirements.
// Strategy: apply migrations 001-006 first to a v0.1.0 schema, insert test data,
// then apply 007 and verify all columns, backfills, and constraints.

import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '../migrations');

let db: Database.Database;

// Create a DB, apply 001-006 only, insert v0.1.0 data, then apply 007
beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const files = readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort()
    .filter((f: string) => {
      const match = f.match(/^(\d+)/);
      const ver = match ? parseInt(match[1]!, 10) : 0;
      return ver <= 6; // only 001-006
    });

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec(sql);
  }

  // Insert v0.1.0 style data BEFORE applying 007
  db.prepare(`
    INSERT INTO leagues (name, season_number, phase, sim_speed, current_game_date, current_game_number,
      last_pick_id, last_game_id, worldgen_seed, archived, created_at)
    VALUES ('Test League', 1, 'regular_season', 'paused', 0, 10, 0, 0, 42, 0, ?)
  `).run(Date.now());

  const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;

  // Team with 'moderate' personality (v0.1.0 valid)
  db.prepare(`
    INSERT INTO teams (league_id, name, city, state_province, region, market_size, conference, division,
      gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, manager_name, manager_style,
      owner_name, owner_personality, owner_age, job_security, wins, losses, payroll_budget, current_payroll, revenue)
    VALUES (?, 'Wanderers', 'Portland', 'OR', 'West', 'small', 'NL', 'West',
      'Bob Smith', 'rebuild', 'aggressive', 'hitting', 'Mike Jones', 'balanced',
      'Alice Brown', 'moderate', 60, 5, 0, 0, 50000000, 25000000, 30000000)
  `).run(leagueId);

  db.prepare(`
    INSERT INTO teams (league_id, name, city, state_province, region, market_size, conference, division,
      gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, manager_name, manager_style,
      owner_name, owner_personality, owner_age, job_security, wins, losses, payroll_budget, current_payroll, revenue)
    VALUES (?, 'Giants', 'New York', 'NY', 'East', 'mega', 'AL', 'East',
      'Ted Wilson', 'win-now', 'conservative', 'pitching', 'Sam Davis', 'aggressive',
      'Henry Ford', 'meddling', 70, 3, 0, 0, 150000000, 120000000, 80000000)
  `).run(leagueId);

  const team1Id = (db.prepare('SELECT id FROM teams WHERE league_id = ? ORDER BY id ASC LIMIT 1').get(leagueId) as { id: number }).id;
  const team2Id = (db.prepare('SELECT id FROM teams WHERE league_id = ? ORDER BY id ASC LIMIT 1 OFFSET 1').get(leagueId) as { id: number }).id;

  // MLB roster player (service_time=2 years → should become 60 days after migration)
  db.prepare(`
    INSERT INTO players (league_id, team_id, first_name, last_name, age, position, overall_rating, potential,
      is_on_mlb_roster, minor_level, service_time, is_drafted, annual_salary, contract_years_remaining)
    VALUES (?, ?, 'John', 'Doe', 28, 'SP', 75, 'B', 1, NULL, 2, 1, 5000000, 2)
  `).run(leagueId, team1Id);

  // Minor league player (service_time=0, is_on_mlb_roster=0)
  db.prepare(`
    INSERT INTO players (league_id, team_id, first_name, last_name, age, position, overall_rating, potential,
      is_on_mlb_roster, minor_level, service_time, is_drafted, annual_salary, contract_years_remaining)
    VALUES (?, ?, 'Jane', 'Smith', 22, 'SS', 65, 'A', 0, 'AAA', 0, 1, 500000, 1)
  `).run(leagueId, team2Id);

  // Now apply migration 007
  const migration007 = readFileSync(join(migrationsDir, '007_v0_2_0_schema.sql'), 'utf8');
  db.exec(migration007);
});

describe('Migration 007 — Phase 1 gate', () => {
  it('row counts preserved after teams table swap', () => {
    const teamCount = (db.prepare('SELECT COUNT(*) as cnt FROM teams').get() as { cnt: number }).cnt;
    expect(teamCount).toBe(2);

    const playerCount = (db.prepare('SELECT COUNT(*) as cnt FROM players').get() as { cnt: number }).cnt;
    expect(playerCount).toBe(2);
  });

  it('FK integrity: PRAGMA foreign_key_check returns empty', () => {
    const fkCheck = db.pragma('foreign_key_check') as unknown[];
    expect(fkCheck.length).toBe(0);
  });

  it('legacy moderate owner_personality survives', () => {
    const team = db.prepare("SELECT owner_personality FROM teams WHERE city = 'Portland'").get() as { owner_personality: string };
    expect(team.owner_personality).toBe('moderate');
  });

  it('legacy meddling owner_personality survives', () => {
    const team = db.prepare("SELECT owner_personality FROM teams WHERE city = 'New York'").get() as { owner_personality: string };
    expect(team.owner_personality).toBe('meddling');
  });

  it('new win-now owner_personality is now insertable', () => {
    const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;
    expect(() => {
      db.prepare(`
        INSERT INTO teams (league_id, name, city, state_province, region, market_size, conference, division,
          gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, manager_name, manager_style,
          owner_name, owner_personality, owner_age, job_security, wins, losses, payroll_budget, current_payroll, revenue)
        VALUES (?, 'TestTeam', 'Miami', 'FL', 'South', 'large', 'AL', 'South',
          'GM', 'balanced', 'moderate', 'hitting', 'Mgr', 'balanced',
          'Owner', 'win-now', 50, 5, 0, 0, 80000000, 50000000, 40000000)
      `).run(leagueId);
    }).not.toThrow();
  });

  it('new patient owner_personality is now insertable', () => {
    const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;
    expect(() => {
      db.prepare(`
        INSERT INTO teams (league_id, name, city, state_province, region, market_size, conference, division,
          gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, manager_name, manager_style,
          owner_name, owner_personality, owner_age, job_security, wins, losses, payroll_budget, current_payroll, revenue)
        VALUES (?, 'TestTeam2', 'Dallas', 'TX', 'South', 'medium', 'AL', 'South',
          'GM2', 'balanced', 'moderate', 'hitting', 'Mgr2', 'balanced',
          'Owner2', 'patient', 45, 5, 0, 0, 60000000, 40000000, 35000000)
      `).run(leagueId);
    }).not.toThrow();
  });

  it('gm_archetype column exists and has valid values for legacy teams', () => {
    const teams = db.prepare('SELECT gm_archetype FROM teams WHERE city IN (?, ?)').all('Portland', 'New York') as Array<{ gm_archetype: string }>;
    expect(teams.length).toBe(2);
    const validArchetypes = ['analytics', 'old-school', 'balanced'];
    for (const team of teams) {
      expect(validArchetypes).toContain(team.gm_archetype);
    }
  });

  it('gm_archetype derived: rebuild+aggressive → analytics for Portland', () => {
    // Portland has rebuild philosophy + aggressive risk → analytics
    const team = db.prepare("SELECT gm_archetype FROM teams WHERE city = 'Portland'").get() as { gm_archetype: string };
    expect(team.gm_archetype).toBe('analytics');
  });

  it('is_on_25man backfilled: MLB roster players (is_on_mlb_roster=1) get is_on_25man=1', () => {
    const mlbPlayer = db.prepare("SELECT is_on_25man FROM players WHERE first_name = 'John' AND last_name = 'Doe'").get() as { is_on_25man: number };
    expect(mlbPlayer.is_on_25man).toBe(1);
  });

  it('is_on_25man backfilled: minor league players (is_on_mlb_roster=0) keep is_on_25man=0', () => {
    const minorPlayer = db.prepare("SELECT is_on_25man FROM players WHERE first_name = 'Jane' AND last_name = 'Smith'").get() as { is_on_25man: number };
    expect(minorPlayer.is_on_25man).toBe(0);
  });

  it('service_time_days backfilled: service_time * 30 for MLB player', () => {
    const mlbPlayer = db.prepare("SELECT service_time, service_time_days FROM players WHERE first_name = 'John' AND last_name = 'Doe'").get() as { service_time: number; service_time_days: number };
    expect(mlbPlayer.service_time_days).toBe(mlbPlayer.service_time * 30);
    expect(mlbPlayer.service_time_days).toBe(60); // 2 years * 30
  });

  it('all new player columns have correct defaults for minor player', () => {
    const player = db.prepare("SELECT * FROM players WHERE first_name = 'Jane' AND last_name = 'Smith'").get() as Record<string, unknown>;
    expect(player['is_on_25man']).toBe(0);
    expect(player['options_remaining']).toBe(3);
    expect(player['service_time_days']).toBe(0);
    expect(player['free_agent_eligible']).toBe(0);
    expect(player['prospect_visible']).toBe(0);
    expect(player['waiver_state']).toBe('none');
    expect(player['dfa_team_id']).toBeNull();
    expect(player['claim_game_window_end']).toBeNull();
  });

  it('all new team columns have correct defaults', () => {
    const team = db.prepare("SELECT * FROM teams WHERE city = 'Portland'").get() as Record<string, unknown>;
    expect(team['interim_gm']).toBe(0);
    expect(team['interim_manager']).toBe(0);
    expect(team['last_call_up_check_game']).toBe(0);
    expect(team['last_firing_check_game']).toBe(0);
    expect(team['last_gm_firing_check_game']).toBe(0);
    expect(team['last_service_time_update_game']).toBe(0);
    expect(team['deadline_trades_this_season']).toBe(0);
    expect(team['manager_tactics']).toBe(50);
    expect(team['manager_motivation']).toBe(50);
    expect(team['manager_communication']).toBe(50);
    expect(team['trade_posture']).toBeNull();
  });

  it('season_stats has new columns (hits_allowed, recent_*, hit_streak)', () => {
    // Insert a test season_stats row to verify columns exist
    const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;
    const player = db.prepare('SELECT id FROM players LIMIT 1').get() as { id: number };
    const team = db.prepare('SELECT id FROM teams LIMIT 1').get() as { id: number };
    db.prepare(`
      INSERT INTO season_stats (league_id, season_number, team_id, player_id,
        at_bats, hits, home_runs, rbi, walks, strikeouts_batting, innings_pitched,
        earned_runs, strikeouts_pitching, walks_pitching, games_played)
      VALUES (?, 1, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    `).run(leagueId, team.id, player.id);

    const stats = db.prepare('SELECT * FROM season_stats WHERE league_id = ? LIMIT 1').get(leagueId) as Record<string, unknown>;
    expect(stats['hits_allowed']).toBe(0);
    expect(stats['recent_ab']).toBe(0);
    expect(stats['recent_hits']).toBe(0);
    expect(stats['recent_er']).toBe(0);
    expect(stats['recent_ip']).toBe(0);
    expect(stats['recent_starts']).toBe(0);
    expect(stats['hit_streak']).toBe(0);
  });

  it('leagues table has spring_cuts_done_season column defaulting to NULL', () => {
    const league = db.prepare('SELECT spring_cuts_done_season FROM leagues WHERE archived = 0').get() as { spring_cuts_done_season: unknown };
    expect(league.spring_cuts_done_season).toBeNull();
  });

  it('front_office_events has actor column defaulting to system', () => {
    const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;
    const team = db.prepare('SELECT id FROM teams LIMIT 1').get() as { id: number };
    db.prepare(`
      INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, created_at)
      VALUES (?, 1, ?, 'manager_fired', 'Old Guy', 'New Guy', 'Test narrative', ?)
    `).run(leagueId, team.id, Date.now());
    const event = db.prepare('SELECT actor FROM front_office_events LIMIT 1').get() as { actor: string };
    expect(event.actor).toBe('system');
  });

  it('news_items table exists and accepts valid badge values', () => {
    const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;
    const validBadges = ['ROSTER', 'TRANSACTION', 'FRONT OFFICE', 'INJURY', 'MILESTONE', 'GAME'];
    for (const badge of validBadges) {
      expect(() => {
        db.prepare(`
          INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge)
          VALUES (?, 1, 5, ?, 'test_event', ?)
        `).run(leagueId, Date.now(), badge);
      }).not.toThrow();
    }
  });

  it('news_items rejects invalid badge values', () => {
    const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;
    expect(() => {
      db.prepare(`
        INSERT INTO news_items (league_id, season_number, game_number, created_at, event_type, badge)
        VALUES (?, 1, 5, ?, 'test', 'INVALID_BADGE')
      `).run(leagueId, Date.now());
    }).toThrow();
  });

  it('waiver_state domain: only valid states should be used in code (no DB constraint)', () => {
    const validStates = ['none', 'dfa', 'waivers', 'expired'];
    const player = db.prepare('SELECT id FROM players LIMIT 1').get() as { id: number };
    for (const state of validStates) {
      expect(() => {
        db.prepare('UPDATE players SET waiver_state = ? WHERE id = ?').run(state, player.id);
      }).not.toThrow();
    }
    // Reset
    db.prepare("UPDATE players SET waiver_state = 'none' WHERE id = ?").run(player.id);
  });

  it('actor domain: only valid values gm, owner, system enforced in code', () => {
    const validActors = ['gm', 'owner', 'system'];
    const event = db.prepare('SELECT id FROM front_office_events LIMIT 1').get() as { id: number };
    if (event) {
      for (const actor of validActors) {
        expect(() => {
          db.prepare('UPDATE front_office_events SET actor = ? WHERE id = ?').run(actor, event.id);
        }).not.toThrow();
      }
      // Reset
      db.prepare("UPDATE front_office_events SET actor = 'system' WHERE id = ?").run(event.id);
    }
  });

  it('trade_posture CHECK constraint works on teams', () => {
    const leagueId = (db.prepare('SELECT id FROM leagues WHERE archived = 0').get() as { id: number }).id;
    // Valid values
    for (const posture of ['BUYER', 'SELLER', 'NEUTRAL', null]) {
      expect(() => {
        const team = db.prepare('SELECT id FROM teams WHERE league_id = ? LIMIT 1').get(leagueId) as { id: number };
        db.prepare('UPDATE teams SET trade_posture = ? WHERE id = ?').run(posture, team.id);
      }).not.toThrow();
    }
    // Invalid value
    expect(() => {
      const team = db.prepare('SELECT id FROM teams WHERE league_id = ? LIMIT 1').get(leagueId) as { id: number };
      db.prepare("UPDATE teams SET trade_posture = 'INVALID' WHERE id = ?").run(team.id);
    }).toThrow();
  });
});
