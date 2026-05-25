-- 011_v0_4_0_schema.sql — v0.4.0 schema additions.
-- Applied in one transaction by the migration runner (db.ts:66).
-- SQLite rules: all booleans are INTEGER NOT NULL DEFAULT 0; new-column inline CHECK is allowed;
-- existing CHECK changes require a table swap (owner_directives only).

-- =========================================================
-- 1. PLAYERS new columns (Features 6, 7, 8, 9)
-- =========================================================
-- Feature 6 — Injuries
ALTER TABLE players ADD COLUMN injury_type TEXT
  CHECK (injury_type IS NULL OR injury_type IN ('arm','hamstring','oblique','concussion','tommy_john'));
ALTER TABLE players ADD COLUMN injury_tier TEXT
  CHECK (injury_tier IS NULL OR injury_tier IN ('day_to_day','short_il','standard_il','long_il','season_ending'));
ALTER TABLE players ADD COLUMN rehab_games_remaining INTEGER NOT NULL DEFAULT 0
  CHECK (rehab_games_remaining >= 0 AND rehab_games_remaining <= 15);
ALTER TABLE players ADD COLUMN career_injuries INTEGER NOT NULL DEFAULT 0
  CHECK (career_injuries >= 0);
-- Feature 8 — Suspensions
ALTER TABLE players ADD COLUMN suspension_games_remaining INTEGER NOT NULL DEFAULT 0
  CHECK (suspension_games_remaining >= 0 AND suspension_games_remaining <= 200);
ALTER TABLE players ADD COLUMN suspension_type TEXT
  CHECK (suspension_type IS NULL OR suspension_type IN ('brawl','dirty_play','ped','conduct','gambling'));
ALTER TABLE players ADD COLUMN ped_offenses INTEGER NOT NULL DEFAULT 0
  CHECK (ped_offenses >= 0 AND ped_offenses <= 3);
ALTER TABLE players ADD COLUMN gambling_ban INTEGER NOT NULL DEFAULT 0;
-- Feature 9 — Personality flags
ALTER TABLE players ADD COLUMN is_malcontent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN trade_demand_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN loyalty_discount_eligible INTEGER NOT NULL DEFAULT 0;
-- Feature 7 — Tragedy
ALTER TABLE players ADD COLUMN memorial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN tragedy_victim INTEGER NOT NULL DEFAULT 0;  -- E-3: reaches vet committee w/o retirement
ALTER TABLE players ADD COLUMN retired_number INTEGER
  CHECK (retired_number IS NULL OR (retired_number >= 0 AND retired_number <= 99));
-- Feature 9 — per-team tenure (loyalty / veteran-core / franchise-legend). Real counter, not service_time.
ALTER TABLE players ADD COLUMN seasons_with_current_team INTEGER NOT NULL DEFAULT 0
  CHECK (seasons_with_current_team >= 0);
-- Feature 5 — 2-consecutive-eval streak state (reset on level change). Positive = promotion streak,
-- negative = demotion streak. Bounded so a corrupted value cannot break the cascade.
ALTER TABLE players ADD COLUMN promo_eval_streak INTEGER NOT NULL DEFAULT 0
  CHECK (promo_eval_streak >= -5 AND promo_eval_streak <= 5);
-- Feature 7/9 — transient morale modifier (shared mechanism: tragedy morale + chemistry win-prob).
-- Stored as basis points (e.g. +200 = +2%); expires when current_game_number > morale_effect_until_game.
ALTER TABLE players ADD COLUMN morale_effect_bp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN morale_effect_until_game INTEGER;

-- =========================================================
-- 2. TEAMS new columns (Features 2, 6, 9, 10)
-- =========================================================
ALTER TABLE teams ADD COLUMN medical_staff_rating INTEGER NOT NULL DEFAULT 5
  CHECK (medical_staff_rating >= 1 AND medical_staff_rating <= 10);
ALTER TABLE teams ADD COLUMN chemistry_score INTEGER NOT NULL DEFAULT 50
  CHECK (chemistry_score >= 0 AND chemistry_score <= 100);
ALTER TABLE teams ADD COLUMN franchise_value INTEGER NOT NULL DEFAULT 0
  CHECK (franchise_value >= 0);                          -- stored in MILLIONS (see Step 14 units rule)
ALTER TABLE teams ADD COLUMN stadium_deal_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN relocation_threat_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN original_city TEXT
  CHECK (original_city IS NULL OR length(original_city) <= 64);  -- F4: cap free-text; flows into LLM prompt
-- Feature 10 — valuation inputs the spec references but that do not exist yet:
ALTER TABLE teams ADD COLUMN stadium_capacity INTEGER NOT NULL DEFAULT 35000
  CHECK (stadium_capacity >= 0 AND stadium_capacity <= 80000);
ALTER TABLE teams ADD COLUMN founded_season INTEGER NOT NULL DEFAULT 1
  CHECK (founded_season >= 1);
-- Feature 2 — cumulative luxury tax (no such column exists today; needed for the financials panel)
ALTER TABLE teams ADD COLUMN luxury_tax_paid INTEGER NOT NULL DEFAULT 0
  CHECK (luxury_tax_paid >= 0);
-- Feature 5/8 — cascade + morale cadence markers (per-team clock)
ALTER TABLE teams ADD COLUMN last_cascade_check_game INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN last_chemistry_calc_game INTEGER NOT NULL DEFAULT 0;
-- Feature 9 once-per-season roll markers (L2 determinism gate; see Step 13)
ALTER TABLE teams ADD COLUMN personality_rolls_done_season INTEGER;

-- =========================================================
-- 3. PLAYERS in-game injury return marker already exists (migration 008: injury_return_game).
--    No re-add. Confirm present via PRAGMA table_info(players).
-- =========================================================

-- =========================================================
-- 4. LEAGUES new column (Feature 7)
-- =========================================================
ALTER TABLE leagues ADD COLUMN memorial_patch_season INTEGER;

-- =========================================================
-- 5. NEW TABLE: franchise_season_history  (R1 keystone — NOT in spec, REQUIRED)
--    One row per (team, season) written at season end BEFORE the W/L reset.
--    Features 1, 2, 10 read exclusively from this table (never from live teams scalars).
-- =========================================================
CREATE TABLE IF NOT EXISTS franchise_season_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  season_number INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  division_finish INTEGER,                 -- 1=first in division; frozen at season end (standings reset after)
  playoff_round TEXT,                      -- 'missed' | 'DS' | 'CS' | 'WS' | 'champion'
  made_playoffs INTEGER NOT NULL DEFAULT 0,
  won_championship INTEGER NOT NULL DEFAULT 0,
  attendance_avg INTEGER NOT NULL DEFAULT 0,
  revenue INTEGER NOT NULL DEFAULT 0,
  payroll_actual INTEGER NOT NULL DEFAULT 0,
  payroll_budget INTEGER NOT NULL DEFAULT 0,
  luxury_tax_paid INTEGER NOT NULL DEFAULT 0,
  manager_name TEXT,                       -- manager of record at season end
  gm_name TEXT,                            -- GM of record at season end
  city_label TEXT,                         -- city at the time (for "[Old City] era" relocation labels)
  UNIQUE(league_id, team_id, season_number)
);
CREATE INDEX IF NOT EXISTS idx_fsh_team_season ON franchise_season_history(team_id, season_number);
CREATE INDEX IF NOT EXISTS idx_fsh_league_season ON franchise_season_history(league_id, season_number);

-- =========================================================
-- 6. NEW TABLE: franchise_player_season  (A-1 fix — per-(player, season, team) stat snapshot)
--    Captures a player's stats AS A MEMBER OF a specific franchise for that season.
--    Required because season_stats has only one row per player-season (no team breakdown).
--    Written at season end alongside franchise_season_history. Used for franchise stat leaders,
--    HOF "career as member of franchise", loyalty seasons-with-team, franchise legend.
-- =========================================================
CREATE TABLE IF NOT EXISTS franchise_player_season (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  season_number INTEGER NOT NULL,
  -- counting stats for that player on that team that season
  games_played INTEGER NOT NULL DEFAULT 0,
  at_bats INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  home_runs INTEGER NOT NULL DEFAULT 0,
  rbi INTEGER NOT NULL DEFAULT 0,
  walks INTEGER NOT NULL DEFAULT 0,
  innings_pitched REAL NOT NULL DEFAULT 0,
  earned_runs INTEGER NOT NULL DEFAULT 0,
  strikeouts_pitching INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  UNIQUE(league_id, team_id, player_id, season_number)
);
CREATE INDEX IF NOT EXISTS idx_fps_team_season ON franchise_player_season(team_id, season_number);
CREATE INDEX IF NOT EXISTS idx_fps_player ON franchise_player_season(player_id);

-- =========================================================
-- 7. NEW TABLES from spec (Features 3, 4, 5)
-- =========================================================
CREATE TABLE IF NOT EXISTS coaching_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  specialty TEXT NOT NULL
    CHECK (specialty IN ('pitching_coach','hitting_coach','bench_coach','third_base_coach','manager')),
  coaching_rating INTEGER NOT NULL DEFAULT 50 CHECK (coaching_rating >= 0 AND coaching_rating <= 110),
  available INTEGER NOT NULL DEFAULT 1,
  available_since INTEGER NOT NULL DEFAULT 0,   -- season number entered pool
  hired_team_id INTEGER REFERENCES teams(id),
  hired_season INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_coaching_candidates_player ON coaching_candidates(player_id);
CREATE INDEX IF NOT EXISTS idx_coaching_candidates_available ON coaching_candidates(league_id, available)
  WHERE available = 1;

CREATE TABLE IF NOT EXISTS hall_of_fame (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  induction_season INTEGER NOT NULL,
  vote_share REAL NOT NULL DEFAULT 0,            -- 0-100 percent; for vet-committee inductees use 0 + flag
  veterans_committee INTEGER NOT NULL DEFAULT 0,
  ped_flag INTEGER NOT NULL DEFAULT 0,
  wing TEXT NOT NULL DEFAULT 'player'
    CHECK (wing IN ('player','manager','gm')),
  memorial INTEGER NOT NULL DEFAULT 0,           -- tragedy inductee marker
  career_stats_at_induction TEXT,                -- JSON snapshot
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(league_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_hof_league ON hall_of_fame(league_id, induction_season);

CREATE TABLE IF NOT EXISTS hof_ballot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  ballot_since_season INTEGER NOT NULL,
  years_on_ballot INTEGER NOT NULL DEFAULT 0 CHECK (years_on_ballot >= 0 AND years_on_ballot <= 10),
  best_vote_share REAL NOT NULL DEFAULT 0,
  current_vote_share REAL NOT NULL DEFAULT 0,
  ped_flag INTEGER NOT NULL DEFAULT 0,
  UNIQUE(league_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_hof_ballot_player ON hof_ballot(player_id);
CREATE INDEX IF NOT EXISTS idx_hof_ballot_league ON hof_ballot(league_id);

CREATE TABLE IF NOT EXISTS minor_league_standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  season_number INTEGER NOT NULL DEFAULT 1,
  level TEXT NOT NULL CHECK (level IN ('AAA','AA','A','Rookie')),
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  last_updated_game INTEGER NOT NULL DEFAULT 0,
  UNIQUE(league_id, team_id, season_number, level)
);
CREATE INDEX IF NOT EXISTS idx_mls_team_level ON minor_league_standings(team_id, level);
CREATE INDEX IF NOT EXISTS idx_mls_league_level ON minor_league_standings(league_id, level);

-- =========================================================
-- 8. Feature-9 partial indexes from spec
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_players_malcontent ON players(is_malcontent) WHERE is_malcontent = 1;
CREATE INDEX IF NOT EXISTS idx_players_trade_demand ON players(trade_demand_active) WHERE trade_demand_active = 1;
CREATE INDEX IF NOT EXISTS idx_players_suspension ON players(suspension_games_remaining)
  WHERE suspension_games_remaining > 0;

-- =========================================================
-- 9. owner_directives CHECK expansion (Feature 9 "Address the Clubhouse") — TABLE SWAP.
--    SQLite cannot ALTER a CHECK. Recreate with 'address_clubhouse' added, copy rows,
--    and RE-CREATE BOTH indexes from migrations 009 AND 010 (the partial UNIQUE index is
--    relied on by directives.ts as a once-per-season backstop — do NOT drop it).
-- =========================================================
CREATE TABLE owner_directives_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id       INTEGER NOT NULL,
  season_number   INTEGER NOT NULL,
  directive_type  TEXT NOT NULL CHECK (directive_type IN
                    ('go_for_it','rebuild','target_player','fire_manager','trust_process','address_clubhouse')),
  issued_game     INTEGER NOT NULL DEFAULT 0,
  target_player_id INTEGER,
  resolved        INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT,
  created_at      INTEGER NOT NULL
);
INSERT INTO owner_directives_new
  (id, league_id, season_number, directive_type, issued_game, target_player_id, resolved, outcome, created_at)
SELECT id, league_id, season_number, directive_type, issued_game, target_player_id, resolved, outcome, created_at
FROM owner_directives;
DROP TABLE owner_directives;
ALTER TABLE owner_directives_new RENAME TO owner_directives;
-- Recreate index from migration 009:
CREATE INDEX IF NOT EXISTS idx_owner_directives_lookup
  ON owner_directives (league_id, season_number, directive_type);
-- Recreate partial UNIQUE index from migration 010 (MUST survive the swap):
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_directives_once_season
  ON owner_directives (league_id, season_number, directive_type)
  WHERE directive_type != 'target_player';

-- =========================================================
-- 10. Backfill founded_season for carried-over v0.3.0 teams.
--     Earliest known season for the team = MIN over existing season_stats; fall back to 1.
-- =========================================================
UPDATE teams SET founded_season = COALESCE(
  (SELECT MIN(ss.season_number) FROM season_stats ss
     JOIN players p ON p.id = ss.player_id
    WHERE ss.team_id = teams.id),
  1
);
-- Backfill franchise_value to a non-zero starting value so G10 "all teams > 0 after world gen" holds
-- for carried-over DBs (real valuation recomputed at first season-end financial step).
UPDATE teams SET franchise_value =
  CASE market_size
    WHEN 'mega' THEN 400 WHEN 'large' THEN 250 WHEN 'medium' THEN 150 ELSE 100 END
  WHERE franchise_value = 0;
-- Stadium capacity by market (deterministic; relocation may change it later)
UPDATE teams SET stadium_capacity =
  CASE market_size
    WHEN 'mega' THEN 48000 WHEN 'large' THEN 42000 WHEN 'medium' THEN 36000 ELSE 30000 END;
