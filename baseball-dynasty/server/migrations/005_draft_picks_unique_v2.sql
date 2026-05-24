-- Iteration 4 §1.2: Include is_expansion_draft in the UNIQUE index on draft_picks
-- so that the expansion draft and the season-1 annual draft (both written with
-- season_number=1) can coexist without colliding on (round, pick_number).

DROP INDEX IF EXISTS uniq_draft_picks;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_draft_picks
  ON draft_picks(league_id, season_number, is_expansion_draft, round, pick_number);
