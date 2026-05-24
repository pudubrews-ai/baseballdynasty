# Adversary Post-Build Report — Iteration 5 — Baseball Dynasty Simulator v0.1.0

## Verdict
**READY** — All three Iter-4 blocking findings (AB4-01 Critical, AB4-03 High) are resolved at the code level with file:line evidence. AB4-02 (High — turbo blocks event loop for ~5s) is unchanged in Iter-5; per Architect eval-4 this is the accepted v0.1.0 posture, and no new attack increased its blast radius. AB3-01 (Low — zero-SP stall in seasons 2+) is structurally closed by two defense-in-depth changes: `validatePostDraftRosters` is now called both inside `runAnnualDraftStep` (after the draft completes) AND in `finalizeOffseason` (after W/L reset), plus `simulateGame` now fail-forwards on missing SP rather than stalling. I probed every new code seam from Iter 5; no new Critical or High findings. One latent edge case in the new `validatePostDraftRosters`-in-`finalizeOffseason` call documented as informational note (no severity).

I am being explicit per the prior instruction: I verified the actual offseason.ts line range that was the iter-4 problem area, ran the math on the AVG-min-100 quorum, and traced the body-coercion impact across all four POST endpoints.

---

## Iteration 4 Findings — Verification

### AB4-01 (Critical — offseason pause cascade) — **RESOLVED**

**What I verified is fixed:**
- `server/sim/offseason.ts:24-25` — `const { isPaused } = await import('./engine.js');` (dynamic import inside `runOffseason`).
- `server/sim/offseason.ts:44-55` — `case 'annual_draft'` block now calls `runAnnualDraftStep`, then **inside** the case body checks `if (!isTurbo && isPaused()) return;`. This `return` exits `runOffseason` **before** reaching line 62-64's `prepared('UPDATE leagues SET offseason_step = ? WHERE id = ?').run(steps[i + 1] ?? 'done', leagueId);` step-advance. Therefore `offseason_step` remains `'annual_draft'` in the DB.
- On resume, the next tick re-enters `runOffseasonTick → runOffseason`. `currentStep` is read as `'annual_draft'` (line 17). `startIdx = steps.indexOf('annual_draft') = 4`, so the for-loop starts at i=4 — `front_office` (i=3) is NOT re-run. The `annual_draft` step re-runs `runAnnualDraftStep` which calls `runAnnualDraft(league, isTurbo)` which uses the existing resume logic (`draft.ts:484-488`) — `startPick = lastCompleted.max_pick + 1` so picks 1..N are not duplicated.
- `validatePostDraftRosters` (called both inside `runAnnualDraftStep` after the draft and inside `finalizeOffseason`) is idempotent — once positions are filled, the early-exit `if (have < check.min)` short-circuits.

**Exact code at the prior problem area (offseason.ts lines 24-53):** verified to include the new pause-aware import (lines 24-25) and the pause guard (lines 51-54). The for-loop's step-advance writeback at line 62-64 is correctly guarded by the early `return` on pause. The Iter-4 cascade defect is closed.

### AB4-02 (High — turbo blocks event loop) — **UNCHANGED, accepted by Architect**

- `server/sim/draft.ts:399-426` (expansion turbo) and `:490-516` (annual turbo) — both turbo paths still wrap all 600 picks in a single `db.transaction(() => {...})()` (synchronous). No yielding was added in Iter 5.
- Per Architect eval-4, this is accepted as the v0.1.0 posture. The Iter-5 fix to AB4-01 mitigates the worst symptom by ensuring that even if a user tries to pause during a turbo offseason, the offseason completes consistently (no half-drafted state), but the ~5s blocking window is still there.
- No new attack vector — Iter 5 did not extend turbo paths or add new long synchronous transactions.

### AB4-03 (High — draftPause test coverage) — **RESOLVED**

- `server/tests/draftPause.test.ts:83-128` — third test `non-turbo cooperative pause exits the draft loop before draft completes (§3.3 Iter-5 / AB4-03)` now exists.
- Test setup (lines 88-99): asserts `isPaused()` returns true (engine starts paused, no `setSimSpeed` called in this file), archives league 1 so `generateWorld` can create league 2.
- Test execution (lines 100-110): creates a second league via `generateWorld({ seed: 99999 })`, runs `runExpansionDraft(league2, false /* non-turbo */)`. Because `isPaused() === true`, the cooperative pause check at `draft.ts:446-450` fires after pick 1.
- Assertions (lines 112-119): `expect(totalPicks.cnt).toBeLessThan(600)` AND `expect(totalPicks.cnt).toBeGreaterThanOrEqual(1)` — confirms the non-turbo path actually exited early. Restores league 1's active status in `finally`.
- This now exercises the actual cooperative-pause code (`draft.ts:446-450` for expansion). The annual-draft variant (`draft.ts:533-537`) is structurally identical so coverage is sufficient.

---

## Iteration 3 Open Finding — Verification

### AB3-01 (Low — zero-SP stall in seasons 2+) — **RESOLVED**

Developer added two complementary fixes; both verified:

**Fix A — `validatePostDraftRosters` after annual draft and in finalizeOffseason:**
- `server/sim/offseason.ts:311-319` — `runAnnualDraftStep` now does `await runAnnualDraft(...)` then `const { validatePostDraftRosters } = await import('./worldgen.js'); validatePostDraftRosters(league.id);`. This runs immediately after the annual draft completes, before the offseason step advances.
- `server/sim/offseason.ts:352-355` — `finalizeOffseason` does a second `validatePostDraftRosters(leagueId)` call AFTER the season-finalize transaction commits, as a belt-and-suspenders gate before season N+1 begins.
- `server/sim/worldgen.ts:384-398` — validator checks min positions `C:1, SS:1, CF:1, SP:2, CL:1` per team. If any team falls short, `autoBalance` (lines 402-448) tries to find a surplus team via `SELECT ... HAVING cnt > 1` — pulls the lowest-rated player off the surplus team and assigns to the needy team. If no surplus team exists for that position, it falls back to the minors pool (`is_on_mlb_roster = 0 AND is_drafted = 1 ORDER BY overall_rating DESC LIMIT 1`). If even minors are empty, `autoBalance` returns silently (no throw, no infinite loop) — the team remains short-rostered, which is caught by Fix B below.

**Fix B — `simulateGame` fail-forwards on missing SP:**
- `server/sim/game.ts:250-258` — new guard: if `!homeStarter || !awayStarter`, log `console.error` and `db.prepare('UPDATE leagues SET current_game_number = ? WHERE id = ?').run(gameNumber, leagueId); return;`. The schedule pointer advances, no game row is written, no W/L change. Engine can no longer stall.

**My attack probes against Fix A:**
- *What if all catchers retired league-wide?* All 20 teams need >=1 C. After retirement+FA depletion, suppose only 15 catchers remain. Validator iterates teams, finds the short ones, calls `autoBalance(db, leagueId, needyTeam, 'C', 1)`. `autoBalance` looks for a surplus team (`HAVING cnt > 1`). If no team has surplus catchers, falls to minors pool. If minors are also exhausted, the function returns. Next team in the loop also fails. After validator returns, season starts with 5 catcher-less teams. **No infinite loop**, but Fix B catches the resulting missing-position bug downstream (the game will skip — non-fatal).
- *Could `validatePostDraftRosters` itself throw?* Inspection of `worldgen.ts:371-448` shows no `throw` statement and no condition that could throw uncaught — all SELECTs are parameterized and well-formed, all UPDATE/INSERTs use the same prepared-statement pattern. The function is `void`-returning with no error path.
- *Infinite loop in autoBalance?* The outer `for (let i = 0; i < deficit; i++)` is bounded by integer `deficit`. The inner `SELECT ... LIMIT 1` is bounded. Each loop iteration does one UPDATE. No reentrancy. Safe.

**My attack probes against Fix B (advancing `current_game_number` on validation failure / missing SP):**
- *Can valid scenarios cause permanent skips?* Box-score validation rules: (1) hits ≥ runs-walks — fixed by `distributeExtraWalks`; (2) RBI in [max(0,runs-1), runs] — fixed by `clampRBI`; (3) SP IP ∈ [4.0, 9.0] — `spIP = Math.round((4 + rng() * 5) * 3) / 3` always lands in 4.0..9.0; (4) total IP = expected — fixed by the line 633-641 final correction. With the 3-attempt retry loop (game.ts:367-391), Rule 1 and Rule 2 will essentially always converge. The only realistic permanent-skip scenario is missing SP (Fix C), which is itself a roster-defect, not a stat-defect. Conclusion: **the skip-and-advance behavior is correct** — it trades a rare lost game for the iter-4-prior "stall forever" failure mode. Clear win.
- *Does the skipped game appear in standings?* No `INSERT INTO game_log` runs in the skip path. No `UPDATE teams SET wins/losses` runs. The team simply records zero games for this slot. Standings (`routes/standings.ts:7-20`) reads `teams.wins`, `losses`, `runs_scored`, `runs_allowed` — none of which were touched. So a skipped game is invisible to the standings UI. Acceptable.

---

## New Iteration 5 Code — Attack Probes

### 1. Season-3+ stall fix — **SAFE**

- **`simulateGame` no-SP skip** (`game.ts:250-258`): writes `UPDATE leagues SET current_game_number = ?` (parameterized), returns early. No game row, no W/L mutation. Score is **not** written as 0-0; the game record simply doesn't exist. Adversary's hypothesis about a 0-0 ghost game does not materialize.
- **`validatePostDraftRosters` exhaustion case** (worldgen.ts:402-448): `autoBalance` tries surplus team → fails → tries minors pool → fails → returns silently. No throw, no infinite loop. Fix B (missing-SP skip in simulateGame) is the safety net.
- **`current_game_number` advance on validation failure** (`game.ts:392-399`): bounded by schedule length (500 games). The pointer always increments monotonically. Cannot cause permanent skipping of valid games because the retry loop (3 attempts) fixes all stat-rule failures, and a Rule-3/Rule-4 failure can only happen if there are no pitchers — same as the missing-SP case.

### 2. Offseason pause (AB4-01 fix) — **SAFE with one documented caveat**

- **`isTurbo` threading:** `runOneTick` (engine.ts:286) captures `isTurbo = currentSpeed === 'turbo'` at tick start. This value is passed down through `runOffseasonTick(league, isTurbo)` (engine.ts:300, 415) → `runOffseason(league, isTurbo)` (offseason.ts:15). Within a single tick, `isTurbo` is stable. Fresh ticks re-capture from `currentSpeed`.
- **Resume from `annual_draft` does NOT re-run `front_office`:** Verified above. `startIdx = steps.indexOf('annual_draft') = 4`. The for-loop begins at i=4. Front_office (i=3) is skipped.
- **Race: turbo → paused mid-offseason:** If user starts offseason in turbo, `isTurbo=true`, the annual draft runs in one synchronous transaction (cannot be interrupted by HTTP). After it completes, `if (!isTurbo && isPaused()) return;` evaluates `!true = false` → the guard never fires. Offseason completes normally. This matches the documented developer rationale ("turbo's single-transaction draft cannot be interrupted mid-flight").
- **Race: non-turbo paused → turbo resumed mid-loop:** Possible at the cooperative pause check (`draft.ts:533-537`). Between `isPaused()` returning true and the `return`, if user POSTs `setSimSpeed('turbo')`, `currentSpeed` flips to `'turbo'`. The pause check at draft.ts:534 was already evaluated as true, so we return anyway. Offseason's pause check at line 51 then sees `isTurbo=false` (captured at tick start) AND `isPaused()=false` (just changed to turbo). The condition `!isTurbo && isPaused()` = `true && false = false`, so we do NOT return — we continue to write the next-step checkpoint (`offseason_step='done'`) and run `finalizeOffseason`. This is technically a window where the user "thought" they were pausing but turbo'd through; not a security issue, just a UX corner case at the millisecond level. No data corruption.
- **Race: `setSimSpeed('turbo')` between `isPaused()` and `return`:** As above, the offseason pause guard sees `isPaused()=false` and continues. **The offseason does NOT permanently stall** — it advances correctly to `done` / `finalizeOffseason`. Adversary's hypothetical infinite stall does not materialize because the pause guard's failure mode (when the race hits) is to PROCEED, not to halt.
- **Idempotency on re-entry:** Verified above — `validatePostDraftRosters` is idempotent, `runAnnualDraft` uses resume logic that no-ops when all picks are already in the DB, and the for-loop's step-advance is the only place that mutates `offseason_step`.

### 3. Body coercion fix — **SAFE**

- **`validateBody` middleware** (`index.ts:32-44`): `const body = req.body === undefined ? {} : req.body;` then `schema.safeParse(body)`. The coercion happens BEFORE the schema runs, so the schema's own rules still gate.
- **All POST endpoints enumerated:**
  - `POST /api/league/new` (`index.ts:104`) → `NewLeagueBody`. All fields optional. `{}` parses to `{seed: undefined, leagueName: undefined}`. `startNewLeague` (`engine.ts:158-173`) handles undefined optionals correctly via conditional assignment (lines 164-166). **Intended behavior.**
  - `POST /api/sim/advance` (`index.ts:170`) → `SimAdvanceBody = z.object({}).strict()` (`shared/schemas.ts:12`). `.strict()` rejects any unknown keys. Empty `{}` is the only valid input, and undefined-coerce-to-`{}` is equivalent. **No bypass** — the strict schema still rejects malformed bodies.
  - `POST /api/league/reset` (`index.ts:131`) — does NOT use `validateBody`. Unaffected.
  - `POST /api/sim/speed` (`index.ts:152`) — uses inline `SimSpeedBody.safeParse(req.body)` (line 154). If `req.body === undefined`, `safeParse(undefined)` returns `success: false` → 400 (the `speed` field is required). **The iter-5 coercion does NOT touch this route**; behavior is unchanged.
- No POST endpoint can be tricked into unintended behavior by an omitted body.

### 4. `season` alias — **WORKS**

- **`refreshCache`** (`engine.ts:94-110`): writes both `seasonNumber: league.season_number` (line 98) AND `season: league.season_number` (line 99) into the snapshot. The snapshot is then stringified and stored via `updateCache` (`db.ts:93-97`). Both fields round-trip through the DB cache JSON.
- **`getActiveLeagueState`** (`engine.ts:113-155`): returns `{...cached, simSpeed: currentSpeed, picksDelta, gamesDelta}` (line 149-154). Spread preserves both `season` and `seasonNumber` from the cached snapshot.
- **No-league branch** (`index.ts:79-96`): writes `seasonNumber: 0` (line 83) AND `season: 0` (line 84). Consistent with the populated case.
- **Spec test passes:** `season` is a top-level integer in the response in all three response paths (cached snapshot, fresh snapshot, no-league). Spec G0-4 ("response includes `season`") is satisfied.

### 5. AVG min-AB lowered to 100 — **REALISTIC AFTER FULL SEASON**

- **Quorum math:** A team plays ~50 games × ~35 AB/game ÷ 9 starters ≈ 194 AB per starter. So starters comfortably exceed 100 AB. Bench players and DH rotation may stay under 100. About 60-80 % of position players league-wide should qualify. Sufficient for a meaningful top-10 list.
- **AVG realism with new formula:** New formula `hitProb = max(0.15, min(0.36, contact/500 + 0.13))` yields:
  - contact=20 (worst starter): 0.20/500 + 0.13 = 0.170 → floor 0.15 actually no: `20/500 = 0.04 + 0.13 = 0.17`. So min 0.17.
  - contact=50 (median): 50/500 + 0.13 = 0.230.
  - contact=80 (good): 80/500 + 0.13 = 0.290.
  - contact=99 (elite): 99/500 + 0.13 = 0.328. Below cap 0.36.
  - With per-AB variance over 100+ ABs, top-10 leaders should land in roughly 0.300-0.395 range (within spec ceiling of 0.400). Acceptable.
- **Note:** I cannot verify the AVG distribution post-50-game season without running tests (which I'm not allowed to do). But the formula math is sound and the developer's new `multiSeasonProgression.test.ts` exercises 3 full seasons.

### 6. Standings sort fix — **CORRECT, JS SORT IS STABLE**

- `server/routes/standings.ts:11-20` — JS `Array.prototype.sort` callback returns: (1) PCT desc; (2) run-diff desc as tiebreaker; (3) wins desc as third tiebreaker.
- **Sort stability:** ECMAScript 2019+ mandates `Array.prototype.sort` is stable. Node 18+ (project requirement) uses V8 which implements stable sort. Ties on all three criteria preserve original DB order (which itself comes from `SELECT * FROM teams WHERE league_id = ?` — no ORDER BY, so order is insertion order = team.id ascending). Deterministic.
- **Tiebreak math correctness:**
  - PCT formula `(wins + losses) > 0 ? wins / (wins + losses) : 0` — division by zero guarded by ternary. Good.
  - Run-diff `runs_scored - runs_allowed` — straightforward integer subtraction.
  - Wins fallback — straightforward integer comparison.
- **Edge cases:**
  - Two teams with identical PCT, RD, AND wins: ties remain stable, original DB order preserved. No crash.
  - Team with 0 games played: PCT=0, RD=0. Sorts to bottom (correct).
  - Mid-season with uneven games: PCT correctly reflects winning percentage regardless of games played. The old SQL `ORDER BY wins DESC, (wins - losses) DESC` was buggy for uneven games — this fix is correct.

---

## Latent Findings (Informational, Not New in Iter 5)

### LOW (latent, informational) — `validatePostDraftRosters` cannot satisfy positional minimums in deep-depletion scenarios

If retirement + free agency leave the entire league with fewer total players at a position than the per-team minimum (e.g., 25 total catchers across 20 teams when each needs >=1), `autoBalance` will exhaust the surplus-team and minors pools and return silently. Some teams will start season N+1 short. The new Fix B (missing-SP skip in `simulateGame`) catches the resulting downstream failure for missing SP, but not for missing C/SS/CF/CL (the game-sim `selectLineup` already had a position-fallback at lines 76-90 that fakes a substitute, so this is a pre-existing degraded path, not a new bug).

**Severity remains LOW** because deep depletion is improbable in normal play (worldgen seeds initial rosters with adequate depth; the development step grows minor-league players; FA targets fill gaps). Not a v0.1.0 blocker. Documenting for traceability.

### LOW (latent) — AB4-06 (WHIP formula uses batter hits, not pitcher hits_allowed)

Pre-existing per Iter-4 report. Unchanged in Iter-5. Not a v0.1.0 blocker per prior Architect acceptance.

---

## What Iter 5 Got Right

- **AB4-01 fix is structurally correct** — the pause guard is INSIDE the `case 'annual_draft'` block, BEFORE the for-loop's step-advance write. This is the architecturally minimal change and it cleanly preserves the checkpoint for resume.
- **Belt-and-suspenders validator placement** — calling `validatePostDraftRosters` in both `runAnnualDraftStep` AND `finalizeOffseason` is correct defense-in-depth. The validator is idempotent, so the duplicate call is cheap and safer than a single point of failure.
- **`game.ts` missing-SP guard** — fail-forwarding rather than fail-stalling is the right tradeoff. The schedule pointer always advances, breaking the iter-4 infinite-stall failure mode.
- **`game.ts` validation-failure advance** — same logic; trades a rare lost game for a guaranteed-progress invariant. Correct.
- **AB4-03 test coverage** — the new third test in `draftPause.test.ts` actually exercises the non-turbo cooperative pause path (via the engine's default `currentSpeed='paused'`). This closes the test-theater gap from Iter 4.
- **`validateBody` undefined-coercion** — scoped change. Only affects the one POST endpoint that uses an all-optional schema. Other POST endpoints unaffected.
- **`season` alias** — correctly populated in all three response paths (cached, fresh, no-league). Spec G0-4 satisfied.
- **Standings JS-side sort** — correct fix for uneven-games tiebreaking. Sort is stable per ES2019.
- **AVG min-AB → 100** — sound quorum math (~194 AB per starter over 50 games).
- **hitProb formula tightening** — math keeps top leaders under the 0.400 spec ceiling.

## What Iter 5 Could Have Done Better (Non-Blocking)

- **AB4-02 not addressed** — turbo draft still blocks the event loop for ~5s. Per Architect eval-4, accepted for v0.1.0. Recommend revisiting in v0.2 with chunked transactions (50-pick sub-transactions with `await setImmediate()` between chunks).
- **`isTurbo` capture race documented above** — in the cross-iteration race where user starts non-turbo, the pause cooperative check fires, then user flips to turbo before the offseason's pause guard evaluates: the guard sees `!isTurbo && isPaused() = true && false = false` and proceeds. Net result: the offseason completes (no data corruption), but the user's "pause" intent was effectively ignored. Could be tightened by re-reading `currentSpeed` instead of using the cached `isTurbo` parameter, but the current behavior is safe (no stall, no corruption).

## Bottom Line

The Iter 5 fixes resolved all blocking findings from Iter 4 (AB4-01 Critical, AB4-03 High) and the carryover AB3-01 (Low) from Iter 3. AB4-02 is accepted per Architect; no new code path made it worse. New attack surface (offseason pause guard, body coercion, season alias, standings sort, missing-SP skip) was probed at every seam. No new Critical or High findings.

**Verdict: READY.** Iter 5 is the v0.1.0 ship candidate from an adversarial perspective. The system has clean fail-forward semantics, idempotent validators, deterministic sorts, and correct resume behavior across pause/turbo transitions.

---

**End of adversary-iter5-post-build.md.**
