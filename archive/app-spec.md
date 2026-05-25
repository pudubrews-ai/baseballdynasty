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
| v0.3.0 | Aquarium mode, animated ballpark/city/front office visuals, franchise selection, owner nudge mechanic, newspaper dynasty timeline, front office reasons (4 locations), v0.2.0 deferred fixes |

---

## Roadmap

| Version | Feature |
|---|---|
| v0.4.0 | International draft, rule 5 draft, minor league free agency |
| v0.5.0 | Stadium upgrades, revenue model depth, ownership drama |
| v1.0.0 | 10-season dynasty playthrough, exportable history, shareable recaps |

# v0.3.0-app-spec-section.md
# Feature: Aquarium Mode, Visual Layer, Owner Nudge, Newspaper Timeline, Front Office Reasons

---

## Scope

v0.3.0 is the "feel alive" release. It adds the Watch tab (aquarium mode), animated visuals, the owner franchise selection and nudge mechanic, a newspaper-style dynasty timeline, surfaces front office change reasons everywhere, and cleans up the four deferred items from v0.2.0.

---

## New Dependencies

```
framer-motion       # animation
@react-spring/web   # physics-based transitions (fallback/supplement)
```

Google Fonts (loaded via index.html):
- **Bebas Neue** — scoreboards, headlines, team names in display contexts
- **Inter** — all data, stats, body text (already likely in use)

All illustrations are SVG-based — inline React components, no external image files.

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
--color-danger:       #ef4444   # losses, negative deltas, firings
--color-warning:      #f59e0b   # caution states
```

Team colors are generated at world gen — each team gets a primary and secondary color assigned from a curated palette of 30 color pairs. No two teams share the same primary.

### Typography
- Display (scoreboards, season headlines): Bebas Neue, tracking wide
- UI labels, nav, badges: Inter 500
- Body, stats, data: Inter 400
- Newspaper headlines: Bebas Neue with slight rotation/texture effect

### Animation Principles
- All transitions: 200-350ms, ease-out
- Scoreboard numbers: split-flap mechanical effect (CSS + Framer Motion)
- Crowd fill: SVG path fill animating upward like water rising
- News ticker: continuous horizontal scroll, pauses on hover
- Sprite emotions: scale + opacity micro-animations, never full character animation
- Turbo mode: everything runs at 8× speed, no skipped frames

---

## Franchise Selection Screen

Shown once, on first launch after world gen completes, before expansion draft begins.

### Layout
- Full screen dark overlay on top of the generated league
- Headline: "Choose Your Franchise" (Bebas Neue, large)
- Subhead: "You won't control them. You'll watch them. Pick wisely."
- Grid of 20 team cards, 4×5 layout

### Team Card
Each card shows:
- Team nickname + city (large)
- Market size badge (MEGA / LARGE / MEDIUM / SMALL)
- Owner name + personality tag (e.g. "Meddling Win-Now Owner")
- GM name + archetype tag (e.g. "Analytics GM")
- One-line flavor: generated at world gen, e.g. "A scrappy small-market org with a patient owner and an analytics GM who loves a bargain."
- Team primary color as card border/accent

Hover: card elevates, shows stadium capacity and payroll budget.
Click: confirmation modal — "Own the [City] [Nickname]? You'll be along for the ride." Confirm → expansion draft begins, your team highlighted throughout.

### data-testid
```
[data-testid="franchise-selection-screen"]
[data-testid="franchise-card-{teamId}"]
[data-testid="franchise-confirm-modal"]
[data-testid="franchise-confirm-button"]
```

---

## Watch Tab (Aquarium Mode)

A full-screen immersive view. No tables, no data grids. Just the world living.

### Layout: Three Zones

**Zone 1 — The Ballpark (center, 60% of screen)**
SVG illustration of a stadium at game time:
- Perspective view from behind home plate looking out
- Crowd sections that fill based on attendance percentage (SVG path animation)
- Scoreboard in left field: home team, away team, score, inning — split-flap animation on changes
- Diamond with baserunner dots (filled circles) showing current base state
- Sky changes: day game (blue), twilight (orange-purple), night game (deep navy with lights)
- Weather indicator: clear / cloudy / overcast (subtle sky texture change)
- Your team's ballpark has a subtle glow/highlight vs visiting parks

When no game is active (offseason, draft): stadium is empty, lights off, peaceful. Scoreboard shows league logo.

**Zone 2 — The Front Office (left panel, 20% of screen)**
Three character sprites stacked vertically: Owner, GM, Manager.
Each sprite is a simple SVG figure (not pixel art — clean flat illustration, think a well-designed iOS game character):
- Suit silhouette for owner, slightly more casual for GM, baseball attire for manager
- Emotion states: Neutral / Happy (team winning) / Anxious (losing streak) / Angry (threshold approaching) / Celebrating (playoff clinch)
- Small name label + role badge beneath each
- When someone gets fired: sprite walks off screen to the right with a small exit animation
- When interim: sprite has "INTERIM" badge, slightly different color

Meddling owner: paces back and forth slowly during games.
Hands-off owner: sits, barely moves.
Aggressive GM: leans forward.
Conservative GM: arms crossed.

**Zone 3 — The City (right panel, 20% of screen)**
SVG skyline illustration of your team's city:
- Small market: modest 4-6 building skyline, water tower, cozy
- Medium market: 8-10 buildings, mix of heights
- Large market: dense skyline, 12+ buildings
- Mega market: towering skyline, landmark building

Dynamic states:
- Winning record: lights on in buildings, warm glow
- Losing record: fewer lit windows, cooler tone
- Playoff clinch: fireworks burst above skyline (Framer Motion SVG animation)
- Offseason: night sky, quiet, snow dusting for winter months

**Bottom Bar — Live Feed**
Scrolling news ticker across full width. LLM one-liners. Pauses on hover to let you read.

### Speed Control in Watch Tab
Same speed buttons as League tab, styled to fit the dark immersive aesthetic.

### Turbo Mode in Watch Tab
Does NOT go blank. Instead:
- Ballpark scoreboard spins rapidly (split-flap blur effect)
- Calendar overlay appears center screen, pages tearing through weeks
- News headlines flash center screen one at a time, 200ms each, like a teletype montage
- Front office sprites animate at 4× speed
- City skyline pulses — buildings light up and dim rapidly as record fluctuates
- When season ends: everything snaps to still, newspaper front page drops in (see Newspaper Timeline)
- After 1.5s on the newspaper: Watch tab resumes in offseason state

### data-testid
```
[data-testid="watch-tab"]
[data-testid="watch-ballpark"]
[data-testid="watch-scoreboard"]
[data-testid="watch-crowd"]
[data-testid="watch-diamond"]
[data-testid="watch-frontoffice-panel"]
[data-testid="watch-owner-sprite"]
[data-testid="watch-gm-sprite"]
[data-testid="watch-manager-sprite"]
[data-testid="watch-city-skyline"]
[data-testid="watch-news-ticker"]
[data-testid="watch-turbo-headline-flash"]
```

---

## Owner Nudge Mechanic

### Overview
Once you've picked your franchise you are the owner. You have five directives you can issue at any time. Each has a cooldown. Overusing nudges degrades your GM's confidence — if confidence hits 0 the GM resigns.

### The Five Directives

**"Go For It"**
- Effect: GM shifts to aggressive buyer at trade deadline; opens checkbook for one FA signing above normal budget ceiling
- Cooldown: once per season
- Confidence cost: 0 (this is your right as owner)
- Best used: when team is 3-5 games back at game 30

**"Start Rebuilding"**
- Effect: GM shifts to seller; top prospects marked untouchable; veterans become available
- Cooldown: once per season
- Confidence cost: 0
- Cannot be issued same season as "Go For It"

**"I Want That Player"**
- Effect: flag any one player as a priority acquisition target — GM will pursue via trade, waiver claim, or FA bid above normal valuation
- Cooldown: twice per season
- Confidence cost: -5 if player not acquired within 10 games (GM tried, couldn't deliver)
- UI: click any player card → "Make This a Priority" button appears

**"This Manager Has Lost Me"**
- Effect: fires manager immediately regardless of record or GM preference
- Cooldown: once per season
- Confidence cost: -10 (you went over your GM's head)
- Triggers "owner breaks glass" news event with reason: "Owner lost confidence in manager"

**"Trust The Process"**
- Effect: locks out all in-season firings for remainder of season; signals patience to org
- Cooldown: once per season
- Confidence cost: 0
- GM confidence +5 (owner showing trust)

### GM Confidence
- Starts at 100 per GM
- Nudges that override GM judgment cost confidence points (see above)
- If team wins: +2 per 5 games above .500
- If team loses badly: -1 per 5 games below .500 (GM is stressed regardless)
- Confidence hits 0: GM resigns end of season. News item: "[GM Name] resigns, citing inability to operate with ownership interference."
- Confidence 80+: GM occasionally sends you a one-line status update in the news feed

### Nudge UI
- Persistent "Owner Directives" panel in Watch tab, bottom-left
- Five buttons, each showing: directive name, cooldown state, last used
- Greyed out when on cooldown or conditions not met
- Confirmation modal on every directive — shows consequence preview
- After issuing: directive appears as news item immediately

### data-testid
```
[data-testid="owner-directives-panel"]
[data-testid="directive-go-for-it"]
[data-testid="directive-rebuild"]
[data-testid="directive-target-player"]
[data-testid="directive-fire-manager"]
[data-testid="directive-trust-process"]
[data-testid="directive-confirm-modal"]
[data-testid="gm-confidence-indicator"]
```

---

## Newspaper Dynasty Timeline

Replaces the text-list Timeline tab with a newspaper front page per season.

### Layout
- Vertical scroll, most recent season at top
- Each season = one newspaper front page
- Page has slight paper texture (CSS: subtle noise filter, warm off-white background)
- Masthead: "[City] [Nickname] Gazette" — or league name if neutral
- Date line: "End of Season [N]"

### Front Page Anatomy
```
┌─────────────────────────────────────────────┐
│  THE VALMORA STORM GAZETTE    Season 4       │
├─────────────────────────────────────────────┤
│  ████ CHAMPIONS ████                        │
│  Storm Win First Title in Franchise History  │  ← LLM headline
│                                             │
│  [Champion team color block]  │  SIDEBAR:   │
│  W-L record                   │  MVP        │
│  Playoff run summary          │  Cy Young   │
│  LLM narrative paragraph      │  Top Prospect│
├─────────────────────────────────────────────┤
│  BELOW THE FOLD                             │
│  "GM Martinez Fired After 4-18 Start"  →    │  ← front office reason shown
│  "Storm Steal Ace on Waivers"          →    │
│  "Prospect Flores Breaks Out"          →    │
└─────────────────────────────────────────────┘
```

### Content Rules
- Champion season: big headline, celebration layout
- Non-champion: lead story is biggest event of the season (firing, trade, breakout)
- Below the fold: 3-4 story teasers, each with a headline and click-to-expand
- All headlines: LLM-generated, batched with season narrative call
- Front office events in below-the-fold always include reason string

### Click to Expand
Click any season card: expands to full broadsheet with:
- Full LLM narrative (2-3 paragraphs)
- Full standings table
- Award winners
- Top 5 transactions with reasons
- Front office changes with reasons

### data-testid
```
[data-testid="timeline-newspaper-{seasonNumber}"]
[data-testid="timeline-headline-{seasonNumber}"]
[data-testid="timeline-expand-{seasonNumber}"]
[data-testid="timeline-frontoffice-reason-{eventId}"]
```

---

## Front Office Change Reasons (4 Locations)

The `reason` field in `front_office_events` must always be populated. Format:

**Firings (procedural):**
- Manager: "Fired after going [W-L] through [N] games (Season [S])"
- GM: "Fired after team went [W-L], [N] games under .500 at time of dismissal"
- Owner override: "Owner lost confidence in manager after [N]-game losing streak"

**Resignations (LLM flavor):**
- One sentence, e.g. "Resigned citing philosophical differences with ownership"

**Death/Sale:**
- Death: "Passed away during Season [S]. Succeeded by [heir name]."
- Sale: "Sold franchise after Season [S]. New ownership group takes control."

### The Four UI Locations

**1. News feed headline**
Format: "[Person] [fired/resigned], [City] [Nickname] — [reason]"
Example: "Dale Pruitt fired, Valmora Storm — fired after going 4-18 through 22 games"

**2. Team detail front office panel**
Current GM/manager shows beneath their name:
- Tenure: "Season 3, Game 22 – present"
- How hired: "Promoted from bench coach after Pruitt firing"
Previous front office members shown in collapsed history section with reason.

**3. Timeline / newspaper below the fold**
Story teaser includes reason inline. Click expands to full detail.

**4. Transaction history (`/api/transactions` and `/api/players/:id/transactions`)**
Front office events appear as transaction rows with reason in the details field. Currently reason is in `front_office_events` only — wire it into the transaction feed display.

---

## Deferred Items from v0.2.0 (fix in v0.3.0)

**AB-18 — Same-tick send-down/recall churn**
Add a cooldown: a player sent down cannot be recalled within the same 5-game evaluation window. Prevents option burn and redundant news pairs.

**AB-17 — send_down test assertion**
Add `game_number` column to transaction log entries for in-season moves so tests can discriminate spring cuts from in-season send-downs.

**Trade-path — is_on_25man write path**
Clean up write path so is_on_25man is set correctly at write time, not just healed by checkRosterInvariant each tick.

**UI — Owner in team detail panel**
Add owner name, personality tag, patience rating, and net worth tier to the front office panel. Previously only GM info was shown.

---

## Updated API

### Modified endpoints
- `GET /api/timeline` — response now includes `newspaper` object per season: headline, lede, below_fold array (each with reason for front office events)
- `GET /api/teams/:id` — front office panel now includes owner fields and full front office history with reasons
- `GET /api/transactions` — front office events surfaced in feed with reason field populated

### New fields on front_office_events
- `reason` — always populated (was nullable, now required)
- `hired_person_context` — how the incoming person got the job ("Promoted from bench coach", "Hired in offseason", "Interim appointment")

---

## Known Edge Cases

- **Player targeted via "I Want That Player" gets injured before acquisition:** directive auto-cancels, no confidence penalty, news item generated
- **"Go For It" issued but team is 15+ games back:** GM acknowledges directive but overrides — too far back to buy. Generates news item: "[GM] declines to buy despite owner directive, team 15 games out." Confidence cost: -5 (GM stood up to owner)
- **"Trust The Process" issued same season as "This Manager Has Lost Me":** "Trust The Process" cannot be issued after firing directive in same season — greyed out
- **GM resigns due to low confidence mid-season:** resignation deferred to end of season (same as other mid-season events). News item fires immediately but GM stays through season end.
- **Franchise selection skipped (no team picked):** sim runs normally, Watch tab shows league-wide view with no "your team" highlight, nudge panel disabled
- **Turbo during newspaper display:** newspaper stays up for full 1.5s even in turbo — do not skip
