# Developer Iteration 5 — Completion Report

**Final commit:** `2619d4d280f9a21480d1b1ca5c801f1f1e4d69ea`

**Vitest test count:** 178 passed / 0 failed (was 166 before this iteration; +12 new tests)

---

## Fixes Applied

### Critical

- **§1.1 Fix A** — `server/sim/offseason.ts:runAnnualDraftStep`: Added `validatePostDraftRosters(league.id)` call after `runAnnualDraft()` completes. Prevents zero-pitcher team state entering the next season.
- **§1.1 Fix A (belt-and-suspenders)** — `server/sim/offseason.ts:finalizeOffseason`: Added second `validatePostDraftRosters(leagueId)` call after the W/L reset transaction commits, before returning.
- **§1.1 Fix B** — `server/sim/game.ts` (lines ~382–389): Replaced silent `return` on box-score validation failure with `current_game_number` advance via `UPDATE leagues SET current_game_number = ?`. Engine can no longer stall on the same game.
- **§1.1 Fix C** — `server/sim/game.ts` (after lines ~247–248): Added `if (!homeStarter || !awayStarter)` guard that advances `current_game_number` and returns early before any batter/pitcher lines are generated. Defense-in-depth against missing SP rosters.
- **§1.2 (AB4-01)** — `server/sim/offseason.ts:runOffseason`: Added `const { isPaused } = await import('./engine.js')`. After `annual_draft` step, check `!isTurbo && isPaused()` and return without writing the checkpoint if paused. Turbo mode is excluded because its single-transaction draft cannot be interrupted mid-flight.

### High

- **§2.1** — `server/index.ts:validateBody`: Added `const body = req.body === undefined ? {} : req.body` before `schema.safeParse()`. POST `/api/league/new` with no Content-Type / no body now returns 200 instead of 400.
- **§2.2 Fix A** — `shared/types.ts:LeagueStateSnapshot`: Added `season: number` field alongside `seasonNumber`.
- **§2.2 Fix B** — `server/sim/engine.ts:refreshCache`: Populated `season: league.season_number` in the snapshot literal.
- **§2.2 Fix C** — `server/index.ts` no-league response: Added `season: 0` alongside `seasonNumber: 0`.
- **§2.3** — `server/routes/players.ts`: Lowered AVG minimum AT-BATS from `>= 150` to `>= 100`.

### Medium

- **§3.1** — `server/sim/game.ts:generateBatterLines`: Changed hit probability formula from `Math.min(0.40, contact/400 + 0.15)` to `Math.min(0.36, contact/500 + 0.13)`. Keeps top AVG leaders under 0.400 spec ceiling.
- **§3.2** — `server/routes/standings.ts:getStandings`: Replaced SQL `ORDER BY wins DESC, (wins - losses) DESC` with JS `.sort()` by PCT desc, then run-differential, then wins. Correctly handles partial-season games-played differences.
- **§3.3 (AB4-03)** — `server/tests/draftPause.test.ts`: Added third test `non-turbo cooperative pause exits the draft loop before draft completes`. Archives league 1, generates league 2, runs `runExpansionDraft(..., false)` with engine `currentSpeed='paused'` (module default), verifies `draft_picks.cnt < 600`, restores league 1's active status.

### Tests Added

- **§5.1** — `server/tests/multiSeasonProgression.test.ts` (3 tests): Runs 3 full seasons end-to-end in turbo + fast-forward. Asserts `season_number >= 4`, all 20 teams have at least 1 SP on MLB roster entering season 4, and each season has ≥50 completed games in `game_log`.
- **§5.2** — `server/tests/offseasonPause.test.ts` (4 tests): Exercises offseason starting from `offseason_step='annual_draft'`. Verifies turbo (non-paused) run completes and advances to season 2. Confirms `annual_draft` picks reach 600 and `offseason_step` is NULL after finalization.
- **§5.3** — `server/tests/leagueNewEmptyBody.test.ts` (4 tests): Verifies `NewLeagueBody.safeParse({})` succeeds, coercion of `undefined` to `{}` passes schema, and `startNewLeague({})` returns a valid `leagueId`.

---

## Deviations

- **§1.2 pause guard** — Instructions specify `isPaused()` check after `annual_draft` with no turbo condition. Added `!isTurbo &&` guard to prevent the check from firing during turbo offseason runs (where `currentSpeed === 'paused'` is the engine default in test context). This is necessary because turbo's atomic transaction cannot be interrupted; without the guard, `offseasonAnnualDraft.test.ts` (existing regression test) broke. The pause cascade for non-turbo is fully preserved.

---

## Items Not Completed

All §1–§3 items were applied. All §5 tests were created. No items skipped.

---

## Build Gate Results

| Gate | Result |
|------|--------|
| `npx tsc --noEmit -p tsconfig.server.json` | ✅ 0 errors |
| `npm run test` | ✅ 178/178 passed |
| `npm run lint` | ✅ 0 errors (296 pre-existing warnings in ui4-*.mjs files, not in scope) |
| `npm run security:sql-grep` | ✅ passed |
| `npm run build` (client) | ✅ succeeded |
| `npm run security:bundle-grep` | ✅ passed |
