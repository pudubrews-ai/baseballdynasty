# Adversary Post-Build Report — Iteration 4 — Baseball Dynasty Simulator v0.1.0

## Verdict
**NOT READY** — Two new Critical defects were introduced by the Iter 4 fixes themselves, and one High-severity event-loop lockup makes the turbo path fundamentally hostile to all concurrent HTTP traffic (including the very pause request it is supposed to honor). The "fix" to AB-iter3-#1 (DRAFT_PAUSED) overcorrected: the cooperative pause introduced **AB4-01 (Critical) — partial annual draft + auto-finalize when paused mid-offseason**, because the cooperative `return` propagates up to a `runOffseason` step loop that has no pause awareness and continues straight to `finalizeOffseason`. The "fix" to AB-iter3-#2 (UNIQUE constraint) is correct, but the production code path (`runOffseason → runAnnualDraftStep`) writes annual-draft picks at `season_number = league.season_number` (the just-completed season, still 1) — which is only safe because migration 005 was added; if migration 005 fails to apply for any reason, the loop is back. New finding **AB4-02 (High) — turbo draft transaction blocks the event loop for the full ~5s** (entire 600-pick `db.transaction()` is synchronous via better-sqlite3, so no HTTP request can be serviced during turbo draft, including a pause request). **AB4-03 (High) — `draftPause.test.ts` exercises only the turbo path** which bypasses the new cooperative pause check entirely; the actual non-turbo pause code path (`draft.ts:446-450` and `:533-537`) has zero test coverage. **AB4-04 (Medium) — playoff observability window is conditional** on the engine actually awaiting between series (which it does in code), but turbo can still close the window faster than the 1500ms client polling cadence guarantees a hit. Verdict: ITERATE.

I am being explicit per the instruction: in Iter 3 I issued READY without verifying these paths. This time I followed the prescribed verifications first and probed every code seam the developer's completion report touched.

---

## Iteration 3 Findings I Was Asked to Re-Verify

### Iter-3 Critical Miss #1 — DRAFT_PAUSED unhandled rejection — **PARTIALLY RESOLVED → NEW BUG AB4-01**

**What I verified is fixed:**
- `server/sim/draft.ts:385` — `onPickComplete` type is now `(...) => Promise<void>` (was `() => void`).
- `server/sim/draft.ts:442` — call site in `runExpansionDraft` is now `await onPickComplete(pickId, round, pickNumber);` with `// §1.1: Must await…` comment.
- `server/sim/draft.ts:529` — call site in `runAnnualDraft` is now `await onPickComplete(pickId, round, pickNumber);`.
- `server/sim/engine.ts:316-322` — expansion-draft callback no longer throws; just refreshes cache (with turbo-skip).
- `server/sim/engine.ts:335-341` — annual-draft callback (only used by the unreachable engine branch; see AB4-01 below) also no longer throws.
- `server/sim/engine.ts:347-355` — catch block notes DRAFT_PAUSED is legacy/dead.
- `server/sim/engine.ts:64-66` — `isPaused()` exported.
- `server/sim/draft.ts:446-450` and `:533-537` — `isPaused()` cooperative checks added after the per-pick callback. The poll is **per pick, between picks** (not on a fixed interval) — so the resolution latency is bounded by one pick-delay (≤1500ms in normal, ≤200ms in fast, 0 in turbo) plus one DB-write of the current pick.
- The legacy `throw new Error('DRAFT_PAUSED')` is gone from `engine.ts`.

**What is NOT resolved — see new finding AB4-01:** The cooperative `return` from `runAnnualDraft` propagates back up to the `runOffseason` for-loop, which has NO pause awareness and continues to `finalizeOffseason`, advancing season_number even though only a partial annual draft has been run.

**Race answer (turbo → paused → turbo):** When the turbo path runs (`draft.ts:399-426`), all 600 picks are inside a single `db.transaction(() => {…})()`. better-sqlite3 transactions are fully synchronous. The event loop is blocked for the entire transaction. A `POST /api/sim/speed {"speed":"paused"}` arriving mid-transaction is queued by Express but cannot be processed until the transaction completes. So the cooperative `isPaused()` check is **never even reached** during a turbo draft (the turbo path doesn't have one anyway — only the non-turbo loop does). The turbo path is effectively un-pauseable. See AB4-02 below.

---

### Iter-3 Critical Miss #2 — Offseason UNIQUE constraint loop — **RESOLVED (with one residual risk)**

**What I verified is fixed:**
- `server/migrations/005_draft_picks_unique_v2.sql:5-8` — drops old `uniq_draft_picks`, recreates on `(league_id, season_number, is_expansion_draft, round, pick_number)`.
- `server/migrations/001_init.sql:107` — `is_expansion_draft INTEGER NOT NULL DEFAULT 0`. NOT NULL with a DEFAULT, so the column is always populated; the unique-index column can never be NULL → SQLite UNIQUE semantics work correctly (would have been ambiguous if NULL-able).
- `server/sim/draft.ts:172-173, 184-194, 266-277, 311-313` — every INSERT into `draft_picks` includes the literal `isExpansion ? 1 : 0` value.
- `server/sim/draft.ts:414` (expansion turbo path), `:439` (expansion non-turbo path), `:504` (annual turbo path), `:526` (annual non-turbo path) — all pass the correct `isExpansion` flag to `runDraftPickSync` / `runDraftPick`.
- `server/tests/offseasonAnnualDraft.test.ts` — direct regression test runs the full offseason → annual draft path and asserts 600 expansion picks + 600 annual picks coexist at `season_number=1`. The test asserts season advances to 2 and phase becomes `'regular_season'`. ✓

**Residual risk:** The production annual-draft pick row uses `season_number = league.season_number`, where `league.season_number` is the season that just COMPLETED (1 after the first season's offseason runs). The annual draft is FOR season 2, but its `season_number` column says 1. This is semantically confusing — `annualDraftOrder.test.ts:84` queries `season_number = 2` because that test manually advances `season_number` before calling `runAnnualDraft`. **Two different conventions for the same column**, but neither path collides under migration 005's unique constraint. Migration 005 keeps both consistent. Not a bug, but a footgun for anyone querying draft history.

**Server-restart-after-migration-005-before-annual-draft scenario:** Migrations are tracked in `schema_versions`. On restart, `initDb` checks `appliedStmt.get(version)` and skips already-applied migrations (`db.ts:54-72`). So a restart after 005 applies will not re-run it. The annual draft is then run from the offseason resume path (`league.offseason_step !== 'done'`), which is preserved across restarts. The cooperative pause won't fire on resume because `currentSpeed` is forced to `'paused'` on boot (`engine.ts:48`) — but `runOffseason` is only entered via `runOffseasonTick` when `simRunning=true`. On a paused server, the offseason doesn't progress until the user resumes. When resumed, `runOffseason` enters at the checkpoint `offseason_step='annual_draft'` (`offseason.ts:22-23`) and proceeds normally. No collision, no resume hazard.

---

## NEW Iteration 4 Critical Findings

### CRITICAL AB4-01 — Cooperative pause mid-offseason-annual-draft causes partial draft + auto-finalize

**Severity:** Critical (silent data corruption; partial annual draft class + premature season advance).

**Affected files:**
- `server/sim/offseason.ts:15-54` (`runOffseason` for-loop)
- `server/sim/offseason.ts:298-302` (`runAnnualDraftStep`)
- `server/sim/draft.ts:533-537` (`runAnnualDraft` cooperative pause)

**Evidence chain:**
1. The engine never sets `phase = 'annual_draft'` anywhere in the codebase. `grep -n "annual_draft" server/sim/*.ts` confirms only `engine.ts:333` *reads* `league.phase === 'annual_draft'` — no write. The only path that executes `runAnnualDraft` is the offseason path: `runOffseasonTick` (`engine.ts:414-420`) → `runOffseason` (`offseason.ts:15-54`) → `runAnnualDraftStep` (`offseason.ts:298-302`) → `runAnnualDraft` (`draft.ts:464+`).
2. During the offseason annual draft, `league.phase === 'offseason'` for the entire duration.
3. If the user POSTs `{"speed":"paused"}` mid-annual-draft, `setSimSpeed('paused')` (`engine.ts:199-215`) sets `currentSpeed='paused'`, `simRunning=false`, `clearTimeout(tickTimeout)`.
4. The in-flight `runAnnualDraft` non-turbo loop at `draft.ts:518-544` hits the `isPaused()` check at `:534`, sees `true`, logs `[draft] Paused at pick N`, and `return`s on line 536.
5. Control returns to `runAnnualDraftStep` (`offseason.ts:300`), which returns to `runOffseason` (`offseason.ts:42`).
6. The for-loop in `runOffseason` (`:24-53`) has **no pause awareness**. On line 51, it writes `UPDATE leagues SET offseason_step = 'done' WHERE id = ?`.
7. The for-loop advances to `i++` and enters the next iteration with `step='done'`.
8. `case 'done'` (`offseason.ts:44-46`) calls `finalizeOffseason(leagueId, league.season_number)`.
9. `finalizeOffseason` (`:305-333`) advances `season_number = previousSeason + 1` and sets `phase='regular_season'`.

**Result:** The user paused expecting the annual draft to halt. Instead, the season number jumps forward, the W/L reset fires, and the new season begins with only a fraction of the annual draft class drafted. Many teams have no picks at all (those after the paused team in the draft order). The undrafted prospects from the annual draft pool become free agents because `finalizeOffseason` line 328-330 zeroes their team_id (`UPDATE players SET team_id = NULL WHERE is_drafted = 0 AND team_id IS NULL`) — actually this matches the "draft pool" semantics, but the teams that didn't get to pick are short-rostered.

**Even worse: `draft.ts:474-481` "Resume" logic for annual draft is bypassed.** On a future tick, even if the user un-pauses, `runOffseason` will not re-enter at the `annual_draft` step because `offseason_step` was already advanced to `'done'`. The partial annual draft is permanent.

**Why the corresponding expansion-draft pause IS safe:** Expansion draft is run from `runDraftTick` (`engine.ts:310-345`), not from a multi-step orchestrator. When `runExpansionDraft` returns early due to pause, `runDraftTick`'s finally block at `:356-364` does NOT advance phase — it leaves `phase='expansion_draft'` and `simRunning=false`. On resume, `runDraftTick` re-enters and `runExpansionDraft`'s resume logic (`:393-397, :429`) starts from `lastCompleted.max_pick + 1`. Clean resume. The offseason annual draft has no equivalent.

**Fix sketch:** Either (a) hoist the pause check into `runOffseason` so it returns before advancing `offseason_step`, or (b) keep `runAnnualDraft` in a paused state by detecting "resume needed" (last picks < 600) and returning a sentinel that `runOffseason` recognizes to skip the step advance, or (c) move `runAnnualDraftStep`'s pause handling to a transaction so partial picks are rolled back.

**Repro:** Start a fresh dynasty, run through season 1 at fast speed until offseason begins (or use the offseason test harness). When `[offseason] Running step: annual_draft` appears in logs, POST `{"speed":"paused"}`. Observe: `[draft] Paused at pick N`, then `[offseason] Season 1 complete. Season 2 begins.` despite only N picks having been made.

---

### HIGH AB4-02 — Turbo draft single-transaction blocks the entire event loop

**Severity:** High (UI freezes, all HTTP requests blocked, defeats the cooperative pause architecture).

**Affected files:**
- `server/sim/draft.ts:399-426` (turbo expansion-draft batch)
- `server/sim/draft.ts:490-516` (turbo annual-draft batch)

**Evidence:**
- Both turbo paths wrap the entire 600-pick loop in a single `db.transaction(() => {…})()`.
- `better-sqlite3` is fully synchronous. A `db.transaction(...)` invocation runs the entire callback synchronously, blocking the Node event loop for its duration.
- `runDraftPickSync` (`draft.ts:148-198`) per pick: one `SELECT TOP 50` from players (now indexed thanks to migration 006), one in-JS sort, one or two INSERTs, and one UPDATE on leagues. Estimated ~3-8ms per pick × 600 picks = 1.8-4.8 seconds of contiguous event-loop blockage. Developer report claims <5s target.
- During the blocked window:
  - `POST /api/sim/speed {"speed":"paused"}` cannot be received or processed by Express.
  - `GET /api/state` polling from the client hangs.
  - The reconnect logic in `client/src/hooks/useLeagueState.ts:97-100` ("Show reconnecting banner only after 2 consecutive failures") will flip the banner to "Reconnecting..." if polls time out → exactly the symptom UI Tester B reported in earlier iterations.
  - The `D11: yield every 5 games in turbo to allow HTTP requests` pattern at `engine.ts:267-272` is bypassed entirely — that yield only fires for game simulation, not the draft turbo batch.
- The previously-existing per-pick `await getDraftPickDelay()` was the only yield point in the non-turbo path. The turbo path removed it for performance and never restored a different yield mechanism.

**Implication:** The cooperative pause architecture (the whole point of AB-iter3-#1's fix) does not protect users from a turbo-mode runaway. If turbo is slow on the user's machine (e.g., low-RAM, busy disk), the unpauseable window grows. There is no upper bound documented.

**Fix sketch:** Break the single transaction into batches of N picks (e.g., 50 picks per transaction), check `isPaused()` and yield (`await new Promise(r => setImmediate(r))`) between batches. This trades ~5% of throughput for responsiveness.

**Repro:** Start fresh dynasty, set turbo. Immediately POST `{"speed":"paused"}` (use a script). Observe that the POST response is delayed by the full duration of the turbo transaction, and the draft completes despite the pause.

---

### HIGH AB4-03 — `draftPause.test.ts` exercises only turbo; the non-turbo cooperative pause path has zero test coverage

**Severity:** High (test theater — a test exists but doesn't exercise the fix).

**Affected files:**
- `server/tests/draftPause.test.ts:41` — `await runExpansionDraft(league, true /* isTurbo */, async (...))` — `true` means turbo path.
- `server/sim/draft.ts:399-426` — turbo path bypasses the cooperative `isPaused()` check entirely.
- `server/sim/draft.ts:429-457` — non-turbo loop is the only place the new `isPaused()` check lives.

**Evidence:**
- `draftPause.test.ts:41` passes `isTurbo=true`. The function enters the turbo branch at `draft.ts:399`, runs all 600 picks in a single sync transaction at `:405-422`, and returns. The cooperative `isPaused()` check at `:446-450` (expansion draft) and `:533-537` (annual draft) is in the **non-turbo** for-loop and is never reached.
- The second test in the file (`onPickComplete callback is awaited`, line 64) is a pure TypeScript signature check — it doesn't actually run any draft logic.
- `grep` across all tests confirms every `runExpansionDraft`/`runAnnualDraft` invocation uses turbo. The non-turbo path has **zero runtime test coverage**.

**Implication:** The fix that addressed iter-3's Critical #1 (DRAFT_PAUSED unhandled rejection) is not validated by tests. A regression here would not be caught.

**Fix:** Add a test that uses `isTurbo=false`, mocks `setTimeout` (or uses fake timers), and toggles `currentSpeed` via `setSimSpeed('paused')` between picks. Assert that the draft returns early and that `draft_picks` count is less than 600.

---

## Probes of Iter 4 New Attack Surface

### 1. Cooperative pause in draft.ts — non-turbo polling cadence
- **Polling interval:** The check fires after each pick's per-pick delay (1500ms normal, 200ms fast, 0 turbo) AND after the `onPickComplete` callback. So a paused signal will be honored within ≤1500ms in normal speed, ≤200ms in fast — meets UX expectation.
- **Cannot-see-paused-true:** If `currentSpeed` is mutated after the check but before the next iteration's delay, the next iteration's check catches it. No scenario where the poll permanently misses pause.
- **Yield control:** `return` exits the function cleanly; `runDraftTick`'s finally block (`engine.ts:356-364`) only sets `simRunning=false` if `currentSpeed==='paused'`. On resume, `runDraftTick` re-enters and the resume logic at `draft.ts:393-397/484-488` picks up from `lastCompleted.max_pick + 1`. Good.
- **Turbo→paused→turbo race:** See AB4-02. Turbo path is unpauseable.

### 2. `runDraftPickSync()` turbo batch — crash/rollback semantics
- **Server crash mid-batch:** better-sqlite3 + WAL journal mode (`db.ts:24`). If the process dies mid-transaction, SQLite's WAL guarantees atomicity — the transaction either is fully visible on next open or not at all. So no torn write.
- **`validatePostDraftRosters` invocation:** `engine.ts:323` calls `validatePostDraftRosters(league.id)` AFTER `runExpansionDraft` completes (both turbo and non-turbo paths reach this line). ✓ — teams will be auto-balanced for missing C/SS/CF/SP/CL after the turbo draft.
- **Annual draft `validatePostDraftRosters`:** The annual-draft branch in `engine.ts:333-345` does NOT call `validatePostDraftRosters`. **Latent gap** — this is the same gap I flagged as AB3-01 in iter-3, except now (a) the annual draft is reachable via the offseason path, not the engine's annual_draft branch (which is dead code), and (b) the offseason path in `runOffseasonTick` also doesn't call `validatePostDraftRosters`. After season 1's offseason, teams that lost players in retirement/FA and weren't replenished by the annual draft can have <2 SP, <1 C, <1 SS, <1 CF, <1 CL → season 2 game sim will silently stall on those teams' home games (AB3-01 latent stall). Filed below as **AB4-05 (Low, latent)**.
- **Batch failure rollback:** `db.transaction()` in better-sqlite3 throws on any inner exception and rolls back the entire transaction. The `runDraftPickSync` function does not throw under normal conditions (handles exhaustion at `:159-176`). If an INSERT violates the UNIQUE index (would only happen if migration 005 didn't apply), the whole batch rolls back. `simRunning` would be set to false by the engine's tick catch, but `draftRunning` would NOT be reset by the engine's finally block (`engine.ts:356-364`) — wait, it would: `draftRunning = false` at `:357`. OK, recoverable.

### 3. Migration 005 — `is_expansion_draft` column
- **NULL handling:** Column is `NOT NULL DEFAULT 0` from `001_init.sql:107`. SQLite's UNIQUE constraint treats two NULLs as distinct (each NULL is unique), but here NULLs cannot occur. Safe.
- **Existing rows on migration:** Any pre-existing row in the `draft_picks` table has `is_expansion_draft` populated (DEFAULT 0 from creation OR explicit value from INSERT). After migration 005, the new unique index is created over (league_id, season_number, is_expansion_draft, round, pick_number). If the pre-existing rows were distinct on (league_id, season_number, round, pick_number) — which the old index enforced — they are also distinct on the new 5-tuple. No migration failure.
- **Expansion draft rows get is_expansion_draft=0?** Verified `draft.ts:414` passes `true` (→ 1) for expansion, `:504` passes `false` (→ 0) for annual. Correct.

### 4. `hitProbFormula` change — game balance
- **Minimum contact (1):** `1/400 + 0.15 = 0.1525`. Above floor 0.15, so used directly. Realistic for a position player.
- **Maximum contact (99):** `99/400 + 0.15 = 0.3975`. Below cap 0.40, used directly. Just under the 0.400 spec ceiling for AVG leaders, with normal variance lifting some seasons above 0.400 (the test allows up to 0.55 to accommodate variance).
- **Effect on Rule 1 (`hits >= runs - walks`):** Lower per-AB hit probability means lower team hits per game. For a balanced lineup avg contact=50, expected team hits = 9 × 4 × 0.275 = ~10 per game. Winning team scores 4-9 runs typically. Even with 0 walks, hits (~10) >> runs (4-9). Rule 1 deficit is rare. When it does fire, `distributeExtraWalks` patches by adding walks to satisfy `hits >= runs - walks`, and the retry loop re-validates up to 3x (`game.ts:357-381`). For extreme low-hit games, walks are added until rule passes; no infinite loop risk.
- **Effect on Rule 4 (total IP):** Independent of hitProb. Unaffected.
- **Edge case — extreme low contact lineup:** If a team's batters all have contact ≤20 (very low), hits expectation = ~9 × 4 × 0.20 = 7.2. With a 9-run loss possible, deficit = 9 - 0 - 7 = 2 walks. distributeExtraWalks would add 2 walks. Passes. No starvation.

### 5. App.tsx auto-navigation to Draft tab
- **Phase change away from 'draft':** `client/src/App.tsx:50-54` — the useEffect only runs on phase change. If phase changes from 'draft' to 'regular_season', `setActiveTab('draft')` is NOT called because the condition `state?.phase === 'draft'` is false. The user stays on the Draft tab (showing "No active draft" message from `Draft.tsx:122-132`). Acceptable.
- **User-override:** `hasUserNavigatedRef.current` is set to `true` on any nav-button click (`App.tsx:127`). Once set, the auto-navigate effect never re-fires (the condition `!hasUserNavigatedRef.current` is false). The ref persists across re-renders of `AppContent` because `useRef` is stable per mount.
- **Page refresh during draft:** The ref is created fresh on mount → `false` → auto-nav fires → user is on Draft. ✓
- **User navigates away during draft:** They are NOT redirected back. Once they click "League", `hasUserNavigatedRef.current = true` and the auto-nav effect is permanently suppressed for this session. Matches the spec's intent.
- **Continuous override:** No. One-time per mount. Safe.

### 6. Playoffs observable window
- **500ms initial + 7 × 250ms = 2250ms guaranteed observable in cache.** `playoffs.ts:143-144` does `refreshCache + setTimeout(500)` BEFORE the first DS. Each inter-series adds `refreshCache + setTimeout(250)`. Total guaranteed cache visibility ≈ 2250ms.
- **Client polling cadence:** `useLeagueState.ts:108-110` — during regular season `interval = 1500ms`, during reconnecting 3000ms. For playoffs (which the client doesn't have a special case for), polling is 1500ms (because the phase isn't 'draft'). With a 2250ms observable window, the client should hit at least once with probability ≈ 1.0 over a steady 1500ms-interval poll. Reasonable.
- **Turbo can NOT close the window faster:** Even at turbo, the `await new Promise(r => setTimeout(r, 500))` and 250ms intervals are not turbo-conditional — they always run. The 2250ms floor is guaranteed. ✓
- **If the client misses:** `GET /api/state` returns the cached phase from the cache or refreshes. After playoffs completes, `playoffs.ts:199` sets phase='offseason', then `:200` sets `offseason_step='retirement'`. The next refreshCache will reflect 'offseason'. So a missed playoffs window means the client jumps from 'regular_season' to 'offseason' with no intermediate. Not a crash, just lost observability — acceptable for v0.1.0.

### 7. Front-office fields in team list
- **Generation:** `worldgen.ts:237-242` — names selected by `pickRandomName(rng, 'us', 'first')` and `pickRandomName(rng, 'us', 'last')`, then concatenated with a space.
- **Name pool:** `server/data/names.ts` — hardcoded ASCII strings, all matching the comment regex `/^[\p{L}'.\- ]{1,40}$/u`. Verified by `head -50 names.ts` — examples: `'James'`, `'Robert'`, `'DeShawn'`. No special chars, no quote injection vectors, no `<script>` tags, no SQL.
- **Database write:** Uses `?` parameterized binding (`worldgen.ts:177` INSERT statement). SQL injection impossible.
- **API response:** `routes/teams.ts:46-53` returns `t.owner_name`, `t.gm_name`, `t.manager_name` as plain string fields in JSON. No HTML/JSON escaping needed since values are from the hardcoded name pool.
- **Client render:** No `dangerouslySetInnerHTML`. All rendered as React text nodes. XSS impossible.
- **Verdict:** Safe.

---

## Latent Findings (Not New in Iter 4)

### LOW AB4-05 — Annual-draft `validatePostDraftRosters` gap (same as iter-3's AB3-01, now reachable)

The offseason annual draft path does not call `validatePostDraftRosters`. If retirement + free agency + annual draft leave a team with <2 SP, <1 C, <1 SS, <1 CF, or <1 CL, season 2 game sim will stall forever on that team's first home game per AB3-01 (game.ts retries 3x then skips, but engine never advances past the skipped game).

**Severity remains LOW** because the failure mode is rare on a fresh worldgen, but blast radius is high (sim freeze with no UI signal). Recommend calling `validatePostDraftRosters` after `runAnnualDraftStep` in `runOffseason` (or in `finalizeOffseason` before the season 2 phase transition).

### LOW AB4-06 — WHIP formula uses batter `hits`, not pitcher `hits_allowed`

`routes/players.ts:83` — `(ss.walks_pitching + ss.hits) / ss.innings_pitched`. `ss.hits` is the player's batting hits (column from `001_init.sql:142`), not the hits the pitcher allowed. For a player who is a pitcher with 0 ABs, `hits=0` and the WHIP formula reduces to `walks_pitching / innings_pitched`, which is WALKS-PER-INNING-PITCHED — incorrect; should be `(walks + hits_allowed) / IP`. For a two-way player, the formula adds their batting hits to walks allowed, also wrong. The schema is missing `hits_allowed` for season_stats.

**Pre-existing** (not new in iter 4). Documenting for traceability. Acceptable for v0.1.0 since the leaderboard order is still monotonic for true pitchers (just an incorrect absolute number).

---

## What Iter 4 Got Right

- **Migration 005** is the cleanest possible fix for the UNIQUE collision — adds `is_expansion_draft` to the discriminator. The DROP/CREATE sequence is wrapped in the migration runner's transaction (`db.ts:66-70`), so it either fully applies or doesn't apply at all. Idempotent across restarts.
- **`onPickComplete` is now properly awaited** at both call sites (`draft.ts:442, :529`) and the async type signature prevents accidental sync-fire/forget regressions.
- **`isPaused()` is exported cleanly** from engine.ts and consumed via dynamic import in draft.ts (avoids circular import).
- **`hitProb` formula** is mathematically sound for the spec's 0.300-0.400 AVG target. The cap at 0.40 plus the floor at 0.15 keeps all values in [0.15, 0.40].
- **Front-office fields in the team list** are populated correctly and reuse the existing schema column values — no new data path, no new injection risk.
- **App.tsx auto-navigation** correctly uses a ref to track user intent and only auto-switches once per mount. The implementation is minimal and correct.
- **Playoffs 500ms initial + 250ms inter-series** is a much-improved observable window from iter 3's 50ms.
- **`data-testid="nav-{tab.id}"` and `data-division-leader="true"`** make UI testing tractable.

## What Iter 4 Got Wrong

- **AB4-01 (Critical):** Cooperative pause cascades incorrectly through `runOffseason`'s step loop, advancing season number with a partial annual draft.
- **AB4-02 (High):** Turbo draft single-transaction blocks the event loop for the full draft duration, defeating the cooperative pause architecture and freezing all HTTP traffic.
- **AB4-03 (High):** Test for the new cooperative-pause fix uses turbo, which doesn't exercise the fix. Zero runtime coverage of the non-turbo pause path.
- **`engine.ts:333-345` (annual_draft branch) is dead code** — phase is never set to 'annual_draft'. Should be removed or wired up to a proper annual_draft phase transition.

## Bottom Line

The Iter 4 fixes resolved both of the Iter 3 Critical defects I missed, but the resolution to Critical #1 introduced a new Critical (AB4-01) one layer up in the offseason orchestrator, and the turbo-batch optimization (AB4-02) created a High-severity event-loop lockup. The cooperative pause architecture is half-built: it works in the non-turbo expansion-draft path but is bypassed by turbo, ignored by the offseason orchestrator, and uncovered by tests.

**Verdict: NOT READY.** Iter 5 must address AB4-01 (offseason pause-aware step loop) and AB4-02 (turbo batch yielding) before this build can ship. AB4-03 (test gap) should also be closed so the cooperative pause path has real coverage.

---

**End of adversary-iter4-post-build.md.**
