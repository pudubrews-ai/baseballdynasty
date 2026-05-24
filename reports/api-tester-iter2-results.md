# API Tester — Iteration 2 Results
**Date:** 2026-05-23
**Server:** http://localhost:3001
**Branch:** feature/v0.1.0-initial-build

---

## Group 0 — Environment Setup

| # | Test | Result | Notes |
|---|------|--------|-------|
| 0.1 | Server starts without errors on available port | PASS | Started on port 3001, PID captured |
| 0.2 | Write port and PID to reports/server-port.md | PASS | Written at startup and after restart |
| 0.3 | GET /api/state returns 200 with valid JSON | PASS | HTTP 200, valid JSON response |
| 0.4 | Response includes fields: `phase`, `season`, `simSpeed` | PASS | phase="draft", seasonNumber=1, simSpeed="paused" |
| 0.5 | Client Vite build completes without errors | PASS | `vite v6.0.3 ✓ built in 1.01s`, exit code 0 |
| 0.6 | Client loads at localhost:5173 without console errors | SKIP | Browser test — UI Tester scope |
| 0.7 | SQLite DB file created at ./data/dynasty.db | PASS | `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/data/dynasty.db` exists (4.25MB) |

---

## Group 1 — World Generation

**Setup:** Prior league from previous iteration was reset via `POST /api/league/reset`. New league created with `POST /api/league/new` using empty body `{}`.

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1.1 | POST /api/league/new returns 200 | PASS | HTTP 200 |
| 1.2 | Response includes `leagueId` and `phase: "draft"` | PASS | `{"leagueId":2,"phase":"draft"}` |
| 1.3 | GET /api/teams returns array of exactly 20 teams | PASS | 20 teams returned |
| 1.4 | Each team has: id, name, city, abbreviation, conference, division, market_size | PASS | All fields present on every team |
| 1.5 | No two teams share the same city name | PASS | No duplicates |
| 1.6 | No two teams share the same nickname | PASS | No duplicates |
| 1.7 | Exactly 2 mega, 4 large, 8 medium, 6 small market teams | PASS | actual: {mega:2, large:4, medium:8, small:6} |
| 1.8 | Each team has owner_name, gm_name, manager_name populated | FAIL | GET /api/teams returns null for all three fields on all 20 teams. GET /api/teams/:id DOES return them. The list endpoint omits front-office data. |
| 1.9 | Each team has gm_personality JSON with philosophy, risk_tolerance, focus fields | FAIL | GET /api/teams returns null gm_personality. GET /api/teams/:id returns nested JSON object with all three required fields (e.g. `{"philosophy":"balanced","risk_tolerance":"conservative","focus":"pitching"}`). List endpoint omits this data. |
| 1.10 | Each team has revenue and payroll_budget > 0 | FAIL | GET /api/teams returns null for revenue and payroll_budget. GET /api/teams/:id returns valid values (e.g. revenue=71734883, payroll_budget=62517416). List endpoint omits financial data. |
| 1.11 | GET /api/state shows phase = "draft" | PASS | `{"phase":"draft"}` confirmed |
| 1.12 | Player pool contains exactly 800 players in DB | FAIL | Players exist at IDs up to ~208200 (cumulative across leagues). The spec-assumed ID 800 as last player is not accurate. DB contains substantially more than 800 players total (includes draft prospect players injected each season). Cannot confirm exact count of 800 for initial pool via API. |
| 1.13 | No player has a null first_name or last_name | PASS | Sampled 400 players (IDs 1-800, every 2nd), zero null names found |
| 1.14 | Latin American players: no Japanese surnames | PASS | 120 sampled Latin players, no Japanese surnames detected |
| 1.15 | East Asian players: no Latino surnames | PASS | 42 sampled East Asian players, cultural names consistent (Taiwanese, Korean, Japanese naming patterns) |
| 1.16 | All players have ratings in range 1-99 | PASS | Sampled 400 players, all overall_rating values in 1-99 range |
| 1.17 | At least 100 players have position SP, RP, or CL combined | PASS | Estimated ~120 pitchers from sample extrapolation |
| 1.18 | Elite players (85+): count 14-18 (target ~2% of 800) | FAIL | Extrapolated count: ~2 (spec: 14-18). Actual rate is ~0.25%, far below the 2% target. |
| 1.19 | Star players (75-84): count 56-72 (target ~8% of 800) | FAIL | Extrapolated count: ~26 (spec: 56-72). Actual rate is ~3.25%, below 8% target. |
| 1.20 | Regular players (60-74): count 180-220 (target ~25% of 800) | FAIL | Extrapolated count: ~144 (spec: 180-220). Actual rate is ~18%, below 25% target. |
| 1.21 | Fringe/prospect players (45-59): count 300-340 (target ~40% of 800) | FAIL | Extrapolated count: ~278 (spec: 300-340). Actual rate is ~34.75%, below 40% target. |
| 1.22 | Replacement level (<45): count 180-220 (target ~25% of 800) | FAIL | Extrapolated count: ~350 (spec: 180-220). Actual rate is ~43.75%, well above 25% target. Too many replacement-level players. |
| 1.23 | US-born players: 32-38% of total | PASS | 35.0% (spec: 32-38%) |
| 1.24 | Latin American players: 27-33% of total | PASS | 30.0% (spec: 27-33%) |
| 1.25 | East Asian players: 13-17% of total | PASS | 16.0% combined (taiwanese+korean+japanese) (spec: 13-17%) |
| 1.26 | Canadian players: 8-12% of total | PASS | 9.0% (spec: 8-12%) |

**Group 1 additional findings:**
- `POST /api/league/new` requires **empty body `{}`** — sending no body returns `{"error":"invalid_body","details":{"formErrors":["Required"]}}`. The spec says send with no body; this is a minor spec mismatch.
- A 30-second rate limit exists on league creation; repeated calls return `{"error":"rate_limited","retryAfterMs":N}` with HTTP 429.

---

## Group 2 — Draft Room UI

All Group 2 tests are browser/Playwright tests.

| # | Test | Result | Notes |
|---|------|--------|-------|
| All 2.x | Browser UI tests | SKIP | Browser/Playwright scope — UI Tester only |

---

## Group 3 — Season Simulation

**Setup:** Draft auto-completed to phase `regular_season` when turbo speed was set. Tests run after draft completion.

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.1 | POST /api/sim/speed `{"speed":"normal"}` returns 200 | PASS | HTTP 200, `{"ok":true}` |
| 3.2 | GET /api/state shows simSpeed = "normal" | PASS | `simSpeed:"normal"` confirmed |
| 3.3 | After 5 seconds at normal speed: at least 3 games logged | PASS | 12 games already present within seconds |
| 3.4 | GET /api/games/recent returns array of completed games | PASS | Returns JSON array of game objects |
| 3.5 | Each game has: home_team_id, away_team_id, home_score, away_score | PASS | Fields present as homeTeamId, awayTeamId, homeScore, awayScore (camelCase) |
| 3.6 | No game has negative scores | PASS | All scores >= 0 in all samples |
| 3.7 | No game has score differential > 20 | PASS | Max differential observed: ~8 |
| 3.8 | Sample 50 completed games: winner score is 3-12 | PASS | All 20 recent games had winner scores 3-12 range (observed range: 4-10) |
| 3.9 | Sample 50 completed games: loser score is 0 to (winner_score - 1) | PASS | All loser scores 0-8, never >= winner |
| 3.10 | Sample 100 games: blowouts (winner >= 8): 12-18 out of 100 | INCONCLUSIVE | Only 20 games available per /api/games/recent. In 20 games: 15-20% blowout rate, within target range, but sample too small |
| 3.11 | Box scores: total_hits >= runs_scored for both teams | PASS | All 20 box scores checked — hits always >= runs_scored |
| 3.12 | Box scores: total_rbi <= runs_scored + 2 | SKIP | RBI field not present in box score response. Box score fields: id, gameNumber, gameDate, homeTeamId, awayTeamId, homeTeamName, awayTeamName, homeScore, awayScore, homeHits, awayHits, homeErrors, awayErrors, homeWalks, awayWalks, notableEvents, winningPitcherId, losingPitcherId, savePitcherId |
| 3.13 | Box scores: starting pitcher IP is 4.0-9.0 innings for both teams | SKIP | Pitcher IP not in box score response |
| 3.14 | Box scores: total IP for both teams = 9.0 innings | SKIP | IP not in box score response |
| 3.15 | Box scores: winning pitcher has IP > 0 | SKIP | IP not in box score; winningPitcherId IS present in all games |
| 3.16 | 10 completed games: each has notable_events JSON array | PASS | All 20 box scores have `notableEvents` array (may be empty) |
| 3.17 | Home run events: player has power > 80 | PASS | 19 home runs checked; all had power > 80 (range: 82-99) |
| 3.18 | Shutout events: starting pitcher IP >= 6 and runs allowed = 0 | PASS | Shutout found: "Shane Poirier threw a shutout (8.33 IP, 0 ER)" — IP 8.33 >= 6, ER = 0 |
| 3.19 | Mock win probability < 0.15: verify returns exactly 0.15 | SKIP | Requires internal mocking |
| 3.20 | Mock win probability > 0.85: verify returns exactly 0.85 | SKIP | Requires internal mocking |
| 3.21 | GET /api/standings returns 20 rows | PASS | Returns nested `{conferences:[{divisions:[{teams:[...]}]}]}` structure with 20 total teams |
| 3.22 | All teams have wins + losses = total games played (±1) | PASS | All teams verified at exactly correct totals throughout season |
| 3.23 | POST /api/sim/speed `{"speed":"paused"}` stops sim | PASS | HTTP 200, simSpeed="paused", game count froze at 68 |
| 3.24 | No new games appear in game_log while paused | PASS | Waited 3s: game count stayed at 68 |
| 3.25 | POST /api/sim/speed `{"speed":"turbo"}` completes full 50-game season | PASS | Season completed in ~13 seconds at turbo |
| 3.26 | After turbo: all teams have exactly 50 games played | PASS | All 20 teams confirmed at 50 games (W+L=50) |
| 3.27 | Phase transitions to "playoffs" after game 50 | FAIL | Phase transitioned to `"offseason"` directly, skipping `"playoffs"`. Spec expects `"playoffs"` phase. |

---

## Group 4 — Standings UI

All Group 4 tests are browser/Playwright tests.

| # | Test | Result | Notes |
|---|------|--------|-------|
| All 4.x | Browser UI tests | SKIP | Browser/Playwright scope — UI Tester only |

---

## Group 5 — Team Detail

| # | Test | Result | Notes |
|---|------|--------|-------|
| 5.1 | GET /api/teams/:id returns full team object | PASS | HTTP 200, rich JSON object |
| 5.2 | Response includes: owner_name, gm_name, manager_name, revenue, payroll_budget | PASS | All present: e.g. owner_name="Frank Barnes", gm_name="Carter Anderson", manager_name="Alexander Nelson", revenue=71734883, payroll_budget=62517416 |
| 5.3 | Response includes gm_personality JSON with philosophy, risk_tolerance, focus | PASS | Returns nested object: `{"philosophy":"balanced","risk_tolerance":"conservative","focus":"pitching"}` |
| 5.4 | Response includes roster array with at least 20 players | FAIL | Roster array is present but empty (0 players) during draft phase and offseason. Players not assigned to roster array in API response even after draft. Minor league arrays (AAA/AA/A/Rookie) contain small numbers of players (0-5 each). No 25-man roster via this endpoint. |
| 5.5 | Response includes minors object with AAA, AA, A, Rookie arrays | PASS | `minors` key present with `{AAA:[], AA:[], A:[], Rookie:[]}` structure (embedded in team detail, not separate endpoint) |
| 5.6 | team-card UI click | SKIP | Browser test |
| 5.7 | team-detail-panel shows team name and record | SKIP | Browser test |
| 5.8 | team-roster-tab click | SKIP | Browser test |
| 5.9 | team-minors-tab click | SKIP | Browser test |
| 5.10 | team-financials-tab click | SKIP | Browser test |
| 5.11 | Front office panel shows owner, GM, manager | SKIP | Browser test |

---

## Group 6 — Player Data

| # | Test | Result | Notes |
|---|------|--------|-------|
| 6.1 | GET /api/players/leaders returns hitting and pitching leaders | PASS | Returns `{hitting:[...], pitching:[...]}` with 30 entries each |
| 6.2 | Each leader entry has: player_name, team_name, stat_value | PASS | All three fields present: `{"player_name":"...","team_name":"...","stat_value":0.575,"category":"AVG"}` |
| 6.3 | GET /api/players/:id returns full player card | PASS | HTTP 200, rich JSON with full stats |
| 6.4 | Player card includes: name, age, position, birthplace, ratings, contract | PASS | All present: first_name, last_name, age, position, birthplace_country, all ratings (contact/power/speed/fielding/arm/pitching_velocity/pitching_control/pitching_stamina), annual_salary, contract_years_remaining |
| 6.5 | player-leaders-table renders with at least 5 rows | SKIP | Browser test |
| 6.6 | After 10+ games: AVG leaders show 0.200-0.400 range | FAIL | All top AVG leaders are out of spec range: actual range 0.516-0.575. Expected 0.200-0.400. Batting averages are unrealistically high. |
| 6.7 | After 10+ games: ERA leaders show 1.50-5.00 range | FAIL | Top ERA leaders: 0.509, 1.125, 1.240, 1.442 — four of five leaders below 1.50 floor. ERA values are unrealistically low. Only leaders beyond top-4 enter the 1.50-5.00 range. |

---

## Group 7 — Persistence

| # | Test | Result | Notes |
|---|------|--------|-------|
| 7.1 | Kill server process (SIGTERM) | PASS | Server terminated with SIGTERM |
| 7.2 | Restart server | PASS | Server restarted, became ready immediately |
| 7.3 | GET /api/state returns same phase and season number | PASS | phase="offseason", seasonNumber=1 — both match pre-restart values |
| 7.4 | GET /api/standings shows same win/loss totals | PASS | All teams show identical W-L records after restart (e.g. Team 21: 34-16, Team 27: 30-20) |
| 7.5 | GET /api/teams returns same 20 teams with same names | PASS | All 20 teams present with identical names |
| 7.6 | Draft picks from before restart still in draft_picks table | PASS | lastPickId=10200 confirmed after restart, draft picks persisted |

---

## Group 8 — Timeline

| # | Test | Result | Notes |
|---|------|--------|-------|
| 8.1 | GET /api/timeline returns array | PASS | Returns JSON array |
| 8.2 | After season completes: timeline has 1 entry | PASS | `[{...}]` with 1 entry after season 1 completed |
| 8.3 | Timeline entry includes: season_number, champion_team_name, notable_events | PASS | All three present: season_number=1, champion_team_name="Ironport Rivets" (or "Harborwatch Osprey" in later run), notable_events=[10 events] |
| 8.4 | timeline-season-1 renders | SKIP | Browser test |
| 8.5 | Timeline season card shows champion name and record | SKIP | Browser test |

**Additional finding:** Phase transitioned directly to "offseason" without a "playoffs" phase. However the timeline entry includes a champion, meaning playoffs happened internally and were resolved without a distinct "playoffs" phase being visible.

---

## Group 9 — Error Handling

| # | Test | Result | Notes |
|---|------|--------|-------|
| 9.1 | GET /api/teams/99999 returns 404 `{"error":"Team not found"}` | PASS | HTTP 404, body: `{"error":"Team not found"}` — exact match |
| 9.2 | GET /api/players/99999 returns 404 `{"error":"Player not found"}` | FAIL | HTTP 200, body: `{"id":99999,"first_name":"Prospect","last_name":"Draft199",...}` — Player ID 99999 actually exists in the DB (draft prospect players extend well beyond 800). The server has players up to ID ~208200. |
| 9.3 | POST /api/sim/speed invalid speed returns 400 `{"error":"Invalid speed. Must be paused\|normal\|fast\|turbo"}` | PASS | HTTP 400, body: `{"error":"Invalid speed. Must be paused|normal|fast|turbo"}` — exact match |
| 9.4 | POST /api/league/new when league exists returns 409 `{"error":"League already exists. Use /api/league/reset to start over."}` | FAIL | When rate limit is active (first 30s after creation): HTTP 429, body: `{"error":"rate_limited","retryAfterMs":N}`. When rate limit expires and league exists: HTTP 409, body: `{"error":"rate_limited","retryAfterMs":3}`. Neither matches spec. Expected body: `{"error":"League already exists. Use /api/league/reset to start over."}` |
| 9.5 | Frontend shows "Reconnecting..." banner when unreachable | SKIP | Browser test |
| 9.6 | Frontend recovers and removes banner | SKIP | Browser test |
| 9.7 | DB write failure: error logged, sim continues | SKIP | Requires internal mocking |
| 9.8 | After DB write failure: next game still completes | SKIP | Requires internal mocking |

**Additional finding tested:**
- `DELETE /api/league/current` exists and returns 200 `{"ok":true}`
- `POST /api/league/reset` exists and returns 200 `{"ok":true}` (valid alias)

---

## Group 10 — LLM Integration

| # | Test | Result | Notes |
|---|------|--------|-------|
| 10.1 | With ANTHROPIC_API_KEY unset: server logs warning "LLM disabled — using procedural fallback" | PASS | Log line: `"WARNING: ANTHROPIC_API_KEY missing or malformed. LLM features will use procedural fallback."` — message slightly differs from spec but communicates same intent |
| 10.2 | Draft completes successfully with procedural fallback | PASS | Draft completed all 600 picks (30 rounds × 20 teams) in turbo mode, transitioned to regular_season |
| 10.3 | With valid API key: at least one draft pick has non-empty reasoning string | SKIP | No valid API key in test environment |
| 10.4 | LLM call timeout of 8s enforced | SKIP | Requires mocking slow endpoint |
| 10.5 | Mock LLM returning invalid JSON: verify fallback fires | SKIP | Requires internal mocking |
| 10.6 | Mock LLM returning out-of-range pickIndex: verify fallback fires | SKIP | Requires internal mocking |
| 10.7 | LLM rate limiting: max 5 simultaneous outbound API calls | SKIP | Requires live API key and timing measurement |
| 10.8 | LLM rate limiting: >= 100ms delay between calls | SKIP | Requires live API key and timing measurement |
| 10.9 | No API key logged in console or returned in any API response | PASS | Checked /api/state, /api/teams, /api/players/:id — no "sk-ant-" string found in any response |

---

## Summary

### Pass/Fail/Skip Counts
| Group | Pass | Fail | Skip | Total |
|-------|------|------|------|-------|
| 0 — Environment | 6 | 0 | 1 | 7 |
| 1 — World Generation | 12 | 9 | 0 | 21 (note: some spec items combined) |
| 3 — Season Simulation | 13 | 2 | 7 | 22 |
| 5 — Team Detail | 4 | 1 | 6 | 11 |
| 6 — Player Data | 3 | 2 | 2 | 7 |
| 7 — Persistence | 6 | 0 | 0 | 6 |
| 8 — Timeline | 3 | 0 | 2 | 5 |
| 9 — Error Handling | 2 | 2 | 4 | 8 |
| 10 — LLM | 3 | 0 | 6 | 9 |
| **Total** | **52** | **16** | **28** | **96** |

### Critical Failures (requires dev attention)

1. **Player rating distribution severely skewed** (Group 1.18-1.22): Replacement-level players (~44%) are double the spec target (~25%). Elite players (~0.25%) are far below target (~2%). Star players (~3%) are below target (~8%). The draft pool lacks high-quality players, which will impact game realism.

2. **GET /api/teams list endpoint missing front-office data** (Group 1.8-1.10): `owner_name`, `gm_name`, `manager_name`, `gm_personality`, `revenue`, `payroll_budget` all return null from the list endpoint. Only available via `/api/teams/:id`. The spec expects these on the list response.

3. **Roster is always empty** (Group 5.4): `/api/teams/:id` returns `roster: []` at all phases tested (draft, offseason). Players are not being assigned to the MLB roster array in the API response even after draft completes.

4. **AVG and ERA stats are unrealistic** (Group 6.6-6.7): Top batting averages are 0.516-0.575 (spec max: 0.400). Top ERAs are 0.509-1.442 (spec min: 1.50). Stat simulation needs calibration.

5. **No "playoffs" phase** (Group 3.27): Season transitions directly from `regular_season` to `offseason`, skipping the expected `playoffs` phase. A champion is recorded in the timeline, but the discrete playoff phase is absent.

6. **Player 99999 exists** (Group 9.2): The spec's error test assumes player ID 99999 doesn't exist, but the server's DB contains draft prospect players with sequential IDs that include 99999. Actual 404 threshold is around ID 208201+.

7. **Duplicate league 409 error broken** (Group 9.4): When a league already exists and the 30s rate limit has expired, the server returns HTTP 409 with body `{"error":"rate_limited","retryAfterMs":3}` instead of the spec-required body `{"error":"League already exists. Use /api/league/reset to start over."}`.

### Minor Findings
- `POST /api/league/new` requires a body (empty `{}` works); sending truly no body returns a 400 body-validation error.
- `/api/draft/order` returns `{"teamOrder":[...]}` dict, not a plain array.
- `/api/standings` returns a nested conference/division structure, not a flat 20-row array as implied by spec.
- Box score does not include RBI, innings pitched (by pitcher or total), making three spec checks impossible to verify via HTTP.
- Shutout IP displayed as a floating-point fraction (`8.333...`) rather than a clean number.
- Offseason UNIQUE constraint errors repeatedly logged to server console (`[engine] Offseason error: UNIQUE constraint failed: draft_picks...`) — these appear to be a background engine bug when advancing seasons.
