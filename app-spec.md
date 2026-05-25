# app-spec.md
# Baseball Dynasty Simulator

**Version:** v0.2.0
**Status:** Shipped

---

## Project Overview

A fully simulated baseball dynasty engine. 20 procedurally generated teams, each with a complete organization: owner, GM, manager, coaching staff, 40-man roster, and a full minor league system (AAA/AA/A/Rookie). The simulation runs continuous 50-game seasons from an expansion draft day forward with no predetermined end. Front office personalities drive all decisions procedurally. The LLM is used for narrative and flavor text only — all sim decisions are code. The UI shows the league unfolding in real time with standings, stats, org drilldowns, news feed, and a season-by-season dynasty timeline.

**Repository:** https://github.com/pudubrews-ai/baseballdynasty
**Local dev URL:** http://localhost:3001

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| Frontend | Vite + React + Tailwind CSS |
| AI | Claude Haiku (claude-haiku-4-5-20251001) via Anthropic SDK — narrator only |
| Sim Engine | Pure TypeScript, server-side, tick-based |
| State sync | Frontend polls GET /api/state every 2s during active sim |

---

## LLM Philosophy

**LLM is a narrator, not a decision maker.** All roster moves, trade decisions, firing thresholds, draft picks, and free agent bids are fully procedural. LLM produces:
- Season narrative (1 call per season — Timeline tab recap)
- Transaction flavor one-liners (batched 10 per call)
- News feed headlines (batched 10 per call)
- Draft pick reasoning strings (~20 sampled picks per draft, not all 600)

The app runs fully offline when `ANTHROPIC_API_KEY` is absent. Headlines and flavor text are empty strings in keyless mode — this is expected behavior, not a defect.

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
- **Financials** — annual revenue (derived from market + attendance + winning %), payroll budget, luxury tax threshold
- **Owner** — name, personality (patient/win-now/meddling/hands-off), net worth tier, years of ownership
- **GM** — name, philosophy (analytics/old-school/balanced), aggression (conservative/moderate/aggressive), archetype (gm_archetype field), tenure, interim flag
- **Manager** — name, style (small-ball/power/balanced), tenure, job security rating, interim flag
- **Coaching staff** — pitching coach, hitting coach, 3B coach, bench coach (each with specialty rating 1-10)

### Players
Every player has:
- **Identity** — first name, last name, age, birthplace (city, state or country — diverse, walks of life)
- **Position** — C, 1B, 2B, 3B, SS, LF, CF, RF, SP, RP, CL
- **Ratings (1-99 each):**
  - Hitters: contact, power, speed, fielding, arm, eye (plate discipline)
  - Pitchers: velocity, movement, control, stamina, composure
- **Potential** — hidden ceiling rating revealed through development (A/B/C/D)
- **Personality** — coachability, work ethic, leadership (affects development and clubhouse)
- **Status** — service time, contract (years, salary), options remaining
- **Health** — injury prone rating, current health status, injury_return_game (IL tracking)
- **Level** — MLB / AAA / AA / A / Rookie

### Game Simulation
Each game produces:
- Final score
- Box score: AB, H, HR, RBI, BB, K per batter; IP, H, ER, BB, K per pitcher
- Key events (HR, injuries, ejections) logged as game events
- Stats accumulate to season totals, career totals

Game outcome is determined by matchup math:
- Starting pitcher quality vs lineup quality
- Bullpen depth
- Home field advantage (+3% win probability)
- Fatigue (pitcher usage), injuries, streaks

No pitch-by-pitch simulation — game resolves to box score in one pass.

---

## Data Model

### Tables

**leagues**
- id, name, season_number, phase (draft/regular/playoffs/offseason), current_game_date, created_at

**teams**
- id, league_id, name, abbreviation, city, conference, division
- market_size (small/medium/large/mega), stadium_capacity, base_attendance_rate
- revenue, payroll_budget, luxury_tax_paid
- wins, losses, runs_scored, runs_allowed, games_back, magic_number
- owner_name, owner_personality, owner_patience (1-10)
- gm_name, gm_philosophy, gm_aggression, gm_archetype, interim_gm (bool)
- manager_name, manager_style, manager_job_security (1-10), interim_manager (bool)
- world_series_wins, playoff_appearances, founded_season

**players**
- id, team_id (nullable = free agent), league_id
- first_name, last_name, age, birthplace_city, birthplace_state, birthplace_country
- position, level (MLB/AAA/AA/A/Rookie)
- contact, power, speed, fielding, arm, eye (hitters)
- velocity, movement, control, stamina, composure (pitchers)
- potential (A/B/C/D), potential_revealed (bool)
- coachability, work_ethic, leadership
- service_time_years, contract_years_remaining, annual_salary
- injury_prone (1-10), is_injured, injury_return_game
- is_on_40man, is_on_25man
- career_games, career_ab, career_hits, career_hr, career_rbi, career_avg
- career_ip, career_wins, career_losses, career_era, career_so

**game_log**
- id, league_id, season_number, game_number, game_date
- home_team_id, away_team_id, home_score, away_score
- winning_pitcher_id, losing_pitcher_id, save_pitcher_id
- attendance, duration_minutes, notable_events (JSON array)

**season_stats** (one row per player per season)
- id, player_id, team_id, season_number
- games, ab, hits, doubles, triples, hr, rbi, bb, so, sb, avg, obp, slg, ops (hitters)
- games, gs, ip, wins, losses, saves, h, er, bb, so, era, whip (pitchers)

**transactions**
- id, league_id, season_number, transaction_date, type (trade/signing/release/draft/promotion/demotion/injury/fired/resigned)
- team_id, player_id, from_team_id, to_team_id, details (JSON), narrative (LLM-generated string)

**front_office_events**
- id, league_id, season_number, event_date, team_id
- event_type (gm_fired/gm_resigned/manager_fired/manager_resigned/owner_sold_team/owner_died)
- departing_person, incoming_person, reason, narrative (LLM-generated string)

**draft_picks**
- id, league_id, season_number, round, pick_number, team_id, player_id
- player_name_at_draft, position, bonus_paid

**news_items**
- id, league_id, season_number, game_number, event_type, headline (LLM or procedural)
- entity references to originating player/team/event

**waiver_wire**
- DFA'd players with claim state machine, claim_window_games_remaining, claim order by reverse standings

---

## API Endpoints

### Simulation Control
- `POST /api/league/new` — generate new league, 20 teams, player pool, begin expansion draft
- `GET /api/state` — full current state snapshot (league phase, standings, active sim status, waiverCount)
- `POST /api/sim/speed` — body: `{ speed: "paused" | "normal" | "fast" | "turbo" }`
- `POST /api/sim/advance` — manually advance one game (when paused)

### League Data
- `GET /api/standings` — full standings with W/L/GB/RS/RA/run diff
- `GET /api/teams` — all 20 teams summary
- `GET /api/teams/:id` — full team detail: roster, minors, front office, financials, history
- `GET /api/teams/:id/roster` — 25-man + 40-man roster with stats
- `GET /api/teams/:id/minors` — full minor league org by level with live synthesized stats
- `GET /api/games/recent` — last 20 game results with box scores
- `GET /api/games/:id` — single game box score + notable events
- `GET /api/transactions` — recent 50 transactions across league (no type filter — use /api/news for filtered views)
- `GET /api/draft/current` — current draft board, picks made, on-the-clock team
- `GET /api/waivers` — current waiver wire. 200 + array; [] when empty (never 404)
- `GET /api/news` — news feed. Supports `?type=<token>` filter with lowercase tokens only: transactions, frontoffice, injuries, milestones. Non-allowlisted tokens → 400 `{"error":"Invalid event type filter"}`. Note: filter tokens are lowercase — badge labels (INJURY, MILESTONE) are display only.

### Players
- `GET /api/players/leaders` — stat leaders: AVG, HR, RBI, ERA, SO, WHIP
- `GET /api/players/:id` — full player card: ratings, contract, career stats, transaction history
- `GET /api/players/:id/transactions` — full transaction history for a player

### Timeline
- `GET /api/timeline` — all seasons completed, with narrative, champion, award winners, notable events

> **Note:** `GET /api/league` is not implemented. League info is available via `GET /api/state` (leagueId field).

---

## Frontend Views

### Tab: League
- Live standings table (`data-testid="league-standings-table"`): Rank, Team, W, L, PCT, GB, RS, RA, Diff, Last 10, Streak
- Standings update in real time as games sim
- Sim speed control: ⏸ Pause / ▶ Normal / ⏩ Fast / ⚡ Turbo
- Game ticker: scrolling feed of results as they complete
- Current date / game number indicator
- Live news ticker visible on all tabs during active sim

### Tab: Teams
- Grid of all 20 teams with logo placeholder, record, market size indicator
- Click team → Team Detail view (`data-testid="team-detail-panel"`):
  - Header: team name, record, payroll, market
  - Front Office panel: GM / Manager / Coaches with tenure and personality tags. Note: Owner info not currently rendered in UI — v0.3.0 scope item.
  - Roster tab (`data-testid="team-roster-tab"`): 25-man active, sortable by position/stats. Note: individual roster player testids not present — roster renders as text inside team-detail-panel.
  - Minors tab (`data-testid="team-minors-tab"`): AAA / AA / A / Rookie with live stats
  - Financials tab (`data-testid="team-financials-tab"`): revenue, payroll, budget remaining, luxury tax
  - History tab (`data-testid="team-history-tab"`): season-by-season record, playoff appearances, championships

### Tab: Games
- Recent results feed with box score modal on click
- Today's games (if season active): matchups with probable starters

### Tab: Draft
- Active during expansion draft and annual draft phases
- Draft board: round/pick grid
- On-the-clock team highlighted with GM personality shown
- Pick reveal animation with player card
- LLM reasoning shown on ~20 sampled picks: "The [Team] GM, known for analytics, targets upside here..."

### Tab: Players
- Stat leaders leaderboard (toggle: hitting / pitching)
- Search by name
- Player card modal: bio, ratings bars, contract, season stats, career stats

### Tab: News
- Full chronological news feed, most recent at top
- Event type badge per item: GAME / ROSTER / TRANSACTION / FRONT OFFICE / INJURY / MILESTONE
- Filter bar: All / Transactions / Front Office / Injuries / Milestones
- Filter tokens are lowercase (transactions, frontoffice, injuries, milestones)
- Click item: expands to full detail
- Game result items show score only — no LLM headline

### Tab: Timeline
- Vertical season-by-season timeline (most recent at top)
- Each season card: Champion, MVP, Cy Young, notable transactions, LLM narrative paragraph
- Expandable to full season detail
- Dynasty arcs highlighted: teams that win multiple titles, great players' careers

---

## Simulation Engine Details

### Tick Loop
- Server runs a tick loop via setImmediate (never blocks event loop)
- Each tick = one game
- Speed settings:
  - Paused: no ticks
  - Normal: 1 game per 800ms (watchable)
  - Fast: 1 game per 100ms
  - Turbo: sim entire remaining season in one burst, then pause
- All firing checks, waiver windows, call-up evaluations run correctly in turbo — never skipped

### Season Phases (in order)
1. **Expansion Draft** (season 1 only) — 30 rounds, 20 teams, procedural GM picks with ~20 LLM flavor strings sampled
2. **Annual Draft** (every season after) — 30 rounds, reverse standings order
3. **Spring Training Cuts** — each team trims to 25-man; released players go straight to free agents (not waivers)
4. **Free Agency** — top 50 free agents, teams bid based on need + budget + GM archetype (fully procedural)
5. **Regular Season** — 50 games, all 20 teams, round-robin scheduling
6. **Trade Deadline** — game 30-40 window, procedural buy/sell logic driven by standings + GM archetype
7. **Playoffs** — bracket, best-of series
8. **Offseason** — contracts expire, arbitration, option decisions, front office changes

### GM Archetypes
**Analytics:** Aggressively targets waivers, trades veterans early, non-tenders expensive players, drafts for upside.
**Old-School:** Claims veterans on waivers, loyal to veterans, drafts for current rating, pays market rate in FA.
**Balanced:** Middle ground on all decisions.

### Live Minor League System
- **DFA:** When 40-man space needed mid-season; 3-game waiver window before free agency
- **Waiver wire:** Reverse standings claim order; 3-game window; unclaimed → free agent
- **Call-ups:** Evaluated every 5 games; triggered by injury, poor performance, or prospect outperforming MLB incumbent
- **Send-downs:** Triggered by poor performance; player must have option or is DFA'd instead
- **Service time:** 172 games = 1 year; 6 years = FA eligible; analytics GMs manipulate for potential A/B prospects only
- **Prospect development:** Runs every 10 games (not just offseason); ages 18-25 in AA/A/Rookie
- **Bust mechanic:** Age 26+ still in AA with potential C/D → potential locked at D, overall capped at 65

### In-Season Firing Logic
```
firing_threshold = base_games_under_500 (8)
  × owner_patience_modifier (meddling:0.6, win-now:0.8, patient:1.5, hands-off:2.0)
  × gm_aggression_modifier  (aggressive:0.75, moderate:1.0, conservative:1.2) [manager firings only]
```
- **Owner fires GM:** Every 10 games. Owner modifier only.
- **GM fires manager:** Every 5 games. Both modifiers. Only when owner is NOT meddling.
- **Meddling owner fires manager:** Bypasses GM directly. Low threshold.
- **Non-meddling owner fires manager:** Very high threshold (2.5× base). Triggers "owner breaks glass" news event; GM job_security -= 2.
- **Interims:** Cannot be fired mid-season. Bench coach becomes interim manager. Most senior scout becomes interim GM.

### Front Office Instability (offseason)
- Owner patience erodes on losing seasons
- Owner death (0.5% chance, older owners higher risk): new name + new randomized personality
- Owner sale (2% chance if low net worth): new name + new randomized personality
- Permanent GM/manager hires happen in offseason after interim stints

### Player Development (offseason)
- Age increments
- Players 28-32: stable, minor fluctuations
- Players 33+: decline risk per season (speed first, then contact/velocity)
- Potential revealed at age 25 if still in system
- Injuries: 5% chance per season of significant injury (15-45 game IL)

---

## Production Server Launch

```
npm run build   # builds to dist/
npm start       # → node dist/server/server/index.js
```
Note: nested `server/server/` path is a tsc output artifact, not a typo.
Migrations live at `dist/server/server/migrations/` (8 SQL files, 001–008).
Server self-heals a migration-pending DB on boot.

---

## Known Deferred Items (v0.3.0)

| ID | Description |
|---|---|
| AB-18 | Same-tick send-down/recall churn burns an option and emits redundant news pair. Bounded, non-looping, roster integrity holds. |
| AB-17 | send_down test assertion gameable by spring cuts (no game_number discriminator). Real gates are sound. |
| NB-2/CB-2 | Write-time raw-name scrub deferred. Non-exploitable under fixed name pool, single-user local threat model. |
| Trade-path | is_on_25man not cleared at write time; self-healed every tick by checkRosterInvariant. |
| UI | Owner name + personality not rendered in team detail panel. |

---

## Version History

| Version | Description |
|---|---|
| v0.1.0 | World gen, expansion draft, full season sim, standings UI, team drilldown, draft room, basic timeline |
| v0.2.0 | Live minor league system (DFA, waivers, call-ups, send-downs, service time), market dynamics, GM archetypes, in-season firings, news feed, LLM restructured to narrator-only |

---

## Roadmap

| Version | Feature |
|---|---|
| v0.3.0 | Aquarium mode: pick a team to own, animated ballpark/city/front office visuals, time-lapse turbo view, owner nudge mechanic, newspaper dynasty timeline |
| v0.4.0 | International draft, rule 5 draft, minor league free agency |
| v0.5.0 | Stadium upgrades, revenue model depth, ownership drama |
| v1.0.0 | 10-season dynasty playthrough, exportable history, shareable recaps |
