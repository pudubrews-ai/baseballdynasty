# Adversary Post-Build Report — Iteration 3 — Baseball Dynasty Simulator v0.1.0

## Verdict
**READY** — Every open finding from Iter-1 and Iter-2 is closed at the code level with file:line evidence. The new attack surface introduced in Iter-3 (subPhase field, per-pick delay function, reconnect debounce, league-exists pre-check, snake-order pick numbering, playoff 50ms yield, pitcher-IP rounding fix, minors grouping) was probed at each named seam and only one residual (latent, low-severity, not new in Iter-3) edge case survives — a season can stall if a team ever lacks an SP during the regular season because `validateBoxScore`'s Rule 4 fail-closed skip combines with `getNextGame`'s "same game until written" semantics to loop forever on that game. Documented as AB3-01 below; not a v0.1.0 blocker because `validatePostDraftRosters` plus auto-balance keep this off the hot path on fresh worldgen.

---

## Iteration 2 Open Findings — Verification

### AB-11 (was UNRESOLVED): Draft.tsx team ordering + data-testids — **RESOLVED**
- **Calls /api/draft/order:** `client/src/views/Draft.tsx:41-48` — `useEffect` fires when `state?.phase === 'draft'` and re-fires when `subPhase` changes. Sets `teamOrder` from the response.
- **Renders teams in draft order:** `client/src/views/Draft.tsx:50-53` builds `teamsInDraftOrder` by mapping `teamOrder` → team objects, falling back to `/api/teams` listing order only until the draft-order fetch resolves. Header (`:189-202`) and rows (`:212-237`) both iterate `teamsInDraftOrder`.
- **data-testid uses pick_number not teamIdx+1:** `Draft.tsx:217` — `data-testid={`draft-pick-${round}-${getPickNumberForCell(round, teamIdx, teamsInDraftOrder.length || totalTeams)}`}`. `getPickNumberForCell` at `:110-114` implements the snake formula. See "snake-order math verification" below.

### AB-NEW-01 / AB2-04 (was PARTIAL): Tick loop restart after draft completes — **RESOLVED**
- `server/sim/engine.ts:337-345` — `runDraftTick`'s finally block now only sets `simRunning = false` if `currentSpeed === 'paused'`. If the user left the speed at `normal/fast/turbo`, `simRunning` stays `true`.
- Combined with `runTickLoop`'s post-tick guard at `:270-272` (`if (simRunning && (currentSpeed as string) !== 'paused') scheduleTick(currentLeague)`), the regular season tick is scheduled immediately after the draft transition writes `phase = 'regular_season'` at `:322`. No user input required.

### AB2-01 (was CRITICAL): mapPhase client/server mismatch — **RESOLVED**
- **Server still maps:** `server/sim/engine.ts:69-80` `mapPhase` collapses `expansion_draft`/`annual_draft` → `'draft'`; throws on unrecognized phase (also closes AB2-10).
- **subPhase added:** `server/sim/engine.ts:83-87` `mapSubPhase` returns `'expansion'` | `'annual'` | `null` and is wired into the snapshot at `:92`. Shared type updated at `shared/types.ts:32`.
- **Client checks `phase === 'draft'`:** `client/src/views/Draft.tsx:127` (gate); `:104` (on-clock); `:42` (draft-order fetch).
- **Polling uses 'draft':** `client/src/hooks/useLeagueState.ts:108` — `const isDraft = phaseRef.current === 'draft';` → 500ms polling re-engaged for the draft phase.
- **Title uses subPhase:** `Draft.tsx:144` — `state.subPhase === 'expansion' ? 'Expansion Draft' : 'Annual Draft'`.

### AB2-02 (was HIGH): validateBoxScore commits invalid games — **RESOLVED**
- **Fail-closed return:** `server/sim/game.ts:382-386` — after the 3-attempt retry, if `validationErrors.length > 0`, the function `console.error`s and `return`s before `writeGame()` is invoked. No DB row is inserted for an invalid box.
- **Rule 4 added:** `server/sim/game.ts:195-210` — sums per-team `inningsPitched`, compares to `expectedHomeIP = 9.0` (always) and `expectedAwayIP = isWalkOff ? 8.0 : 9.0`, with ±0.01 tolerance for thirds rounding. Errors push to the returned array.

### AB2-03 (was HIGH): finalizeOffseason not transactional — **RESOLVED**
- `server/sim/offseason.ts:319-333` — the `season_number/phase` update, the `wins/losses/runs_scored/runs_allowed/games_played` reset, AND the orphan-player cleanup are all wrapped in `db.transaction(() => { ... })`. The transaction is executed at line 333. Either all three writes happen or none.
- The narrative generation and `saveSchedule` are intentionally outside the transaction. They're idempotent on restart (re-LLM, schedule deterministic from `worldgen_seed ^ newSeason`). If the transaction did not commit on the first attempt, `phase` is still `'offseason'` and `season_number` is still N — so the engine re-enters `runOffseasonTick → runOffseason` at step `'done'` and `finalizeOffseason` runs cleanly with the same inputs.

### AB2-05 (was MEDIUM): /api/draft/order branches by phase — **RESOLVED**
- `server/index.ts:192-202` — `const teamOrder = league.phase === 'annual_draft' ? getAnnualDraftOrder(league.id) : getExpansionDraftOrder(league.id);`
- `getAnnualDraftOrder` exported at `server/sim/draft.ts:323-325`, returns `generateAnnualDraftOrder(leagueId)` which orders by `wins ASC, losses DESC` (`draft.ts:278-284`) — the reverse-standings order the annual draft actually uses.

### AB2-06 (was MEDIUM): quota-unsatisfiable cities crash worldgen — **RESOLVED**
- `server/sim/worldgen.ts:94-101` — after both passes, if `selected.length < 20`, the function builds an `unmet` array from `remaining[size] > 0` entries and throws `Error: [worldgen] Insufficient cities to satisfy market quotas: ${unmet.join(', ')}`. Descriptive, names the missing categories.

### AB2-07 (was MEDIUM): JWT-shaped bearer tokens partially survive scrubError — **RESOLVED**
- `server/util/scrub.ts:9` — `.replace(/bearer\s+[a-zA-Z0-9._~+/=\-]+/gi, 'bearer [REDACTED]')`. Character class now includes `. ~ + / = -` covering JWT separators (`.`) and base64url chars. A `Bearer eyJhbG.eyJ0eX.4_signature` is now matched and fully redacted in one pass.

### AB2-08 (was LOW): walk-off IP truncation hits wrong team — **RESOLVED**
- `server/sim/game.ts:286-291` — home pitchers receive `isWalkOff = false` (always 9.0 IP), away pitchers receive `isWalkOff = isWalkOff` (8.0 IP on walk-off games). Baseball-correct semantics: away team's bottom-of-9 was preempted by the walk-off.
- Comment at `:284-285` documents the rationale.

### AB2-09 (was LOW): validator missing Rule 4 — **RESOLVED** (see AB2-02 above)

### AB2-10 (was LOW): mapPhase default cast — **RESOLVED**
- `server/sim/engine.ts:77-79` — `default: throw new Error(`[engine] Unrecognized DB phase: ${dbPhase}`);` — no more unsafe cast. Any unknown DB phase value will fail-fast at snapshot construction rather than leak through to the client.

---

## New Attack Surface in Iteration 3 — Probes

### 1. subPhase field in snapshot — **SAFE**
- `mapSubPhase` (`engine.ts:83-87`) returns `'expansion'`, `'annual'`, or `null` (never `undefined`). All three are JSON-serializable.
- If `dbPhase` is something unexpected (e.g., `'setup'`), `mapPhase` throws BEFORE `mapSubPhase` is called (snapshot construction at `:91-92` evaluates `mapPhase` first). So `mapSubPhase` never sees an unmapped phase in production.
- `shared/types.ts:32` declares `subPhase: 'expansion' | 'annual' | null` — `null` round-trips through JSON cleanly.

### 2. Per-pick delay logic — **SAFE**
- `getDraftPickDelay()` (`engine.ts:33-41`) reads the module-level `currentSpeed` synchronously.
- In `runExpansionDraft`/`runAnnualDraft` (`draft.ts:359-363` and `:409-413`), `getDraftPickDelay()` is called AFTER `runDraftPick` resolves — after the pick is generated AND the DB transaction has committed (the transaction inside `runDraftPick` at `draft.ts:208-231` is synchronous via better-sqlite3).
- If a client POSTs `/api/sim/speed` mid-draft from turbo → normal, `setSimSpeed` updates `currentSpeed` synchronously at `engine.ts:198`. The change takes effect on the NEXT pick's delay; the in-flight pick (already DB-written) is unaffected. No vulnerable window.
- The speed is read freshly per pick, not cached per loop — so turbo→normal mid-draft slows subsequent picks as expected.

### 3. failureCountRef reconnect logic — **SAFE**
- `client/src/hooks/useLeagueState.ts:53` — `failureCountRef.current = 0;` runs on every successful poll, regardless of previous failure count. `setReconnecting(false)` also runs unconditionally on success (`:54`).
- The ref is created via `useRef(0)` inside `useLeagueStatePolling`, so it's per-mount, not module-level. Each remount (or session) starts at 0. No cross-session accumulation.
- `cancelledRef` (`:40, :42, :123-126`) guards against rescheduling after unmount. Re-entering the page resets it via the useEffect.

### 4. League-exists check before rate limit — **SAFE** (race-free under better-sqlite3 + Express single-threading)
- `index.ts:46-60` `rateLimitLeagueNew` calls `getActiveLeague()` (sync) before consuming `lastLeagueCreateMs`. The check at `:48-51` returns 409 if a league exists.
- Concurrency analysis: Node is single-threaded. An async request only yields at `await` boundaries. `getActiveLeague()` (`db.ts:89-91`) is synchronous. The next yield point in the new-league path is `await startNewLeague(req.body)` at `index.ts:103`. Inside `startNewLeague` (`engine.ts:152-168`), the first await is `await generateWorld(wgOptions)` at `:161`. But `generateWorld` (`worldgen.ts:124-355`) has NO `await` in its body — its work runs synchronously up to `return doWorldgen()` at `:354`, and `doWorldgen()` is `db.transaction(...)` (synchronous better-sqlite3). So the entire league INSERT completes synchronously before the `await` yields.
- Therefore: by the time Request A yields, the league row is committed. Request B, entering middleware on the next event loop turn, will see the new league via `getActiveLeague()` and 409. Two simultaneous `/api/league/new` requests cannot both proceed. Defense-in-depth: `startNewLeague` re-checks `getActiveLeague()` at `engine.ts:153-156` and throws `LEAGUE_EXISTS` (mapped to 409 by the route handler).
- Note: `lastLeagueCreateMs` is set only after success at `index.ts:104`. So a failed/409 attempt does not consume the 30s window — matches §4.7 / Architect ruling.

### 5. Draft pick cell testids — snake order math verified — **CORRECT**
For 30-round, 20-team draft, `getPickNumberForCell(round, teamIdx, 20)`:
- **(round=1, teamIdx=19):** `round % 2 === 1` → `pickInRound = 19 + 1 = 20` → result = `(0) * 20 + 20 = 20`. ✓
- **(round=2, teamIdx=0):** `round % 2 === 0` → `pickInRound = 20 - 0 = 20` → result = `(1) * 20 + 20 = 40`. ✓
- **Round 1 pick 20 ↔ Round 2 pick 21 same-team check:** Round 1 col 19 is `teamsInDraftOrder[19]` (renders pick 20). Round 2 col 19 has `pickInRound = 20 - 19 = 1` → pick 21, also `teamsInDraftOrder[19]`. Same column = same team = correct snake "team picks twice consecutively at round boundary" semantics. ✓
- The on-clock logic at `Draft.tsx:103-107` independently reverses `teamsInDraftOrder` for even rounds and indexes by `currentPickInRound`. For pick 21 (round 2, `currentPickInRound = 0`), `roundOrder[0]` of the reversed array = `teamsInDraftOrder[19]`. Consistent with the cell rendering. ✓

### 6. playoffs.ts 50ms yield — phase stable — **SAFE**
- `playoffs.ts:139` writes `phase = 'playoffs'` BEFORE any `runSeries` runs.
- Inside `runSeries` (`:192-251`), `simulateGame` is called with `isPlayoff = true` (`:222`). No phase mutation in this path; `simulateGame`'s W/L update block is skipped (`game.ts:423-435`).
- The 50ms `await new Promise(r => setTimeout(r, 50))` (`:147, :149, :151, :153, :162, :164`) yields the event loop. During those windows, `phase === 'playoffs'` is stable in the DB. `GET /api/state` reading the cache (or refreshing) will see `'playoffs'`.
- Phase only changes to `'offseason'` at `:188` after the World Series completes.

### 7. generatePitcherLines fix — **CORRECT, with one latent (NOT new) bug — see AB3-01**
- `game.ts:617-624` — final-correction block adjusts the LAST line's IP by the diff between expected total and actual total, rounded to thirds. Closes thirds-arithmetic gaps cleanly.
- **Negative IP check:** `lastLine.inningsPitched + diff` could go negative only if `currentTotal > totalIP` AND the last line's IP is smaller than the over-shoot. In practice, thirds-rounding produces diffs of at most ±0.33 IP; the last reliever's IP is always ≥ the forced "remainingIP" calculated at `:589` (which is ≥ 0). I traced the walk-off (totalIP=8.0) and non-walk-off (totalIP=9.0) paths — no path produces negative IP.
- **No-bullpen case:** `game.ts:609-613` — if `starter` exists but `bullpenToUse.length === 0`, the starter's IP is overwritten to the full `totalIP`. The starter then carries all 9.0 (or 8.0) IP. Reasonable handling.
- **No-SP case (AB3-01 below):** if `starter` is `null`, `generatePitcherLines` skips ALL its `if (starter)` work — pushing no pitcher lines at all. The team's pitcher line count is 0, Rule 4 sum is 0, Rule 4 fails. After 3 retries (which don't help because no SP magically appears), the game is SKIPPED. `getNextGame` returns the same game on the next tick → infinite stall on that game.

### 8. minors tab fix in Teams.tsx — **SAFE**
- `server/routes/teams.ts:10-23` `buildMinorsObject` is the data source. It queries players from SQL, so each entry in `minorsRaw` is a complete row object — never `null` per row. `minor_level` defaults to `'Rookie'` via `??` at `:17`. Players with an unknown level string are silently dropped by the `if (minors[level])` guard, but `assignRosterLevels` (`draft.ts:303-309`) only writes the four canonical levels, so this guard never fires in production.
- `client/src/views/Teams.tsx:159-179` — `tabData ?? {}` handles failed fetch; `Array.isArray(minors[level])` guards each level; `minors[level]!.length` is safe after the `Array.isArray` check; players are rendered via React text nodes (`{p.first_name}`, etc.). No `dangerouslySetInnerHTML`.
- No path where a `null` player object could appear in any minor-level array.

---

## New Findings (Iter-3 code)

### LOW (latent, not new in Iter-3) AB3-01 — Season stalls forever if a team has zero SP during regular season
**Attack scenario:** A team somehow ends a season with zero SP on its MLB roster (e.g., all SPs retired age 40+ in offseason, free agency didn't fill, auto-balance not re-run on offseason transitions). On the first home game for that team in the new season, `simulateGame` produces zero home pitcher lines, Rule 4 fails (`Home total IP 0.00 != expected 9.0`), 3 retries don't help (the retry loop only re-runs `distributeExtraWalks` and `clampRBI`, not pitcher generation), game is skipped (`game.ts:382-386`), and `current_game_number` is NOT advanced. Next tick: `getNextGame` returns the same game. Same stall. The sim is frozen.

**Evidence:**
- `server/sim/game.ts:247-248` — `homeStarter = selectStartingPitcher(homeTeam)` may return `null` (`game.ts:97-106` returns `null` if no SPs on roster).
- `server/sim/game.ts:556-614` — entire pitcher-lines block gated on `if (starter)`. Zero lines pushed for that team if starter is null.
- `server/sim/game.ts:195-210` — Rule 4 sums per-team `inningsPitched`; with zero pitcher lines the sum is 0, expected is 9.0 (or 8.0). Fails.
- `server/sim/game.ts:357-381` — retry loop re-runs walks/RBI fixers only, never re-generates pitcher lines.
- `server/sim/game.ts:382-386` — fail-closed return; no game write.
- `server/sim/engine.ts:348-385` — `runGameTick`'s `getNextGame` returns the lowest unplayed game by `current_game_number`. With no advance, it's the same game forever.

**Mitigations already in place:**
- `validatePostDraftRosters` (`worldgen.ts:371-399`) runs after the expansion draft and calls `autoBalance` for teams missing SP < 2, CL < 1, C/SS/CF < 1.
- `autoBalance` (`worldgen.ts:402+`) promotes from minors or trades to fill the gap.

**Gap:** `validatePostDraftRosters` is NOT called after retirement, free agency, or annual draft in offseason. So season-2+ retirements/FA-shortfalls/draft-misses could leave a team SP-shy, and no validator catches it.

**Severity rationale:** LOW because (a) the position validator + auto-balance keep this off the hot path on a fresh worldgen; (b) most teams have 4-5 SPs and rarely lose all of them in one offseason; (c) does not present in v0.1.0 test runs because retirement age 40 minus typical SP age ≤ 35 leaves margin. But the failure mode is "sim freezes silently with no UI signal" — high blast radius if it ever happens. Recommend either (i) call `validatePostDraftRosters` after annual_draft in `finalizeOffseason`, or (ii) make `generatePitcherLines` synthesize a replacement-level pitcher line when `starter === null`, or (iii) record the skipped game's id in a `skipped_games` table and advance `current_game_number` past it.

---

## Attack Surface Summary

### Iter-2 critical/high findings — all closed
- AB-11, AB2-01, AB2-02, AB2-03, AB2-04, AB-NEW-01 all have file:line evidence above.

### Iter-2 medium/low findings — all closed
- AB2-05, AB2-06, AB2-07, AB2-08, AB2-09, AB2-10 all have file:line evidence above.

### Iter-3 net-new probes — all safe
- subPhase serialization, per-pick delay timing, reconnect debounce, league-exists race, snake-order pick numbering, playoff 50ms yield, pitcher IP rounding, minors null handling — none yielded an exploitable bug.

### Latent (not new in Iter-3) finding
- **AB3-01 (Low)** — season can stall forever if a team has 0 SP at the start of a regular-season game. Mitigated by `validatePostDraftRosters` for season 1; gap exists for seasons 2+. Not a v0.1.0 blocker but worth flagging for v0.2.

### What Iter-3 got right
- `mapPhase` throws on unknown phase (no more silent cast leaks).
- `subPhase` field is the cleanest possible client/server contract for the dual draft type.
- `getDraftPickDelay()` reads the module-level `currentSpeed` per pick (no stale cache).
- `finalizeOffseason` transaction is correctly scoped (the three coupled writes; narrative & schedule outside on purpose for idempotence).
- `bearer` regex now matches the full JWT including dots.
- Pitcher-IP rounding fix is mathematically sound; thirds-arithmetic gap closed in the final-correction step.
- Snake-order math in the client matches the snake-order math the server uses to assign `pick_number`.
- Minors grouped object is initialized with all 4 levels (no `undefined` arrays); client double-checks with `Array.isArray`.
- Walk-off IP semantics now match baseball reality (away team gets 8.0, home gets 9.0).

### Bottom line
The Iter-3 build is ready. All 11 Iter-1 + 10 Iter-2 findings are closed with verifiable code evidence. The eight Iter-3 attack surfaces are all defensively coded. The only residual is AB3-01, a latent stall-forever edge case that was always present (not introduced in Iter-3) and is masked by the existing post-expansion-draft validator for season 1. The v0.1.0 gate can be marked READY.

---

**End of adversary-iter3-post-build.md.**
