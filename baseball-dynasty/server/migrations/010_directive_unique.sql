-- v0.3.0 L2: Unique index to prevent duplicate once/season directive race conditions.
-- target_player is excluded because it can be issued twice per season.
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_directives_once_season
  ON owner_directives (league_id, season_number, directive_type)
  WHERE directive_type != 'target_player';
