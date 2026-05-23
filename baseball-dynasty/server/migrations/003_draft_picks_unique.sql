-- Add UNIQUE constraint on draft_picks to prevent duplicate picks (§2.7)
-- First remove any pre-existing duplicate rows (keep the highest-id row per unique tuple)
DELETE FROM draft_picks
WHERE id NOT IN (
  SELECT MAX(id)
  FROM draft_picks
  GROUP BY league_id, season_number, round, pick_number
);

-- Now create the UNIQUE index
CREATE UNIQUE INDEX IF NOT EXISTS uniq_draft_picks
  ON draft_picks(league_id, season_number, round, pick_number);
