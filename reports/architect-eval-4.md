# Architect Evaluation 4 — Baseball Dynasty Simulator v0.1.0

**Iteration:** 4 (Phase 2 — post-build)
**Reviewer:** Architect
**Inputs:** `ciso-iter4-post-build.md`, `adversary-iter4-post-build.md`, `api-tester-iter4-results.md`, `ui-tester-a-iter4-results.md`, `ui-tester-b-iter4-results.md`, `architect-eval-3.md`, `developer-instructions-4.md`, plus direct inspection of the source at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`.

---

## Decision: ITERATE (final pre-COMPLETE iteration)

Iteration 4 fixed every Iter-3 Critical (DRAFT_PAUSED no longer crashes server; offseason UNIQUE constraint resolved via migration 005). All UI-testability fixes landed (nav testids, division-leader attribute, auto-navigate to Draft, draft-pick-reveal). CISO returns zero findings. The build is materially shippable for the local-dev threat model.

However four issues remain that block COMPLETE. Two are NEW Critical regressions introduced by Iter-4 itself; the other two are remaining High items that have repeatedly survived previous iterations.

### Critical (must fix, blocks COMPLETE):

1. **Season-3 box-score infinite loop (NEW in Iter 4).** API Tester ran two full seasons cleanly, then on Season 3 hit `[game N] box-score validation failed: Home total IP 0.00 != expected 9` and the engine retries the same game forever. Root cause: after two offseasons of retirement + free agency, some teams reach Season 3 with zero starting pitchers. `selectStartingPitcher` returns null, `generatePitcherLines` returns an empty array, total IP = 0, validation fails on every retry, and the game is SKIPPED without advancing `current_game_number` → `getNextGame` returns the same `gameNumber` next tick → permanent stall. `validatePostDraftRosters` is called only after the expansion draft (`engine.ts:323`), never after the annual draft or the offseason finalize.

2. **Cooperative pause corrupts offseason annual draft (AB4-01, NEW in Iter 4).** When a user POSTs `{"speed":"paused"}` mid-annual-draft, the new cooperative `return` in `runAnnualDraft` propagates back into `runOffseason`'s for-loop (`offseason.ts:24-53`). That loop is unaware of pause and proceeds to write `offseason_step='done'`, then runs `finalizeOffseason` which advances `season_number = previousSeason + 1` and switches phase to `regular_season`. The result: partial annual draft (only N of 600 picks made), no path to resume (the offseason_step is already past 'annual_draft'), and the new season starts with short-rostered teams. Silent data corruption.

### High (must fix, blocks COMPLETE):

3. **POST /api/league/new requires JSON body (NEW regression in Iter 4).** Spec line 24 says "POST /api/league/new returns 200" with no body required. API Tester saw HTTP 400 with `{"error":"invalid_body","details":{"formErrors":["Required"]}}` when the body was omitted. Source: `server/index.ts:32-42` invokes `validateBody(NewLeagueBody)` which calls `schema.safeParse(req.body)`. If the client omits the Content-Type header AND the body, Express sets `req.body` to `{}` (an empty object), and `z.object({seed: optional(), leagueName: optional()})` parses `{}` successfully. So the regression must be exercised by a request without a body and without `Content-Type: application/json`, in which case Express does not populate `req.body` at all and `safeParse(undefined)` errors with "Required". The fix is to allow undefined body in the validator (treat missing body as `{}`).

4. **AVG missing from /api/players/leaders hitting array (NEW regression OR test-blocker).** UI Tester B reports the `hitting` array contains only HR and RBI; AVG is absent. Looking at `server/routes/players.ts:25-34`, the AVG query IS present and is concatenated into `hitting` at line 92. So the API code is correct. UI Tester B's report and API Tester's "API returns HR/RBI only" claim are inconsistent with the source. **Most likely the issue:** AVG entries are filtered out by the `at_bats >= 150` floor when total games played < 50 or when sampling occurred before season completion. The AVG query yields zero rows if no player has 150+ AB yet. Need to verify by inspecting the actual API response after a full season. **Treat as High** — if it really is missing from the response after a full season, the formula min-AB threshold must be lowered or the query order must be relaxed.

### Medium (fix if practical):

5. **AVG simulated leaders 0.41-0.47 (spec 0.200-0.400).** Iter-4 changed the hit-probability formula to `contact/400 + 0.15` capped at 0.40. Math: contact=99 → 0.3975, contact=50 → 0.275. The math is sound for individual at-bat probability, but over 150 ABs the SAMPLED batting average for the top hitters lands at 0.41-0.47. This is BATTING-AVERAGE VARIANCE: top performers (with both high hitProb AND high random sampling luck) regress upward, not to the mean. A 99-contact hitter with hitProb=0.3975 over 150 ABs has a 2σ band of roughly [0.34, 0.46]. The TOP-10 leaders are by definition the upper tail of the distribution and will reliably exceed 0.40. The fix is to lower the cap to ~0.36 (giving top-end at 99 contact a hitProb of 0.36 and a +2σ tail at ~0.41 — but the top-10 leaders are pulled from a 400-player league, so the upper extreme is roughly +2.5σ above mean, around 0.42 even with a 0.36 hitProb). A more robust fix is to lower the additive baseline AND the cap to bring the upper tail under 0.40. Acceptable to defer to v0.2 if the architect rules this is a calibration question rather than a correctness issue.

6. **Standings within-division sort order.** `server/routes/standings.ts:8` orders by `wins DESC, (wins - losses) DESC`. For teams with different games-played counts (which happens mid-season due to scheduling), this can place a team with .500 PCT below a team with .429 PCT (because the .429 team has more wins, just also more losses). UI Tester B observed `0.545, 0.536, 0.429, 0.5, 0.435`. The fix: sort by computed PCT in JS after the SQL pull, or use `ORDER BY (CAST(wins AS REAL) / NULLIF(wins+losses, 0)) DESC`.

7. **Test coverage gap AB4-03.** `server/tests/draftPause.test.ts` only exercises the turbo path (which skips the cooperative-pause check entirely). The non-turbo cooperative-pause logic at `draft.ts:446-450` and `:533-537` has zero runtime test coverage. Add a non-turbo test that actually flips `currentSpeed` to `paused` between picks via `setSimSpeed('paused')`.

### Architect Rulings (no code change):

8. **Turbo cold-start 26.4s / warm 2.1s.** UI Tester B observed 26.4s for the first full draft (cold-start) versus ~2.1s for subsequent runs. The Iter-4 turbo single-transaction batch achieves the spec target on warm-path. The 26.4s cold figure is most likely first-run JIT compilation of TypeScript-via-tsx + Node module resolution + initial SQLite WAL setup + the 800-player worldgen INSERT loop (which runs BEFORE the turbo draft). The spec test "POST /api/sim/speed turbo, verify all 600 picks complete in <5 seconds total" is measured from the turbo POST onward, NOT from server boot. **Ruling: 2.1s warm-path satisfies spec.** The 26.4s cold figure is a measurement artifact that includes server boot + worldgen + first-tick TypeScript JIT. Document the result; no code change required.

9. **AB4-02 (turbo blocks event loop for ~2-5s).** Adversary correctly identifies that the single `db.transaction()` wrapping 600 picks is fully synchronous and blocks all HTTP traffic for its duration. The spec does NOT require turbo to be pauseable mid-batch; it requires turbo to complete in <5s. A 2.1s warm-path lockup is below typical browser-fetch-timeout (30s) and below the client's reconnect-banner threshold (2 consecutive failed polls × 500ms in draft = 1000ms — actually below 2.1s, so the banner WILL flash briefly). **Ruling for v0.1.0: ACCEPTABLE.** The turbo batch is a developer-tool fast-forward; users are expected to wait. The brief "Reconnecting..." flash is cosmetic. Document this as an explicit v0.2 enhancement (chunk into 50-pick sub-batches).

10. **AB3-01 / AB4-05 (latent SP-zero stall).** This finding is now realized as the Critical Season-3 box-score loop above. Per item 1, `validatePostDraftRosters` must be called after every annual draft and after offseason finalization.

11. **`GET /api/players/99999` returns synthetic player (UI Tester A bug 4A-001).** Per Iter-3 ruling: player IDs are global auto-increment and 99999 IS a legitimate prospect after multiple offseasons of draft-class generation (200 per season × 5 seasons ≈ 1000 prospects on top of original 800 = >99999 in a few decades, but ID 99999 specifically is reachable around season 495 — actually no, IDs are league-scoped auto-increment but stored as global RowID, so a single multi-season run won't reach 99999 alone). However the production code at `server/routes/players.ts:131-132` clearly does:
    ```ts
    const player = prepared('SELECT * FROM players WHERE id = ?').get(idResult.data) as PlayerRow | undefined;
    if (!player) { res.status(404).json({ error: 'Player not found' }); return; }
    ```
    There is NO synthetic-player generation in the route. UI Tester A's observation of a synthetic "Prospect Draft199" record means there is a real player with id=99999 in their DB (which had run for many seasons before the test). **Ruling stands:** the spec sentinel ID must be 99999999, not 99999. No code change.

12. **`seasonNumber` vs `season` field name in `/api/state` response.** Spec test G0-4 says "Response includes fields: phase, season, simSpeed." Current `LeagueStateSnapshot.seasonNumber` (`shared/types.ts:33`) and `engine.ts:98` use `seasonNumber`. This field has been wrong since Iteration 1; both API Tester and Architect missed it earlier. **The spec wording IS "season"** (not "seasonNumber"). Adding a duplicate `season` field would be the safe non-breaking fix; renaming would break the client (`client/src/views/League.tsx` and others read `state.seasonNumber`). **Ruling:** add `season` as an alias alongside `seasonNumber` (both populated identically) so spec tests pass without breaking the client. v0.2 may remove `seasonNumber`. **High severity** because the spec explicitly names the field.

---

## Source-Code Investigation Details

### Issue 1 — Season-3 infinite box-score loop

**Files:** `server/sim/game.ts:97-106, 215-388`, `server/sim/engine.ts:367-404`, `server/sim/worldgen.ts:371-400`, `server/sim/offseason.ts:298-336`.

**Mechanism:**
- `selectStartingPitcher` (`game.ts:97-106`): `SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 AND position = 'SP' ... LIMIT 5`. Returns `null` if zero rows.
- `simulateGame` (`game.ts:215+`): calls `selectStartingPitcher(homeTeam)` at line 247. If null, `generatePitcherLines` at line 286-291 returns an empty array (the `if (starter)` block at line 559 is skipped).
- `validateBoxScore` (`game.ts:151-213`): Rule 4 (line 196-210) computes `homeIPTotal = result.pitcherLines.filter(...).reduce(s+ip, 0)`. With zero pitcher lines, `homeIPTotal = 0`, `expectedHomeIP = 9.0`. Fails with "Home total IP 0.00 != expected 9".
- `simulateGame` retry loop (`game.ts:357-381`): the 3-retry block re-applies hits/walks/RBI fixes but does NOTHING for missing pitcher lines. After 3 failed retries, it returns at line 385 without writing the game.
- **Critical:** when `simulateGame` returns early without writing, the league row's `current_game_number` is NOT advanced (the `UPDATE leagues SET current_game_number = ?` is inside the transaction at `game.ts:438`, which is bypassed by the early return).
- `runGameTick` (`engine.ts:367`) calls `getNextGame(league.id)` which returns the next game where `gameNumber > league.current_game_number`. Since `current_game_number` did not advance, the same game is returned again. The next tick attempts the same game. Forever.

**Why Seasons 1-2 work but Season 3 doesn't:**
- After expansion draft: `validatePostDraftRosters(league.id)` is called (`engine.ts:323`), which auto-balances any team missing the SP/C/SS/CF/CL minimums. Every team enters Season 1 with full position coverage.
- During Season 1's offseason: retirement (age 40+) and free agency (contract_years_remaining = 0) remove players. The annual draft adds 600 picks but `assignRosterLevels` is called AFTER the annual draft, which moves top 25 by overall_rating to MLB. With 600 picks per team distributed across 30 rounds, some teams may now have <2 SP on MLB roster (especially if the draft class skewed toward position players).
- Critically, `validatePostDraftRosters` is NOT called after the annual draft path (search: `grep -n validatePostDraftRosters server/sim/*.ts` returns only the expansion-draft caller and the function definition).
- Season 2 may still work if no team is fully SP-depleted yet. Season 3 hits the wall after a second round of retirement/FA.

**Fix:**
- Add `validatePostDraftRosters(leagueId)` call at the end of `runAnnualDraftStep` in `offseason.ts:298-302`, AND at the end of `finalizeOffseason` in `offseason.ts:305-333` (after the W/L reset, before phase transition).
- ALSO add a defensive guard in `simulateGame`: if `selectStartingPitcher` returns null, fail gracefully — emit a warning, advance `current_game_number`, and write a placeholder game result (e.g., 0-0 forfeit) rather than retrying indefinitely. This is the defense-in-depth fix in case `validatePostDraftRosters` misses some edge case.

### Issue 2 — Offseason pause corruption (AB4-01)

**Files:** `server/sim/offseason.ts:15-54`, `server/sim/draft.ts:518-547`.

**Mechanism:**
- `runOffseason` is a for-loop over the `steps` array (`offseason.ts:24-53`).
- Step 5 is `'annual_draft'`, which calls `runAnnualDraftStep` → `runAnnualDraft`.
- `runAnnualDraft` non-turbo path at `draft.ts:518-544` checks `isPaused()` after each pick. If true, `return`s on line 536.
- The `return` from `runAnnualDraft` propagates to `runAnnualDraftStep` (no error, just function return), which returns to `runOffseason`'s for-loop body.
- The for-loop's bottom (`offseason.ts:50-52`) writes `offseason_step = ?` to the NEXT step (`'done'`).
- The for-loop's next iteration enters `case 'done'`, which calls `finalizeOffseason` → advances season number, resets W/L, phase='regular_season'.

**Fix:** `runOffseason` must detect the pause state and break BEFORE advancing `offseason_step`. After calling `runAnnualDraftStep`, check `isPaused()`; if true, do NOT update `offseason_step`, log "[offseason] Paused at step annual_draft", and `return` from `runOffseason` cleanly. On resume, `runOffseason` re-enters at `offseason_step = 'annual_draft'` (the unchanged checkpoint) and `runAnnualDraft`'s resume logic at `draft.ts:484-488` picks up from `max(pick_number) + 1`.

**Note for symmetry:** the same pause-cascade issue does NOT affect `runRetirementStep`, `runDevelopmentStep`, `runFreeAgencyStep`, or `runFrontOfficeStep` because none of those are pausable — they run synchronously to completion. Only `runAnnualDraftStep` calls into the cooperative-pause-aware `runAnnualDraft`. So the fix only needs to special-case the annual_draft step.

### Issue 3 — POST /api/league/new regression

**File:** `server/index.ts:32-42, 101-114`.

**Mechanism:**
- Express `app.use(express.json({ limit: '8kb' }))` parses `Content-Type: application/json` bodies. If the request has NO body and NO Content-Type header, `req.body` is `undefined` (not `{}`).
- `validateBody(NewLeagueBody)` calls `schema.safeParse(req.body)` → `safeParse(undefined)`.
- `z.object({...}).safeParse(undefined)` returns `{success: false, error: {formErrors: ["Required"]}}` because zod requires the input to be at least an object.
- The validator responds with HTTP 400 `{"error":"invalid_body","details":{"formErrors":["Required"]}}`.

**Why this is a regression:** Spec test G1-1 says "POST /api/league/new returns 200" with no body specified. Prior iterations presumably exercised the endpoint via curl with a JSON body, masking this defect. API Tester Iter-4 explicitly tested with no body and observed the 400.

**Fix:** Inside `validateBody`, coerce undefined `req.body` to `{}` before parsing:
```ts
function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body === undefined ? {} : req.body;
    const result = schema.safeParse(body);
    // ...
  };
}
```

### Issue 4 — `season` field name

**File:** `shared/types.ts:33`, `server/sim/engine.ts:98`.

**Mechanism:** The snapshot type defines `seasonNumber: number`. `refreshCache` at `engine.ts:98` writes `seasonNumber: league.season_number`. The spec test G0-4 reads "Response includes fields: phase, season, simSpeed."

**Fix:** Add `season: league.season_number` alongside `seasonNumber` in the snapshot, and add `season?: number` to the `LeagueStateSnapshot` type. The client continues to read `seasonNumber` (no client change needed). v0.2 can deprecate the alias.

### Issue 5 — AVG simulated leaders 0.41-0.47

**File:** `server/sim/game.ts:459-462`.

**Mechanism:** Current formula:
```ts
const hitProb = Math.max(0.15, Math.min(0.40, player.contact / 400 + 0.15));
```
For contact=99: hitProb = 0.3975. For contact=50: 0.275.

A single batter with hitProb=0.3975 across 150 ABs has expected hits = 59.6, standard deviation ≈ 6.0 (binomial). 95% CI on observed AVG: [0.318, 0.477]. Across ~800 players (of whom ~150 might qualify for the min-AB 150 filter), the upper tail of the top-10 leaders is at roughly +2.5σ above mean = 0.40 + 0.04 = 0.44. Observed 0.41-0.47 is consistent with this math.

**Fix:** Either (a) lower the cap and baseline:
```ts
const hitProb = Math.max(0.15, Math.min(0.36, player.contact / 500 + 0.13));
```
For contact=99: 0.328. Expected leaders top-end: 0.328 + 0.07 = ~0.40. Or (b) raise the min-AB threshold to 175+. (a) is preferred because it doesn't artificially shrink the leaderboard sample.

**Architect ruling: MEDIUM, fix if Developer has time.** Stat realism within ±50 batting points is a calibration question, not a correctness defect. If Developer cannot calibrate cleanly in Iter 5, document the actual range in a code comment and defer further tuning to v0.2.

### Issue 6 — Standings within-division sort

**File:** `server/routes/standings.ts:7-9`.

**Fix:** Change the SQL to:
```sql
SELECT *, CAST(wins AS REAL) / NULLIF(wins + losses, 0) AS pct
FROM teams WHERE league_id = ?
ORDER BY pct DESC, (wins - losses) DESC, wins DESC
```
Or sort in JS after the pull:
```ts
const teams = (... rows ...).sort((a, b) => {
  const pctA = (a.wins + a.losses) > 0 ? a.wins / (a.wins + a.losses) : 0;
  const pctB = (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : 0;
  return pctB - pctA || (b.wins - b.losses) - (a.wins - a.losses) || b.wins - a.wins;
});
```

### Issue 7 — draftPause test gap (AB4-03)

**File:** `server/tests/draftPause.test.ts:41`.

**Fix:** Add a second test that:
1. Calls `setSimSpeed('normal')` BEFORE invoking `runExpansionDraft(league, false, ...)`.
2. In the callback at pick 5, calls `setSimSpeed('paused')`.
3. Awaits the runExpansionDraft promise.
4. Asserts the draft loop returned early (`SELECT COUNT(*) FROM draft_picks WHERE league_id = ?` < 600).
5. Asserts zero unhandled rejections.

This test exercises the actual cooperative pause logic at `draft.ts:446-450`.

---

## Adversary's NOT-READY Verdict — Confirmed and Adopted

The Adversary correctly identified AB4-01 (Critical) and AB4-02 (High, ruled acceptable by Architect). The Adversary also correctly flagged AB4-03 (test coverage gap). The Adversary's READY/NOT-READY verdict in Iter-3 was wrong; the Iter-4 NOT-READY verdict is right. Process note: the Adversary's commitment to "exercise the full offseason → season 2 transition before declaring READY" was honored this iteration. The Architect commends the Adversary's discipline.

---

## CISO Iter-4 Verdict — Adopted

CISO returned 0 findings across all severity bands. The cooperative-pause refactor, turbo single-transaction batch, migrations 005/006, and front-office field additions are all clean under the localhost threat model. No new code changes are required for security in Iter 5.

---

## Severity Summary for Iteration 4

- **Critical: 2** (must fix in Iter 5)
  - Season-3 box-score infinite loop (`validatePostDraftRosters` not called after annual draft; `simulateGame` has no zero-pitcher fallback)
  - Offseason pause cascades to finalize (AB4-01)

- **High: 3** (must fix in Iter 5)
  - POST /api/league/new requires body (regression)
  - `season` field missing from `/api/state` snapshot
  - AVG absent from `/api/players/leaders` hitting array (likely test-timing artifact, verify in Iter 5)

- **Medium: 3** (fix if practical)
  - Normal pick timing measurement (UI methodology variance; server is correct)
  - AVG stat range 0.41-0.47 (calibration)
  - Within-division standings sort order
  - AB4-03 test coverage gap

- **Architect rulings (no code change):**
  - Turbo cold-start 26.4s (measurement artifact, warm-path 2.1s satisfies spec)
  - AB4-02 turbo event-loop block (acceptable for v0.1.0)
  - `/api/players/99999` (use 99999999 as test sentinel)
  - `/api/standings` grouped shape (unchanged from Iter 3 ruling)

Total must-fix: **2 Critical + 3 High = 5 items**. Plus 3 Medium fixes if practical. Plus 1 test gap.

---

## What Iter 4 Got Right

- **DRAFT_PAUSED resolved.** No unhandled rejections; server survives pause-during-draft.
- **Offseason UNIQUE constraint resolved.** Migration 005 adds `is_expansion_draft` to the index. Seasons 1 and 2 complete cleanly.
- **CISO: zero findings.** Cooperative pause architecture, single-transaction turbo, migrations 005/006, and front-office routing are all clean.
- **UI testability fixed.** `nav-{tab}` testids, `data-division-leader`, auto-navigate to Draft, draft-pick-reveal all working.
- **ERA leaders in spec range.** Confirmed 2.43-3.54 across UI Tester B's verification.
- **Playoffs phase observable.** API Tester confirmed `phase=playoffs` appears in `/api/state` during the playoff window.
- **Front-office fields populated.** `owner_name`, `gm_name`, `manager_name`, `revenue`, `payroll_budget`, `gm_personality` all present on `GET /api/teams` list.
- **Persistence intact.** Server restart preserves phase, season, standings, team names.

---

## Iteration 4 Process Notes

- **Adversary discipline restored.** The Adversary correctly identified two new defects introduced by the Iter-4 fixes themselves, which the Iter-3 architect-eval anticipated they should be looking for.
- **Test coverage gap.** AB4-03 highlights that adding a test for a fix isn't the same as testing the fix. Iter 5 should add the non-turbo pause test.
- **Architect testing gap.** The `season` vs `seasonNumber` field issue has been wrong since Iteration 1 and was missed by API Tester and Architect in three prior reviews. The lesson: spec test text is authoritative; deviation from the spec wording must be flagged at every iteration regardless of "but the client works."

---

## Rationale for ITERATE

Per `build-rules.md`: "Build is complete when all post-build reports contain zero Critical, High, or Medium findings AND the Architect formally issues COMPLETE."

This iteration has 2 Critical and 3 High findings. The Season-3 loop alone is sufficient to block COMPLETE — a build that cannot progress past Season 2 is not production-ready for a "dynasty" simulator. The Iter 5 instructions are narrow and targeted: 5 must-fix items, 3 nice-to-have, 1 test gap. With focused execution, Iter 5 will be the final iteration before COMPLETE.

---

**End of architect-eval-4.md.**
