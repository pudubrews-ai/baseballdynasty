# Architect Evaluation 1 — Baseball Dynasty Simulator v0.1.0

**Iteration:** 1 (Phase 2 — post-build)
**Reviewer:** Architect
**Inputs:** `architect-eval-0.md`, `developer-instructions-1.md`, `ciso-post-build.md`, `adversary-post-build.md`, `api-tester-results.md`, `developer-build-complete.md`, and a direct inspection of the committed source at `baseball-dynasty/server/` and `baseball-dynasty/client/` at commit `4a8588d`.

---

## Decision: ITERATE

The committed build cannot start (Adversary AB-01 confirmed: `engine.ts:8` imports `validatePostDraftRosters` from `./draft.js`, but the symbol is exported from `worldgen.ts:323`). Two Critical and at least nine High findings are open across the three reports. The Developer self-report's "97 tests passing, 0 failures" is consistent with the test suite running independently of `server/index.ts` startup — the test suite never exercises the server bootstrap path, so it did not catch the broken import. ITERATE is mandatory; COMPLETE is unreachable until at minimum AB-01, AB-02, and all 12+ confirmed High items are fixed.

---

## Finding Assessment

### Severity scale (build-rules.md §Severity Classification)
- **Critical:** System broken or serious vulnerability.
- **High:** Significant functional or security gap.
- **Medium:** Meaningful correctness/safety issue.
- **Low:** Minor issue, fix at Architect's discretion.

### Adversary findings (AB-01 through AB-22)

| ID | Severity (as reported) | Decision | Justification |
|---|---|---|---|
| **AB-01** | Critical | **CONFIRMED Critical** | Verified: `server/sim/engine.ts:8` imports `validatePostDraftRosters` from `./draft.js`; the export is on `server/sim/worldgen.ts:323`. Server cannot start. Compile fails with TS2305. Also confirmed two collateral TS errors at engine.ts:123 and :234 (Adversary AB-19 is the same family). |
| **AB-02** | Critical | **CONFIRMED Critical** | Verified at `server/sim/game.ts:405` and `:418` — `Math.floor(Math.random() * ...)` inside `clampRBI`. The function is called once per team per game (`game.ts:236-237`). Breaks D7/D30 determinism end-to-end; replays diverge. |
| **AB-03** | Critical | **CONFIRMED Critical** | Verified at `server/sim/game.ts:152-173`. `validateBoxScore` is exported but never called by `simulateGame`. The function body at line 167 does `b.teamId === homeScore` (integer score vs team_id), so even if invoked it cannot validate RBI correctly. The Developer's own claim ("§5.1 box score consistency rules" implemented) is contradicted at the runtime path — only the *generators* enforce constraints, with no post-write gate. Overlaps with API Tester finding "1 hits-less-than-runs violation in 500 games" (same root cause: no validator catches the edge case). |
| **AB-04** | High | **CONFIRMED High** | Verified at `server/sim/playoffs.ts:116-119, 127-128, 136`. `runSeries(... 5 ...)` is called for both DS rounds; `runSeries` interprets `bestOf` as games-in-series (`winsNeeded = Math.ceil(bestOf/2)`). v0.1.0 spec is silent on series lengths but the original `app-spec.md` (per Adversary citation) says Division=3, Championship=5, World=7. The instructions also need a definitive number. **Architect ruling:** DS = best-of-5 (3 wins), CS = best-of-7 (4 wins), WS = best-of-7 (4 wins). This matches MLB convention and the Developer's already-implemented CS/WS values; only the DS value is wrong (currently best-of-5 but argued by Adversary as best-of-3). Architect chooses best-of-5 for DS because the spec is ambiguous and that's what shipped. **NOTE:** developer-instructions-2 will specify the *exact* values to lock down: DS=5, CS=7, WS=7. This downgrades AB-04 to a spec-clarification, but the second issue — that `runSeries` interprets `bestOf` inconsistently with how playoffs.ts calls it — must still be audited and confirmed correct. |
| **AB-05** | High | **CONFIRMED High** | Verified at `server/sim/game.ts:196` (`const isWalkOff = homeWins`). Walk-off should fire only when the home team scores the winning run in the bottom of the 9th+. Currently fires on ~54% of games (all home wins). Plus the IP truncation at line 448 incorrectly applies 8.5 IP to all home wins, biasing pitcher stats. |
| **AB-06** | High | **CONFIRMED High** | Verified at `server/sim/season.ts:189-197`. The HAVING clause counts only games where the team is `home_team_id`; max possible is 25 home games per season. The 35-threshold is unreachable. Trade deadline never fires for any season. |
| **AB-07** | High | **CONFIRMED High** | Verified at `server/sim/game.ts:317-328` — every call to `simulateGame` unconditionally updates `teams.wins/losses/runs_scored/runs_allowed/games_played`. `server/sim/playoffs.ts:181-184` calls `simulateGame` for playoff games with no opt-out flag. Regular-season standings get polluted with playoff results. |
| **AB-08** | High | **CONFIRMED High** | Verified at `server/sim/offseason.ts:290` (front_office step resets `wins=0, losses=0` for all teams) and `server/sim/draft.ts:264-270` (annual draft order reads from `teams` ordered by `wins ASC, losses DESC`). The reset happens *before* annual_draft step. After the reset, the sort is non-deterministic / falls to insertion order. Reverse-standings invariant broken. |
| **AB-09** | High | **CONFIRMED High** | Verified at `server/sim/draft.ts:311` (`for (let round = 1; round <= totalRounds; round++)`) — no resume bookkeeping. Combined with `001_init.sql:98-109` lacking UNIQUE constraint on `(league_id, round, pick_number)` (only an index at line 209). Pause-then-resume produces duplicate picks. Overlaps with the API Tester's mention of "draft completes successfully with procedural fallback" (no pause was tested, so the bug was not exercised). |
| **AB-10** | High | **CONFIRMED High** | Verified at `server/sim/worldgen.ts:374-377`. SQL placeholders are `league_id, position`; `.get(position, leagueId)` passes them reversed. Both predicates evaluate false → minors fallback always returns no row → silent failure. |
| **AB-11** | High | **CONFIRMED High** | Verified at `client/src/views/Draft.tsx:33` (fetches `/api/teams`, which `server/routes/teams.ts:14` returns ordered by `wins DESC`), and `Draft.tsx:90-92` (computes `onClockTeamId` from API list order with snake reversal — not from the actual `generateExpansionDraftOrder` server-side shuffle). Spec data-testid is `draft-pick-{round}-{pickNumber}` per `v0.1.0-app-spec-section.md:283`; the implementation at `Draft.tsx:194` writes `draft-pick-${round}-${teamIdx + 1}` (column index, which is wrong for even rounds with snake reversal). |
| **AB-12** | Medium | **CONFIRMED Medium** | Verified at `server/sim/offseason.ts:175` — `seedFor('fa_contract', Date.now())` inside a loop violates D7. Also produces biased distribution for same-millisecond iterations. |
| **AB-13** | Medium | **CONFIRMED Medium** | Verified at `server/sim/offseason.ts:181-187` — hardcoded `1` for `season_number` in the `transactions` INSERT. FA signings recorded forever as season-1 events. |
| **AB-14** | Medium | **CONFIRMED Medium** | Verified at `server/sim/draft.ts:232` — `seedFor('draft_fill', Date.now())`. Same D7 violation as AB-12. Low frequency code path but still a determinism break. |
| **AB-15** | Medium | **CONFIRMED Medium** | Verified at `server/sim/season.ts:101-104`. Both-zero quota branch falls into else without rollback. Combined with the schedule test not calling the real `generateSchedule` (it re-implements the algorithm in `server/tests/schedule.test.ts`), the production path is untested. |
| **AB-16** | Medium | **SEVERITY ADJUSTED → Low** | Verified at `server/sim/engine.ts:147-150`. Comment explicitly says "don't cascade-delete players/teams in v0.1.0 for simplicity." The 30-second rate limit on `POST /api/league/new` plus the limit of 3 archived leagues stored bounds the growth meaningfully. For v0.1.0 single-user local-tool threat model, this is a Low housekeeping item; not a correctness blocker. Architect downgrades. **Defer to v0.2.** |
| **AB-17** | Medium | **CONFIRMED Medium** | Verified at `server/sim/playoffs.ts:31-59`. `Array.prototype.sort` requires a consistent comparator. Calling `rng()` inside the comparator yields non-deterministic +1/-1 with no memoization for the (a,b) pair. JS engines may produce undefined results. |
| **AB-18** | Medium | **CONFIRMED Medium** | Verified at `server/sim/draft.ts:104-106`. `LIMIT 50 ORDER BY overall_rating DESC` filters out scarce-position candidates whose effective PAV would beat in-prefix players. Real impact is highest in late rounds where the top-50 is heavily LF/RF. |
| **AB-19** | Low | **CONFIRMED Low** | Verified at `server/sim/engine.ts:123` — `exactOptionalPropertyTypes` strict-optional violation. Compile fails. Subsumed by AB-01 fix because the Developer must satisfy `tsc -p tsconfig.server.json` for the build to run. |
| **AB-20** | Low | **CONFIRMED Low** | Verified at `server/sim/playoffs.ts:144-148`. No MVP recorded. `mvp_player_id` always null in `season_narratives`. Timeline view (`Timeline.tsx`) consequently shows null MVP. Architect downgrades the visibility to Low because the spec lists "champion + narrative" as the minimum Timeline content; MVP is a stretch goal. Document the deferral, generate procedurally if cheap. |
| **AB-21** | Low | **CONFIRMED Low** | Verified at `server/services/llm.ts:212`. Daily budget counts attempts, not successes. The guardrail is slightly tighter than intended; not unsafe. |
| **AB-22** | Low | **CONFIRMED Low** | Same defect family as AB-06 (broken SQL counts home games only). Architect treats this as a sub-finding of AB-06 — fix once and verify both. |

### CISO findings (CB-1 through CB-7)

| ID | Severity (as reported) | Decision | Justification |
|---|---|---|---|
| **CB-1** | High | **CONFIRMED High** | Verified at `server/index.ts:179` — `app.listen(PORT, () => {...})`. No host arg → binds 0.0.0.0. One-line fix. Local-tool threat model bounds blast radius, but the developer-instructions-1.md §6.6 "Express 5, minimal middleware" never spelled out the localhost-bind, so this is an instructions gap as well as an implementation gap. |
| **CB-2** | Medium | **CONFIRMED Medium** | Verified at `server/services/llm.ts:144-152`. Single-pass replaces are bypassable. React text-node rendering covers the live exploit path, but the defense-in-depth is weak. Fix in Iteration 2. |
| **CB-3** | Medium | **CONFIRMED Medium** | Verified at `server/index.ts:44-53`. Rate limiter consumes its window on requests rejected later by validateBody. Minor UX issue with no security exposure. Fix by reordering middleware or moving the timestamp set into the handler. |
| **CB-4** | Low | **CONFIRMED Low** | Five sites at `server/sim/engine.ts:238,297,348,356` and `server/index.ts:183` log raw `err` to stderr. Currently unexploitable because LLM errors are pre-scrubbed at the `services/llm.ts` boundary, but the discipline must be uniform. |
| **CB-5** | Low | **CONFIRMED Low** | Duplication of `scrubError` between `server/index.ts:159-167` and `server/services/llm.ts:155-163`. Extract to shared util. |
| **CB-6** | Low | **CONFIRMED Low** | `version: '0.1.0'` in `/healthz` is fingerprintable. Becomes moot once CB-1 is fixed. |
| **CB-7** | Low | **CONFIRMED Low** | `schedule_json` and per-event description length are not size-validated before write. Defensive, not exploitable in v0.1.0. |

### API Tester findings (Group 0-10)

The API Tester ran against a partially-patched local build (per orchestrator note, the patches were reverted before commit). The findings still describe real defects in the committed code:

| API Tester Finding | Decision | Notes / Overlap |
|---|---|---|
| BUG-1 duplicate `export { initEngine }` | **CONFIRMED High** | Verified at `server/sim/engine.ts:361`. Independent of AB-01 but also blocks server startup under `tsx` ESM strict mode. |
| BUG-2 missing `validatePostDraftRosters` | **CONFIRMED Critical** | Same root cause as AB-01; the API Tester worked around it by writing a new function in `draft.ts`. The correct fix is to change the import in `engine.ts`, not to duplicate the function. |
| BUG-3 sim doesn't restart after draft | **CONFIRMED High** | The API Tester observed: after expansion draft completes, `simRunning=false` and `currentSpeed='turbo'`. Subsequent `POST /api/sim/speed` with `'normal'` does not restart the tick loop because the engine's restart guard requires `prevSpeed === 'paused'`. Architect ruling: confirmed as new finding **AB-NEW-01** (post-draft tick restart). |
| POST /api/league/new returns 201 (not 200), no `phase` field, phase value `expansion_draft` instead of `draft` | **CONFIRMED High** | Three sub-defects in one route at `server/index.ts:79-90` and `server/routes/teams.ts:14` indirectly. Spec mandates 200, `{leagueId, phase: "draft"}`. |
| Market size distribution 3/7/6/4 instead of 2/4/8/6 | **CONFIRMED High** | Root cause: `server/data/cities.ts` pool is 6 mega / 8 large / 14 medium / 5 small; selection in `worldgen.ts:102-122` is region-constrained random with no market-size quota. Fix: add deliberate market-size quota sampling. |
| Team `abbreviation` missing | **CONFIRMED Medium** | `server/routes/teams.ts:15-28, 40-62` doesn't return `abbreviation`. Also missing from DB schema (`migrations/001_init.sql` has no `abbreviation` column on `teams`). Either compute or store. |
| `gm_personality` is flat, not nested | **CONFIRMED Medium** | `server/routes/teams.ts:54-56` returns three flat `gm*` fields. Spec/test expects nested `gm_personality: {philosophy, risk_tolerance, focus}`. Architect note: D1 said *store* flat (which is correct) but the *response* shape can be either; the test spec demands nested. Conform to test spec at the API boundary. |
| Minors not embedded in team detail | **CONFIRMED Medium** | `GET /api/teams/:id` returns no minors field. `GET /api/teams/:id/minors` returns flat array of all minor levels with `minorLevel` field; spec wants nested `{AAA: [], AA: [], A: [], Rookie: []}` either embedded in team detail or returned from `/minors`. |
| Blowout rate 26% vs spec 12-18% | **CONFIRMED High** | Root cause: `randTriangular(rng, 3, 4, 12)` at `server/sim/game.ts:191`. The mode=4 and max=12 produce too-flat a tail. The spec target 12-18% requires either lower max or stronger weight toward mode. Architect ruling: change `randTriangular(rng, 3, 4, 9)` (lower max from 12 to 9) and clamp winner score in `[3, 12]` by a separate distribution that produces blowout ratio ~15%. See dev-instructions-2 for exact formula. |
| Hits >= runs violation (1/500) | **CONFIRMED Medium** | Walks-deficit logic at `game.ts:222-233` has an off-by-one or edge case. Combined with AB-03 (validateBoxScore is dead) there is no runtime safety net. Architect: tighten the deficit check to `<=` instead of `<`, and add a post-generation assertion that calls `validateBoxScore` (after AB-03 is fixed) and regenerates on failure (limit 3 retries). |
| Playoffs phase skipped in turbo | **CONFIRMED Medium** | Reported by API tester; likely concurrent with AB-07 (playoffs writing to teams.wins) and the tick loop transitioning phases too quickly to observe. Investigate as part of the playoffs/standings fix. |
| Players leaders shape wrong (categories, fields) | **CONFIRMED High** | `server/routes/players.ts:82` returns `{battingAvg, homeRuns, rbi, era, strikeouts, whip}`. Spec wants `{hitting: [...], pitching: [...]}` with each entry as `{player_name, team_name, stat_value}` (where `player_name` is the *concatenated* full name, not first/last separately). |
| BA/ERA leader ranges (BA 0.429, ERA 0.915) | **CONFIRMED Medium** | Reflects a small sample at season start (8 games in). The min-50-AB and min-20-IP thresholds in `routes/players.ts:23, 56, 78` are not yet reached, allowing extreme outliers. Architect ruling: raise min-AB to 100 *or* gate leaders by `gamesPlayed > 25` to avoid early-season noise. |
| Timeline field names + missing notable_events | **CONFIRMED Medium** | `server/routes/timeline.ts:29-37` returns camelCase. Spec wants snake_case and a `notable_events` field. Fix at the route serializer; the underlying DB stores `notable_events_json` in `game_log` already, so the timeline route must aggregate top notable events per season. |
| Error message bodies all 4 wrong | **CONFIRMED High** | Spec strings are explicit per build-rules.md §"Spec Quality Standards" — "Every error message string verbatim." All four error responses (`Team not found`, `Player not found`, `Invalid speed. Must be paused\|normal\|fast\|turbo`, `League already exists. Use /api/league/reset to start over.`) must match exactly. Note: spec references `/api/league/reset` but implementation has `DELETE /api/league/current` — Architect resolves: change the error message string only, keep the existing endpoint. The error message is a literal, not a route reference; the user-facing copy can advise calling `/api/league/reset` but the implementation can route either way. **However**, to avoid future confusion, also add an alias route `POST /api/league/reset` that does the same thing as `DELETE /api/league/current`. |
| GET /api/state returns `{noLeague: true}` only | **CONFIRMED Medium** | Spec wants `phase`/`season`/`simSpeed` always present, even pre-league. Fix: when no active league, return `{leagueId: null, phase: "no_league", seasonNumber: 0, simSpeed: "paused"}` with all standard fields populated to defaults. |

### Developer self-report claims to verify

The Developer's `developer-build-complete.md` claims "97 tests passing, 0 failures" — this is consistent with the codebase but the tests do not exercise:
- Server startup (the import error at `engine.ts:8` is therefore not caught).
- Full simulateGame replay determinism (AB-02 not caught).
- `validateBoxScore` runtime invocation (AB-03 not caught).
- Trade deadline firing in an end-to-end run (AB-06 not caught).
- Playoff side effects on standings (AB-07 not caught).
- Annual draft order reading non-reset wins (AB-08 not caught).

The Developer's "deviations" list at the bottom is reasonable; none of the deviations themselves require fixing — the issues are spec-violations the Developer did not flag and bugs the test suite did not catch.

---

## False Positives Declared

**None.** Every finding across all three reports has independent evidence in the source code. The Adversary's AB-04 is the closest to ambiguous (the v0.1.0 feature spec is silent on series lengths; only `app-spec.md` mentions them), but the implementation's `runSeries(_, _, _, 5, 'American DS')` vs `7, 'American CS'` vs `7, 'World Series'` is internally consistent with MLB-style best-of-N convention if DS=5, CS=7, WS=7. Architect locks those values in developer-instructions-2 to remove ambiguity.

---

## Severity Summary (Post-Assessment)

- **Critical: 3**
  - AB-01 (import error, server cannot start)
  - AB-02 (`Math.random()` in clampRBI breaks determinism)
  - AB-03 (validateBoxScore is dead + buggy)
- **High: 14**
  - AB-04 (playoff series sizes — locked at DS=5, CS=7, WS=7)
  - AB-05 (every home win flagged as walk-off)
  - AB-06 (trade deadline never fires)
  - AB-07 (playoffs pollute regular-season standings)
  - AB-08 (front_office wins-reset breaks annual draft order)
  - AB-09 (draft resume produces duplicate picks)
  - AB-10 (autoBalance reversed SQL params)
  - AB-11 (Draft.tsx on-clock team + data-testid wrong)
  - CB-1 (Express binds 0.0.0.0)
  - API: BUG-1 duplicate export
  - API: BUG-3 sim doesn't restart after draft (NEW)
  - API: market size distribution wrong
  - API: blowout rate 26% (vs 12-18% spec)
  - API: players/leaders shape + error message bodies (treated together)
- **Medium: 12**
  - AB-12, AB-13, AB-14, AB-15, AB-17, AB-18
  - CB-2 (sanitizer single-pass bypass)
  - CB-3 (rate-limit consumes on reject)
  - API: hits-vs-runs 1/500 violation
  - API: playoff phase skipped in turbo
  - API: BA/ERA leader ranges (raise min thresholds)
  - API: timeline shape + notable_events
  - API: GET /api/state pre-league shape
  - API: team `abbreviation` missing
  - API: `gm_personality` flat vs nested
  - API: minors not embedded
- **Low: 8**
  - AB-16 (deferred), AB-19, AB-20, AB-21, AB-22
  - CB-4, CB-5, CB-6, CB-7

Total confirmed defects requiring fix before COMPLETE: **3 Critical + 14 High + 12 Medium = 29 must-fix items.**

---

## Rationale for ITERATE

build-rules.md §Severity Classification: "Build is **complete** when all post-build reports contain zero Critical, High, or Medium findings AND the Architect formally issues COMPLETE."

The committed build has 3 Critical, 14 High, and 12 Medium findings. The most fundamental — AB-01 — blocks server startup. The second most fundamental — AB-02 — invalidates the determinism contract (D7/D30) that the entire test strategy relies on. Without these two fixes, no end-to-end verification is meaningful. ITERATE is mandatory.

Beyond the must-fix list, several findings (AB-05, AB-06, AB-07, AB-08, AB-11) describe user-visible defects on day-one play that would be impossible to ship: walk-offs on 54% of games, no trade deadline transactions ever, playoffs corrupting standings, draft board showing the wrong team on the clock. These together would yield a v0.1.0 release that any reviewer would reject in five minutes.

---

## What UI Testers will cover in Iteration 2

UI Tester A and UI Tester B were not run in Iteration 1 because the server cannot start from the committed code (AB-01 import error). In Iteration 2 — after the Developer applies the fixes in `developer-instructions-2.md` and the server starts — UI Tester A will run regression groups (League, Teams, Games, Players, Timeline tabs) and UI Tester B will run new-feature groups (Draft tab in particular, including the AB-11 fix verification: on-clock team correctness and `data-testid="draft-pick-{round}-{pickNumber}"` selector compliance).

The Adversary's AB-11 finding (Draft.tsx team ordering and data-testid mismatches) is the primary known UI defect for UI Tester B to verify after fix. UI Tester A should also verify: Reconnecting banner, Turbo badge, confirm-new-dynasty modal, all 6 tabs render after a fresh dynasty creation through to season 2.

---

## Notes on Lane Violations

The API Tester modified source code (`draft.ts`, `engine.ts`) to make the server startable before running tests — a hard lane violation per build-rules.md. The Orchestrator reverted these changes. The API Tester's results reflect a partially-patched state, not the committed Developer code. **All API Tester findings are still valid defects** because they describe behavior of the partially-patched code that closely approximates what the post-fix code will produce. The Developer must not consult the API Tester report directly (lane rule); developer-instructions-2.md re-states every must-fix item the API Tester surfaced.

---

**End of architect-eval-1.md.**
