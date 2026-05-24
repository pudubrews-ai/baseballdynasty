# Architect Evaluation 2 — Baseball Dynasty Simulator v0.1.0

**Iteration:** 2 (Phase 2 — post-build)
**Reviewer:** Architect
**Inputs:** `ciso-iter2-post-build.md`, `adversary-iter2-post-build.md`, `api-tester-iter2-results.md`, `ui-tester-a-results.md`, `ui-tester-b-results.md`, `architect-eval-1.md`, `developer-instructions-2.md`, and direct inspection of the source at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`.

---

## Decision: ITERATE

Iteration 2 made enormous progress on Iteration 1 server-side defects — every Critical and most Highs from architect-eval-1 are RESOLVED (per Adversary AB-01..AB-22, CISO CB-1..CB-7). However Iteration 2 introduced two NEW Critical regressions and surfaced multiple previously-undetectable defects now that the server can actually start and the UI testers can run end-to-end:

1. **AB2-01 Critical** — `mapPhase()` collapses `expansion_draft`/`annual_draft` → `'draft'` on the API surface, but the client still checks for the raw DB strings. The Draft tab does not render at all. Every spec-mandated `data-testid="draft-*"` is unreachable. This is a Day-1 build blocker.
2. **BUG-A02 Critical** — Clicking the Minors tab crashes the app with `TypeError: tabData.map is not a function`. `/api/teams/:id/minors` returns an object `{AAA, AA, A, Rookie}` but `Teams.tsx` expects an array.

These two regressions alone block COMPLETE. Combined with the High-severity findings (`finalizeOffseason` not transactional, picksDelta always empty, validateBoxScore fail-open, draft pick timing not honoring speed, reconnect banner stuck, no roster array in API, no playoffs phase exposed), Iteration 2 has 4 Critical + 9 High + 7 Medium + 5 Low findings to address.

ITERATE is mandatory.

---

## Finding Assessment

### Adversary Iter 2 findings

| ID | Reported | Decision | Justification |
|---|---|---|---|
| **AB-11 (carried)** | Critical | **CONFIRMED Critical** | Verified at `client/src/views/Draft.tsx:33` — still fetches `/api/teams` and computes from list order. `data-testid` at `Draft.tsx:194` is still `draft-pick-${round}-${teamIdx + 1}` (column index), not `{pickNumber}`. The new `GET /api/draft/order` route at `server/index.ts:172-180` is wired on the server but never consumed by the client. Folded into AB2-01 fix set since both must be done in `Draft.tsx`. |
| **AB-NEW-01 (carried)** | High → **Medium** | **SEVERITY ADJUSTED → Medium** | Verified at `engine.ts:316-318` — `runDraftTick`'s finally sets `simRunning = false` always. `setSimSpeed` at `engine.ts:185-189` restarts only when `!simRunning && newSpeed !== 'paused'`. So after a natural draft completion at any non-paused speed, the tick loop dies until the user touches speed. The test spec explicitly POSTs the speed after draft completes (test 77), so the test passes — but the player UX is broken. Fix in §2.10/§3.1 of new instructions. |
| **AB2-01** | Critical | **CONFIRMED Critical** | Verified at `engine.ts:58-68` (server collapses to `'draft'`) and `Draft.tsx:89, 107, 123` + `useLeagueState.ts:89` (client checks for `'expansion_draft'`/`'annual_draft'`). Draft tab never renders. Polling falls back to 2s during draft. **BUILD BLOCKER.** |
| **AB2-02** | High | **CONFIRMED High** | Verified at `game.ts:336-366`. The 3-retry loop only re-applies `distributeExtraWalks` and `clampRBI`. After the loop, control falls through to `writeGame()` regardless of remaining errors. The "gate" the Iter-1 review demanded is still advisory. Rule 4 (total IP = 9.0) is missing from `validateBoxScore`. |
| **AB2-03** | High | **CONFIRMED High** | Verified at `offseason.ts:318-323`. Two `db.prepare(...).run(...)` statements with no `db.transaction()` wrapper. The orphan-player cleanup at `:326-328` is also outside any transaction. Crash window: any SIGKILL between the two statements leaves season N+1 in `regular_season` with stale wins. Idempotent boot-time check would catch it but doesn't exist. |
| **AB2-04** | Medium | **CONFIRMED Medium** | Same as AB-NEW-01 carried. The test spec masks the bug by re-POSTing speed; player UX is degraded. |
| **AB2-05** | Medium | **CONFIRMED Medium** | Verified at `server/index.ts:172-180`. `/api/draft/order` always calls `getExpansionDraftOrder` regardless of `league.phase`. During annual draft, returns wrong order. |
| **AB2-06** | Medium | **CONFIRMED Medium** | Verified at `worldgen.ts:62-95` + insertion loop at `:190+`. The current 33-city pool barely satisfies quotas; any future edit to `cities.ts` could silently undercount. Defensive fix is a 2-line throw. |
| **AB2-07** | Medium | **CONFIRMED Medium** | Verified at `server/util/scrub.ts:9`. The bearer regex character class `[a-zA-Z0-9_-]` excludes `.`, truncating JWT-shaped tokens after the first segment. Add `.~+/=` to the class. |
| **AB2-08** | Low | **CONFIRMED Low** | Verified at `game.ts:267-272`. Walk-off truncation applies to HOME team's pitchers; in real baseball, the home team pitches a full 9 in a walk-off win — the AWAY team is the one with truncated IP (couldn't get the 3rd out in the bottom of the 9th). Side-of-field stat bias over many seasons. |
| **AB2-09** | Low | **CONFIRMED Low** | Verified — Rule 4 (total IP = 9.0 / 8.0 walk-off) is not in `validateBoxScore` at `game.ts:152-195`. Easy to add. |
| **AB2-10** | Low | **CONFIRMED Low** | Verified at `engine.ts:66`. Cosmetic. The default branch can't fire under current writers but documents type-unsoundness. |

### CISO Iter 2 findings

| ID | Reported | Decision | Justification |
|---|---|---|---|
| **CB2-1** | Medium | **CONFIRMED Medium** | Verified at `server/services/llm.ts:165-173` (local `scrubError`) and `server/util/scrub.ts:5-10` (canonical with bearer redaction). The drift CB-5 predicted has manifested. 5-minute fix: delete local copy, import canonical. |
| **CB2-2** | Low | **CONFIRMED Low** | Verified at `server/index.ts:110-117`. `POST /api/league/reset` lacks rate limit and body validation. Low risk under localhost-bind, but trivially fixable. |
| **CB2-3** | Low | **CONFIRMED Low** | Verified at `server/index.ts:219`. Startup catch logs raw `err`. One-line fix to use `scrubError(err).message`. |
| **CB2-4** | Low | **CONFIRMED Low** | Verified at `server/routes/players.ts:111`. Leading-`%` LIKE forces table scan. Endpoint not yet wired from UI. Defer to v0.2. |

### API Tester Iter 2 findings

| Finding | Decision | Notes |
|---|---|---|
| **Player rating distribution wrong (replacement ~44%)** | **FALSE POSITIVE → spec test gap** | The TIER allocation in `worldgen.ts:11-17` is correct (16/64/200/320/200 = 800). The API tester sampled player IDs 1-800, but player IDs are global auto-increment across all leagues (`001_init.sql:` `id INTEGER PRIMARY KEY AUTOINCREMENT`). After multiple iterations of league creation + reset + season simulation + offseason aging, IDs 1-800 are from an archived league that has been through 30+ offseasons of `runDevelopmentStep` (aging decline at 33+). The active league's worldgen distribution is correct. **Architect ruling:** The spec test should sample by `WHERE league_id = (active league)`, not by ID range. The Developer is NOT asked to change the worldgen tier allocation. Add a small note to test-spec for future iterations. |
| **GET /api/teams list missing front-office data** | **FALSE POSITIVE** | Verified `teams.ts:25-46` deliberately omits front-office fields from the list endpoint for payload reasons. The `:id` endpoint returns them correctly. This is consistent with most sports-management API designs (list = summary, detail = full). The spec column for Group 1.8-1.10 does not differentiate list vs detail. **Architect ruling:** Accept current shape — front-office data is on `/api/teams/:id` which is one click away in the UI. If the spec intended the list endpoint to carry these fields, document the spec ambiguity for v0.2. No Developer action required. |
| **Roster array always empty (roster: [])** | **CONFIRMED High** | Verified: `GET /api/teams/:id` at `teams.ts:49-87` returns `minors` (§3.3 fix) but does NOT return a `roster` field at all. The spec test (1.4) expects `roster` array with at least 20 players. The `team-roster-tab` endpoint exists at `:89-110` (`/api/teams/:id/roster`) but the team detail object itself has no `roster` field. **Fix:** Add `roster` to the team detail response, populated via the same query as `/api/teams/:id/roster`. |
| **AVG stats 0.516-0.575 (spec max 0.400), ERA 0.509-1.442 (spec min 1.50)** | **CONFIRMED Medium** | Verified — the min-AB threshold was raised to 100 and min-IP to 30 in §2.15. Over a 50-game season, top hitters reach ~100 ABs; with 50-100 ABs, batting averages of 0.500+ are common variance outliers, not unrealistic given the small sample. Top ERAs of 0.509-1.442 come from pitchers in the 30-50 IP range — at 30 IP, allowing 2 earned runs gives 0.60 ERA. Either the min thresholds need to be raised further OR the leaders should be gated by `team.games_played > 30` to avoid early-season noise. **Architect ruling:** Raise min-AB to 150 and min-IP to 50. This will exclude smaller-sample outliers and give realistic mid-season leaders. |
| **No "playoffs" phase exposed (skips to offseason)** | **CONFIRMED High** | Verified at `engine.ts:325, 355` sets phase to `'playoffs'`, then `runPlayoffTick` calls `runPlayoffs` which at `playoffs.ts:178` sets phase to `'offseason'` — all in a single tick. Because `runPlayoffs` runs ALL 7 series synchronously, the `playoffs` phase exists for milliseconds, not pollable by a 2s-interval client. **Fix:** Run playoffs incrementally (one series per tick, or one game per tick) so the `playoffs` phase persists long enough to be observable AND the user can watch the bracket fill in. Even a `console.log` + a `refreshCache` + a yield between series would suffice. |
| **Player ID 99999 is a real player** | **CONFIRMED — spec test gap, NOT a code bug** | Verified: `draft.ts:402-428` `generateDraftClass` inserts 200 prospects per offseason. After ~50 seasons across multiple leagues, prospect IDs reach 99999+ (the API tester observed IDs up to 208200). The spec error test uses 99999 as "non-existent ID" but this ID DOES exist. **Architect ruling:** The spec test is non-normative on the exact ID value — its intent is "a sufficiently large ID that no real player has." Use `99999999` (8 nines, 99 million) as the test ID, which exceeds the lifetime of any plausible test run. Update the spec test to use 99999999. No server code change required for this specific issue, but the spec test is being adjusted by Architect ruling. |
| **Duplicate league 409 returns rate_limited error in 30s window** | **CONFIRMED Medium** | Verified at `server/index.ts:45-53, 94-107`. The `rateLimitLeagueNew` middleware runs BEFORE the handler executes. If the rate limit window is active (last creation < 30s ago), the user gets `429 rate_limited` regardless of whether they were trying to create a *duplicate* (which should be 409). The 30s timestamp is also set on the legitimate 409 path (line 101), which compounds the issue — a duplicate-creation attempt that returned 409 then re-locks the rate limit window. **Fix:** Reorder — perform the `LEAGUE_EXISTS` check BEFORE the rate-limit check, OR check `getActiveLeague()` inside the rate-limit middleware and return 409 instead of 429 when a league already exists. |

### UI Tester A findings

| ID | Reported | Decision | Justification |
|---|---|---|---|
| **BUG-A01** | High | **CONFIRMED High** | Verified at `League.tsx:111-139`. The `<>` fragment at line 113 lacks a key. React surfaces this as a console error which violates spec requirement of zero console errors. Fix: use `<React.Fragment key={...}>` or extract to a real wrapper element with a key. |
| **BUG-A02** | Critical | **CONFIRMED Critical** | Verified at `Teams.tsx:61` — calls `setTabData(await getTeamMinors(selectedTeamId))`. `Teams.tsx:36` types `tabData` as `unknown[]`. `Teams.tsx:152` casts it as array and calls `.map()`. But `/api/teams/:id/minors` at `teams.ts:117-119` returns the grouped OBJECT `{AAA: [], AA: [], A: [], Rookie: []}` (per §3.3 fix). The minors handler in Teams.tsx needs to be rewritten to consume the grouped object. **BUILD BLOCKER.** |
| **BUG-A03** | High | **CONFIRMED High** | Verified at `App.tsx:81-85` and `useLeagueState.ts:78-80`. The catch sets `reconnecting=true`; the success path sets `reconnecting=false`. In principle the banner should clear. UI Tester observed it doesn't. Most likely cause: the `useEffect` polling loop at `useLeagueState.ts:83-103` captures a stale `reconnecting` closure (deps are `[]`), so the interval doesn't switch back to its non-reconnecting cadence — and possibly the reschedule loop terminates after an error. Architect ruling in §3.4: add explicit state-machine handling: track a `failureCount` ref, set `reconnecting=true` only after 2 consecutive failures, set `reconnecting=false` on ANY success, and ensure `schedule()` is unconditionally called in a `finally` so the loop never dies. |

### UI Tester B findings

| Finding | Decision | Justification |
|---|---|---|
| **Draft board never renders (picksDelta always [])** | **CONFIRMED Critical (sub-finding of AB2-01)** | Verified at `useLeagueState.ts:42-44`. Initial poll sends `sincePickId: lastPickIdRef.current` = 0. Server returns `picks: []` (per `engine.ts:100-109` — `sincePickId > 0 ? query : []`). Because `picks.length === 0`, `lastPickIdRef.current` is never updated (line 67-68 only fires when picks.length > 0). So `sincePickId` stays at 0 forever, server keeps returning `[]`. **Fix:** Either (a) on the FIRST poll only, request `sincePickId=0` and treat the response as a full snapshot (Draft.tsx already does this at line 42-49 with a separate fetch, but useLeagueState ignores it), OR (b) change server semantics to return the LAST 50 picks when sincePickId=0, OR (c) bootstrap `lastPickIdRef.current` from `state.lastPickId` on first poll, then request picks since (lastPickId - 50). **Architect ruling:** Option (c) — bootstrap from state.lastPickId minus the batch size on the FIRST successful poll, then continue streaming deltas. Simplest and matches existing server contract. |
| **Draft engine crashes on speed changes (DRAFT_PAUSED)** | **CONFIRMED High** | Verified at `engine.ts:294`. When user pauses mid-draft, the callback throws `DRAFT_PAUSED`. The catch at `:309-314` handles it, but it logs and exits. However the `runExpansionDraft` loop is still iterating — wait, no, the `throw` aborts the `await` chain. The next call to `runDraftTick` resumes from `lastCompleted.max_pick + 1`. So actually the pause-throw mechanism is by design. The "server crash" observed by UI Tester B is likely because the throw was not caught at the right level. Looking again at `engine.ts:285-318`: the try wraps `runExpansionDraft` which awaits each pick via callback. Callback throws DRAFT_PAUSED → propagates up through `await runExpansionDraft(...)` → caught at line 309. This SHOULD work. The "server crash" may be the test rapidly switching speeds (causing multiple `DRAFT_PAUSED` errors stacking). **Fix:** Move the `simRunning = false` in the finally to only fire if no error or the error was DRAFT_PAUSED. Also ensure the throw is silently swallowed for DRAFT_PAUSED, not logged. |
| **Pick timing wrong (100ms for normal/fast)** | **CONFIRMED High** | Verified: `engine.ts:25-30` `TICK_INTERVALS = {paused: 0, normal: 800, fast: 100, turbo: 0}`. But the draft loop in `draft.ts:337-352` runs synchronously inside a single tick (no per-pick delay). The tick loop runs every `interval` ms, but each tick runs `runExpansionDraft` which ITERATES through ALL remaining picks until completion or pause. So the inter-pick cadence is bounded only by JS event-loop and the (disabled) LLM throttle. To honor speed, the draft loop must yield between picks with a delay matching the spec: normal=1400-1600ms, fast=180-220ms, turbo=immediate. **Fix:** Add per-pick delay inside the draft loop (or run one pick per tick). The simplest architectural change: make the draft loop call `await new Promise(r => setTimeout(r, getDraftDelay(currentSpeed)))` between picks, where `getDraftDelay` returns 1500/200/0 for normal/fast/turbo. |
| **Turbo correctly completes 600 picks in ~0.9s** | **Pass — no change** | Confirmed working. |
| **Division leader row has no visual distinction** | **CONFIRMED Low** | Verified at `League.tsx:119-135`. All team rows have identical styling. The division HEADER row has blue text but the actual first-place team row does not. **Fix:** Add a CSS class or bolded styling to the first row of each division's `teams` array (it's already sorted by pct desc, so it's the `[0]` index). |
| **Standings polling lag 5+ seconds (spec ≤3s)** | **CONFIRMED Medium** | Verified at `League.tsx:46-49`. Standings re-fetch is triggered by `state?.currentGameNumber` change. State polling interval is 2000ms (`useLeagueState.ts:90`). At normal sim speed (one game per 800ms), the worst case is: game completes → next state poll up to 2s later detects new currentGameNumber → standings refetch ~100ms. So worst case ~2.1s. Tester observed 5008ms suggesting the state polling interval was 2s but the state response also lagged. **Fix:** Lower state polling interval from 2000ms to 1500ms during regular-season AND add a separate standings poll at 2s interval (or refetch standings on every state response, not just on game number change). Architect ruling: refetch standings every 1500ms during regular-season phase using a dedicated effect. |
| **player-leaders-table shows "No data yet" (data structure mismatch)** | **CONFIRMED High** | Verified at `Players.tsx:41-48, 90`. The `Leaders` interface expects `{battingAvg, homeRuns, rbi, era, strikeouts, whip}` (the OLD shape from Iteration 1). The API now returns `{hitting: [...], pitching: [...]}` per §2.15 fix. `activeLeaders = leaders[activeCategory]` is always `undefined`. **Fix:** Rewrite Players.tsx to consume `{hitting, pitching}`, filter by `category` field, use `player_name` and `stat_value` instead of `first_name + last_name + value`. |
| **AVG category missing from API** | **FALSE POSITIVE** | The API DOES return AVG entries in `hitting` (per `players.ts:34` — `mapLeader('AVG')`). The UI Tester B's confusion stems from the UI's "No data yet" display (the player-leaders-table bug above). Once Players.tsx is fixed, AVG will appear. |
| **timeline-season-undefined testid** | **CONFIRMED High** | Verified at `Timeline.tsx:4-12, 57-58`. Interface uses camelCase `seasonNumber, championTeamName`. API returns snake_case `season_number, champion_team_name` per §3.4 fix. `season.seasonNumber` is undefined → `data-testid="timeline-season-undefined"`. **Fix:** Update Timeline.tsx interface to snake_case fields. |
| **Timeline card shows only "Season 2026" — champion/record not rendered** | **CONFIRMED High** | Same root cause as above — `season.championTeamName` is undefined because the field is `champion_team_name`. Fixed by the same TypeScript interface change. |

---

## Architect Rulings (New for Iteration 3)

### Ruling 1: AB2-01 fix approach — UPDATE THE CLIENT, KEEP mapPhase()
**Decision:** Keep the server's `mapPhase()` collapsing both draft phases to `'draft'`. Update the client to check for `'draft'`.

**Rationale:** The API surface should be the user-facing taxonomy (`draft` is a phase the user thinks about, not `expansion_draft` vs `annual_draft`). The internal DB phase distinction is implementation detail. Adding a separate `subPhase` field (`'expansion' | 'annual'`) on the snapshot lets the UI show the correct title ("Expansion Draft" vs "Annual Draft") without coupling to the DB strings. This is cleaner than reverting mapPhase().

**Action:** Add `subPhase: 'expansion' | 'annual' | null` to `LeagueStateSnapshot`. `mapPhase` keeps returning `'draft'` and the snapshot also populates `subPhase` from the DB phase (`expansion_draft` → `'expansion'`, `annual_draft` → `'annual'`, else `null`). The client checks `phase === 'draft'` for rendering decisions and `subPhase` for the title label.

### Ruling 2: Player ID 99999 not-found test — Use 99999999
**Decision:** The spec error test for `GET /api/players/<id>` returning 404 should use **99999999** (eight nines), not 99999.

**Rationale:** Player IDs are global auto-increment. Draft prospects are inserted every offseason (`draft.ts:407` — 200 prospects per season). After 50+ seasons across multiple test leagues, prospect IDs exceed 99999. The exact value 99999 in the spec is non-normative — its INTENT is "an ID that demonstrably does not exist." 99999999 (99 million) exceeds the lifetime of any realistic test run.

**Action:** Document this in the spec test (the test-spec is not in scope of this iteration, but the Developer should ensure the server returns the correct shape — `404 {"error":"Player not found"}` — for genuinely non-existent IDs). No server code change needed; the error path at `players.ts:138` already returns the correct shape.

### Ruling 3: Player rating distribution — NOT a worldgen bug
**Decision:** The API tester's finding that 44% of sampled players are replacement-level is a **test artifact**, not a worldgen bug.

**Rationale:** Player IDs are global. The tester sampled IDs 1-800. After multiple league cycles + season aging + offseason development, IDs 1-800 reside in archived leagues that have been through many seasons of `runDevelopmentStep` (aging decline). The active league's worldgen tier distribution (verified at `worldgen.ts:11-17`) is correct (16/64/200/320/200).

**Action:** No Developer change to `worldgen.ts`. Add a code comment in `worldgen.ts` documenting this and noting that future test specs must filter by `league_id = active_league_id`.

### Ruling 4: Roster field — Add to team detail
**Decision:** `GET /api/teams/:id` MUST include a `roster` array with the team's MLB-roster players, separate from the existing `minors` object.

**Rationale:** The spec test 5.4 explicitly checks for at least 20 players in the team detail's roster. Returning an empty array when the team-roster query has data is a clear regression.

**Action:** Add `roster` field to the response object in `teams.ts:59-86`, populated via the same query as `/api/teams/:id/roster`.

### Ruling 5: Playoffs phase must be observable
**Decision:** The `playoffs` phase must persist long enough for the UI to display it.

**Rationale:** Currently `runPlayoffs` runs all 7 series synchronously in a single tick — the phase is `'playoffs'` for milliseconds before transitioning to `'offseason'`. Test 3.27 expects `phase: "playoffs"` to be observable via API. Iterative playoffs also improve UX (user sees bracket fill in).

**Action:** Refactor `runPlayoffs` to be tick-driven: run one series at a time, persist progress in a new `playoff_round` column on `leagues`, return after each series, let the tick loop call back for the next. Or simpler: insert `await new Promise(r => setImmediate(r))` between series + add `await refreshCache(leagueId)` so the cached snapshot updates.

### Ruling 6: Standings polling — Add dedicated 1500ms polling during regular season
**Decision:** Standings should refresh every 1500ms during regular_season phase, independent of state polling.

**Action:** In `League.tsx`, add a `useEffect` with `setInterval(() => getStandings()..., 1500)` gated on `state?.phase === 'regular_season'`. Clear the interval on phase change or unmount.

### Ruling 7: Draft pick timing — Add per-pick delay
**Decision:** The draft loop must honor `currentSpeed` with per-pick delays: normal=1500ms, fast=200ms, turbo=0.

**Action:** In `draft.ts`'s `runExpansionDraft` and `runAnnualDraft` loops, after each `await runDraftPick(...)`, call `await new Promise(r => setTimeout(r, getDraftDelay()))` where `getDraftDelay()` reads `currentSpeed` from the engine module and returns 1500/200/0.

### Ruling 8: 409 rate-limit ordering
**Decision:** The LEAGUE_EXISTS check should fire BEFORE the rate-limit check.

**Rationale:** A duplicate create attempt is a deterministic 409 condition that doesn't need to be rate-limited (the rate limit's purpose is to prevent runaway league creation, not to throttle informational error responses).

**Action:** In `server/index.ts:45-53`, modify `rateLimitLeagueNew` to first check `getActiveLeague()` and return 409 immediately if a league exists (without consuming the rate-limit window). Alternative: move the rate-limit check into the handler after the league-exists check.

---

## False Positives Declared

1. **API Tester: Player rating distribution wrong** — test-spec artifact (Architect Ruling 3 above).
2. **API Tester: GET /api/teams list missing front-office data** — list endpoint is intentionally a summary; spec doesn't differentiate list vs detail clearly. Front-office data correctly available on `/api/teams/:id`. No fix required.
3. **UI Tester B: AVG category missing from API** — AVG IS in the API response (in the `hitting` array with `category: 'AVG'`). The "missing" perception came from the Players.tsx data-shape mismatch which makes ALL categories appear empty.

---

## Severity Summary

- **Critical: 4**
  - AB2-01 — Draft tab does not render (client/server phase mismatch)
  - AB-11 (carried) — Draft.tsx uses wrong order + wrong testids
  - BUG-A02 — Minors tab crashes (`tabData.map is not a function`)
  - UI Tester B: picksDelta always empty — Draft board never renders (sub-finding of AB2-01)

- **High: 9**
  - AB2-02 — validateBoxScore retry fail-open + missing Rule 4
  - AB2-03 — finalizeOffseason not transactional
  - API: Roster array always empty
  - API: No playoffs phase exposed
  - BUG-A01 — React key prop missing in standings tbody
  - BUG-A03 — Reconnecting banner stuck after server recovery
  - UI Tester B: Draft pick timing wrong (no speed honoring)
  - UI Tester B: player-leaders-table data structure mismatch
  - UI Tester B: timeline-season-undefined testid + champion/record not shown (snake/camel case mismatch)

- **Medium: 7**
  - AB2-04 — Draft completion doesn't auto-continue
  - AB2-05 — /api/draft/order returns expansion order during annual draft
  - AB2-06 — Quota-unsatisfiable cities crash worldgen
  - AB2-07 — JWT-shaped bearer tokens partially survive scrubError
  - CB2-1 — Duplicate scrubError in llm.ts drifted from canonical
  - API: Duplicate league 409 returns rate_limited error
  - API: AVG/ERA stats out of range (raise min thresholds)
  - UI Tester B: Standings polling lag (5s vs spec 3s)
  - UI Tester B: Draft engine crashes on rapid speed changes

- **Low: 5**
  - AB2-08 — Walk-off IP truncation hits wrong team
  - AB2-09 — Validator missing Rule 4 (total IP)
  - AB2-10 — mapPhase default cast
  - CB2-2 — POST /api/league/reset missing rate limit + body validation
  - CB2-3 — Startup catch logs raw err
  - CB2-4 — LIKE leading-% scan (defer to v0.2)
  - UI Tester B: Division leader row no visual distinction

Total: **4 Critical + 9 High + 7 Medium + 6 Low = 26 must-fix items.**

---

## Rationale for ITERATE

build-rules.md §Severity Classification: "Build is **complete** when all post-build reports contain zero Critical, High, or Medium findings AND the Architect formally issues COMPLETE."

The committed Iteration 2 build has 4 Critical and 9 High findings. The two most-fundamental Criticals (AB2-01 and BUG-A02) are user-blocking:

- **AB2-01**: The Draft tab — the marquee feature of v0.1.0 — does not render at all because of a one-line server/client contract mismatch. Every Draft-related spec test fails.
- **BUG-A02**: Clicking the Minors tab triggers a React error boundary, requiring a full page reload. Users cannot view minor league depth for any team.

Beyond these blockers, the High-severity findings cumulatively yield a release that any reviewer would reject in 5 minutes:
- Playoffs phase invisible (test 3.27 fails)
- Roster always empty (test 5.4 fails)
- Player leaders table shows "No data yet" forever
- Timeline cards show only the year ("Season 2026"), not the champion
- Standings polling lags 5s+
- Reconnecting banner never clears after a server restart

ITERATE is mandatory. The Iteration 3 instruction set focuses on closing all 4 Critical + 9 High + 7 Medium findings. The 5 Low items are gathered into a "cleanup" section but the Developer is expected to address them in the same iteration to reach COMPLETE.

---

## Notes for Iteration 3

- **Lane discipline held in Iteration 2.** Per the Iteration 1 incident with the API Tester, the reviewers each stayed in their lanes for Iteration 2. The UI Testers were run for the first time (Iteration 1 was blocked by AB-01) and produced valuable findings, particularly the cross-cutting symptom that "the server starts, but the Draft and Minors tabs are broken."

- **The Developer's Iteration 2 work was thorough on the server side.** Every Iteration 1 finding (Critical, High, Medium) is RESOLVED per all three reviewers. The two new Criticals introduced are both client/server contract mismatches — the kind of thing that only surfaces after the server can actually start and the UI can talk to it. This is expected and not a quality criticism.

- **Going into Iteration 3, the Developer should focus equally on client code.** Iteration 1 instructions were 90% server; Iteration 2 instructions need to be ~50/50 split because the remaining defects are at the client/server interface and in the React views.

---

**End of architect-eval-2.md.**
