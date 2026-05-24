-- Migration 008: Add injury_return_game column for temporary IL stint tracking (AB-10 Part A)
-- is_injured already exists in 001_init.sql — do NOT re-add it.
ALTER TABLE players ADD COLUMN injury_return_game INTEGER;
