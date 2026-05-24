# Adversary Post-Build Report — Iteration 2 — Baseball Dynasty Simulator v0.1.0

## Verdict
**NOT READY** — Server-side determinism, playoff isolation, walk-off semantics, trade-deadline counting, draft-resume, and most original AB findings are fixed; however the Iter-2 `mapPhase()` change broke the Draft tab (it never renders, because the client still checks for the internal phase names that the server now collapses to `'draft'`), the box-score "retry loop" is a soft warning that still commits invalid games, and `finalizeOffseason()` is not transactional so a crash between its two writes corrupts season N+1 standings.

---

## Iteration 1 Finding Status

- **AB-01** Wrong import path: **RESOLVED** — `server/sim/engine.ts:9` now imports `validatePostDraftRosters` from `./worldgen.js` (not `./draft.js`). Compile blocker gone.
- **AB-02** `clampRBI` uses `Math.random()`: **RESOLVED** — `server/sim/game.ts:483-513` `clampRBI` takes `rng: () => number` and both `Math.floor(rng() * highRBI.length)` (line 491) and `Math.floor(rng() * hasHits.length)` (line 504) draw from the seeded stream. Both call sites at `:263-264` pass the per-game `rng`. (Note: there's also a still-present `Math.floor(rng() * 3)` for default RBI distribution at `:453` — same seeded `rng`, fine.) Determinism contract restored.
- **AB-03** `validateBoxScore` dead + teamId/score bug: **RESOLVED** — Comparison at `server/sim/game.ts:177-178` now uses `b.teamId === homeTeamId` / `b.teamId === awayTeamId`. Function is now actually invoked from `simulateGame` (`server/sim/game.ts:330` and `:357`) with a 3-attempt retry. *Caveat: see AB2-02 below — retries fail-open, not fail-closed.*
- **AB-04** Best-of series 5/7/7 vs spec 3/5/7: Out of scope — Architect locked at 5/7/7 in Iter-1 review.
- **AB-05** Every home win flagged walk-off: **RESOLVED** — `server/sim/game.ts:224` `const isWalkOff = homeWins && (rng() < 0.18);` (~9.7% of all games). `totalIP = isWalkOff ? 8.0 : 9.0` (line 533) only truncates home staff IP on actual walk-offs. *Minor side note in AB2-08 below: the team whose IP is truncated is mis-identified (home, not away), but the walk-off detection itself is correct.*
- **AB-06** Trade deadline SQL counts only home games: **RESOLVED** — `server/sim/season.ts:231-247` now uses a `UNION ALL` over home+away counts grouped per team. Condition is now reachable at the spec'd game 35.
- **AB-07** `simulateGame` updates `teams.wins` during playoffs: **RESOLVED** — `simulateGame` now takes `isPlayoff: boolean = false` (`server/sim/game.ts:205`). The W/L/runs/games_played update block is gated by `if (!isPlayoff)` (`server/sim/game.ts:402-414`). `runSeries` passes `true` (`server/sim/playoffs.ts:212`). Only call site that omits the arg is `engine.ts:343` (regular season), which correctly defaults to `false`. Grep for `simulateGame(` confirms only these two call sites.
- **AB-08** Wins reset before annual draft: **RESOLVED, with a NEW corruption risk** — Wins-reset moved to `finalizeOffseason` (`server/sim/offseason.ts:323`) which runs *after* `runAnnualDraft`. The comment at `:294` explicitly documents the ordering. Annual draft reads standings via `generateAnnualDraftOrder` (`draft.ts:277-283`) which still has full W/L data. **BUT** — `finalizeOffseason` is not wrapped in a DB transaction; see AB2-03 for the crash-window corruption.
- **AB-09** Draft resume restarts at round 1; no UNIQUE: **RESOLVED** — Migration `003_draft_picks_unique.sql` adds `UNIQUE(league_id, season_number, round, pick_number)`. `runExpansionDraft` (`draft.ts:333-336`) and `runAnnualDraft` (`draft.ts:379-381`) both query `COALESCE(MAX(pick_number), 0)` and resume from `max_pick + 1`. *Caveat: the dedup `DELETE WHERE id NOT IN (SELECT MAX(id) ...)` keeps the LAST inserted row, which for pre-existing dupes from Iter-1 corruption is the WRONG row — but on a fresh DB this code path never triggers, so this is a fossil concern only.*
- **AB-10** `autoBalance` reversed SQL params: **RESOLVED** — `server/sim/worldgen.ts:415-416` now binds `(leagueId, position)` matching the SQL `?, ?` for `league_id = ? AND position = ?`. Comment at `:413` flags the §2.8 fix explicitly.
- **AB-11** Draft.tsx uses `/api/teams` order + wrong testids: **UNRESOLVED** — A new `GET /api/draft/order` route was added at `server/index.ts:172-180`, but `client/src/views/Draft.tsx` never calls it. The component still fetches `/api/teams` (`Draft.tsx:33`) and computes on-clock from the API's listing order (`Draft.tsx:90-92`). `data-testid` at `Draft.tsx:194` is still `draft-pick-${round}-${teamIdx + 1}` — not the `{pickNumber}` the spec requires (`v0.1.0-app-spec-section.md:283`). And see AB2-01 below — the component's `phase === 'expansion_draft'` check is now NEVER true because the server collapses both draft phases to `'draft'` via `mapPhase`.

### Medium spot-checks
- **AB-12** Date.now() for FA contract years: **RESOLVED** — `server/sim/offseason.ts:177-178` builds `fa_seed_base = (worldgen_seed ^ season_number)` and uses `seedFor('fa_contract_${fa.id}', fa_seed_base)`. Deterministic, per-player.
- **AB-13** FA signing hardcoded season=1: **RESOLVED** — `server/sim/offseason.ts:184` `const actualSeason = seasonNumber ?? leagueRow?.season_number ?? 1;` then inserts `actualSeason` (line 188). `runOffseason` passes `league.season_number` at the call site (`offseason.ts:36`).
- **AB-14** `handleExhaustedPool` Date.now seed: **RESOLVED** — `draft.ts:244-245` uses `seedFor('draft_fill_${teamId}_${round}_${pickNumber}', worldgen_seed)`.
- **AB-15** Inter-conference quota fallback: **PARTIAL** — `season.ts` now has an explicit both-quotas-exhausted else-branch (`:115-119`), `tryAssignInterConference` validates balance and returns false on failure, and `generateInterConferenceGames` retries up to 5 attempts with seeded re-shuffle (`:147-150`). Throws if all 5 fail — could brick worldgen for an unlucky seed, but deterministic.
- **AB-16** Archived league players not pruned: **DEFERRED** per Architect.
- **AB-17** Tiebreaker rng() in sort comparator: **RESOLVED** — `playoffs.ts:34-82` adds a `tiebreakerCache: Map<string, number>`, cleared at `buildPlayoffBracket` entry (line 89), then memoizes per unordered `pairKey` with a sign-flip so `compareTeams(a,b)` and `compareTeams(b,a)` always disagree. JS sort now has a consistent comparator.
- **AB-18** PAV selectTopN missing scarcity: **RESOLVED** — `draft.ts:105-117` puts the scarcity bonus into the SQL `ORDER BY` (`estimated_pav` includes the C+5/SS+4/CF+3/CL+4 bumps and a smooth SP bonus). Then JS re-sorts the top-50 by full PAV (with age bonus). Catchers/SSes can no longer be filtered out of the prefix.
- **AB-19** TS strict-optional violation: **RESOLVED** — `engine.ts:138-140` builds the worldgen options conditionally to satisfy `exactOptionalPropertyTypes`.
- **AB-20** WS records no MVP: **RESOLVED** — `playoffs.ts:171-173` records `mvp_player_id` via `pickSeasonMVP` (proc fallback: OPS>0.950 → top hitter, else best ERA pitcher). Timeline will now have something to show.
- **AB-21** Daily-budget counts attempts not successes: **RESOLVED** — `server/services/llm.ts:223,231` `recordLlmCall()` is invoked AFTER `client.messages.create` resolves, so failed calls do not consume budget. (The rolling-window timestamp at `:223` still counts attempts — that's intentional rate-limiting.)
- **AB-22** Trade deadline SQL fragility: **RESOLVED** — Rewritten with `UNION ALL` per AB-06.

### Architect-added findings
- **AB-NEW-01** Tick loop doesn't restart after expansion draft completes: **PARTIAL** — `setSimSpeed` now restarts the tick when `speed !== 'paused' && !simRunning` (`engine.ts:185-189`). **But** `runDraftTick`'s `finally` block still sets `simRunning = false` unconditionally (`engine.ts:316-318`), and `runTickLoop`'s post-tick guard then sees `!simRunning` and stops scheduling (`engine.ts:250`). So after the expansion draft completes WITHOUT the user touching the speed control, the simulation does not auto-continue into regular season — it sits in `regular_season` phase, `currentSpeed='normal'`, `simRunning=false`, with no scheduled tick. The user must press the speed control again. The test spec line 77 ("POST /api/sim/speed with body `{speed: 'normal'}`") assumes the user does this manually, so this may be acceptable per the test contract — but it is *not* the auto-resume the Architect's note implied. See AB2-04.

---

## New Findings (Iteration 2 code)

### CRITICAL AB2-01 client/server phase contract mismatch breaks Draft tab entirely
**Attack scenario:** Start a new league. Navigate to the Draft tab. You see "No active draft. Draft occurs during expansion and each offseason." even though the expansion draft is in progress.

**Evidence:**
- `server/sim/engine.ts:57-68` adds `mapPhase()` which collapses both internal `expansion_draft` and `annual_draft` to API value `'draft'`. The cached snapshot returned by `GET /api/state` is built from `mapPhase(league.phase)` at `:72`.
- `client/src/views/Draft.tsx:107` early-returns the empty-state view when `state?.phase !== 'expansion_draft' && state?.phase !== 'annual_draft'`. Since the server now sends `'draft'`, this condition is ALWAYS true.
- The same string-equality bug recurs at `Draft.tsx:89` (`state?.phase === 'expansion_draft'` for the on-clock check), `Draft.tsx:123` (header label `state.phase === 'expansion_draft' ? 'Expansion Draft' : 'Annual Draft'` — both fall through to "Annual Draft"), and `client/src/hooks/useLeagueState.ts:89` (`isDraft = state?.phase === 'expansion_draft' || state?.phase === 'annual_draft'` — polling falls back to the slow 2s cadence instead of the spec'd 500ms during draft).

**Impact:**
- The Draft tab is unusable during expansion AND annual drafts.
- The `data-testid="draft-board"`, `draft-pick-{round}-{pickNumber}`, `draft-onclock-team`, `draft-pick-reveal` testids never render. Every spec-required draft testid will fail QA per D24.
- Polling reverts to 2s during the highest-velocity sim phase (Architect explicitly called this out in R5).

**Reproduction:** `npm run dev:all`, `POST /api/league/new`, `POST /api/sim/speed { speed: "normal" }`, open `http://localhost:5173`, click Draft tab. See empty state.

**Fix shape:** Either change `mapPhase` to pass `expansion_draft`/`annual_draft` through, or update all client phase checks to handle `'draft'`. Pick one and document the contract.

---

### HIGH AB2-02 Box-score retry "gate" commits invalid games anyway
**Attack scenario:** A game's RBI generator produces a configuration the retry loop cannot satisfy (e.g., all players have 0 hits but team scored 5). The validator returns errors, the retry runs 3 times, all fail, the game is logged anyway.

**Evidence:** `server/sim/game.ts:336-366`. The 3-attempt loop only re-applies `distributeExtraWalks` and `clampRBI`. After the loop:
```js
if (validationErrors.length > 0) {
  console.error(`[game ${gameId}] box-score still invalid after retries: ${validationErrors.join('; ')}`);
}
```
…and then control falls through to `writeGame()` at `:374` which inserts the row unconditionally. There is no `throw`, no `return`, no "regenerate the game", and no flag on the game_log row recording that it failed validation.

Additional issues with the retry:
- Validator Rule 3 (SP IP between 4.0 and 9.0) is checked but the retry never adjusts pitcher lines, so any IP-out-of-range case is unfixable by the retry — yet it still loops 3 times and commits.
- Validator Rule 4 ("total IP = 9.0 / 8.0 walk-off") is in the spec (§5.1 Rule 4 / test 90) but NOT implemented in `validateBoxScore`. Tests sampling `total_innings_pitched_per_team == 9.0` on walk-off games will see ~9.0% of games with total IP ≠ 9.0.

**Impact:**
- `validateBoxScore` is presented as the runtime gate the Iter-1 review demanded, but it's still effectively advisory. Box-score-internal-consistency violations are logged-and-shipped, not blocked.
- Tests at `v0.1.0-test-spec.md:88-91` (RBI ≤ runs+2; SP IP 4-9; total IP = 9) can still fail on invalid games that the validator already detected.

**Reproduction:** Force a configuration where `lines.every(b => b.hits === 0)` but `teamScore > 0` (very low contact ratings or unlucky seed). RBI cannot be raised to ≥ runs-1 because `clampRBI` only raises RBI for batters with hits. The validator returns "Home RBI 0 < min N"; retry doesn't help; game is committed with RBI=0 and runs=N.

---

### HIGH AB2-03 finalizeOffseason is not transactional — crash between updates corrupts season N+1 standings
**Attack scenario:** Server restart (`SIGTERM`, kernel OOM, `kill -9`) during the milliseconds between the `leagues SET season_number = ?, phase = 'regular_season'` update and the `teams SET wins=0, losses=0, ...` reset. On boot, the league is in season N+1, regular_season phase, but every team still carries season-N wins.

**Evidence:** `server/sim/offseason.ts:318-323`:
```js
db.prepare(
  'UPDATE leagues SET season_number = ?, phase = ?, offseason_step = NULL, current_game_number = 0, current_game_date = 0, last_game_id = 0 WHERE id = ?'
).run(newSeason, 'regular_season', leagueId);

// Reset W/L/runs/games_played for the new season — must happen AFTER annual_draft (§2.6)
db.prepare('UPDATE teams SET wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0 WHERE league_id = ?').run(leagueId);
```
These are two separate statements with no `db.transaction(...)` wrapper. The two `prepared(...)` calls above (`UPDATE players SET team_id = NULL`) at `:326-328` are also outside any transaction.

`runOffseason`'s loop (`:50-52`) updates `offseason_step` to `'done'` after the `annual_draft` step but does NOT update it after the `'done'` step itself. So if a crash occurs after the league-row update but before the team-row reset, `offseason_step` stays as `'done'` but phase is now `'regular_season'`. On restart, `initEngine` sees a `regular_season` league and does not re-enter `runOffseason`. The wins-reset never runs. Each game in season N+1 then increments wins on top of the season-N totals — standings, playoff seeding, and the next-season draft order all become incoherent.

**Impact:** Persistent, silent data corruption that survives restart. The user has no UI signal that anything went wrong (the season N+1 standings just look weird: teams that were good in N appear dominant in N+1 from game 1).

**Fix shape:** Wrap the two statements (and the orphan-player cleanup) in `db.transaction(() => { ... })()`. Also consider an idempotent boot-time check: on `initEngine`, if `phase === 'regular_season'` and `current_game_number === 0` and any team has `wins > 0`, run the reset.

---

### MEDIUM AB2-04 Speed control does not auto-resume the tick after expansion draft completes
**Attack scenario:** User clicks Normal → expansion draft runs all 600 picks → draft finishes, phase transitions to `regular_season` → no game is ever simulated, the season sits idle until the user toggles the speed control again.

**Evidence:** `server/sim/engine.ts:285-318` — `runDraftTick` always sets `simRunning = false` in its `finally` block (`:316-317`), regardless of whether the draft completed naturally or was paused. After return, `runTickLoop`'s guard at `:250` (`if (simRunning && (currentSpeed as string) !== 'paused')`) sees `!simRunning` and stops scheduling.

The fix in `setSimSpeed` (`engine.ts:185-189`) only triggers when the user *changes* the speed. If the user already had `currentSpeed = 'normal'` and the draft completed naturally, no `setSimSpeed` call is made and the tick loop dies.

**Impact:** Player experience: the dynasty appears to freeze after the draft. Test `v0.1.0-test-spec.md:101` ("POST /api/sim/speed with body `{speed: 'turbo'}` completes full 50-game season") starts to look like it's masking this bug — the test explicitly re-POSTs the speed, papering over the issue.

**Fix shape:** In `runDraftTick`, on natural completion (not pause), if `currentSpeed !== 'paused'` then call `startTick(currentLeague)` before returning. Or just leave `simRunning = true` when `currentSpeed !== 'paused'`.

---

### MEDIUM AB2-05 /api/draft/order returns expansion order even during annual draft
**Attack scenario:** During annual draft (season 2+ offseason), call `GET /api/draft/order`. The server returns the *expansion* draft team order (random shuffle by `worldgen_seed`) — not the reverse-standings order the annual draft actually uses.

**Evidence:** `server/index.ts:172-180`:
```js
app.get('/api/draft/order', async (_req, res, next) => {
  ...
  const { getExpansionDraftOrder } = await import('./sim/draft.js');
  res.json({ teamOrder: getExpansionDraftOrder(league.id) });
});
```
The route does not branch on `league.phase`. `getExpansionDraftOrder` always returns `generateExpansionDraftOrder(leagueId, worldgen_seed)` (`draft.ts:315-319`), which is the RNG-shuffled order used only for expansion draft.

**Impact:** Even if the client started calling `/api/draft/order` (it doesn't — see AB-11), it would get the wrong order during annual drafts. The on-clock indicator would point to whatever random team is at the front of the expansion shuffle, not the worst-standings team that's actually picking.

**Fix shape:** Branch by `league.phase`: expansion → expansion order, annual → `generateAnnualDraftOrder(leagueId)`. Or rename the route to `/api/draft/expansion-order` and add a sibling `/api/draft/annual-order`.

---

### MEDIUM AB2-06 selectCitiesWithMarketQuota silently returns < 20 cities if quotas are unsatisfiable
**Attack scenario:** Corrupt `server/data/cities.ts` so one quota category has too few cities (e.g., remove `Ironbrook` so only 5 `small` cities exist for quota=6). Run `POST /api/league/new`.

**Evidence:** `server/sim/worldgen.ts:62-95`. After both passes, `selected.length < 20` is possible if a market-size category is short. The function returns `selected` (length < 20) silently. Then `worldgen.ts:190-261` iterates `for (let i = 0; i < 20; i++) { const city = selectedCities[i]!; ... }` — the `!` non-null assertion lies, and any `i` where `selectedCities[i]` is `undefined` will crash inside `insertTeam.run(... city.name ...)` with `TypeError: Cannot read properties of undefined`.

The current city pool has exactly 6 small cities for a quota of 6, so this is exact-equality and fragile to *any* future trim. (And the 14 medium / 6 small don't enforce regional uniqueness — if a region-uniqueness pass-1 pick happens to claim the only mega in a region while a needed large is in the same region, pass-2 relaxes uniqueness and recovers, but pass-2 doesn't recover quota gaps.)

**Impact:** Future cities.ts edits or filtering (e.g., removing offensive names) will silently brick worldgen.

**Fix shape:** Throw a clear error if `selected.length < 20` or if any `remaining[market_size] > 0` after both passes. Validate quotas on module load.

---

### MEDIUM AB2-07 scrubError leaves common JWT-shaped bearer tokens partially exposed
**Attack scenario:** An LLM SDK error message contains `Authorization: Bearer eyJhbG.eyJ0eX.4_signature`. The scrubber leaves the `.eyJ0eX.4_signature` portion unredacted.

**Evidence:** `server/util/scrub.ts:9`:
```js
.replace(/bearer\s+[a-zA-Z0-9_-]+/gi, 'bearer [REDACTED]')
```
The character class `[a-zA-Z0-9_-]` excludes `.`. JWTs are dot-separated (`header.payload.signature`). For a JWT-shaped bearer token, the regex matches only the first segment; the remaining `.payload.signature` survives.

However, the preceding `.replace(/authorization[^,}\n]*/gi, 'authorization: [REDACTED]')` at line 7 should catch the whole `Authorization: Bearer ...` header before the bearer regex sees it — *as long as the auth header is preceded by the literal word `authorization`*. If the error message has a bare `Bearer eyJ...` (some SDKs log just the token, not the header name), the bearer fallback fires and the JWT body+signature leak.

Additional weakness: `[^,}\n]*` doesn't include `;` — so `Authorization: Bearer xxx; X-API-Key: yyy` on a single line over-redacts (consumes the whole tail including the api-key portion, which is actually fine for redaction but leaves no signal where the boundary was — minor).

**Impact:** In a worst-case stack trace that prints just `Bearer <jwt>`, the payload (which may encode user IDs, expiry, scopes) leaks to whatever log destination receives `scrubError`'s output.

**Fix shape:** Change `[a-zA-Z0-9_-]+` to `[a-zA-Z0-9._~+/=-]+` (RFC 7515 base64url + JWT separator). And/or strip the entire word `Bearer` followed by anything up to the next whitespace.

---

### LOW AB2-08 Walk-off IP truncation truncates the wrong team
**Attack scenario:** In a walk-off, in real baseball, the AWAY team's pitchers throw the partial bottom-of-9 (couldn't get the 3rd out before losing the game). The HOME team's pitchers throw a full 9.0. The implementation truncates the home team's pitchers' IP instead.

**Evidence:** `server/sim/game.ts:267-272`:
```js
const homePitcherLines = generatePitcherLines(
  rng, homeStarter, homeBullpen, homeTeam.id, awayScore, isWalkOff  // ← passes walk-off=true to home
);
const awayPitcherLines = generatePitcherLines(
  rng, awayStarter, awayBullpen, awayTeam.id, homeScore, false       // ← away always non-walkoff
);
```
And inside `generatePitcherLines` (`:533`): `const totalIP = isWalkOff ? 8.0 : 9.0;` — so the home team gets 8.0 total IP on walk-offs. Baseball-incorrectly.

**Impact:** Home pitchers' ERA is artificially boosted (fewer IP for same ER); away pitchers' ERA is depressed. Skews stat leaderboards over many seasons by side-of-field. Also fails `v0.1.0-test-spec.md:90` ("total IP for both teams = 9.0 innings") on ~9% of games — the test will see 8.0 for the home team on walk-off games.

**Fix shape:** Swap which team gets `isWalkOff = true` (pass `true` to away, `false` to home). Update spec/test-spec accordingly if walk-off semantics were intended to mean "the LOSING away pitcher gets the truncated final inning".

---

### LOW AB2-09 ValidateBoxScore does not check Rule 4 (total IP)
**Attack scenario:** Box score has home pitchers totaling 7.0 IP (one starter at 5.0 IP, two relievers at 1.0 IP each). Validator passes.

**Evidence:** `server/sim/game.ts:152-195`. Rules 1, 2, 3 are checked. Rule 4 ("total IP = 9.0 / 8.0 walk-off") from the spec is NOT checked.

**Impact:** Games can be committed with team-total IP ≠ 9.0 (or 8.0 on walk-off). The bullpen distribution in `generatePitcherLines` (`:561-583`) rounds each reliever's IP to thirds; cumulative rounding can produce 8.67 or 9.33 totals.

**Fix shape:** Add a Rule 4 check summing `pitcherLines.filter(p => p.teamId === X).reduce((s,p) => s + p.inningsPitched, 0) === expectedTotalIP` for both teams. Round-aware tolerance ±0.01 because of float arithmetic.

---

### LOW AB2-10 mapPhase default branch lies to TypeScript
**Evidence:** `server/sim/engine.ts:66`: `default: return dbPhase as LeagueStateSnapshot['phase'];` — unsafe cast. If `league.phase` is `'setup'` or any future value not in the switch, it leaks through to the client as-is, which the client cannot then handle. Mostly cosmetic but undermines the type contract the snapshot interface is supposed to provide.

---

## Attack Surface Summary

### Most dangerous (must-fix before COMPLETE)
1. **AB2-01 (Critical)** — Draft tab does not render due to client/server phase contract mismatch. Every spec'd `data-testid="draft-*"` testid is unreachable.
2. **AB-11 (carried, Critical)** — Even if AB2-01 is fixed, Draft.tsx still uses `/api/teams` ordering and wrong testid suffixes (teamIdx+1 vs pickNumber). The new `/api/draft/order` route exists but is never consumed by the client.
3. **AB2-03 (High)** — `finalizeOffseason` is not transactional; a server restart in a ~10ms window corrupts season N+1 standings forever.
4. **AB2-02 (High)** — Box-score validation logs errors then commits the invalid game anyway. The "gate" the Iter-1 review demanded is not actually a gate.

### Should-fix
5. **AB2-04 (Medium)** — After expansion draft completes, the simulation doesn't auto-continue into regular season. User must touch the speed control to unfreeze.
6. **AB2-05 (Medium)** — `/api/draft/order` returns expansion order during annual draft (wrong phase, wrong data).
7. **AB2-06 (Medium)** — Quota-driven city selection can silently undercount; future cities.ts edits will brick worldgen.
8. **AB2-07 (Medium)** — JWT-shaped bearer tokens partially survive `scrubError`.
9. **AB2-09 (Low)** — Validator doesn't enforce Rule 4 (total IP).

### What Iter-2 got right
- Determinism fully restored: `Math.random()` and `Date.now()` removed from the sim path (AB-02/12/14).
- Playoff isolation: `simulateGame(isPlayoff=true)` correctly excludes playoff games from `teams.wins` (AB-07).
- Annual draft order: wins-reset moved to `finalizeOffseason`, so the reverse-standings ordering can see real W/L (AB-08) — provided no crash between the two writes (AB2-03).
- Draft resume: UNIQUE constraint + `MAX(pick_number)+1` resume is correct (AB-09).
- `autoBalance` parameter order fixed (AB-10).
- Tiebreaker comparator memoized — sort is now deterministic (AB-17).
- PAV-aware top-50 SQL prefix — scarce positions can no longer be filtered out (AB-18).
- Trade deadline UNION-ALL count actually fires (AB-06).
- Walk-off no longer asserted on every home win (AB-05) — though see AB2-08 for the side it affects.
- Sanitizer loop-until-stable is sound (replacements monotonically shrink the string; termination guaranteed).

### Bottom line
The Iter-1 server-side rules are largely fixed. The new failure modes cluster on (a) the client/server contract for the `phase` field (which the Iter-2 `mapPhase` introduced and the client was never updated to match), (b) the difference between "the validator exists" and "the validator is a gate", and (c) the missing transaction around the offseason-to-new-season transition. AB2-01 alone keeps the build from passing QA, because the Draft tab — the marquee feature for v0.1.0 — does not render at all.

---

**End of adversary-iter2-post-build.md.**
