-- Playoff series results table — avoids contaminating regular-season standings
CREATE TABLE IF NOT EXISTS playoff_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  round_name TEXT NOT NULL,           -- 'DS' | 'CS' | 'WS'
  conference TEXT,                    -- 'American' | 'National' | NULL for WS
  team1_id INTEGER NOT NULL REFERENCES teams(id),
  team2_id INTEGER NOT NULL REFERENCES teams(id),
  winner_team_id INTEGER NOT NULL REFERENCES teams(id),
  team1_wins INTEGER NOT NULL,
  team2_wins INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
