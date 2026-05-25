-- Migration 012: v0.4.0 Iteration 2 fixes
-- Adds pinned_until_game to news_items (NF-1: tragedy pinning)
-- Adds trade_demand_since_game + trade_demand_penalty_applied to players (NF-3)

-- NF-1: tragedy news pinning (stays top of feed for 5 game-ticks)
ALTER TABLE news_items ADD COLUMN pinned_until_game INTEGER DEFAULT NULL;

-- NF-3: track when trade_demand was set and whether penalty was applied
ALTER TABLE players ADD COLUMN trade_demand_since_game INTEGER DEFAULT NULL;
ALTER TABLE players ADD COLUMN trade_demand_penalty_applied INTEGER DEFAULT 0 CHECK(trade_demand_penalty_applied IN (0,1));
