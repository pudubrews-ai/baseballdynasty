-- Migration 015 — widen news_items.badge CHECK to include 'RIVALRY' (Feature 5).
--
-- Migration 014 was edited after some databases had already applied version 14,
-- so its widened constraint never re-ran (db.ts skips already-applied versions).
-- This new version re-applies the constraint widening idempotently for all DBs.
--
-- Guard: only recreate when the current constraint is missing 'RIVALRY'. If 014's
-- widened form already applied (fresh DBs), this is a no-op and rows are untouched.
-- (Re-running the recreate even on already-widened DBs would still be correct, but
-- the guard avoids needless 100k-row copies on large saves.)
--
-- news_items is not referenced by any foreign key, so the recreate is safe without
-- toggling foreign_keys. Column order below matches the live table exactly so that
-- INSERT ... SELECT * aligns positionally.

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
  pinned_until_game INTEGER DEFAULT NULL
);

INSERT INTO news_items SELECT * FROM news_items_old;
DROP TABLE news_items_old;

CREATE INDEX IF NOT EXISTS idx_news_items_league_id ON news_items(league_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_team ON news_items(team_id);
CREATE INDEX IF NOT EXISTS idx_news_items_secondary_team ON news_items(secondary_team_id);
CREATE INDEX IF NOT EXISTS idx_news_items_badge ON news_items(badge);
CREATE INDEX IF NOT EXISTS idx_news_items_pending ON news_items(is_headline_pending) WHERE is_headline_pending = 1;
