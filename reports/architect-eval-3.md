# Architect Evaluation 3 — Baseball Dynasty Simulator v0.1.0

**Iteration:** 3 (Phase 2 — post-build)
**Reviewer:** Architect
**Inputs:** `ciso-iter3-post-build.md`, `adversary-iter3-post-build.md`, `api-tester-iter3-results.md`, `ui-tester-a-iter3-results.md`, `ui-tester-b-iter3-results.md`, `architect-eval-2.md`, `developer-instructions-3.md`, and direct inspection of the source at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`.

---

## Decision: ITERATE

Iteration 3 closed a large fraction of Iteration 2's defects — every Critical from Iter 2 is RESOLVED (Draft tab renders, Minors tab does not crash, picksDelta streams correctly, snake-order pick numbering is right). Most Iter 2 High and Medium findings are also closed.

However Iteration 3 introduced (or left latent) defects that make the build unshippable:

1. **Server crash on DRAFT_PAUSED (Critical, regression introduced in Iter 3).** Setting `speed=paused` during the draft causes `server/sim/engine.ts:314` to throw inside an `await runExpansionDraft(...)` callback. The throw IS caught at engine.ts:329-336, but UI Tester B reproducibly observed the server process terminating. The "Reconnecting..." banner appeared in the browser and all subsequent UI tests failed — definitive evidence the Node process is dying. See §1 of new instructions for root cause and fix.

2. **Offseason UNIQUE constraint loop (Critical, latent → fatal in Iter 3).** The annual draft inserts picks with `season_number = league.season_number`, but `league.season_number` is still the OLD season (1) during the offseason. The expansion draft already inserted picks with `season_number = 1`, and the UNIQUE index `(league_id, season_number, round, pick_number)` therefore rejects the annual draft's first pick. This blocks every league from ever reaching season 2. UI Tester B observed the offseason looping forever on the constraint error.

3. **Draft UI not functional end-to-end (High).** The Draft tab DOES render now, but: the app defaults to League tab even when phase='draft' (no auto-navigation), `draft-pick-reveal` never renders during active draft, `draft-onclock-team` does not appear in the DOM in any observed state, and turbo draft takes 18s (3.6× the 5s spec ceiling).

4. **AVG and ERA still unrealistic (High).** Min-AB raised to 150 and min-IP raised to 50 in Iter 3, but the underlying batting simulation (`game.ts:459` — `hitProb = clamp(player.contact/200 + 0.1, 0.15, 0.45)`) produces a hit probability of 0.45 for any player with contact ≥ 70. Over 150 ABs, an inherently 0.450 hitter regresses to ~0.450, not the spec's 0.200-0.400 range. The min-AB filter was the wrong lever; the simulation math is the actual defect.

5. **Front-office data still null in `GET /api/teams` list endpoint.** Architect ruled this a false-positive in Iter 2 (spec-ambiguous list-vs-detail). I am REVERSING that ruling — the spec test (Group 1.8-1.10) explicitly asserts these fields on the list endpoint and the UI Tester B verified the data is rendered in the detail panel. Add the fields to the list response. The marginal payload cost is trivial.

6. **No observable `playoffs` phase.** Engine code is correct (50ms yields between series, phase set before series begins) but the API tester polling every 100ms-5s during turbo (a season completes in ~3s) never caught the phase. The cache IS refreshed by `runOneTick` BEFORE the playoff tick begins, so phase='playoffs' should be in the cache. The actual gap: the regular_season tick sets phase='playoffs' at `engine.ts:382`, returns, refreshCache fires at `engine.ts:300`, then the next tick fires within ~0ms (setImmediate in turbo) and runs ALL playoffs synchronously. The 50ms × 7 inter-series yields total 350ms of `phase=playoffs` cache visibility. That should be observable, but apparently isn't. See investigation in §2 below — the fix is to also refresh the cache at the START of `runPlayoffTick` (defense in depth) and during `runPlayoffs` after each series.

CRITICAL severity findings (#1 and #2) mandate ITERATE per build-rules §Severity Classification. The remaining items would have been individually downgradeable to "v0.2 backlog" but together they prevent a clean COMPLETE.

---

## Source-Code Investigation Findings

### Finding 1 — DRAFT_PAUSED unhandled throw (Critical)

**File:** `server/sim/engine.ts:305-345`

**Evidence:** The callback passed to `runExpansionDraft` (line 311-316) throws `new Error('DRAFT_PAUSED')` when `currentSpeed === 'paused'`. This throw propagates through `await runExpansionDraft(...)` and is caught at `engine.ts:330-336` (specific case for `DRAFT_PAUSED`) — the catch logs "Draft paused" and sets `simRunning = false`. The finally block at `engine.ts:337-345` only sets `simRunning = false` when `currentSpeed === 'paused'`.

So why does the server "crash"? Two possibilities:
1. The throw happens INSIDE the `refreshCache` await on line 312 — actually no, the throw is at line 314 AFTER refreshCache awaits. But refreshCache is `await`ed in the callback, so the throw is well inside an async context.
2. The throw propagates UP to `runDraftPick` → `runExpansionDraft` (which awaits onPickComplete) → back into `runDraftTick`'s try block. The catch at line 329 SHOULD swallow it. UNLESS the test triggers the throw between the `await runExpansionDraft` returning and `validatePostDraftRosters` at line 317 — but that path goes through the try block too.

**Actual root cause:** The `await refreshCache(league.id)` at line 312 succeeds, then the throw on line 314 fires. This rejects the promise returned by the `onPickComplete` callback. That promise is awaited inside `runDraftPick` (no — `runDraftPick` doesn't await `onPickComplete`)... let me re-check. `runExpansionDraft` calls `onPickComplete(pickId, round, pickNumber)` at `draft.ts:356`. This is NOT awaited (`onPickComplete` returns void by signature). But the callback IS an async function that returns a promise. So the throw becomes an UNHANDLED PROMISE REJECTION which Node default behavior is to log and exit (in newer Node versions: `--unhandled-rejections=throw` is default since Node 15).

This is the bug: `draft.ts:355-357` invokes `onPickComplete` without `await`. Combined with the callback being an async function that throws, this creates an unhandled rejection.

**Fix:** Two changes needed:
1. `draft.ts:355-357`: `if (pickId && onPickComplete) { await onPickComplete(pickId, round, pickNumber); }` — await the callback.
2. `engine.ts:311-316` (and `:411-413` for annual): Wrap the throw so it propagates cleanly through await, OR change the pause mechanism to use a flag check instead of throw.

The architecturally cleaner fix is #2: replace the throw with a cooperative cancellation. The draft loop in `draft.ts:343-364` should check a `wasPausedRef.current` flag between picks and exit gracefully.

### Finding 2 — Offseason UNIQUE constraint loop (Critical)

**File:** `server/sim/draft.ts:212-215` and `server/migrations/003_draft_picks_unique.sql`

**Evidence:**
- Migration `003_draft_picks_unique.sql:11-12` creates UNIQUE INDEX `uniq_draft_picks ON draft_picks(league_id, season_number, round, pick_number)`.
- `draft.ts:212-215` inserts annual draft picks with `season_number = league.season_number`. During the offseason of season 1, `league.season_number` is still **1** (incremented only by `finalizeOffseason` at `offseason.ts:322` after the annual draft completes).
- The expansion draft (also at season 1) already inserted `(league_id, season_number=1, round=1, pick_number=1, ...)`.
- When the annual draft tries to insert `(league_id, season_number=1, round=1, pick_number=1, ...)`, the UNIQUE constraint rejects it.
- The error propagates back to `runOffseasonTick` (`engine.ts:395-401`) which catches and logs, then returns. The offseason_step is STILL `'annual_draft'` (not advanced), so the next tick re-enters `runOffseason` from the same step, attempts the same insert, fails identically. **Infinite loop.**

**Fix options:**
1. Insert annual draft picks with `season_number = league.season_number + 1` (the upcoming season the picks are FOR).
2. Add `is_expansion_draft` to the UNIQUE index: `(league_id, season_number, is_expansion_draft, round, pick_number)`.
3. Reset the index of draft_picks per-season (delete previous season's picks before inserting new ones).

**Architect ruling: Option 2.** Adding `is_expansion_draft` to the unique constraint is the most semantically correct fix — expansion and annual drafts are distinct events that happen to share `(season_number=1, round=1, pick_number=1)` at the moment of the first annual draft. Option 1 would break the existing test `annualDraftOrder.test.ts:84` which queries `season_number = 2 AND is_expansion_draft = 0`. Option 3 destroys data. Migration `004_draft_picks_unique_v2.sql` should drop the old index and create the new one.

This fix also resolves the `getAnnualDraftOrder` test scaffolding which queries by `season_number = 2`. Re-check that test passes after the migration.

### Finding 3 — Draft auto-navigation missing

**File:** `client/src/App.tsx:41-130`

**Evidence:** `App.tsx:42` initializes `activeTab='league'`. The only `setActiveTab('draft')` calls are at line 52 and 62 — both inside the `handleNewDynasty` flow. When the user lands on the app with a draft already in progress (or if they navigate away during a draft), the app shows the League tab. No effect-based auto-navigation exists.

**Spec interpretation:** Spec line 282 lists `[data-testid="draft-board"]` as a top-level testid. UI Tester B reasonably interpreted "draft-board visible when phase=draft" as auto-render. The spec is ambiguous; I am ruling that auto-navigation IS required when phase='draft' AND the user has not explicitly chosen another tab.

**Fix:** Add to App.tsx:
```tsx
const hasUserNavigatedRef = useRef(false);
useEffect(() => {
  if (state?.phase === 'draft' && !hasUserNavigatedRef.current) {
    setActiveTab('draft');
  }
}, [state?.phase]);
// In the tab click handler, set hasUserNavigatedRef.current = true.
```

### Finding 4 — `draft-pick-reveal` never renders

**File:** `client/src/views/Draft.tsx:69-92, 157-180`

**Evidence:** The reveal element is conditional at line 157: `{latestPick && latestPick.first_name && (...)}`. `latestPick` is set at line 89 only when `newPicks.length > 0` AND `newPicks.length <= 20` (the batch-mode branch at line 76 does NOT update `latestPick`). The initial load at line 56-67 calls `/api/state?sincePickId=0` which returns ALL picks. If there are >20 picks already, the batch-mode triggers and `latestPick` is never set.

For a fresh dynasty with NO picks yet, `picksDelta` is initially empty. As picks arrive via polling (one at a time at normal speed), `newPicks.length === 1`, so the `else` branch at line 83-91 runs and `latestPick` IS set. So in principle this should work.

But UI Tester B's draft already had 15098 picks (from prior runs). On their fresh page load, the initial GET /api/state?sincePickId=0 returned the picks bootstrapped from `lastPickIdRef.current = lastPickId - 50` (per useLeagueState.ts §1.3 bootstrap). So picksDelta on the first poll has up to 50 picks — triggering batch mode → `latestPick` never set.

**Fix:** In Draft.tsx line 76-91, ALWAYS set `latestPick` to the last item in `newPicks` regardless of batch mode. The reveal element will then appear whenever any pick arrives, including post-bootstrap on a fresh page load.

```tsx
useEffect(() => {
  if (picksDelta.length === 0) return;
  const newPicks = picksDelta as DraftPick[];
  setAllPicks(prev => {
    const existingIds = new Set(prev.map(p => p.id));
    return [...prev, ...newPicks.filter(p => !existingIds.has(p.id))];
  });
  // Always set latestPick to the last item, even in batch mode
  setLatestPick(newPicks[newPicks.length - 1] ?? null);
}, [picksDelta]);
```

### Finding 5 — `draft-onclock-team` missing

**File:** `client/src/views/Draft.tsx:103-107, 146-150`

**Evidence:** The element at line 146 renders only when `onClockTeamId` is truthy. `onClockTeamId` is set at line 103-107 only when `teamsInDraftOrder.length > 0 && state?.phase === 'draft'`. After the draft completes (phase='regular_season' or later), `state?.phase !== 'draft'` and the early return at line 127 fires, so the element is never reachable in non-draft phases.

For UI Tester B, the draft was active during their test but they couldn't see the element because the app was on the League tab (Finding 3). Once auto-navigation is fixed, this element should be visible during active draft.

**Fix:** No code change needed for the missing-element issue — it's a symptom of Finding 3. However, the element should ALSO appear when `state?.phase === 'draft'` AND `teamsInDraftOrder.length === 0` (draft order not yet fetched) — show a placeholder or "Loading draft order...".

### Finding 6 — Turbo speed 18s for 600 picks

**File:** `server/sim/draft.ts:343-364` and `server/sim/engine.ts:33-41`

**Evidence:** `getDraftPickDelay()` returns 0 for turbo (engine.ts:38). The draft loop's `if (delay > 0)` at draft.ts:361 short-circuits the `setTimeout(0)` call, so there's no per-pick yield. But the test showed 18s for 600 picks = 30ms per pick.

The remaining bottleneck is the per-pick DB work in `runDraftPick` (`draft.ts:146-234`):
- `selectTopN` runs a SQL query that scans top 50 by `estimated_pav` from `players` table (filtered by `is_drafted = 0`). After 200+ picks, the players table is large; the index on `(league_id, is_drafted, overall_rating)` may not exist, forcing a sort.
- The transaction at `draft.ts:208-231` does 3 statements (UPDATE players, INSERT draft_picks, UPDATE leagues). With 600 transactions, even at 5ms each, that's 3s.
- The LLM call path (draft.ts:178) is skipped in turbo (`isTurbo` true at line 165 → branch skipped).
- `refreshCache(league.id)` is called on every callback at `engine.ts:312`, which writes the cache to DB. 600 cache writes = significant overhead.

**Fix recommendations:**
1. In the turbo path, suppress the `refreshCache` callback entirely — or batch it (refresh once every 50 picks).
2. Add `CREATE INDEX IF NOT EXISTS idx_players_league_drafted_rating ON players(league_id, is_drafted, overall_rating)` migration to speed up `selectTopN`.
3. Wrap the entire turbo draft loop in a single SQLite transaction (commit at the end). better-sqlite3's atomic-transaction overhead per-pick is the main cost.

**Realistic floor:** With 600 INSERTs into draft_picks, 600 UPDATEs on players, and SQLite's WAL-mode sync, the theoretical minimum is ~2-3s on typical hardware. Single-transaction batching can get the whole draft under 1s. **Document the floor:** If we can't reach <5s, the spec's "<5s" target is unrealistic and should be relaxed to "<10s" with an Architect ruling. But first try the single-transaction batching — that should easily achieve <5s.

### Finding 7 — AVG/ERA still unrealistic

**File:** `server/sim/game.ts:447-495`

**Evidence:** The batting simulation at line 459:
```ts
const hitProb = Math.max(0.15, Math.min(0.45, player.contact / 200 + 0.1));
```

For a player with contact=80 (good but not elite), `hitProb = 80/200 + 0.1 = 0.5`, capped at 0.45.
For contact=99 (elite), same cap of 0.45.
For contact=50 (average), `hitProb = 50/200 + 0.1 = 0.35`.

So average MLB hitters (contact ~50) end up with 0.35 BA. Elite hitters end up with 0.45 BA. Over 150+ AB, this regresses very close to those rates. Real MLB: average ~0.245, elite ~0.330.

**Fix:** Lower the formula to produce more realistic averages.
```ts
const hitProb = Math.max(0.15, Math.min(0.40, player.contact / 400 + 0.15));
```
For contact=50: 50/400 + 0.15 = 0.275 (realistic average)
For contact=80: 80/400 + 0.15 = 0.35 (above average)
For contact=99: 99/400 + 0.15 = 0.3975 (elite)

Combined with the existing min-AB filter, leaders will land in the 0.300-0.400 range as the spec requires.

For ERA: the ERA formula is `(earned_runs * 9) / innings_pitched`. The issue is `earnedRuns` per game is too low for good pitchers. Looking at `game.ts:559-571`:
```ts
const starterER = Math.min(runsAllowed, Math.round(runsAllowed * (starterIP / totalIP)));
```
`runsAllowed` comes from the team-level score. For a top pitcher facing a weak team, score might be 1-2 runs, all distributed to the starter. Over 50 IP, total ER might be 8-12 → ERA 1.44-2.16.

The real issue is that `runsAllowed` is determined by the opposing team's RNG-generated score, not by the pitcher quality. A truly elite pitcher's expected runs allowed should be lower than the league average. Currently the pitcher quality only affects `winProbability`, which decides the binary win/loss but not the score distribution.

**Architect ruling on ERA:** The ERA issue is a deeper simulation defect (game scoring isn't pitcher-quality-aware) that should be deferred to v0.2. For v0.1.0, the practical fix is to bias the runsAllowed by the starter's quality:
```ts
// In simulateGame, after winnerScore/loserScore generation:
// Adjust losing team's score down if the winning team has a great starter
const losingTeamStarter = homeWins ? awayStarter : homeStarter;
const winningTeamStarter = homeWins ? homeStarter : awayStarter;
if (winningTeamStarter && winningTeamStarter.overall_rating >= 80) {
  // Elite starter — reduce opponent runs by 1 (clamped at 0)
  // ...
}
```

OR simpler: raise the min-IP threshold further (to 75) so only pitchers with deep workload accumulate enough variance. **Architect ruling for v0.1.0:** raise min-IP to 75 AND apply the hitProb fix above. The hit-rate fix alone will pull ERA up because more hits → more runs allowed → ERA up. Re-verify after the hitProb fix; the ERA issue may auto-resolve.

### Finding 8 — Front-office null in list endpoint

**File:** `server/routes/teams.ts:25-47`

**Evidence:** The list handler at line 31-46 explicitly OMITS `owner_name`, `gm_name`, `manager_name`, `gm_personality`, `revenue`, `payroll_budget`, etc. The detail endpoint at `:49-93` includes them.

**Architect ruling (REVERSING Iter 2 ruling):** Add the fields to the list endpoint. The Iter 2 false-positive ruling was wrong — the spec test IS for the list endpoint, and the payload cost (12 additional fields × 20 teams = 240 small values) is trivial. UI tests should be able to verify front-office data is available without making 20 additional detail-endpoint requests.

### Finding 9 — No playoffs phase observable

**File:** `server/sim/engine.ts:300, :387-393` and `server/sim/playoffs.ts:138-189`

**Evidence:** The flow is:
1. `runGameTick` (engine.ts:348) — last game of season triggers `phase = 'playoffs'` at line 382.
2. `runOneTick` calls `refreshCache` at line 300 → cache now shows `phase='playoffs'`.
3. Next tick scheduled (setImmediate in turbo).
4. `runOneTick` reads currentLeague (DB), sees phase='playoffs', calls `runPlayoffTick` at line 291.
5. `runPlayoffTick` calls `runPlayoffs` at line 389.
6. `runPlayoffs` (`playoffs.ts:132-189`) sets phase='playoffs' (defensively) at line 139, runs 4 DS series with 50ms yields, 2 CS series with 50ms yields, 1 WS series. Total inter-series yield time = 350ms.
7. After WS, sets phase='offseason' at line 188.
8. Back in `runOneTick`, `refreshCache` runs → cache shows offseason.

The 350ms of inter-series yields SHOULD give an external poller time to observe `phase='playoffs'`. But it doesn't because **the cache is not refreshed DURING `runPlayoffs`** — the cached snapshot was last updated at step 2 (BEFORE the playoff games started). When external polling hits during the playoff games, `getCachedState` returns the snapshot from step 2, which DOES show `phase='playoffs'`. So polling should see it.

Wait — let me re-check. At step 2, refreshCache was called with `phase='playoffs'` in the DB. The cache snapshot has phase='playoffs'. Polling between steps 4-7 returns that cached snapshot with `phase='playoffs'`. So polling SHOULD see it.

UI Tester B and API Tester both report never seeing playoffs phase. The most likely explanation: the inter-series 50ms yields are insufficient given turbo runs the playoff games VERY fast (each `simulateGame` is <5ms synchronous), so the total `runPlayoffs` duration is ~350ms + ~150ms of game time = 500ms. The API tester polled every 5s (based on test code mentions of `sleep 5`). At 5s polling interval with 500ms window, miss probability = (5000-500)/5000 = 90%. Across 4 test runs, miss probability = 0.9^4 = 66%. So it's plausible all 4 runs missed it.

**Fix:** Make the playoff phase persist longer by adding longer waits (e.g., 200ms × 7 series = 1.4s) OR refactor playoffs to run one series per tick (the architecturally correct fix). The simplest fix: **add `await refreshCache(leagueId)` after each series in `runPlayoffs` AND wrap each series wait in 200ms**. This guarantees observability for at least 1.4s.

Actually the cleaner architectural fix: change `runPlayoffTick` to run ONE series per tick, persist current playoff state in a new `playoff_round` column. This makes the playoff phase persist for the duration of the tick interval × 7 series = 100ms × 7 = 700ms in fast, or longer in normal. Plus it gives the UI an animation to show.

**Architect ruling:** For v0.1.0, the simplest fix is sufficient — increase the inter-series wait from 50ms to 200ms and add explicit `refreshCache` calls. Refactor to per-tick series for v0.2.

### Finding 10 — `/api/standings` grouped vs flat

**File:** `server/routes/standings.ts:3-50`

**Evidence:** The endpoint returns `{ conferences: [{ name, divisions: [{ name, teams: [...] }] }] }`. Total teams across all divisions = 20. The spec test says "GET /api/standings returns 20 rows."

**Architect ruling:** The spec test phrasing is ambiguous (the response DOES contain 20 team rows, just nested). The UI consumes the grouped format successfully. Adding a flat endpoint would create two ways to do the same thing.

**Resolution:** Keep the grouped format. The spec test should be re-interpreted as "the response contains 20 team-row objects" which the current response satisfies via `result.conferences.flatMap(c => c.divisions.flatMap(d => d.teams)).length === 20`. Update the spec-test documentation in §5 of the new instructions; no server code change needed.

### Finding 11 — `standings-row` cell testids

**File:** `client/src/views/League.tsx:129-150`

**Evidence:** Each row has `data-testid={standings-row-${team.teamId}}` (line 132). The cells (`<td>` for team name, W, L, PCT, GB, RS, RA, DIFF) have no individual testids.

**Architect ruling:** The spec only requires `standings-row-{teamId}` (spec line 267). The spec does NOT enumerate per-cell testids. The row testid is sufficient — UI tests can use `[data-testid="standings-row-302"] td:nth-child(2)` to pick the wins cell. **Per-cell testids are NOT required.** UI Tester B's failure on G4-2 is a spec misinterpretation. No code change.

### Finding 12 — Division leader visual distinction

**File:** `client/src/views/League.tsx:129-138`

**Evidence:** Line 136 applies `background: teamIdx === 0 ? 'rgba(96, 165, 250, 0.08)' : 'transparent'` and `fontWeight: teamIdx === 0 ? 'bold' : 'normal'`. The styling IS applied. But it's via inline style, not a CSS class or data attribute — UI testers can't easily detect "is this a division leader?" programmatically.

**Architect ruling:** Add `data-division-leader={teamIdx === 0 ? 'true' : undefined}` AND a CSS class `division-leader` to the row. This satisfies the spec's "visually distinguished (class or indicator)" requirement.

### Finding 13 — Nav buttons missing data-testid

**File:** `client/src/App.tsx:113-128`

**Evidence:** Nav buttons (League, Teams, Games, Draft, Players, Timeline) are plain `<button>` elements with no testid. The spec does NOT explicitly require nav testids, but UI testers can only reliably select by testid. UI Tester A worked around it via `button:has-text("Teams")` which is fragile.

**Architect ruling:** Add `data-testid={`nav-${tab.id}`}` to each nav button. This is a 1-line change and unblocks future UI test reliability.

### Finding 14 — `/api/players/99999` returns real player

**Architect ruling stands (re-confirmed):** Player ID 99999 IS a real player (a prospect from draft class generation, see `draft.ts:420-446` which generates 200 prospects per offseason). The spec test for "not found" must use 99999999. **No server code change.** The Architect's Iter 2 ruling on this is unchanged.

---

## Adversary READY Verdict — Re-Assessment

The Adversary issued READY but missed both Critical findings. Why?

1. **DRAFT_PAUSED throw:** Adversary traced the catch path at engine.ts:329 and verified DRAFT_PAUSED is handled. **What was missed:** the throw happens inside an unawaited async callback (`onPickComplete` at draft.ts:355). Without `await`, the rejected promise becomes an unhandled rejection. Adversary's analysis only checked the explicit try/catch wrapper, not the call-site await semantics. This is a real defect the Adversary missed.

2. **Offseason UNIQUE constraint:** Adversary explicitly stated "Offseason UNIQUE constraint errors no longer observed in iter3 logs" — but this was because the API tester used turbo and never reached the annual draft step successfully (turbo crashes earlier). The constraint failure is reproducible by running the offseason at normal speed. Adversary's runtime testing was insufficient.

**My verdict:** Adversary work was thorough on the static analysis side, but failed to exercise the offseason → season 2 transition. The READY is **NOT honored**. ITERATE.

The Adversary's AB3-01 (latent SP-zero stall) is also worth carrying forward but is correctly classified as Low — not v0.1.0 blocking.

---

## Severity Summary

- **Critical: 2**
  - Finding 1 — DRAFT_PAUSED unhandled rejection crashes server process
  - Finding 2 — Offseason UNIQUE constraint loop blocks season 2

- **High: 5**
  - Finding 3 — Draft tab does not auto-navigate when phase='draft'
  - Finding 4 — draft-pick-reveal never renders during active draft
  - Finding 6 — Turbo speed 18s for 600 picks (3.6× spec ceiling)
  - Finding 7 — AVG/ERA unrealistic (hitProb math, not just min-AB threshold)
  - Finding 9 — Playoffs phase not observable via polling

- **Medium: 4**
  - Finding 5 — draft-onclock-team symptom (resolved by Finding 3 fix; minor enhancement to show placeholder when teamOrder not yet loaded)
  - Finding 8 — Front-office null in `GET /api/teams` list (REVERSING Iter 2 ruling)
  - Finding 12 — Division leader needs CSS class or data attribute
  - Finding 13 — Nav buttons need data-testid

- **Low: 1**
  - AB3-01 (carried from Adversary) — Latent SP-zero stall — defer to v0.2

- **Architect rulings (no code change):**
  - Finding 10 — `/api/standings` keep grouped (spec test re-interpreted)
  - Finding 11 — standings-row cells do NOT need per-cell testids
  - Finding 14 — `/api/players/99999` ruling stands (99999999 is the test sentinel)

Total: **2 Critical + 5 High + 4 Medium + 1 Low (deferred) = 11 must-fix items.**

---

## Iteration 3 — What Went Well

- **CISO:** All Iter 2 CISO findings RESOLVED. New scrubErrorDuplicate test is a model defensive gate.
- **Adversary:** All 11 Iter 1 + 10 Iter 2 findings closed at code level with file:line evidence.
- **Most Critical Iter 2 defects fixed:** Draft tab renders, Minors tab no crash, snake-order math, finalizeOffseason transactional, picksDelta streams.
- **Test coverage:** 22 test files now exist, including new regression gates for scrubErrorDuplicate, draftPickTiming, playoffsObservable, etc.

## Iteration 3 — Process Notes

- The Adversary's READY verdict was premature. Going forward, the Adversary must exercise the full offseason → season 2 transition at normal speed before declaring READY.
- The UI Testers caught defects the API tester couldn't (auto-navigation, reveal animation, on-clock indicator). The UI Tester workflow is now proven valuable — the test-spec should explicitly require both API and UI testing for each iteration.
- The Architect's Iter 2 ruling on front-office list-vs-detail was wrong; I reverse it here. Future Architect rulings should be more conservative when the spec test text is explicit.

---

## Rationale for ITERATE

build-rules.md §Severity Classification: "Build is complete when all post-build reports contain zero Critical, High, or Medium findings AND the Architect formally issues COMPLETE."

The committed Iter 3 build has 2 Critical (server crash + season-2 blocker), 5 High (draft UI not functional + stats unrealistic + perf miss), and 4 Medium findings. The Critical findings alone mandate ITERATE — the build does not complete a single-season-to-season-2 round-trip without manual intervention.

---

**End of architect-eval-3.md.**
