-- Iteration 4 §2.4: Index to speed up selectTopN in the draft path
CREATE INDEX IF NOT EXISTS idx_players_league_drafted_rating
  ON players(league_id, is_drafted, overall_rating);
