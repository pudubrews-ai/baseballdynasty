# app-spec.md
# Baseball Dynasty Simulator

**Version:** v0.3.0
**Status:** Shipped

---

## Project Overview

A fully simulated baseball dynasty engine. 20 procedurally generated teams, each with a complete organization: owner, GM, manager, coaching staff, 40-man roster, and a full minor league system (AAA/AA/A/Rookie). The simulation runs continuous 50-game seasons from an expansion draft day forward with no predetermined end. Front office personalities drive all decisions procedurally. The LLM is used for narrative and flavor text only. The UI shows the league unfolding in real time with standings, stats, org drilldowns, news feed, an immersive Watch tab (aquarium mode), and a newspaper-style dynasty timeline.

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
- Transaction flavor one-liners (batched 10 per call)
- News feed headlines (batched 10 per call)
- Draft pick reasoning strings (~20 sampled picks per draft)
- Newspaper front page headlines and below-the-fold teasers (batched with season narrative call)

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
- **Financials** — annual revenue, payroll budget, luxury tax threshold
- **Owner** — name, personality (patient/win-now/meddling/hands-off), net worth tier, patience (1-10). Renders in team detail panel.
- **GM** — name, philosophy, aggression, archetype (analytics/old-school/balanced), tenure, interim flag, gm_confidence (0-100)
- **Manager** — name, style, tenure, job security, interim flag
- **Coaching staff** — pitching coach, hitting coach, 3B coach, bench coach (specialty rating 1-10)

### Players
Every player has:
- **Identity** — first name, last name, age, birthplace (diverse, walks of life)
- **Position** — C, 1B, 2B, 3B, SS, LF, CF, RF, SP, RP, CL
- **Ratings (1-99):** contact, power, speed, fielding, arm, eye (hitters); velocity, movement, control, stamina, composure (pitchers)
- **Potential** — A/B/C/D, hidden until age 25
- **Personality** — coachability, work_ethic, leadership
- **Status** — service time, contract, options remaining
- **Health** — injury_prone, is_injured, injury_return_game
- **Level** — MLB / AAA / AA / A / Rookie
- **last_send_down_game** — cooldown field preventing same-window recall (AB-18 fix)

---

## Data Model

### Tables

**leagues** — id, name, season_number, phase, current_game_date, created_at

**teams** — id, league_id, name, abbreviation, city, conference, division, market_size, stadium_capacity, base_attendance_rate, revenue, payroll_budget, luxury_tax_paid, wins, losses, runs_scored, runs_allowed, games_back, magic_number, owner_name, owner_personality, owner_patience, gm_name, gm_philosophy, gm_aggression, gm_archetype, interim_gm, gm_confidence (DEFAULT 100), manager_name, manager_style, manager_job_security, interim_manager, world_series_wins, playoff_appearances, founded_season

**players** — id, team_id, league_id, first_name, last_name, age, birthplace_city, birthplace_state, birthplace_country, position, level, contact, power, speed, fielding, arm, eye, velocity, movement, control, stamina, composure, potential, potential_revealed, coachability, work_ethic, leadership, service_time_years, contract_years_remaining, annual_salary, injury_prone, is_injured, injury_return_game, is_on_40man, is_on_25man, last_send_down_game, career stats (games/ab/hits/hr/rbi/avg/ip/wins/losses/era/so)

**game_log** — id, league_id, season_number, game_number, game_date, home_team_id, away_team_id, home_score, away_score, winning_pitcher_id, losing_pitcher_id, save_pitcher_id, attendance, duration_minutes, notable_events (JSON)

**season_stats** — one row per player per season, full hitting and pitching line

**transactions** — id, league_id, season_number, transaction_date, game_number, type, team_id, player_id, from_team_id, to_team_id, details (JSON), narrative

**front_office_events** — id, league_id, season_number, event_date, team_id, event_type, departing_person, incoming_person, reason (always populated), hired_person_context, narrative

**draft_picks** — id, league_id, season_number, round, pick_number, team_id, player_id, player_name_at_draft, position, bonus_paid

**news_items** — id, league_id, season_number, game_number, event_type, headline, entity references

**waiver_wire** — DFA'd players with claim state machine and claim_window_games_remaining

**franchise_state** — owned team selection, franchise selection state

**owner_directives** — directive type, season, cooldown state, used_at; UNIQUE index prevents TOCTOU duplicates

---

## API Endpoints

### Simulation Control
- `POST /api/league/new` — generate new league, begin franchise selection
- `GET /api/state` — full state snapshot (phase, season, simSpeed, waiverCount)
- `POST /api/sim/speed` — body: `{ speed: "paused"|"normal"|"fast"|"turbo" }`
- `POST /api/sim/advance` — advance one game when paused

### Franchise
- `POST /api/franchise/select` — set owned franchise. Note: does not call refreshCache() — /api/state may be stale up to one tick; ownership reads go DB-direct via /api/watch
- `POST /api/franchise/skip` — proceed without owned team
- `GET /api/franchise/state` — current franchise selection state

### Watch Tab
- `GET /api/watch` — live game state: scoreboard, base runners, attendance, daypart, weather, front office sprites, city data

### Owner Directives
- `POST /api/directive/:type` — issue directive (go-for-it, rebuild, target-player, fire-manager, trust-process)
- `GET /api/directive/status` — current cooldowns and GM confidence

### League Data
- `GET /api/standings` — full standings with W/L/GB/RS/RA/diff
- `GET /api/teams` — all 20 teams summary
- `GET /api/teams/:id` — full team detail including owner fields, full front office history with reasons, hired_person_context. Note: gm_hired_context backfilled to "Founding GM (league inception)" for pre-v0.3.0 rows
- `GET /api/teams/:id/roster` — 25-man + 40-man with stats
- `GET /api/teams/:id/minors` — full org by level with live synthesized stats
- `GET /api/games/recent` — last 20 results with box scores
- `GET /api/games/:id` — single game box score + notable events
- `GET /api/transactions` — recent 50 transactions including front office events with reason field
- `GET /api/draft/current` — current draft board
- `GET /api/waivers` — waiver wire. 200 + []; never 404
- `GET /api/news` — news feed. `?type=` filter: transactions, frontoffice, injuries, milestones (lowercase only). Invalid token → 400 `{"error":"Invalid event type filter"}`
- `GET /api/timeline` — all seasons with newspaper object: headline, lede, below_fold[] with reasons

### Players
- `GET /api/players/leaders` — stat leaders
- `GET /api/players/:id` — full player card
- `GET /api/players/:id/transactions` — transaction history

> **Note:** `GET /api/league` not implemented — use `GET /api/state`

---

## Frontend Views

### Franchise Selection Screen
Full-screen grid of 20 team cards shown after world gen, before expansion draft. Shows city, nickname, market size, owner personality, GM archetype, flavor line. Hover reveals capacity and payroll. Confirming locks franchise. Dismissing runs sim without owned team (nudge panel disabled).

### Tab: League
Live standings, sim speed control, game ticker, news ticker on all tabs.

### Tab: Teams
Grid → team detail panel. Front office panel shows owner (name, personality, patience, net worth), GM (archetype, confidence, hire context), manager (hire context). Roster, Minors (live stats), Financials, History tabs. Note: individual roster player testids not present — roster renders as text inside team-detail-panel.

### Tab: Games
Recent results, box score modal, today's matchups.

### Tab: Draft
Draft board, pick reveal, ~20 sampled LLM reasoning strings.

### Tab: Players
Stat leaders, player search, player card modal.

### Tab: News
Full chronological feed. Badge types: GAME / ROSTER / TRANSACTION / FRONT OFFICE / INJURY / MILESTONE. Filters: transactions, frontoffice, injuries, milestones. Game items show score only, no LLM headline.

### Tab: Watch (Aquarium Mode)
Full-screen immersive. Three zones:
- **Ballpark (center 60%)** — SVG perspective stadium, crowd fill animation, split-flap scoreboard, baserunner dots, day/night/weather sky, your team's park has pulse glow. Empty/lights-off in offseason.
- **Front Office (left 20%)** — Owner/GM/Manager SVG sprites with emotion states (Neutral/Happy/Anxious/Angry/Celebrating). Meddling owner paces. Exit animation on firing. INTERIM badge on interims. Note: sprites are flat SVG silhouettes, not illustrated characters.
- **City Skyline (right 20%)** — Procedural SVG scaled to market size. Lit windows correlate with record. Playoff clinch fireworks. Winter snow.
- **Bottom bar** — scrolling news ticker, pauses on hover.

**Turbo in Watch tab:** fully animated throughout. Scoreboard spins, calendar overlay tears through weeks, headlines flash at 200ms. Season end: newspaper drops in, holds 1.5s minimum, then offseason state resumes.

### Tab: Timeline (Newspaper)
Vertical scroll, newest season at top. Each season = newspaper front page with paper texture, masthead, LLM headline, champion sidebar (MVP/Cy Young/Top Prospect), below-the-fold teasers with front office reasons inline. Click expands to full broadsheet: narrative, standings, awards, transactions with reasons, front office changes with reasons.

---

## Owner Nudge Mechanic

Five directives with cooldowns. GM confidence starts at 100.

| Directive | Effect | Cooldown | Confidence Cost |
|---|---|---|---|
| Go For It | GM shifts to buyer, opens checkbook | Once/season | 0 |
| Start Rebuilding | GM shifts to seller, prospects untouchable | Once/season | 0 (mutually exclusive with Go For It) |
| I Want That Player | Flag priority acquisition target | Twice/season | -5 if not acquired in 10 games |
| This Manager Has Lost Me | Fire manager immediately | Once/season | -10 |
| Trust The Process | Lock in-season firings, GM confidence +5 | Once/season | 0 (unavailable after fire directive same season) |

GM confidence: +2 per 5 games above .500, -1 per 5 games below .500. At 0: GM resigns end of season. At 80+: GM sends status updates to news feed.

"Go For It" when 15+ games back: GM overrides, news item generated, confidence -5.
"I Want That Player" target injured: auto-cancels, no confidence penalty, news item generated.
GM resignation deferred to season end even if confidence hits 0 mid-season.

---

## Simulation Engine

### Tick Loop
setImmediate-based, never blocks event loop. Speed: Paused / Normal (800ms/game) / Fast (100ms/game) / Turbo (burst). All firing checks, waiver windows, call-up evaluations run in turbo — never skipped.

### Season Phases
1. Franchise Selection (first launch only)
2. Expansion Draft (season 1) / Annual Draft (subsequent) — procedural picks, ~20 LLM flavor strings
3. Spring Training Cuts — to 25-man; released players → free agents (not waivers)
4. Free Agency — procedural, GM archetype driven
5. Regular Season — 50 games
6. Trade Deadline — game 30-40, procedural buy/sell
7. Playoffs
8. Offseason — development, aging, front office changes

### GM Archetypes
- **Analytics:** Aggressive waiver targeting, trades veterans early, non-tenders expensive players, drafts for upside
- **Old-School:** Claims veterans, loyal to vets, drafts for current rating, pays market rate
- **Balanced:** Middle ground

### Live Minor League System
- DFA → 3-game waiver window → free agent if unclaimed
- Waiver claim order: reverse standings
- Call-ups evaluated every 5 games
- Send-downs: player must have option or is DFA'd
- Send-down cooldown: cannot recall within same 5-game window (AB-18)
- Service time: 172 games = 1 year; 6 years = FA eligible
- Prospect development every 10 games (ages 18-25, AA/A/Rookie)
- Bust mechanic: age 26+ in AA with potential C/D → locked D, capped at 65

### In-Season Firing Logic
```
firing_threshold = 8 games under .500
  × owner_patience_modifier (meddling:0.6, win-now:0.8, patient:1.5, hands-off:2.0)
  × gm_aggression_modifier  (aggressive:0.75, moderate:1.0, conservative:1.2) [manager only]
```
Owner fires GM every 10 games. GM fires manager every 5 games (non-meddling owner only). Meddling owner fires manager directly. Non-meddling owner direct fire: 2.5× threshold, GM confidence -2. Interims cannot be fired mid-season.

### Front Office Change Reasons (always populated)
- Manager firing: "Fired after going [W-L] through [N] games (Season [S])"
- GM firing: "Fired after team went [W-L], [N] games under .500 at time of dismissal"
- Owner override: "Owner lost confidence in manager after [N]-game losing streak"
- Death: "Passed away during Season [S]. Succeeded by [heir name]."
- Sale: "Sold franchise after Season [S]. New ownership group takes control."

Surfaces in: news feed headline, team detail front office panel, timeline newspaper below the fold, /api/transactions feed.

### Front Office Instability (offseason)
- Owner death (0.5%, weighted older): new name + new randomized personality
- Owner sale (2%, low net worth): new name + new randomized personality
- Permanent hires happen in offseason after interim stints

### Player Development (offseason)
- Ages 18-27 in low minors: ratings +1-3 based on coachability × work_ethic × coaching staff
- Ages 28-32: stable
- Ages 33+: decline risk (speed first, then contact/velocity)
- Potential revealed at 25
- Injuries: 5% chance per season (15-45 game IL)

---

## Production Server Launch

```
npm run build   # builds to dist/
npm start       # → node dist/server/server/index.js
```
Nested `server/server/` path is a tsc artifact. Migrations at `dist/server/server/migrations/` (010 SQL files, 001–010). Server self-heals migration-pending DB on boot.

---

## Database Migrations
- 001-008: v0.1.0 / v0.2.0 schema
- 009_v0_3_0_schema.sql: reason + hired_person_context on front_office_events; game_number on transactions; last_send_down_game on players; franchise_state table; owner_directives table; gm_confidence on teams
- 010_directive_unique.sql: UNIQUE index on owner_directives (TOCTOU prevention)

---

## Known Limitations
- POST /api/franchise/select does not call refreshCache() — /api/state stale up to one tick after selection. Non-functional; ownership reads go DB-direct via /api/watch.
- "I Want That Player" requires open player card — no browse-and-target flow.
- Front office sprites are flat SVG silhouettes, not illustrated characters.

---

## Version History

| Version | Description |
|---|---|
| v0.1.0 | World gen, expansion draft, season sim, standings UI, team drilldown, draft room, basic timeline |
| v0.2.0 | Live minor league system, market dynamics, GM archetypes, in-season firings, news feed, LLM narrator-only |
| v0.3.0 | Franchise selection, Watch tab (aquarium mode), owner nudge mechanic, newspaper dynasty timeline, front office reasons in 4 locations, v0.2.0 deferred fixes |

---

## Roadmap

| Version | Feature |
|---|---|
| v0.4.0 | Franchise history encyclopedia; financial depth; Hall of Fame; player-to-coach pipeline; live minor league movement with performance-based cascading and standings; injuries with rehab assignments, severity tiers, medical staff, pitcher workload; player/manager/owner tragedies; suspensions; player personality depth (clubhouse chemistry, trade demands, loyalty discounts); team sales depth with relocation threat |
| v0.5.0 | Stadium upgrades, revenue model depth, ownership drama |
| v1.0.0 | 10-season dynasty playthrough, exportable history, shareable recaps |
