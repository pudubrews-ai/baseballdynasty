-- v0.3.0 schema: front-office reasons, deferred-fix columns, franchise/owner state.

-- §5 Front office reasons (nullable add + same-transaction backfill — never NOT NULL on ALTER).
ALTER TABLE front_office_events ADD COLUMN reason TEXT;
ALTER TABLE front_office_events ADD COLUMN hired_person_context TEXT;
UPDATE front_office_events
  SET reason = COALESCE(reason, narrative, event_type)
  WHERE reason IS NULL;

-- §10 AB-17: discriminate in-season moves from spring/offseason (DEFAULT 0 = not-in-season-tagged).
ALTER TABLE transactions ADD COLUMN game_number INTEGER NOT NULL DEFAULT 0;

-- §10 AB-18: send-down cooldown marker (nullable; stores league gameNumber at send-down).
ALTER TABLE players ADD COLUMN last_send_down_game INTEGER;

-- §2 / §6 / §7 Franchise + owner-control state (one row per league; created on first select).
CREATE TABLE IF NOT EXISTS franchise_state (
  league_id            INTEGER PRIMARY KEY,
  owned_team_id        INTEGER,
  selection_resolved   INTEGER NOT NULL DEFAULT 0,
  selected_at          INTEGER,
  gm_confidence        INTEGER NOT NULL DEFAULT 100,
  firings_locked_season    INTEGER,
  go_for_it_season         INTEGER,
  rebuild_season           INTEGER,
  fire_manager_season      INTEGER,
  trust_process_season     INTEGER,
  last_confidence_checkpoint_game  INTEGER NOT NULL DEFAULT 0,
  last_status_update_game          INTEGER NOT NULL DEFAULT 0,
  gm_resign_pending_season         INTEGER
);

-- §7 Owner directives (one row per issued directive; cooldowns enforced by querying this table).
CREATE TABLE IF NOT EXISTS owner_directives (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id       INTEGER NOT NULL,
  season_number   INTEGER NOT NULL,
  directive_type  TEXT NOT NULL CHECK (directive_type IN
                    ('go_for_it','rebuild','target_player','fire_manager','trust_process')),
  issued_game     INTEGER NOT NULL DEFAULT 0,
  target_player_id INTEGER,
  resolved        INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_directives_lookup
  ON owner_directives (league_id, season_number, directive_type);
