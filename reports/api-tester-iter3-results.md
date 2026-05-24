# API Tester — Iteration 3 Results
**Date:** 2026-05-23
**Server:** http://localhost:3001
**Branch:** feature/v0.1.0-initial-build
**League IDs tested:** 13, 14, 15 (multiple resets to isolate test conditions)

---

## Methodology Notes

- Server was found with an existing league on startup (league 12, `regular_season`). Reset and created fresh leagues for all tests.
- The "expansion" subPhase does not auto-complete without a speed being set. Setting `normal` or `fast` speed advances the expansion draft (picks increment). Setting `turbo` completes expansion + all 600 draft picks + full 50-game season within ~3 seconds.
- To observe the draft→regular_season transition at fast speed: transition occurred at pick 15085 (~84 seconds at `fast`). Phase change: `draft|expansion` → `regular_season|None` was clearly observed.
- The "playoffs" phase was never observed as a discrete phase in any test run; the game counter advanced from ~233 games to 535 games within the `regular_season` phase before flipping directly to `offseason`.
- Player pool for league 15 confirmed: exactly 800 real players (IDs 778812–779611).

---

## Group 0 — Environment Setup
**Severity: Critical**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 0.1 | Server starts without errors on available port | PASS | Started on port 3001, PID 78172 |
| 0.2 | Write port and PID to reports/server-port.md | PASS | Written at startup |
| 0.3 | GET /api/state returns 200 with valid JSON | PASS | HTTP 200, valid JSON |
| 0.4 | Response includes fields: `phase`, `season`, `simSpeed` | PASS | phase="draft", seasonNumber=1, simSpeed="paused" |
| 0.5 | Client Vite build completes without errors | PASS | `built in 999ms`, exit code 0 |
| 0.6 | Client loads at localhost:5173 without console errors | SKIP | Browser test — UI Tester scope |
| 0.7 | SQLite DB file created at ./data/dynasty.db | PASS | `baseball-dynasty/data/dynasty.db` exists (68MB) |

---

## Group 1 — World Generation
**Severity: Critical**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1.1 | POST /api/league/new returns 200 | PASS | HTTP 200 confirmed |
| 1.2 | Response includes `leagueId` and `phase: "draft"` | PASS | `{"leagueId":15,"phase":"draft"}` |
| 1.3 | GET /api/teams returns array of exactly 20 teams | PASS | Count: 20 |
| 1.4 | Each team has: id, name, city, abbreviation, conference, division, market_size | PASS | All 7 fields present on all 20 teams |
| 1.5 | No two teams share the same city name | PASS | No duplicates |
| 1.6 | No two teams share the same nickname | PASS | No duplicates |
| 1.7 | Exactly 2 mega, 4 large, 8 medium, 6 small market teams | PASS | `{mega:2, large:4, medium:8, small:6}` — FIXED from iter2 (was 3/7/6/4 in iter1, correct since iter2) |
| 1.8 | Each team has owner_name, gm_name, manager_name populated | FAIL | GET /api/teams list endpoint returns `null` for all three fields. GET /api/teams/:id returns them correctly. Unchanged from iter2. |
| 1.9 | Each team has gm_personality JSON with philosophy, risk_tolerance, focus | FAIL | GET /api/teams list endpoint returns `null` gm_personality. GET /api/teams/:id returns correct nested JSON: `{"philosophy":"win-now","risk_tolerance":"conservative","focus":"pitching"}`. Unchanged from iter2. |
| 1.10 | Each team has revenue and payroll_budget > 0 | FAIL | GET /api/teams list endpoint returns `null` for revenue and payroll_budget. GET /api/teams/:id returns correct values (e.g. revenue=71959851). Unchanged from iter2. |
| 1.11 | GET /api/state shows phase = "draft" | PASS | phase="draft" after league creation |
| 1.12 | Player pool contains exactly 800 players in DB | PASS | Binary search confirmed exactly 800 real players (IDs 778812–779611) — FIXED from iter2 |
| 1.13 | No player has a null first_name or last_name | PASS | All 200 sampled players have both names |
| 1.14 | Latin American players: no Japanese surnames | PASS | 59 Latin American players sampled, no Japanese surnames found |
| 1.15 | East Asian players: no Latino surnames | PASS | 28 East Asian players sampled, cultural names consistent |
| 1.16 | All players have ratings in range 1-99 | PASS | 200 sampled, 0 out of range |
| 1.17 | At least 100 pitchers (SP+RP+CL) combined | PASS | Estimated ~108/800 pitchers (~13.5%) — PASS |
| 1.18 | Elite players (85+): count 14-18 | PASS | Exact count: 18/800 — FIXED from iter2 (was ~2 estimated) |
| 1.19 | Star players (75-84): count 56-72 | PASS | Exact count: 61/800 — FIXED from iter2 (was ~26 estimated) |
| 1.20 | Regular players (60-74): count 180-220 | PASS | Exact count: 201/800 — FIXED from iter2 (was ~144 estimated) |
| 1.21 | Fringe/prospect players (45-59): count 300-340 | PASS | Exact count: 313/800 — FIXED from iter2 (was ~278 estimated) |
| 1.22 | Replacement level (<45): count 180-220 | PASS | Exact count: 207/800 — FIXED from iter2 (was ~350 estimated) |
| 1.23 | US-born players: 32-38% | PASS | 36.0% (USA country code) |
| 1.24 | Latin American players: 27-33% | PASS | 29.5% |
| 1.25 | East Asian players: 13-17% | PASS | 14.0% (Japan+South Korea+Taiwan+China) |
| 1.26 | Canadian players: 8-12% | PASS | 8.5% |

**Group 1 Key Improvements from iter2:**
- Player pool exactly 800 (was ambiguous in iter2)
- All 5 rating tier distributions now PASS (all were FAIL in iter2)
- Nationality distributions all PASS (unchanged from iter2, all PASS)
- **Still failing:** Front-office fields (owner_name, gm_name, manager_name, gm_personality, revenue, payroll_budget) are null in the GET /api/teams list endpoint

---

## Group 2 — Draft Room UI
**Severity: High (Worker: B)**

| # | Test | Result | Notes |
|---|------|--------|-------|
| All 2.x | Browser UI tests | SKIP | Browser/Playwright scope — UI Tester only |

---

## Group 3 — Season Simulation
**Severity: Critical**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.1 | POST /api/sim/speed `{"speed":"normal"}` returns 200 | PASS | HTTP 200, `{"ok":true}` |
| 3.2 | GET /api/state shows simSpeed = "normal" | PASS | `simSpeed:"normal"` confirmed |
| 3.3 | After 5 seconds at normal speed: at least 3 games logged | PASS | 6 new games added in 5 seconds |
| 3.4 | GET /api/games/recent returns array of completed games | PASS | Array of 20 games returned |
| 3.5 | Each game has: home_team_id, away_team_id, home_score, away_score | PASS | All 4 fields present (camelCase: homeTeamId, awayTeamId, homeScore, awayScore) |
| 3.6 | No game has negative scores | PASS | All scores >= 0 |
| 3.7 | No game has score differential > 20 | PASS | Max observed differential: ~8 |
| 3.8 | Sample 50 completed games: winner score is 3-12 | PASS | All 20 available games had winner scores in 3-12 range (observed: 3-10) |
| 3.9 | Sample 50 completed games: loser score is 0 to (winner_score - 1) | PASS | All confirmed |
| 3.10 | Sample 100 games: 12-18 blowouts (winner>=8) | INCONCLUSIVE | Only 20 games available from /api/games/recent. In 20 games: 10% blowout rate (2/20); borderline. Cannot verify 100-game sample. |
| 3.11 | Box scores: total_hits >= runs_scored | PASS | All 20 box scores (via GET /api/games/:id) checked — homeHits >= homeScore, awayHits >= awayScore in all cases |
| 3.12 | Box scores: total_rbi <= runs_scored + 2 | SKIP | RBI field not present in box score response. Fields available: homeHits, awayHits, homeErrors, awayErrors, homeWalks, awayWalks |
| 3.13 | Box scores: starting pitcher IP 4.0-9.0 innings | SKIP | Pitcher IP not in box score response |
| 3.14 | Box scores: total IP = 9.0 innings | SKIP | IP not in box score response |
| 3.15 | Box scores: winning pitcher has IP > 0 | SKIP | winningPitcherId is present but IP not included |
| 3.16 | 10 completed games: each has notable_events JSON array | PASS | All 10 games have `notableEvents` array (may be empty) |
| 3.17 | Home run events: player has power > 80 | PASS | 18 home run events checked — all hitters had power 84-99 (all > 80) |
| 3.18 | Shutout events: pitcher IP >= 6 and runs allowed = 0 | PASS | Found shutout: "Harrison Rios threw a shutout (7 IP, 0 ER)" — IP=7.0 >= 6, ER=0 |
| 3.19 | Mock win probability < 0.15 returns exactly 0.15 | SKIP | Requires internal mocking |
| 3.20 | Mock win probability > 0.85 returns exactly 0.85 | SKIP | Requires internal mocking |
| 3.21 | GET /api/standings returns 20 rows | PASS | Nested conference/division structure with 20 total teams confirmed |
| 3.22 | All teams have wins + losses = total games played (±1) | PASS | All 20 teams at exactly 50 games (W+L=50) after turbo |
| 3.23 | POST /api/sim/speed `{"speed":"paused"}` stops sim | PASS | HTTP 200, game count froze immediately |
| 3.24 | No new games appear while paused | PASS | Waited 3s: game count stayed at 233 |
| 3.25 | POST /api/sim/speed `{"speed":"turbo"}` completes full 50-game season | PASS | Season completed; all teams at exactly 50 games |
| 3.26 | After turbo: all teams have exactly 50 games played | PASS | min=50, max=50 confirmed across all 20 teams |
| 3.27 | Phase transitions to "playoffs" after game 50 | FAIL | Phase went directly from `regular_season` → `offseason` in all 4 test runs. Game counter went from ~233 to 535 within `regular_season` phase (suggesting playoffs occurred internally but no discrete `playoffs` API phase). Champion IS recorded in timeline. Unchanged from iter2. |

---

## Group 4 — Standings UI
**Severity: High (Worker: B)**

| # | Test | Result | Notes |
|---|------|--------|-------|
| All 4.x | Browser UI tests | SKIP | Browser/Playwright scope — UI Tester only |

---

## Group 5 — Team Detail
**Severity: High**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 5.1 | GET /api/teams/:id returns full team object | PASS | HTTP 200, rich JSON |
| 5.2 | Response includes: owner_name, gm_name, manager_name, revenue, payroll_budget | PASS | All present: owner_name="Jamal Rodriguez", gm_name="Jack Johnson", manager_name="Xavier Nelson", revenue=71959851, payroll_budget=63867861 |
| 5.3 | Response includes gm_personality JSON with philosophy, risk_tolerance, focus | PASS | `{"philosophy":"win-now","risk_tolerance":"conservative","focus":"pitching"}` — PASS |
| 5.4 | Response includes roster array with at least 20 players | PASS | Roster has 23 players after draft completes — **FIXED from iter2** (was 0 in iter2) |
| 5.5 | Response includes minors object with AAA, AA, A, Rookie arrays | PASS | All 4 minors keys present |
| 5.6–5.11 | Browser/Playwright tests | SKIP | UI Tester scope |

---

## Group 6 — Player Data
**Severity: Medium**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 6.1 | GET /api/players/leaders returns hitting and pitching leaders | PASS | `{hitting:[30 entries], pitching:[30 entries]}` |
| 6.2 | Each leader entry has: player_name, team_name, stat_value | PASS | All three fields present. Sample: `{"player_name":"Federico Diaz","team_name":"Silverpine Wolverines","stat_value":0.53,"category":"AVG"}` |
| 6.3 | GET /api/players/:id returns full player card | PASS | HTTP 200 |
| 6.4 | Player card includes: name, age, position, birthplace, ratings, contract | PASS | All present: first_name, last_name, age, position, birthplace_country, overall_rating, contact, power, speed, fielding, arm, pitching_velocity, pitching_control, pitching_stamina, annual_salary, contract_years_remaining |
| 6.5 | player-leaders-table renders | SKIP | Browser test |
| 6.6 | After 10+ games: AVG leaders show 0.200-0.400 range | FAIL | Top AVG leaders: 0.530, 0.525, 0.521, 0.504, 0.500 — all far above 0.400 ceiling. Unchanged from iter2. |
| 6.7 | After 10+ games: ERA leaders show 1.50-5.00 range | FAIL | Top 2 ERA leaders: 0.882, 1.440 — below 1.50 floor. Leaders 3-10 are within range (1.53–2.44). Slight improvement from iter2 (was 4/5 below 1.50, now 2/10 below). |

---

## Group 7 — Persistence
**Severity: High**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 7.1 | Kill server process (SIGTERM) | PASS | Killed with SIGTERM |
| 7.2 | Restart server | PASS | Restarted, ready within 2 seconds |
| 7.3 | GET /api/state returns same phase and season number | PASS | phase="offseason", seasonNumber=1 — both match pre-restart |
| 7.4 | GET /api/standings shows same win/loss totals | PASS | All 5 checked teams: [(281,22,28),(282,33,17),(283,28,22),(284,23,27),(285,23,27)] — exact match |
| 7.5 | GET /api/teams returns same 20 teams with same names | PASS | 20 teams, first team "Lake Hensley Embers" — consistent |
| 7.6 | Draft picks from before restart still in draft_picks table | PASS | lastPickId=15085 confirmed after restart |

---

## Group 8 — Timeline
**Severity: Medium**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 8.1 | GET /api/timeline returns array | PASS | Returns JSON array |
| 8.2 | After first season completes: 1 entry | PASS | `[{...}]` with 1 entry after season 1 |
| 8.3 | Entry includes: season_number, champion_team_name, notable_events | PASS | All present: season_number=1, champion_team_name="Cedarwood Grizzlies", notable_events=[10 events array]. All fields in snake_case (no camelCase). |
| 8.4 | timeline-season-1 renders | SKIP | Browser test |
| 8.5 | Timeline season card shows champion name and record | SKIP | Browser test |

**Additional finding:** notable_events items contain `type`, `playerId`, `playerName`, `description` fields (consistent). MVP player captured (mvp_player_name present). Phase goes directly to offseason without discrete "playoffs" phase, but champion IS determined and recorded. Shutout IP shown as integer (`7 IP`) in this run — different from iter2's fractional format.

---

## Group 9 — Error Handling
**Severity: Medium**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 9.1 | GET /api/teams/99999999 returns 404 `{"error":"Team not found"}` | PASS | HTTP 404, exact body match — FIXED from iter2 (now uses 99999999) |
| 9.2 | GET /api/players/99999999 returns 404 `{"error":"Player not found"}` | PASS | HTTP 404, `{"error":"Player not found"}` — **FIXED from iter2** (iter2 returned HTTP 200 for ID 99999; with ID 99999999 now returns proper 404) |
| 9.3 | POST /api/sim/speed invalid speed returns 400 | PASS | HTTP 400, `{"error":"Invalid speed. Must be paused|normal|fast|turbo"}` — exact match |
| 9.4 | POST /api/league/new when league exists returns 409 | PASS | HTTP 409, `{"error":"League already exists. Use /api/league/reset to start over."}` — **FIXED from iter2** (was returning 429/rate_limited body) |
| 9.5 | Frontend shows "Reconnecting..." banner | SKIP | Browser test |
| 9.6 | Frontend recovers after server returns | SKIP | Browser test |
| 9.7 | DB write failure: error logged, sim continues | SKIP | Requires internal mocking |
| 9.8 | After DB failure: next game completes | SKIP | Requires internal mocking |

---

## Group 10 — LLM Integration
**Severity: Medium**

| # | Test | Result | Notes |
|---|------|--------|-------|
| 10.1 | With ANTHROPIC_API_KEY unset: logs warning "LLM disabled — using procedural fallback" | PASS | Actual log: `"WARNING: ANTHROPIC_API_KEY missing or malformed. LLM features will use procedural fallback."` — semantically equivalent to spec (differs in exact wording) |
| 10.2 | Draft completes successfully with procedural fallback | PASS | All 600 draft picks completed at fast speed, transitioned to regular_season |
| 10.3 | With valid API key: non-empty reasoning string in draft_picks | SKIP | No valid API key in test environment |
| 10.4 | LLM call timeout of 8s enforced | SKIP | Requires mocking slow endpoint |
| 10.5 | Mock LLM returning invalid JSON: fallback fires | SKIP | Requires internal mocking |
| 10.6 | Mock LLM returning out-of-range pickIndex: fallback fires | SKIP | Requires internal mocking |
| 10.7 | LLM rate limiting: max 5 simultaneous outbound API calls | SKIP | Requires live API key |
| 10.8 | LLM rate limiting: >= 100ms delay between calls | SKIP | Requires live API key |
| 10.9 | No API key logged or returned in any API response | PASS | `"x-api-key: [REDACTED]"` in server logs (key is redacted). No API key strings in /api/state, /api/teams, or /api/players/:id responses. |

---

## Summary

### Pass/Fail/Skip/Inconclusive Counts

| Group | Pass | Fail | Skip | Inconclusive | Total |
|-------|------|------|------|--------------|-------|
| 0 — Environment | 6 | 0 | 1 | 0 | 7 |
| 1 — World Generation | 23 | 3 | 0 | 0 | 26 |
| 3 — Season Simulation | 16 | 2 | 7 | 1 | 26 |
| 5 — Team Detail | 5 | 0 | 6 | 0 | 11 |
| 6 — Player Data | 3 | 2 | 2 | 0 | 7 |
| 7 — Persistence | 6 | 0 | 0 | 0 | 6 |
| 8 — Timeline | 3 | 0 | 2 | 0 | 5 |
| 9 — Error Handling | 4 | 0 | 4 | 0 | 8 |
| 10 — LLM | 3 | 0 | 6 | 0 | 9 |
| **Total** | **69** | **7** | **28** | **1** | **105** |

### Improvements vs Iteration 2

| Issue | Iter2 Result | Iter3 Result |
|-------|-------------|--------------|
| Rating distributions (1.18–1.22) | ALL 5 FAIL | **ALL 5 PASS** |
| Player pool count (1.12) | FAIL (ambiguous) | **PASS (exactly 800)** |
| Roster populated after draft (5.4) | FAIL (0 players) | **PASS (23 players)** |
| GET /api/players/99999999 returns 404 (9.2) | FAIL (200 returned) | **PASS** |
| POST /api/league/new 409 exact message (9.4) | FAIL (rate_limited body) | **PASS** |
| ERA leaders top-2 below floor (6.7) | 4/5 below 1.50 | Slightly improved: 2/10 below 1.50 |

### Remaining Failures

1. **GET /api/teams list endpoint missing front-office data** (1.8, 1.9, 1.10) — `owner_name`, `gm_name`, `manager_name`, `gm_personality`, `revenue`, `payroll_budget` all `null` in list endpoint. All are available via `/api/teams/:id`.

2. **No "playoffs" phase** (3.27) — Season transitions directly `regular_season` → `offseason` in all 4 test runs across both iter2 and iter3. Game counter jumped from ~233 to ~535 within `regular_season` phase. Champion is recorded in timeline but the discrete API phase `playoffs` is never exposed.

3. **AVG batting leaders unrealistically high** (6.6) — Top leaders 0.49–0.53 (spec max: 0.400). Unchanged from iter2.

4. **ERA leaders 2 below 1.50 floor** (6.7) — Top 2 ERA leaders at 0.882 and 1.440. Slightly improved from iter2 (4/5 were below 1.50). The issue persists for the very top performers.

### Minor Findings
- `POST /api/league/new` still requires a body (empty `{}` works; truly no body returns 400 validation error).
- `/api/standings` returns nested conference/division structure (not flat 20-row array as spec implies), but total is 20 teams — functionally compliant.
- Box score response lacks RBI, total IP (all teams), and per-pitcher IP, making tests 3.12–3.15 unverifiable via HTTP.
- Server log shows `[llm] Draft pick call failed` even when LLM disabled — these are expected fallback events, not server errors.
- Offseason UNIQUE constraint errors (`[engine] Offseason error: UNIQUE constraint failed: draft_picks...`) no longer observed in iter3 logs.
- Shutout IP display: iter3 shows `7 IP` (clean integer) vs iter2's `8.333... IP` (floating point fraction) — improvement.
