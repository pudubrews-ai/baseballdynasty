# app-spec.md
# Baseball Dynasty Simulator

**Version:** v0.1.0
**Status:** Pre-build

---

## Project Overview

A fully simulated baseball dynasty engine. 20 procedurally generated teams, each with a complete organization: owner, GM, manager, coaching staff, 40-man roster, and a full minor league system (AAA/AA/A/Rookie). The simulation runs continuous 50-game seasons from an expansion draft day forward with no predetermined end. Front office personalities drive decisions via Claude Haiku. The UI shows the league unfolding in real time with standings, stats, org drilldowns, and a season-by-season dynasty timeline.

**Repository:** https://github.com/pudubrews-ai/baseballdynasty
**Local dev URL:** http://localhost:3001

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| Frontend | Vite + React + Tailwind CSS |
| AI | Claude Haiku (claude-haiku-4-5-20251001) via Anthropic SDK |
| Sim Engine | Pure TypeScript, server-side, tick-based |
| State sync | Frontend polls GET /api/state every 2s during active sim |

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
- **GM** — name, philosophy (analytics/old-school/balanced), aggression (conservative/moderate/aggressive), tenure
- **Manager** — name, style (small-ball/power/balanced), tenure, job security rating
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
- **Health** — injury prone rating, current health status
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

No pitch-by-pitch simulation in v0.1.0 — game resolves to box score in one pass.

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
- gm_name, gm_philosophy, gm_aggression
- manager_name, manager_style, manager_job_security (1-10)
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

---

## API Endpoints

### Simulation Control
- `POST /api/league/new` — generate new league, 20 teams, player pool, begin expansion draft
- `GET /api/state` — full current state snapshot (league phase, standings, active sim status)
- `POST /api/sim/speed` — body: `{ speed: "paused" | "normal" | "fast" | "turbo" }`
- `POST /api/sim/advance` — manually advance one game (when paused)

### League Data
- `GET /api/league` — league info, current season, phase
- `GET /api/standings` — full standings with W/L/GB/RS/RA/run diff
- `GET /api/teams` — all 20 teams summary
- `GET /api/teams/:id` — full team detail: roster, minors, front office, financials, history
- `GET /api/teams/:id/roster` — 25-man + 40-man roster with stats
- `GET /api/teams/:id/minors` — full minor league org by level
- `GET /api/games/recent` — last 20 game results with box scores
- `GET /api/games/:id` — single game box score + notable events
- `GET /api/transactions` — recent 50 transactions across league
- `GET /api/draft/current` — current draft board, picks made, on-the-clock team

### Players
- `GET /api/players/leaders` — stat leaders: AVG, HR, RBI, ERA, SO, WHIP
- `GET /api/players/:id` — full player card: ratings, contract, career stats, transaction history

### Timeline
- `GET /api/timeline` — all seasons completed, with narrative, champion, award winners, notable events

---

## Frontend Views

### Tab: League
- Live standings table: Rank, Team, W, L, PCT, GB, RS, RA, Diff, Last 10, Streak
- Standings update in real time as games sim
- Sim speed control: ⏸ Pause / ▶ Normal / ⏩ Fast / ⚡ Turbo
- Game ticker: scrolling feed of results as they complete
- Current date / game number indicator

### Tab: Teams
- Grid of all 20 teams with logo placeholder, record, market size indicator
- Click team → Team Detail view:
  - Header: team name, record, payroll, market
  - Front Office panel: Owner / GM / Manager / Coaches with tenure and personality tags
  - Roster tab: 25-man active, sortable by position/stats
  - Minors tab: AAA / AA / A / Rookie depth chart
  - Financials tab: revenue, payroll, budget remaining, luxury tax
  - History tab: season-by-season record, playoff appearances, championships

### Tab: Games
- Recent results feed with box score modal on click
- Today's games (if season active): matchups with probable starters

### Tab: Draft
- Active during expansion draft and annual draft phases
- Draft board: round/pick grid
- On-the-clock team highlighted with GM personality shown
- Pick reveal animation with player card
- LLM reasoning shown inline: "The [Team] GM, known for analytics, targets upside here..."

### Tab: Players
- Stat leaders leaderboard (toggle: hitting / pitching)
- Search by name
- Player card modal: bio, ratings bars, contract, season stats, career stats

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

### Season Phases (in order)
1. **Expansion Draft** (season 1 only) — 30 rounds, 20 teams, LLM GM picks
2. **Annual Draft** (every season after) — 30 rounds, reverse standings order, LLM GM picks
3. **Free Agency** — top 50 free agents, teams bid based on need + budget + GM personality
4. **Regular Season** — 50 games, all 20 teams, round-robin scheduling
5. **Trade Deadline** — at game 35, contenders buy, rebuilders sell, LLM negotiates
6. **Playoffs** — bracket, best-of series
7. **Offseason** — contracts expire, arbitration, option decisions, front office changes

### LLM Decision Points (Claude Haiku)
All calls go server-side through `/services/llm.ts`.

**Draft picks** — prompt includes: team needs by position, GM philosophy, available player pool top 10, previous picks. Returns: player index 0-9 + one-sentence reasoning. ~600 calls on expansion draft day.

**Trade proposals** — prompt includes: both teams' needs, available assets, standings context. Returns: structured trade offer JSON + reasoning sentence. ~40 calls per season.

**Free agent bids** — prompt includes: player profile, team need, budget remaining, other known interest. Returns: offer years + salary + reasoning. ~60 calls per offseason.

**Front office changes** — prompt includes: team's season record, owner patience rating, GM/manager tenure and results. Returns: decision (keep/fire/resign) + reasoning. ~20 calls per offseason.

**Season narrative** — prompt includes: champion, statistical leaders, major transactions, notable story arcs. Returns: 2-3 paragraph season recap for Timeline tab. 1 call per season.

**Transaction flavor** — short one-liner narrative for each transaction card. Batched: 10 transactions per call.

### Player Development
Each offseason:
- Age increments
- Players 18-27 in low minors: ratings can increase by 1-3 points based on coachability × work_ethic × coaching staff quality
- Players 28-32: stable, minor fluctuations
- Players 33+: decline risk per season (speed first, then contact/velocity)
- Potential revealed at age 25 if still in system
- Injuries: 5% chance per season of significant injury (15-45 game IL)

### Front Office Instability
Each offseason, for every team:
- Owner patience erodes if team loses (patience -= 1 per bad season)
- If manager job_security < 3: 60% chance fired
- If GM results poor and owner meddling: 40% chance fired
- Owner can sell team: 2% chance per season if net worth tier is low
- Owner death: 0.5% chance per season (older owners higher risk) → heir takes over with randomized personality

---

## World Generation (v0.1.0)

On `POST /api/league/new`:

1. Generate 20 city names (made up, geographically distributed across US/Canada/Mexico — no real cities)
2. Assign market size: 2 mega, 4 large, 8 medium, 6 small
3. Generate team name: [City] [Nickname] — nicknames are animals, natural phenomena, or occupational (no real MLB names)
4. Generate team abbreviation (3 letters)
5. Generate owner, GM, manager for each team with randomized personalities
6. Generate player pool: 800 players total
   - Diverse names drawn from US (all regions), Latin America, Caribbean, East Asia, West Africa, Europe
   - Age distribution: 18-35, weighted toward 21-28
   - Ratings distributed realistically: most players 40-60 range, stars 70-85, elite 86-99 (rare)
   - ~15% of pool are pitchers (SP/RP/CL), ~85% position players
7. Begin expansion draft: 20 teams draft in snake order, 30 rounds
   - First 15 rounds: MLB-level players
   - Rounds 16-30: minor league players assigned to org levels

---

## Version History

| Version | Description |
|---|---|
| v0.1.0 | World gen, expansion draft, full season sim, standings UI, team drilldown, draft room, basic timeline |

---

## Roadmap

| Version | Feature |
|---|---|
| v0.2.0 | Trade deadline UI, transaction feed, player search, stat leaders |
| v0.3.0 | Full dynasty timeline with LLM narratives, career arcs, hall of fame |
| v0.4.0 | International draft, rule 5 draft, minor league free agency |
| v0.5.0 | Stadium upgrades, revenue model depth, ownership drama |
| v1.0.0 | 10-season dynasty playthrough, exportable history, shareable recaps |
