-- Migration 013: Add career_overall column to players
-- Tracks the career-peak overall rating for each player, used in coaching pipeline formula.
-- Additive-only — does not modify 011 or 012 (already applied in existing DBs).

ALTER TABLE players ADD COLUMN career_overall INTEGER;

-- Backfill existing rows: use current overall_rating as the initial career_overall proxy
UPDATE players SET career_overall = overall_rating WHERE career_overall IS NULL;
