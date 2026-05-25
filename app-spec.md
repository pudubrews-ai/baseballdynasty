# app-spec.md
# Baseball Dynasty Simulator

**Version:** v0.4.0
**Status:** Shipped

---

## Project Overview

A fully simulated baseball dynasty engine. 20 procedurally generated teams, each with a complete organization: owner, GM, manager, coaching staff, 40-man roster, and a full minor league system (AAA/AA/A/Rookie). The simulation runs continuous 50-game seasons from an expansion draft day forward with no predetermined end. Front office personalities drive all decisions procedurally. The LLM is used for narrative and flavor text only — all sim decisions are code. The UI shows the league unfolding in real time with standings, stats, org drilldowns, news feed, an immersive Watch tab (aquarium mode), a newspaper-style dynasty timeline, a Hall of Fame tab, franchise history encyclopedia, minor league standings, and a full injury/rehab system.

**Repository:** https://github.com/pudubrews-ai/baseballdynasty
**Local dev URL:** http://localhost:3001

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| Frontend | Vite + React + Tailwind CSS + Framer Motion 11.18.2 |
| Fonts | Bebas Neue (scoreboards, headlines), Inter (data, body) via Google Fonts |
| AI | Claude Haiku (claude-haiku-4-5-20251001) via Anthropic SDK — narrator only |
| Sim Engine | Pure TypeScript, server-side, tick-based |
| State sync | Frontend polls GET /api/state every 2s during active sim |

---

## LLM Philosophy

**LLM is a narrator, not a decision maker.** All roster moves, trade decisions, firing thresholds, draft picks, and free agent bids are fully procedural. LLM produces:
- Season narrative (1 call per season — Timeline tab recap)
- Transaction flavor one-liners (batched 10 per call — must include player name, show named example in prompt)
- News feed headlines (batched 10 per call)
- Draft pick reasoning strings (~20 sampled picks per draft)
- Newspaper front page headlines and below-the-fold teasers (batched with season narrative call)
- Tragedy obituaries (single dedicated call, never batched, 30s timeout, procedural fallback on failure)

Structural news events with names in scope at call site (signings, non-tenders, waivers, releases, milestones) set headlineText directly — LLM bypassed, names guaranteed.

The app runs fully offline when `ANTHROPIC_API_KEY` is absent. Headlines and flavor text are empty strings in keyless mode — expected behavior, not a defect.

---

## Design System

### Color Palette
```
--color-bg-deep:      #0d1117   # near-black navy — main backgrounds
--color-bg-surface:   #161b22   # card/panel backgrounds
--color-bg-elevated:  #1f2937   # modals, elevated surfaces
--color-accent-amber: #f59e0b   # primary accent — scores, highlights
--color-accent-cream: #fef3c7   # secondary accent — headlines, labels
--color-text-primary: #f9fafb   # main text
--color-text-muted:   #6b7280   # secondary text, metadata
--color-success:      #10b981   # wins, positive deltas
--color-danger:       #ef4444   # losses, firings
--color-warning:      #f59e0b   # caution states
```

Team colors: each team gets a primary and secondary color from a curated palette of 30 pairs at world gen. No two teams share the same primary.

### Animation Principles
- All transitions: 200-350ms, ease-out
- Scoreboard: split-flap mechanical effect
- Crowd fill: SVG path animating upward
- Turbo: everything at 8× speed, no skipped frames

---

## Core Concepts

### The League
- 20 teams split into 2 conferences of 2 divisions (5 teams each)
- 50-game regular season, top 4 teams per conference make playoffs
- Playoffs: Division Series (3-game), Conference Series (5-game), Championship (7-game)
- Draft after every season: reverse order of standings, 30 rounds
- Free agency window between seasons
- Trade deadline at game 35 of each season

### Teams
Every team has:
- **Market** — city name (random, made up), population tier (small/medium/large/mega), stadium capacity, base attendance rate
- **Financials** — annual revenue, payroll budget, luxury tax threshold, franchise_value
- **Owner** — name, personality (patient/win-now/meddling/hands-off), net worth tier, patience (1-10)
- **GM** — name, philosophy, aggression, archetype (analytics/old-school/balanced), tenure, interim flag, gm_confidence (0-100)
- **Manager** — name, style, tenure, job security, interim flag
- **Coaching staff** — pitching coach, hitting coach, 3B coach, bench coach (specialty rating 1-10)
- **Medical staff** — medical_staff_rating (1-10)
- **Chemistry** — chemistry_score (0-100), server-calculated only

### Players
Every player has:
- **Identity** — first name, last name, age, birthplace (diverse, walks of life)
- **Position** — C, 1B, 2B, 3B, SS, LF, CF, RF, SP, RP, CL
- **Ratings (1-99):** contact, power, speed, fielding, arm, eye (hitters); velocity, movement, control, stamina, composure (pitchers)
- **Potential** — A/B/C/D, hidden until age 25
- **Personality** — coachability, work_ethic, leadership
- **Status** — service time, contract, options remaining
- **Health** — injury_prone, is_injured, injury_return_game, injury_type, injury_tier, rehab_games_remaining, career_injuries
- **Suspensions** — suspension_games_remaining, suspension_type, ped_offenses, gambling_ban
- **Personality flags** — is_malcontent, trade_demand_active, trade_demand_since_game, trade_demand_penalty_applied, loyalty_discount_eligible
- **Memorial** — memorial (bool), retired_number
- **Career** — career_overall (backfilled from overall_rating)
- **Level** — MLB / AAA / AA / A / Rookie
- **last_send_down_game** — cooldown preventing same-window recall (AB-18)

---

## Data Model

### Tables

**leagues** — id, name, season_number, phase, current_game_date, created_at, memorial_patch_season

**teams** — id, league_id, name, abbreviation, city, conference, division, market_size, stadium_capacity, base_attendance_rate, revenue, payroll_budget, luxury_tax_paid, wins, losses, runs_scored, runs_allowed, games_back, magic_number, owner_name, owner_personality, owner_patience, gm_name, gm_philosophy, gm_aggression, gm_archetype, interim_gm, gm_confidence (DEFAULT 100), manager_name, manager_style, manager_job_security, interim_manager, world_series_wins, playoff_appearances, founded_season, medical_staff_rating (DEFAULT 5), chemistry_score (DEFAULT 50), franchise_value, stadium_deal_active, relocation_threat_active, original_city

**players** — id, team_id, league_id, first_name, last_name, age, birthplace_city, birthplace_state, birthplace_country, position, level, contact, power, speed, fielding, arm, eye, velocity, movement, control, stamina, composure, potential, potential_revealed, coachability, work_ethic, leadership, service_time_years, contract_years_remaining, annual_salary, injury_prone, is_injured, injury_return_game, injury_type, injury_tier, rehab_games_remaining, career_injuries, suspension_games_remaining, suspension_type, ped_offenses, gambling_ban, is_malcontent, trade_demand_active, trade_demand_since_game, trade_demand_penalty_applied, loyalty_discount_eligible, memorial, retired_number, is_on_40man, is_on_25man, last_send_down_game, career_overall, career stats (games/ab/hits/hr/rbi/avg/ip/wins/losses/era/so)

**game_log** — id, league_id, season_number, game_number, game_date, home_team_id, away_team_id, home_score, away_score, winning_pitcher_id, losing_pitcher_id, save_pitcher_id, attendance, duration_minutes, notable_events (JSON)

**season_stats** — one row per player per season, full hitting and pitching line

**transactions** — id, league_id, season_number, transaction_date, game_number, type (includes: suspended, reinstated), team_id, player_id, from_team_id, to_team_id, details (JSON), narrative

**front_office_events** — id, league_id, season_number, event_date, team_id, event_type, departing_person, incoming_person, reason (always populated), hired_person_context, narrative

**draft_picks** — id, league_id, season_number, round, pick_number, team_id, player_id, player_name_at_draft, position, bonus_paid

**news_items** — id, league_id, season_number, game_number, event_type, headline, pinned_until_game, entity references

**waiver_wire** — DFA'd players with claim state machine and claim_window_games_remaining

**franchise_state** — owned team selection, franchise selection state

**owner_directives** — directive type, season, cooldown state, used_at; UNIQUE index prevents TOCTOU duplicates

**coaching_candidates** — id, player_id, specialty, coaching_rating, available, available_since, hired_team_id, hired_season

**hall_of_fame** — id, player_id, induction_season, vote_share, veterans_committee (bool), ped_flag (bool), career_stats_at_induction (JSON)

**hof_ballot** — id, player_id, ballot_since_season, years_on_ballot, best_vote_share, current_vote_share

**minor_league_standings** — id, team_id, level (AAA/AA/A/Rookie), wins, losses, last_updated_game

**franchise_season_history** — season records per team per season

---

## API Endpoints

### Simulation Control
- `POST /api/league/new` — generate new league, begin franchise selection
- `GET /api/state` — full state snapshot (phase, season, simSpeed, waiverCount)
- `POST /api/sim/speed` — body: `{ speed: "paused"|"normal"|"fast"|"turbo" }`
- `POST /api/sim/advance` — advance one game when paused

### Franchise
- `POST /api/franchise/select` — set owned franchise
- `POST /api/franchise/skip` — proceed without owned team
- `GET /api/franchise/state` — current franchise selection state

### Watch Tab
- `GET /api/watch` — live game state: scoreboard, base runners, attendance, daypart, weather, front office sprites, city data

### Owner Directives
- `POST /api/directive/:type` — issue directive (go-for-it, rebuild, target-player, fire-manager, trust-process)
- `POST /api/directives/address-clubhouse` — "Address the Clubhouse" directive
- `GET /api/directive/status` — current cooldowns and GM confidence

### League Data
- `GET /api/standings` — full standings with W/L/GB/RS/RA/diff
- `GET /api/teams` — all 20 teams summary
- `GET /api/teams/:id` — full team detail including owner fields, full front office history with reasons, hired_person_context, chemistry_score, franchise_value
- `GET /api/teams/:id/roster` — 25-man + 40-man with stats
- `GET /api/teams/:id/minors` — full org by level with live synthesized stats
- `GET /api/teams/:id/history` — franchise encyclopedia (season records, manager/GM/owner history, championships, stat leaders). Performance: < 200ms for 10 seasons, < 500ms for 50 seasons
- `GET /api/teams/:id/financials` — year-over-year revenue, attendance, payroll, luxury tax. Performance: < 300ms for 10 seasons, < 600ms for 50 seasons
- `GET /api/games/recent` — last 20 results with box scores
- `GET /api/games/:id` — single game box score + notable events
- `GET /api/transactions` — recent 50 transactions including front office events with reason field
- `GET /api/draft/current` — current draft board
- `GET /api/waivers` — waiver wire. 200 + []; never 404
- `GET /api/news` — news feed. `?type=` filter: transactions, frontoffice, injuries, milestones (lowercase only). Invalid token → 400 `{"error":"Invalid event type filter"}`
- `GET /api/timeline` — all seasons with newspaper object: headline, lede, below_fold[] with reasons
- `GET /api/minors/standings` — all 4 levels (AAA/AA/A/Rookie). Always 200, never 404
- `GET /api/halloffame` — all HOF inductees. 200 + [] before first induction
- `GET /api/halloffame/:playerId` — single inductee card. 404 if not found
- `GET /api/coaches/available` — coaching candidates pool. 200 + [] before first retirements
- `GET /api/players/prospects` — league-wide top 50 prospects. 200 + [] if none

### Players
- `GET /api/players/leaders` — stat leaders
- `GET /api/players/:id` — full player card including injury history, suspension history
- `GET /api/players/:id/transactions` — transaction history

> **Note:** `GET /api/league` not implemented — use `GET /api/state`

---

## Frontend Views

### Franchise Selection Screen
Full-screen grid of 20 team cards shown after world gen, before expansion draft.

### Tab: League
Live standings, sim speed control, game ticker, news ticker on all tabs.

### Tab: Teams
Grid → team detail panel. Front office panel shows owner, GM, manager. Tabs: Roster, Minors (live stats), Financials (year-over-year charts), History (franchise encyclopedia).

### Tab: Games
Recent results, box score modal, today's matchups.

### Tab: Draft
Draft board, pick reveal, ~20 sampled LLM reasoning strings.

### Tab: Players
Stat leaders, player search, player card modal, Top Prospects toggle (league-wide top 50).

### Tab: News
Full chronological feed. Badge types: GAME / ROSTER / TRANSACTION / FRONT OFFICE / INJURY / MILESTONE. Filters: transactions, frontoffice, injuries, milestones.

### Tab: Watch (Aquarium Mode)
Full-screen immersive. Three zones: Ballpark (center), Front Office sprites (left), City Skyline (right). Bottom news ticker. Turbo mode time-lapse. Owner Directives panel.

### Tab: Hall of Fame
Inductee browser filtered by position, franchise, era. Manager/GM wing. Veterans committee inductees marked. PED flagged players marked.

### Tab: Timeline (Newspaper)
Vertical scroll, newest season at top. Newspaper front page per season. Tragedy seasons get above-the-fold treatment. Click expands to full broadsheet.

---

## Owner Nudge Mechanic

Five directives plus "Address the Clubhouse" when chemistry < 25.

| Directive | Effect | Cooldown | Confidence Cost |
|---|---|---|---|
| Go For It | GM shifts to buyer, opens checkbook | Once/season | 0 |
| Start Rebuilding | GM shifts to seller, prospects untouchable | Once/season | 0 |
| I Want That Player | Flag priority acquisition target | Twice/season | -5 if not acquired in 10 games |
| This Manager Has Lost Me | Fire manager immediately | Once/season | -10 |
| Trust The Process | Lock in-season firings, GM confidence +5 | Once/season | 0 |
| Address the Clubhouse | Resolves trade demand faster | One-time when chemistry < 25 | 0 |

---

## Simulation Engine

### Tick Loop
setImmediate-based, never blocks event loop. Speed: Paused / Normal (800ms/game) / Fast (100ms/game) / Turbo (burst). All firing checks run in turbo — never skipped.

### Season Phases
1. Franchise Selection (first launch only)
2. Expansion Draft (season 1) / Annual Draft (subsequent)
3. Spring Training Cuts — to 25-man; released → free agents
4. Free Agency — procedural, GM archetype driven
5. Regular Season — 50 games
6. Trade Deadline — game 30-40
7. Playoffs
8. Offseason — development, aging, front office changes, HOF voting, coaching pipeline

### Offseason Season Reset
All last_xxx_game per-team counters (cascade, chemistry, call-up, firing checks) reset to 0 at season start. current_payroll recomputed from SUM(annual_salary) before FA bidding.

### Tragedy Probability
Base rate divided by 500 (league games per season) so per-game roll normalizes to intended annual rate. Expected rate: ~1 death per 20 seasons league-wide.
```
per_game_probability = base_annual_rate / 500
Player base: 0.0001 / 500 = 0.0000002 per player per game
Age/roster multipliers applied on top of scaled base.
```

### In-Season Firing Logic
```
firing_threshold = 8 games under .500
  × owner_patience_modifier (meddling:0.6, win-now:0.8, patient:1.5, hands-off:2.0)
  × gm_aggression_modifier  (aggressive:0.75, moderate:1.0, conservative:1.2) [manager only]
```

### Simultaneous Event Priority
1. Tragedy — pauses sim immediately
2. Gambling ban — removes player before any transactions
3. PED third offense — removes player before waiver claims
4. Relocation threat — queued, resolves at season end
5. Injury / suspension — normal processing
6. Minor league cascading — last, after all roster changes settle

### Clubhouse Chemistry
chemistry_score (0-100), server-calculated only, never client-submitted. Recalculated every 10 games.

### Hall of Fame
- Voting each offseason: 30 voters (one per franchise), 75% threshold, max 3 per year
- Veterans committee every 5 seasons: 1 induction
- Tragedy victims auto-considered at next veterans committee cycle
- PED players: ballot eligible but flagged [PED]
- Gambling ban: HOF ineligible permanently

---

## Production Server Launch

```
npm run build   # builds to dist/
npm start       # → node dist/server/server/index.js
```
Nested `server/server/` path is a tsc artifact. Migrations at `dist/server/server/migrations/` (013 SQL files, 001–013). Server self-heals migration-pending DB on boot.

---

## Database Migrations
- 001-008: v0.1.0 / v0.2.0 schema
- 009-010: v0.3.0 schema
- 011_v0_4_0_schema.sql: all v0.4.0 player/team/league fields + new tables
- 012_v0_4_0_iter2.sql: news_items.pinned_until_game, players.trade_demand_since_game, players.trade_demand_penalty_applied
- 013_career_overall.sql: players.career_overall (backfilled from overall_rating)

---

## Known Limitations
- POST /api/franchise/select does not call refreshCache() — /api/state stale up to one tick
- "I Want That Player" requires open player card — no browse-and-target flow
- Front office sprites are flat SVG silhouettes, not illustrated characters

---

## Version History

| Version | Description |
|---|---|
| v0.1.0 | World gen, expansion draft, season sim, standings UI, team drilldown, draft room, basic timeline |
| v0.2.0 | Live minor league system, market dynamics, GM archetypes, in-season firings, news feed, LLM narrator-only |
| v0.3.0 | Franchise selection, Watch tab (aquarium mode), owner nudge mechanic, newspaper dynasty timeline, front office reasons in 4 locations |
| v0.4.0 | Franchise history encyclopedia, financial depth (charts + revenue model), Hall of Fame with voting + veterans committee, player-to-coach pipeline, live minor league cascading with performance-based promotions/demotions + standings, injuries with severity tiers + rehab assignments + pitcher innings limits, tragedies (player/manager/owner) with LLM obituary + sim pause + retired numbers, suspensions (PED/brawl/gambling ban), player personality depth (clubhouse chemistry, malcontents, trade demands, loyalty discounts, work-ethic aging), team sales depth + relocation threat |

---

## Roadmap

| Version | Feature |
|---|---|
| v0.5.0 | Your Franchise tab (persistent owned-team lens, browse any org from same view); Rule 5 draft; international amateur signing (bonus pools, regional scouts); player opt-outs and arbitration; rivalries (tracked narrative, surfaces in timeline and news); award races (MVP/Cy Young/ROY tracked live, late-season drama); records chasing (milestones generate ongoing news coverage); platoon splits (lefty/righty matchup advantages); bullpen management (closer/setup/specialist roles); hot and cold streaks; stadium upgrades; revenue model depth |
| v1.0.0 | 10-season dynasty playthrough, exportable history, shareable recaps |
