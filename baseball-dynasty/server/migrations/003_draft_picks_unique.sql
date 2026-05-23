-- Add UNIQUE constraint on draft_picks to prevent duplicate picks
CREATE UNIQUE INDEX IF NOT EXISTS uniq_draft_picks
  ON draft_picks(league_id, season_number, round, pick_number);
