-- v0.1.0 initial schema
-- Implements D1-D3, D26-D27, C1-C4 decisions

CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Baseball Dynasty',
  season_number INTEGER NOT NULL DEFAULT 1,
  phase TEXT NOT NULL DEFAULT 'setup',
  sim_speed TEXT NOT NULL DEFAULT 'paused',
  current_game_date INTEGER NOT NULL DEFAULT 0,
  current_game_number INTEGER NOT NULL DEFAULT 0,
  last_pick_id INTEGER NOT NULL DEFAULT 0,
  last_game_id INTEGER NOT NULL DEFAULT 0,
  worldgen_seed INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  offseason_step TEXT,
  schedule_json TEXT,
  created_at INTEGER NOT NULL
);

-- D27: Only one active league at a time
CREATE UNIQUE INDEX IF NOT EXISTS one_active_league ON leagues(archived) WHERE archived = 0;

CREATE TABLE IF NOT EXISTS teams (
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
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  runs_scored INTEGER NOT NULL DEFAULT 0,
  runs_allowed INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  payroll_budget INTEGER NOT NULL DEFAULT 0,
  current_payroll INTEGER NOT NULL DEFAULT 0,
  revenue INTEGER NOT NULL DEFAULT 0,
  gm_name TEXT NOT NULL DEFAULT '',
  -- C2/D2: Three flat GM personality columns with CHECK constraints
  gm_philosophy TEXT NOT NULL DEFAULT 'balanced' CHECK (gm_philosophy IN ('win-now','rebuild','balanced')),
  gm_risk_tolerance TEXT NOT NULL DEFAULT 'moderate' CHECK (gm_risk_tolerance IN ('conservative','moderate','aggressive')),
  gm_focus TEXT NOT NULL DEFAULT 'hitting' CHECK (gm_focus IN ('hitting','pitching','defense')),
  manager_name TEXT NOT NULL DEFAULT '',
  manager_style TEXT NOT NULL DEFAULT 'balanced' CHECK (manager_style IN ('aggressive','balanced','conservative')),
  owner_name TEXT NOT NULL DEFAULT '',
  owner_personality TEXT NOT NULL DEFAULT 'moderate' CHECK (owner_personality IN ('meddling','hands-off','moderate')),
  owner_age INTEGER NOT NULL DEFAULT 55,
  job_security INTEGER NOT NULL DEFAULT 5
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  team_id INTEGER REFERENCES teams(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  position TEXT NOT NULL,
  overall_rating INTEGER NOT NULL,
  potential TEXT NOT NULL DEFAULT 'C' CHECK (potential IN ('A','B','C','D')),
  potential_revealed INTEGER NOT NULL DEFAULT 0,
  contact INTEGER NOT NULL DEFAULT 50,
  power INTEGER NOT NULL DEFAULT 50,
  speed INTEGER NOT NULL DEFAULT 50,
  fielding INTEGER NOT NULL DEFAULT 50,
  arm INTEGER NOT NULL DEFAULT 50,
  pitching_velocity INTEGER NOT NULL DEFAULT 50,
  pitching_control INTEGER NOT NULL DEFAULT 50,
  pitching_stamina INTEGER NOT NULL DEFAULT 50,
  -- D3: Single boolean for roster status
  is_on_mlb_roster INTEGER NOT NULL DEFAULT 0,
  minor_level TEXT,
  annual_salary INTEGER NOT NULL DEFAULT 0,
  contract_years_remaining INTEGER NOT NULL DEFAULT 1,
  service_time INTEGER NOT NULL DEFAULT 0,
  injury_prone INTEGER NOT NULL DEFAULT 3,
  coachability INTEGER NOT NULL DEFAULT 5,
  work_ethic INTEGER NOT NULL DEFAULT 5,
  leadership INTEGER NOT NULL DEFAULT 5,
  origin TEXT NOT NULL DEFAULT 'us',
  birthplace_city TEXT NOT NULL DEFAULT '',
  birthplace_country TEXT NOT NULL DEFAULT '',
  is_drafted INTEGER NOT NULL DEFAULT 0,
  is_injured INTEGER NOT NULL DEFAULT 0,
  career_hits INTEGER NOT NULL DEFAULT 0,
  career_hr INTEGER NOT NULL DEFAULT 0,
  career_rbi INTEGER NOT NULL DEFAULT 0,
  career_ip REAL NOT NULL DEFAULT 0,
  career_k INTEGER NOT NULL DEFAULT 0,
  career_wins INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS draft_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL DEFAULT 1,
  round INTEGER NOT NULL,
  pick_number INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id),
  reasoning TEXT,
  is_expansion_draft INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  game_number INTEGER NOT NULL,
  game_date INTEGER NOT NULL,
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  home_hits INTEGER NOT NULL DEFAULT 0,
  away_hits INTEGER NOT NULL DEFAULT 0,
  home_errors INTEGER NOT NULL DEFAULT 0,
  away_errors INTEGER NOT NULL DEFAULT 0,
  home_walks INTEGER NOT NULL DEFAULT 0,
  away_walks INTEGER NOT NULL DEFAULT 0,
  notable_events_json TEXT NOT NULL DEFAULT '[]',
  winning_pitcher_id INTEGER REFERENCES players(id),
  losing_pitcher_id INTEGER REFERENCES players(id),
  save_pitcher_id INTEGER REFERENCES players(id),
  is_complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS season_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id),
  team_id INTEGER REFERENCES teams(id),
  games_played INTEGER NOT NULL DEFAULT 0,
  at_bats INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  home_runs INTEGER NOT NULL DEFAULT 0,
  rbi INTEGER NOT NULL DEFAULT 0,
  walks INTEGER NOT NULL DEFAULT 0,
  strikeouts_batting INTEGER NOT NULL DEFAULT 0,
  innings_pitched REAL NOT NULL DEFAULT 0,
  earned_runs INTEGER NOT NULL DEFAULT 0,
  strikeouts_pitching INTEGER NOT NULL DEFAULT 0,
  walks_pitching INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  UNIQUE(league_id, season_number, player_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  team_id INTEGER REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id),
  narrative TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS front_office_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  event_type TEXT NOT NULL,
  departing_person TEXT,
  incoming_person TEXT,
  narrative TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS season_narratives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  champion_team_id INTEGER REFERENCES teams(id),
  mvp_player_id INTEGER REFERENCES players(id),
  narrative TEXT,
  UNIQUE(league_id, season_number)
);

CREATE TABLE IF NOT EXISTS league_state_cache (
  league_id INTEGER PRIMARY KEY REFERENCES leagues(id),
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- D13: LLM usage tracking
CREATE TABLE IF NOT EXISTS llm_usage (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_players_team_id ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_league_id ON players(league_id);
CREATE INDEX IF NOT EXISTS idx_game_log_league_game ON game_log(league_id, game_number);
CREATE INDEX IF NOT EXISTS idx_season_stats_season_player ON season_stats(season_number, player_id);
CREATE INDEX IF NOT EXISTS idx_transactions_league_season ON transactions(league_id, season_number);
CREATE INDEX IF NOT EXISTS idx_draft_picks_league ON draft_picks(league_id, season_number, round, pick_number);
CREATE INDEX IF NOT EXISTS idx_game_log_season ON game_log(league_id, season_number);
