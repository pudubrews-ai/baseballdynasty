-- 007_v0_2_0_schema.sql — v0.2.0 schema additions
-- Applied in one transaction by the migration runner (db.ts:66). FK pragma toggled explicitly for the teams swap.

PRAGMA foreign_keys = OFF;

-- =========================================================
-- 1. TEAMS table swap (owner_personality CHECK expansion + new columns) — AB-17/CB-06/C14
-- =========================================================
CREATE TABLE teams_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state_province TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL,
  market_size TEXT NOT NULL,
  conference TEXT NOT NULL,
  division TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1e3a5f',
  abbreviation TEXT,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  runs_scored INTEGER NOT NULL DEFAULT 0,
  runs_allowed INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  payroll_budget INTEGER NOT NULL DEFAULT 0,
  current_payroll INTEGER NOT NULL DEFAULT 0,
  revenue INTEGER NOT NULL DEFAULT 0,
  gm_name TEXT NOT NULL DEFAULT '',
  gm_philosophy TEXT NOT NULL DEFAULT 'balanced' CHECK (gm_philosophy IN ('win-now','rebuild','balanced')),
  gm_risk_tolerance TEXT NOT NULL DEFAULT 'moderate' CHECK (gm_risk_tolerance IN ('conservative','moderate','aggressive')),
  gm_focus TEXT NOT NULL DEFAULT 'hitting' CHECK (gm_focus IN ('hitting','pitching','defense')),
  -- NEW: archetype (C1/AB-06)
  gm_archetype TEXT NOT NULL DEFAULT 'balanced' CHECK (gm_archetype IN ('analytics','old-school','balanced')),
  manager_name TEXT NOT NULL DEFAULT '',
  manager_style TEXT NOT NULL DEFAULT 'balanced' CHECK (manager_style IN ('aggressive','balanced','conservative')),
  -- NEW: manager numeric ratings (G16) — needed for interim "-10" assertion
  manager_tactics INTEGER NOT NULL DEFAULT 50,
  manager_motivation INTEGER NOT NULL DEFAULT 50,
  manager_communication INTEGER NOT NULL DEFAULT 50,
  owner_name TEXT NOT NULL DEFAULT '',
  -- EXPANDED CHECK (C14): adds win-now, patient; keeps legacy moderate
  owner_personality TEXT NOT NULL DEFAULT 'moderate' CHECK (owner_personality IN ('meddling','hands-off','moderate','win-now','patient')),
  owner_age INTEGER NOT NULL DEFAULT 55,
  job_security INTEGER NOT NULL DEFAULT 5,
  -- NEW: in-season state (C11)
  trade_posture TEXT CHECK (trade_posture IS NULL OR trade_posture IN ('BUYER','SELLER','NEUTRAL')),
  interim_gm INTEGER NOT NULL DEFAULT 0,
  interim_manager INTEGER NOT NULL DEFAULT 0,
  last_call_up_check_game INTEGER NOT NULL DEFAULT 0,
  last_firing_check_game INTEGER NOT NULL DEFAULT 0,
  last_gm_firing_check_game INTEGER NOT NULL DEFAULT 0,
  last_service_time_update_game INTEGER NOT NULL DEFAULT 0,
  deadline_trades_this_season INTEGER NOT NULL DEFAULT 0
);

-- Copy existing teams. gm_archetype derived inline with a deterministic CASE that approximates
-- the market-correlated rule (AB-06). Manager ratings default to 50.
INSERT INTO teams_new (
  id, league_id, name, city, state_province, region, market_size, conference, division, color, abbreviation,
  wins, losses, runs_scored, runs_allowed, games_played, payroll_budget, current_payroll, revenue,
  gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, gm_archetype,
  manager_name, manager_style, owner_name, owner_personality, owner_age, job_security
)
SELECT
  id, league_id, name, city, state_province, region, market_size, conference, division, color, abbreviation,
  wins, losses, runs_scored, runs_allowed, games_played, payroll_budget, current_payroll, revenue,
  gm_name, gm_philosophy, gm_risk_tolerance, gm_focus,
  CASE
    WHEN gm_risk_tolerance = 'aggressive' OR (gm_philosophy = 'rebuild' AND market_size IN ('small','medium')) THEN 'analytics'
    WHEN gm_risk_tolerance = 'conservative' AND gm_focus IN ('hitting','defense') THEN 'old-school'
    ELSE 'balanced'
  END,
  manager_name, manager_style, owner_name, owner_personality, owner_age, job_security
FROM teams;

DROP TABLE teams;
ALTER TABLE teams_new RENAME TO teams;

-- Recreate index from migration 004 (team_abbreviation)
CREATE INDEX IF NOT EXISTS idx_team_abbreviation ON teams(abbreviation);

-- =========================================================
-- 2. PLAYERS new columns (C2, C6, D4, D8, G10, D7)
-- =========================================================
ALTER TABLE players ADD COLUMN is_on_25man INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN options_remaining INTEGER NOT NULL DEFAULT 3;
ALTER TABLE players ADD COLUMN service_time_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN first_mlb_call_up_game INTEGER;
ALTER TABLE players ADD COLUMN free_agent_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN manipulation_delay_until_game INTEGER;
ALTER TABLE players ADD COLUMN prospect_visible INTEGER NOT NULL DEFAULT 0;
-- waiver_state: no inline CHECK (ALTER cannot add CHECK in SQLite); enforce in code + unit tests
ALTER TABLE players ADD COLUMN waiver_state TEXT NOT NULL DEFAULT 'none';
ALTER TABLE players ADD COLUMN dfa_team_id INTEGER REFERENCES teams(id);
ALTER TABLE players ADD COLUMN claim_game_window_end INTEGER;

-- Backfill is_on_25man and service_time_days from v0.1.0 data.
-- v0.1.0 used is_on_mlb_roster as the active flag → treat existing MLB players as 25-man active.
UPDATE players SET is_on_25man = 1 WHERE is_on_mlb_roster = 1;
-- Legacy service_time was in YEARS; convert to games using the rescaled constant (AB-05: 30 games/year).
UPDATE players SET service_time_days = service_time * 30;

-- =========================================================
-- 3. SEASON_STATS new columns (G9 rolling window for MLB OPS triggers + AB-21 WHIP fix)
-- =========================================================
ALTER TABLE season_stats ADD COLUMN hits_allowed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN recent_ab INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN recent_hits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN recent_hr INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN recent_walks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN recent_er REAL NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN recent_ip REAL NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN recent_starts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_stats ADD COLUMN hit_streak INTEGER NOT NULL DEFAULT 0;

-- =========================================================
-- 4. LEAGUES new columns (G1/G27 spring cuts flag)
-- =========================================================
ALTER TABLE leagues ADD COLUMN spring_cuts_done_season INTEGER;

-- =========================================================
-- 5. FRONT_OFFICE_EVENTS new column (G15 actor)
-- =========================================================
-- SQLite ALTER cannot add a CHECK; enforce 'gm'|'owner'|'system' in code.
ALTER TABLE front_office_events ADD COLUMN actor TEXT NOT NULL DEFAULT 'system';

-- =========================================================
-- 6. NEWS_ITEMS table (D3)
-- =========================================================
CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  game_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  badge TEXT NOT NULL CHECK (badge IN ('ROSTER','TRANSACTION','FRONT OFFICE','INJURY','MILESTONE','GAME')),
  team_id INTEGER REFERENCES teams(id),
  secondary_team_id INTEGER REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id),
  source_table TEXT,
  source_id INTEGER,
  headline_text TEXT,
  is_headline_pending INTEGER NOT NULL DEFAULT 1,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_items_league_id ON news_items(league_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_team ON news_items(team_id);
CREATE INDEX IF NOT EXISTS idx_news_items_secondary_team ON news_items(secondary_team_id);
CREATE INDEX IF NOT EXISTS idx_news_items_badge ON news_items(badge);
CREATE INDEX IF NOT EXISTS idx_news_items_pending ON news_items(is_headline_pending) WHERE is_headline_pending = 1;

-- Waiver lookup indexes
CREATE INDEX IF NOT EXISTS idx_players_waiver_state ON players(waiver_state) WHERE waiver_state != 'none';
CREATE INDEX IF NOT EXISTS idx_players_is_on_25man ON players(team_id, is_on_25man);

PRAGMA foreign_keys = ON;
