-- 014_v0_5_0_schema.sql — v0.5.0 schema additions (immersion release).
-- Applied in one transaction by the migration runner (db.ts:66).
-- SQLite rules: all booleans are INTEGER NOT NULL DEFAULT 0; use TEXT not VARCHAR;
-- nullable enum columns use CHECK (col IS NULL OR col IN (...)) form.

-- =========================================================
-- 1. PLAYERS new columns
-- =========================================================

-- Handedness (Orchestrator Decision 1 — Feature 8/9 blocker)
ALTER TABLE players ADD COLUMN bats TEXT NOT NULL DEFAULT 'R'
  CHECK (bats IN ('L','R','S'));
ALTER TABLE players ADD COLUMN throws TEXT NOT NULL DEFAULT 'R'
  CHECK (throws IN ('L','R'));

-- Arbitration & opt-outs (Feature 4)
ALTER TABLE players ADD COLUMN arb_year INTEGER
  CHECK (arb_year IS NULL OR arb_year IN (1,2,3));
ALTER TABLE players ADD COLUMN has_opt_out INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN opt_out_after_year INTEGER
  CHECK (opt_out_after_year IS NULL OR opt_out_after_year IN (2,3));
ALTER TABLE players ADD COLUMN opted_out INTEGER NOT NULL DEFAULT 0;

-- International signing (Feature 3)
ALTER TABLE players ADD COLUMN is_international_signee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN signing_bonus INTEGER NOT NULL DEFAULT 0
  CHECK (signing_bonus >= 0);
-- Hidden true rating for a signed international prospect; never returned by any API (CISO V5-1).
ALTER TABLE players ADD COLUMN true_overall INTEGER;

-- Rule 5 + org tenure (Feature 2)
ALTER TABLE players ADD COLUMN is_on_40man INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN signed_age INTEGER;          -- age when first signed to ANY team
ALTER TABLE players ADD COLUMN years_in_org INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN rule5_drafted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN rule5_from_team_id INTEGER;  -- original team for the offer-back path
ALTER TABLE players ADD COLUMN rule5_return_checked INTEGER NOT NULL DEFAULT 0; -- one-shot gate (X-F2a)

-- Platoon splits (Feature 8)
ALTER TABLE players ADD COLUMN vs_lefty_modifier INTEGER NOT NULL DEFAULT 0
  CHECK (vs_lefty_modifier >= -10 AND vs_lefty_modifier <= 10);
ALTER TABLE players ADD COLUMN vs_righty_modifier INTEGER NOT NULL DEFAULT 0
  CHECK (vs_righty_modifier >= -10 AND vs_righty_modifier <= 10);

-- Bullpen management (Feature 9)
ALTER TABLE players ADD COLUMN bullpen_role TEXT
  CHECK (bullpen_role IS NULL OR bullpen_role IN ('closer','setup','specialist','middle','long'));
ALTER TABLE players ADD COLUMN appearances_this_season INTEGER NOT NULL DEFAULT 0
  CHECK (appearances_this_season >= 0);
ALTER TABLE players ADD COLUMN consecutive_days_used INTEGER NOT NULL DEFAULT 0
  CHECK (consecutive_days_used >= 0);

-- Hot/cold streaks (Feature 10)
ALTER TABLE players ADD COLUMN streak_type TEXT
  CHECK (streak_type IS NULL OR streak_type IN ('hot','cold'));
ALTER TABLE players ADD COLUMN streak_games_remaining INTEGER NOT NULL DEFAULT 0
  CHECK (streak_games_remaining >= 0);

-- =========================================================
-- 2. TEAMS new columns
-- =========================================================

-- International signing (Feature 3)
ALTER TABLE teams ADD COLUMN international_bonus_pool INTEGER NOT NULL DEFAULT 0
  CHECK (international_bonus_pool >= 0);
ALTER TABLE teams ADD COLUMN scouting_rating INTEGER NOT NULL DEFAULT 5
  CHECK (scouting_rating >= 1 AND scouting_rating <= 10);

-- Stadium upgrades (Feature 11)
ALTER TABLE teams ADD COLUMN stadium_upgrade_in_progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN stadium_upgrade_complete_season INTEGER;
ALTER TABLE teams ADD COLUMN stadium_upgrade_type TEXT
  CHECK (stadium_upgrade_type IS NULL OR stadium_upgrade_type IN
    ('premium_seating','scoreboard','concessions','new_stadium_small','new_stadium_medium'));
ALTER TABLE teams ADD COLUMN new_stadium_honeymoon_seasons_remaining INTEGER NOT NULL DEFAULT 0
  CHECK (new_stadium_honeymoon_seasons_remaining >= 0);

-- Streak cache (Feature 10) — denormalized; streak.ts is source of truth
ALTER TABLE teams ADD COLUMN winning_streak INTEGER NOT NULL DEFAULT 0
  CHECK (winning_streak >= 0);
ALTER TABLE teams ADD COLUMN losing_streak INTEGER NOT NULL DEFAULT 0
  CHECK (losing_streak >= 0);

-- =========================================================
-- 3. NEW TABLES
-- =========================================================

-- Feature 5: Rivalries. Canonical ordering team_a_id < team_b_id prevents double rows.
CREATE TABLE rivalries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL,
  team_a_id INTEGER NOT NULL,
  team_b_id INTEGER NOT NULL,
  rivalry_score INTEGER NOT NULL DEFAULT 0 CHECK (rivalry_score >= 0 AND rivalry_score <= 100),
  formed_season INTEGER NOT NULL,
  last_updated_season INTEGER NOT NULL,
  origin_type TEXT NOT NULL CHECK (origin_type IN ('playoff_series','division_block','bad_trade')),
  CHECK (team_a_id < team_b_id),
  UNIQUE (league_id, team_a_id, team_b_id),
  FOREIGN KEY (league_id) REFERENCES leagues(id),
  FOREIGN KEY (team_a_id) REFERENCES teams(id),
  FOREIGN KEY (team_b_id) REFERENCES teams(id)
);

-- Feature 6: live award races. `league` stores the CONFERENCE name.
CREATE TABLE award_races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  award_type TEXT NOT NULL CHECK (award_type IN ('mvp','cy_young','roy')),
  league TEXT NOT NULL CHECK (league IN ('American','National')),
  leader_player_id INTEGER,
  leader_value REAL,
  second_player_id INTEGER,
  second_value REAL,
  last_updated_game INTEGER NOT NULL DEFAULT 0,
  UNIQUE (league_id, season_number, award_type, league),
  FOREIGN KEY (league_id) REFERENCES leagues(id)
);

-- Feature 6: award winners. player_id NOT NULL — re-rank on retirement, never blank (CISO V5-9).
CREATE TABLE award_winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  award_type TEXT NOT NULL CHECK (award_type IN ('mvp','cy_young','roy')),
  league TEXT NOT NULL CHECK (league IN ('American','National')),
  player_id INTEGER NOT NULL,
  vote_share REAL NOT NULL DEFAULT 0 CHECK (vote_share >= 0.0 AND vote_share <= 1.0),
  UNIQUE (league_id, season_number, award_type, league),
  FOREIGN KEY (league_id) REFERENCES leagues(id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

-- Feature 11: stadium upgrade history/audit.
CREATE TABLE stadium_upgrades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  upgrade_type TEXT NOT NULL CHECK (upgrade_type IN
    ('premium_seating','scoreboard','concessions','new_stadium_small','new_stadium_medium')),
  cost INTEGER NOT NULL CHECK (cost >= 0),
  season_started INTEGER NOT NULL,
  season_completed INTEGER,
  capacity_delta INTEGER NOT NULL DEFAULT 0,
  revenue_delta INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (league_id) REFERENCES leagues(id),
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

-- Feature 3: international prospects live HERE, not in players, until signed.
CREATE TABLE international_prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age IN (16,17)),
  origin_country TEXT NOT NULL CHECK (origin_country IN
    ('dominican','venezuela','cuba','japan','south_korea','other')),
  scouted_overall INTEGER NOT NULL,   -- displayable
  true_overall INTEGER NOT NULL,      -- HIDDEN — never returned by API
  potential TEXT NOT NULL CHECK (potential IN ('A','B','C','D')), -- HIDDEN until signed+revealed
  signing_team_id INTEGER,
  signed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (league_id) REFERENCES leagues(id),
  FOREIGN KEY (signing_team_id) REFERENCES teams(id)
);

-- =========================================================
-- 4. UPDATE news_items badge CHECK constraint to include RIVALRY (Feature 5)
-- =========================================================
-- SQLite cannot ALTER a CHECK constraint in-place; use the rename/recreate pattern.
-- news_items only references other tables (leagues, teams, players) — not referenced by any table —
-- so the copy is safe without disabling foreign_keys.
ALTER TABLE news_items RENAME TO news_items_old;

CREATE TABLE news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  game_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  badge TEXT NOT NULL CHECK (badge IN ('ROSTER','TRANSACTION','FRONT OFFICE','INJURY','MILESTONE','GAME','RIVALRY')),
  team_id INTEGER REFERENCES teams(id),
  secondary_team_id INTEGER REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id),
  source_table TEXT,
  source_id INTEGER,
  headline_text TEXT,
  is_headline_pending INTEGER NOT NULL DEFAULT 1,
  details_json TEXT,
  pinned_until_game INTEGER DEFAULT NULL   -- added by migration 012
);

INSERT INTO news_items SELECT * FROM news_items_old;
DROP TABLE news_items_old;

CREATE INDEX IF NOT EXISTS idx_news_items_league_id ON news_items(league_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_team ON news_items(team_id);
CREATE INDEX IF NOT EXISTS idx_news_items_secondary_team ON news_items(secondary_team_id);
CREATE INDEX IF NOT EXISTS idx_news_items_badge ON news_items(badge);
CREATE INDEX IF NOT EXISTS idx_news_items_pending ON news_items(is_headline_pending) WHERE is_headline_pending = 1;

-- =========================================================
-- 6. INDEXES (new tables)
-- =========================================================

CREATE INDEX idx_intl_prospects_league_season ON international_prospects (league_id, season_number);
CREATE INDEX idx_award_races_lookup ON award_races (league_id, season_number, award_type);
CREATE INDEX idx_stadium_upgrades_team ON stadium_upgrades (league_id, team_id);

-- =========================================================
-- 7. BACKFILL for existing data
-- =========================================================

-- Backfill is_on_40man: all current MLB roster players are on the 40-man
UPDATE players SET is_on_40man = 1 WHERE is_on_mlb_roster = 1;

-- Backfill years_in_org (approximate synthetic tenure by minor level)
-- MLB: 4-8 years, AAA: 3-6, AA: 2-4, A: 1-3, Rookie: 0-1
UPDATE players SET years_in_org =
  CASE
    WHEN is_on_mlb_roster = 1 THEN 5
    WHEN minor_level = 'AAA' THEN 4
    WHEN minor_level = 'AA' THEN 3
    WHEN minor_level = 'A' THEN 2
    WHEN minor_level = 'Rookie' THEN 1
    ELSE 0
  END
WHERE years_in_org = 0;

-- Backfill signed_age using years_in_org
UPDATE players SET signed_age = MAX(16, age - years_in_org)
WHERE signed_age IS NULL;

-- Backfill scouting_rating based on gm_archetype
UPDATE teams SET scouting_rating =
  CASE
    WHEN gm_archetype = 'analytics' THEN MIN(10, 7)
    WHEN gm_archetype = 'old-school' THEN MAX(1, 4)
    ELSE 5
  END;

-- Backfill international_bonus_pool by market size
UPDATE teams SET international_bonus_pool =
  CASE market_size
    WHEN 'mega' THEN 10000000
    WHEN 'large' THEN 6500000
    WHEN 'medium' THEN 4000000
    ELSE 2250000
  END;
