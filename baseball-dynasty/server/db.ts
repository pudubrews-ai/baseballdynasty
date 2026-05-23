import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LeagueStateSnapshot } from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB is opened lazily so tests can set DB_PATH before importing
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = process.env['DB_PATH'] ?? './data/dynasty.db';
    // Ensure data directory exists
    const dir = dirname(dbPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory already exists
    }
    _db = new Database(dbPath);
    // D8: pragmas
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

// D15: Migration runner
export async function initDb(): Promise<void> {
  const db = getDb();

  // Ensure schema_versions table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const migrationsDir = join(__dirname, 'migrations');
  let files: string[];
  try {
    files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  } catch {
    console.warn('[db] No migrations directory found');
    return;
  }

  const appliedStmt = db.prepare('SELECT version FROM schema_versions WHERE version = ?');

  for (const file of files) {
    const versionMatch = file.match(/^(\d+)/);
    if (!versionMatch) continue;
    const version = parseInt(versionMatch[1] ?? '0', 10);

    const alreadyApplied = appliedStmt.get(version);
    if (alreadyApplied) continue;

    console.log(`[db] Applying migration ${file}`);
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    // Apply migration in a transaction
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)').run(version, Date.now());
    });

    applyMigration();
  }
}

// Statement cache to avoid re-preparing
const stmtCache = new Map<string, Database.Statement>();

export function prepared(sql: string): Database.Statement {
  const db = getDb();
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

// League helpers
export function getActiveLeague() {
  return prepared('SELECT * FROM leagues WHERE archived = 0 LIMIT 1').get() as LeagueRow | undefined;
}

export function updateCache(leagueId: number, snapshot: LeagueStateSnapshot): void {
  prepared(
    'INSERT OR REPLACE INTO league_state_cache (league_id, snapshot_json, updated_at) VALUES (?, ?, ?)'
  ).run(leagueId, JSON.stringify(snapshot), Date.now());
}

export function getCachedState(leagueId: number): LeagueStateSnapshot | null {
  const row = prepared('SELECT snapshot_json FROM league_state_cache WHERE league_id = ?').get(leagueId) as { snapshot_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.snapshot_json) as LeagueStateSnapshot;
  } catch {
    return null;
  }
}

// Type definitions for DB rows
export interface LeagueRow {
  id: number;
  name: string;
  season_number: number;
  phase: string;
  sim_speed: string;
  current_game_date: number;
  current_game_number: number;
  last_pick_id: number;
  last_game_id: number;
  worldgen_seed: number;
  archived: number;
  offseason_step: string | null;
  schedule_json: string | null;
  created_at: number;
}

export interface TeamRow {
  id: number;
  league_id: number;
  name: string;
  city: string;
  region: string;
  market_size: string;
  conference: string;
  division: string;
  color: string;
  wins: number;
  losses: number;
  runs_scored: number;
  runs_allowed: number;
  games_played: number;
  payroll_budget: number;
  current_payroll: number;
  revenue: number;
  gm_name: string;
  gm_philosophy: string;
  gm_risk_tolerance: string;
  gm_focus: string;
  manager_name: string;
  manager_style: string;
  owner_name: string;
  owner_personality: string;
  owner_age: number;
  job_security: number;
}

export interface PlayerRow {
  id: number;
  league_id: number;
  team_id: number | null;
  first_name: string;
  last_name: string;
  age: number;
  position: string;
  overall_rating: number;
  potential: string;
  potential_revealed: number;
  contact: number;
  power: number;
  speed: number;
  fielding: number;
  arm: number;
  pitching_velocity: number;
  pitching_control: number;
  pitching_stamina: number;
  is_on_mlb_roster: number;
  minor_level: string | null;
  annual_salary: number;
  contract_years_remaining: number;
  service_time: number;
  injury_prone: number;
  coachability: number;
  work_ethic: number;
  leadership: number;
  origin: string;
  birthplace_city: string;
  birthplace_country: string;
  is_drafted: number;
  career_hits: number;
  career_hr: number;
  career_rbi: number;
  career_ip: number;
  career_k: number;
  career_wins: number;
}

export interface GameLogRow {
  id: number;
  league_id: number;
  season_number: number;
  game_number: number;
  game_date: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  home_hits: number;
  away_hits: number;
  home_errors: number;
  away_errors: number;
  home_walks: number;
  away_walks: number;
  notable_events_json: string;
  winning_pitcher_id: number | null;
  losing_pitcher_id: number | null;
  save_pitcher_id: number | null;
  is_complete: number;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    stmtCache.clear();
  }
}
