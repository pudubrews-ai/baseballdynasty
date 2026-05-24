# Developer Iteration 3 — Completion Report

**Date:** 2026-05-23
**Branch:** feature/v0.1.0-initial-build
**Final commit hash:** 6f7bca3

## Test Count (vitest)
- **22 test files, 157 tests, 0 failures**
- Baseline (start of iteration): 15 test files, 137 tests
- New tests added: 7 new test files + 4 new cases in boxScore.test.ts = 20 new tests

## Fixes Applied

### Critical
1. **§1.1.1** — Added `subPhase: 'expansion' | 'annual' | null` to `LeagueStateSnapshot` in `shared/types.ts`
2. **§1.1.2** — Added `mapSubPhase()` helper in `engine.ts` `refreshCache`; populated `subPhase` in snapshot
3. **§1.1.2 / §4.3** — Changed `mapPhase` default branch to `throw new Error()` instead of unsafe cast
4. **§1.1.3** — `Draft.tsx`: changed `phase === 'expansion_draft'` checks to `phase === 'draft'`; use `subPhase` for title
5. **§1.1.4** — `useLeagueState.ts`: changed `isDraft` check to `phase === 'draft'`
6. **§1.2.1** — `Draft.tsx`: fetch `/api/draft/order`, compute `teamsInDraftOrder` array
7. **§1.2.2** — `Draft.tsx`: replaced all `teams.map(...)` with `teamsInDraftOrder.map(...)` in thead and tbody
8. **§1.2.3** — `Draft.tsx`: changed `data-testid` to use `getPickNumberForCell(round, teamIdx, teamsInDraftOrder.length)`; added `getPickNumberForCell` helper
9. **§1.3** — `useLeagueState.ts`: complete rewrite — `failureCountRef`, `phaseRef`, finally-rescheduling, bootstrap `lastPickIdRef` from `snapshot.lastPickId - 50`
10. **§1.4.1** — `Teams.tsx`: changed `tabData` from `useState<unknown[]>([])` to `useState<unknown>([])`
11. **§1.4.2** — `Teams.tsx`: rewrote minors tab to consume `{AAA, AA, A, Rookie}` grouped object
12. **§1.4.3** — `Teams.tsx`: roster tab updated to use snake_case field names (`first_name`, `last_name`, `overall_rating`, `annual_salary`)
13. **§1.4.4** — `Teams.tsx`: `TeamDetail` interface and financials tab updated to snake_case (`gm_name`, `gm_personality`, `manager_name`, `owner_name`, `payroll_budget`, `current_payroll`); `TeamSummary.market_size` corrected

### High
14. **§2.1** — `server/routes/teams.ts`: added `roster` query in `GET /api/teams/:id` handler; included in response JSON
15. **§2.2** — `server/sim/playoffs.ts`: added defensive `UPDATE leagues SET phase = 'playoffs'`; inserted `await new Promise(r => setTimeout(r, 50))` between each series
16. **§2.3** — `engine.ts`: exported `getDraftPickDelay()` function (normal=1500ms, fast=200ms, turbo=0); `draft.ts`: added import and per-pick delay after `runDraftPick` in both `runExpansionDraft` and `runAnnualDraft`
17. **§2.4** — `League.tsx`: added `import React`; replaced `<>/</>` fragment with `<React.Fragment key={...}>`; removed duplicate `key` on inner `<tr>`; added `teamIdx === 0` division-leader styling
18. **§2.5** — (integrated into §1.3 rewrite of `useLeagueState.ts`) reconnecting banner debounced to 2 consecutive failures; `finally` block guarantees `schedule()` runs
19. **§2.6** — `Players.tsx`: complete rewrite — `StatLeader` updated to `{player_name, team_name, stat_value, category}`; `Leaders` updated to `{hitting, pitching}`; `CATEGORIES` with group field; `activeLeaders` filters by `category` key; `PlayerCard` snake_case
20. **§2.7** — `Timeline.tsx`: all interface fields updated to snake_case (`season_number`, `champion_team_id`, `champion_team_name`, `mvp_player_id`, `mvp_player_name`); `Transaction` fields snake_case; all field accesses updated
21. **§2.8** — `server/sim/offseason.ts`: wrapped `finalizeOffseason` DB writes in `db.transaction()` for atomicity
22. **§2.9** — `server/sim/game.ts`: `validateBoxScore` extended with `isWalkOff` parameter and Rule 4 (total IP check — home=9.0, away=8.0 on walk-off or 9.0 otherwise); fail-closed `return` if validation fails after retries
23. **§2.9 (supporting)** — `server/sim/game.ts`: `generatePitcherLines` updated to always sum to exactly `totalIP` — last reliever gets exact remaining IP; final correction block added
24. **§2.10** — `engine.ts`: `runDraftTick` finally block no longer unconditionally sets `simRunning = false`; only sets false when `currentSpeed === 'paused'`

### Medium
25. **§3.1** — `server/index.ts`: `rateLimitLeagueNew` now calls `getActiveLeague()` first and returns 409 before checking rate window; removed `lastLeagueCreateMs` update on 409 path
26. **§3.2** — `server/sim/draft.ts`: exported `getAnnualDraftOrder()` function; `server/index.ts`: `/api/draft/order` branches on `league.phase === 'annual_draft'` vs expansion
27. **§3.3** — `server/sim/worldgen.ts`: `selectCitiesWithMarketQuota` throws descriptive error if fewer than 20 cities selected
28. **§3.4** — `server/util/scrub.ts`: expanded bearer regex from `[a-zA-Z0-9_-]+` to `[a-zA-Z0-9._~+/=\-]+` to capture full JWTs
29. **§3.5** — `server/services/llm.ts`: deleted local `scrubError` definition (lines 164-173); added `import { scrubError } from '../util/scrub.js'`
30. **§3.6** — `server/routes/players.ts`: raised `at_bats >= 150` (AVG), `innings_pitched >= 50` (ERA, WHIP)
31. **§3.7** — `League.tsx`: added `useEffect` with `setInterval(1500)` for dedicated standings polling during `regular_season`

### Low
32. **§4.1** — `server/sim/game.ts`: swapped `isWalkOff` flag — home pitchers always `false` (9.0 IP), away pitchers get `isWalkOff` (8.0 IP on walk-off)
33. **§4.5** — `server/index.ts`: added `rateLimitLeagueReset` middleware (5s); applied to `POST /api/league/reset` and `DELETE /api/league/current`
34. **§4.6** — `server/index.ts`: startup catch uses `scrubError(err).message` not raw `err`

### New Tests (§6)
35. **§6.1** — `server/tests/playoffsObservable.test.ts`: 2 tests verify playoffs phase transition and WS winner production
36. **§6.2** — `server/tests/draftPickTiming.test.ts`: 2 tests verify `getDraftPickDelay()` spec-correct values
37. **§6.3** — `server/tests/validateBoxScoreGate.test.ts`: 3 tests verify Rule 1, Rule 4 non-walk-off, Rule 4 walk-off
38. **§6.4** — `server/tests/offseasonTransaction.test.ts`: 1 test verifies atomic season finalization
39. **§6.5** — `server/tests/leagueExistsBefore429.test.ts`: 2 tests verify middleware ordering (409 before 429)
40. **§6.6** — `server/tests/scrubErrorJWT.test.ts`: 5 tests verify JWT and API key redaction
41. **§6.7** — `server/tests/scrubErrorDuplicate.test.ts`: 1 test grep-gates for single `scrubError` definition
42. **§6.8** — `server/tests/boxScore.test.ts`: added 4 Rule 4 total IP tests

## Deviations with Justification

1. **IP rounding in generatePitcherLines (§2.9 Rule 4)**: The Architect's instruction added Rule 4 to the validator to catch total IP != 9.0. However, the existing `generatePitcherLines` function produces IP values in thirds notation that could fail to sum to exactly 9.0 due to floating-point rounding in the bullpen distribution loop. Rather than applying Rule 4 as a pure validator that kills ~25% of games (breaking the existing `boxScoreRuntime.test.ts`), I also fixed `generatePitcherLines` to guarantee the total IP sums to exactly `totalIP` by: (a) using the last reliever to absorb remaining IP exactly, and (b) adding a final correction block. This is more correct behavior and preserves all 137 existing tests while allowing Rule 4 to pass.

2. **`git push origin feature/v0.1.0-initial-build`**: The repository has no configured git remote (no `origin`). All 4 commits were made locally on the correct branch. The push instruction could not be executed because there is no remote repository to push to.

3. **§2.5 reconnecting banner**: The instruction said to replace the entire `useLeagueStatePolling` function. I implemented the exact logic specified (failureCountRef, phaseRef, finally-rescheduling) and integrated it with the §1.3 bootstrap logic in a single rewrite. The behavior is identical to what was specified.

## Items Not Completed

None. All items in the instruction set have been applied:
- All 4 Critical defects fixed
- All 7 High defects fixed  
- All 7 Medium defects fixed
- All 3 applicable Low defects fixed (§4.2 covered by §2.9, §4.4 covered by §2.4)
- All 8 test requirements from §6 delivered
- TypeScript: 0 errors
- Tests: 157/157 passing (0 failures)
- Build: clean
- Security: sql-grep passes, bundle-grep passes
- scrubError uniqueness: exactly 1 definition in server/
