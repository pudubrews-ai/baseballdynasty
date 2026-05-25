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
  // v0.2.0 new columns
  spring_cuts_done_season: number | null;
  // v0.4.0 new columns
  memorial_patch_season: number | null;
}

export interface TeamRow {
  id: number;
  league_id: number;
  name: string;
  city: string;
  state_province?: string;
  region: string;
  market_size: string;
  conference: string;
  division: string;
  color: string;
  abbreviation: string | null;  // §3.1 — added by migration 004
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
  // v0.2.0 new columns
  gm_archetype: string;
  manager_name: string;
  manager_style: string;
  manager_tactics: number;
  manager_motivation: number;
  manager_communication: number;
  owner_name: string;
  owner_personality: string;
  owner_age: number;
  job_security: number;
  trade_posture: string | null;
  interim_gm: number;
  interim_manager: number;
  last_call_up_check_game: number;
  last_firing_check_game: number;
  last_gm_firing_check_game: number;
  last_service_time_update_game: number;
  deadline_trades_this_season: number;
  // v0.4.0 new columns
  medical_staff_rating: number;
  chemistry_score: number;
  franchise_value: number;
  stadium_deal_active: number;
  relocation_threat_active: number;
  original_city: string | null;
  stadium_capacity: number;
  founded_season: number;
  luxury_tax_paid: number;
  last_cascade_check_game: number;
  last_chemistry_calc_game: number;
  personality_rolls_done_season: number | null;
  // v0.5.0 new columns
  international_bonus_pool: number;
  scouting_rating: number;
  stadium_upgrade_in_progress: number;
  stadium_upgrade_complete_season: number | null;
  stadium_upgrade_type: string | null;
  new_stadium_honeymoon_seasons_remaining: number;
  winning_streak: number;
  losing_streak: number;
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
  // v0.2.0 new columns
  is_on_25man: number;
  options_remaining: number;
  service_time_days: number;
  first_mlb_call_up_game: number | null;
  free_agent_eligible: number;
  manipulation_delay_until_game: number | null;
  prospect_visible: number;
  waiver_state: string;
  dfa_team_id: number | null;
  claim_game_window_end: number | null;
  // v0.3.0 new columns
  last_send_down_game: number | null;
  is_injured: number;
  injury_return_game: number | null;
  // v0.4.0 new columns
  injury_type: string | null;
  injury_tier: string | null;
  rehab_games_remaining: number;
  career_injuries: number;
  suspension_games_remaining: number;
  suspension_type: string | null;
  ped_offenses: number;
  gambling_ban: number;
  is_malcontent: number;
  trade_demand_active: number;
  loyalty_discount_eligible: number;
  memorial: number;
  tragedy_victim: number;
  retired_number: number | null;
  seasons_with_current_team: number;
  promo_eval_streak: number;
  morale_effect_bp: number;
  morale_effect_until_game: number | null;
  // migration 013: career peak rating (nullable — may be null for pre-013 rows until dev step runs)
  career_overall: number | null;
  // v0.5.0 new columns
  bats: string;
  throws: string;
  arb_year: number | null;
  has_opt_out: number;
  opt_out_after_year: number | null;
  opted_out: number;
  is_international_signee: number;
  signing_bonus: number;
  true_overall: number | null;
  is_on_40man: number;
  signed_age: number | null;
  years_in_org: number;
  rule5_drafted: number;
  rule5_from_team_id: number | null;
  rule5_return_checked: number;
  vs_lefty_modifier: number;
  vs_righty_modifier: number;
  bullpen_role: string | null;
  appearances_this_season: number;
  consecutive_days_used: number;
  streak_type: string | null;
  streak_games_remaining: number;
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

// v0.4.0 new table row interfaces
export interface FranchiseSeasonHistoryRow {
  id: number;
  league_id: number;
  team_id: number;
  season_number: number;
  wins: number;
  losses: number;
  division_finish: number | null;
  playoff_round: string | null;
  made_playoffs: number;
  won_championship: number;
  attendance_avg: number;
  revenue: number;
  payroll_actual: number;
  payroll_budget: number;
  luxury_tax_paid: number;
  manager_name: string | null;
  gm_name: string | null;
  city_label: string | null;
}

export interface FranchisePlayerSeasonRow {
  id: number;
  league_id: number;
  team_id: number;
  player_id: number;
  season_number: number;
  games_played: number;
  at_bats: number;
  hits: number;
  home_runs: number;
  rbi: number;
  walks: number;
  innings_pitched: number;
  earned_runs: number;
  strikeouts_pitching: number;
  wins: number;
  losses: number;
}

export interface CoachingCandidateRow {
  id: number;
  league_id: number;
  player_id: number;
  specialty: string;
  coaching_rating: number;
  available: number;
  available_since: number;
  hired_team_id: number | null;
  hired_season: number | null;
  created_at: number;
}

export interface HallOfFameRow {
  id: number;
  league_id: number;
  player_id: number;
  induction_season: number;
  vote_share: number;
  veterans_committee: number;
  ped_flag: number;
  wing: string;
  memorial: number;
  career_stats_at_induction: string | null;
  created_at: number;
}

export interface HofBallotRow {
  id: number;
  league_id: number;
  player_id: number;
  ballot_since_season: number;
  years_on_ballot: number;
  best_vote_share: number;
  current_vote_share: number;
  ped_flag: number;
}

export interface MinorLeagueStandingsRow {
  id: number;
  league_id: number;
  team_id: number;
  season_number: number;
  level: string;
  wins: number;
  losses: number;
  last_updated_game: number;
}

export interface RivalryRow {
  id: number;
  league_id: number;
  team_a_id: number;
  team_b_id: number;
  rivalry_score: number;
  formed_season: number;
  last_updated_season: number;
  origin_type: string;
}

export interface AwardRaceRow {
  id: number;
  league_id: number;
  season_number: number;
  award_type: string;
  league: string;
  leader_player_id: number | null;
  leader_value: number | null;
  second_player_id: number | null;
  second_value: number | null;
  last_updated_game: number;
}

export interface AwardWinnerRow {
  id: number;
  league_id: number;
  season_number: number;
  award_type: string;
  league: string;
  player_id: number;
  vote_share: number;
}

export interface StadiumUpgradeRow {
  id: number;
  league_id: number;
  team_id: number;
  upgrade_type: string;
  cost: number;
  season_started: number;
  season_completed: number | null;
  capacity_delta: number;
  revenue_delta: number;
}

export interface InternationalProspectRow {
  id: number;
  league_id: number;
  season_number: number;
  name: string;
  age: number;
  origin_country: string;
  scouted_overall: number;
  true_overall: number;
  potential: string;
  signing_team_id: number | null;
  signed: number;
  created_at: number;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    stmtCache.clear();
  }
}
