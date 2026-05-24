# Adversary Post-Build Report — Baseball Dynasty Simulator v0.1.0

## Verdict
**NOT READY** — The server cannot even start due to a TypeScript module resolution error, multiple gameplay rules contradict the spec (playoffs best-of are wrong, walk-off is mis-flagged for every home win, annual-draft reverse-standings is broken because wins are reset first, trade deadline never fires), and the box-score validator that's supposed to enforce internal consistency is dead code containing an obvious bug.

---

## Pre-Build Defects Status

- **Test spec internal contradiction (D12 turbo timing vs G10 reasoning row)**: Out of scope here (I cannot read test results), but the implementation does honor D12 — `runDraftPick` skips the LLM in turbo (`server/sim/draft.ts:153 if (!isTurbo)`), so any G10-style assertion against turbo-produced picks will see null reasoning. RESOLVED at the implementation level; whether the test spec was reconciled is for QA.

- **Box score consistency rules (hits ≥ runs, RBI ≤ runs, IP rules)**: **PARTIAL → effectively UNRESOLVED.**
  - Hits-vs-runs is enforced by injecting extra walks (`server/sim/game.ts:222-233`) so `hits + walks >= runs` — semantically correct.
  - RBI clamp is implemented (`server/sim/game.ts:397-427`) — clamps to `[max(0, runs-1), runs]`.
  - **But `clampRBI` uses `Math.random()` (lines 405 and 418), not the seeded `rng`.** That defeats determinism entirely; every game's box score becomes non-reproducible from the same seed. See AB-02.
  - The exported `validateBoxScore` function (`server/sim/game.ts:152-173`) compares `b.teamId === homeScore` (an integer) and is never called from runtime. See AB-03.
  - IP-on-walk-off rule: walk-off is *always* asserted for any home win (line 196: `const isWalkOff = homeWins`), so the 8.5-IP rule fires on ~54% of all games whether or not the home team actually walked off. See AB-05.

- **Rating distribution math (tier counts actually implemented correctly?)**: **RESOLVED.**
  Evidence: `server/sim/worldgen.ts:11-17` uses exact `count` per tier (16/64/200/320/200 = 800) via direct sampling, not normal distribution. Distribution will match spec exactly with zero variance.

- **Schedule arithmetic (50 games, 25H/25A, 36 intra + 14 inter)**: **PARTIAL.**
  - 36 intra + 14 inter is reachable: 4 NL opponents doubled, 6 singled (`server/sim/season.ts:62-73`). 
  - Quota-greedy home assignment for singles (`season.ts:81-108`) does *seem* to converge to 25H/25A in the existing unit test, but the test (`server/tests/schedule.test.ts`) re-implements the algorithm rather than calling `generateSchedule`, so the live function's correctness is not tested.
  - The else-branch at line 101-104 silently assigns home to nTeam *even when both quotas are 0*, which can violate the 25/25 invariant if quota-greedy gets unlucky. There's a runtime warning but no rollback (line 124-129).

- **Default seed=1 making every dynasty identical**: **RESOLVED.**
  Evidence: `server/sim/prng.ts:46-59`. Default falls through to `Date.now() & 0xffffffff`. The seed=1 footgun is gone unless a user explicitly passes it.

- **Stored-XSS via LLM narrative fields**: **RESOLVED.**
  - `sanitizeNarrative()` (`server/services/llm.ts:144-152`) strips HTML tags, control chars, `javascript:`/`data:` URIs, and caps at 280 chars before DB write.
  - All React renders use text nodes (verified — no `dangerouslySetInnerHTML` anywhere in `client/src/`). Comments at `client/src/views/Timeline.tsx:77`, `Games.tsx`, `Teams.tsx` confirm the discipline.

---

## Findings

### CRITICAL AB-01 server/sim/engine.ts: Server cannot start — wrong import path
**Attack scenario:** Boot the server. It exits immediately on module load.
**Evidence:** `server/sim/engine.ts:8` imports `validatePostDraftRosters` from `'./draft.js'`, but that symbol is exported from `worldgen.ts` (`server/sim/worldgen.ts:323`). It does not exist in `draft.ts`.
**Impact:** `npx tsx server/index.ts` (the dev command) fails with `SyntaxError: The requested module './draft.js' does not provide an export named 'validatePostDraftRosters'`. `npm run build` also fails (`tsc -p tsconfig.server.json` reports `error TS2305: Module '"./draft.js"' has no exported member 'validatePostDraftRosters'`). Two other TS errors compound it: `server/sim/engine.ts:123` (WorldgenOptions strict-optional mismatch on `seed`) and `:234` (comparison between non-overlapping union members).
**Reproduction steps:**
1. `cd baseball-dynasty && npx tsc --noEmit -p tsconfig.server.json` → 3 errors.
2. `npx tsx server/index.ts` → instant exit with the SyntaxError above.
**Severity rationale:** The application cannot run. This is the single most important finding.

---

### CRITICAL AB-02 server/sim/game.ts: clampRBI uses Math.random(), breaking determinism
**Attack scenario:** Replay the same season with the same seed twice. Box scores differ.
**Evidence:** `server/sim/game.ts:405` and `:418` call `Math.random()` inside the deterministic game loop:
```
const idx = Math.floor(Math.random() * highRBI.length);   // line 405
const idx = Math.floor(Math.random() * hasHits.length);    // line 418
```
The rest of the file correctly threads a seeded `rng` (`seedFor('game:'+gameId, ...)`), but RBI clamping bypasses it.
**Impact:**
- D7 determinism contract is violated. PRNG-determinism tests that only check the underlying PRNG (and not full-game reproducibility) will not catch this.
- Same seed, two runs → different RBI distributions → different stat leaderboards.
**Reproduction steps:** Run two seeded games with identical inputs; capture batterLines RBI. The RBI assignments will diverge whenever clampRBI fires (i.e. nearly every game).

---

### CRITICAL AB-03 server/sim/game.ts: validateBoxScore dead and broken
**Attack scenario:** Box-score consistency is asserted to be defended at the validator. It isn't.
**Evidence:** `server/sim/game.ts:152-173` defines `validateBoxScore`:
- It is `export`ed but never imported anywhere except by tests, and tests use their own local `validateBoxScoreRules` (`server/tests/boxScore.test.ts:13`), not the runtime function.
- Inside, `result.batterLines.filter(b => b.teamId === homeScore)` (line 167) compares team IDs to score integers — they coincide only by chance. So `homeRBI` is ~always 0 and `awayRBI` is the sum of all batter RBIs.
- The function does nothing useful even if you call it.
**Impact:** The architect's D23 "unit tests for box-score consistency rules" gate is paper-thin — the implementation has no runtime gate at all. The visible-on-first-screen "RBI > runs" / "winning pitcher from losing team" bugs the pre-build review warned about are still possible.

---

### HIGH AB-04 server/sim/playoffs.ts: Best-of series sizes wrong (5-7-7 instead of 3-5-7)
**Attack scenario:** Sim through a season, observe playoffs.
**Evidence:** `app-spec.md:36` — "Division Series (3-game), Conference Series (5-game), Championship (7-game)." Implementation at `server/sim/playoffs.ts:116-119` and `:127-136`:
```
runSeries(..., 5, 'American DS');   // should be 3 (best-of-3)
runSeries(..., 5, 'National DS');
runSeries(..., 7, 'American CS');   // should be 5
runSeries(..., 7, 'National CS');
runSeries(..., 7, 'World Series');  // correct
```
Plus `runSeries` interprets `bestOf` as wins-to-clinch via `Math.ceil(bestOf/2)` so the "3-game" series is best-of-3 to 2 wins, "5-game" is best-of-5 to 3 wins, etc. Even if you treat the third number as games-in-series, the values are still wrong (5/5/7 vs spec 3/5/7).
**Impact:** Playoffs run ~2× longer than spec. World Series matchup probabilities drift. Spec violation.

---

### HIGH AB-05 server/sim/game.ts: Every home win is flagged as a "walk-off"
**Attack scenario:** Sim a season; check `game_log.notable_events`.
**Evidence:** `server/sim/game.ts:196`:
```
const isWalkOff = homeWins; // home team winning = potential walk-off
```
This makes every home win a walk-off. ~54% of games will emit a `walk_off` notable event (line 607-612). Worse, line 448 (`const totalIP = isWalkOff ? 8.5 : 9.0`) then truncates home-team pitchers' IP for every home win, *not just walk-offs*. So home pitchers consistently throw 8.5 IP total in winning games — not a real baseball rule.
**Impact:**
- "Walk-off" loses meaning — ~270 walk-offs/season.
- All home-win box scores show 8.5 IP from the home staff; only away wins get 9.0 IP. Stats are systematically biased by side-of-field.
**Reproduction steps:** Sim 100 games, count notable events of type `walk_off`. Expect ~54% of all home-wins.

---

### HIGH AB-06 server/sim/season.ts: Trade deadline never fires
**Attack scenario:** Sim a 50-game season. Check `transactions` table for any `trade_deadline` row.
**Evidence:** `server/sim/season.ts:189-197` — the SQL only counts teams whose *home_team_id* count of games is ≥ 35:
```
SELECT home_team_id, COUNT(*) as gc FROM game_log
WHERE league_id = ? AND season_number = ? AND is_complete = 1
GROUP BY home_team_id
HAVING gc >= 35
```
But each team plays 25 home + 25 away (per schedule design). No team can reach 35 home games in a 50-game season. The condition is unreachable.
**Impact:** Trade deadline is never recorded for the season. v0.1.0 scope was to fire the procedural deadline at "game 35" (architect D19); the implementation silently no-ops.

---

### HIGH AB-07 server/sim/playoffs.ts: simulateGame contaminates regular-season standings during playoffs
**Attack scenario:** Sim through a full season + playoffs. Look at the standings.
**Evidence:** `server/sim/playoffs.ts:181-184` calls `simulateGame(...)` for every playoff game. Inside `simulateGame` (`server/sim/game.ts:317-328`), every game unconditionally does:
```
db.prepare('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + ?, runs_allowed = runs_allowed + ?, games_played = games_played + 1 WHERE id = ?')
```
There is no `is_playoff` flag and no opt-out. So a team that wins the World Series gets +N wins on its `teams.wins` column, polluting the final standings the UI displays and the next-season tiebreakers consume.
**Impact:**
- `GET /api/standings` shows wrong W/L after playoffs.
- Subsequent annual_draft order (already broken — see AB-08) is further corrupted.
- `runs_scored` / `runs_allowed` get padded with playoff totals, inflating per-team rates.

---

### HIGH AB-08 server/sim/offseason.ts: Annual draft "reverse standings" order is destroyed by the wins-reset in front_office step
**Attack scenario:** Sim into season 2; check the annual draft order.
**Evidence:**
- `server/sim/offseason.ts:290` (inside the `front_office` step, which runs *before* `annual_draft`):
```
db.prepare('UPDATE teams SET wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0 WHERE league_id = ?').run(leagueId);
```
- `server/sim/draft.ts:264-270` (`generateAnnualDraftOrder`):
```
prepared('SELECT id, wins, losses FROM teams WHERE league_id = ? ORDER BY wins ASC, losses DESC')...
```
After the reset, all teams have `wins=0, losses=0`. SQLite's `ORDER BY` with all-equal values falls back to (effectively) insertion / rowid order. The annual draft picks teams in *team-id order*, not reverse-standings order.
**Impact:** Worst-team-picks-first is the entire point of the annual draft. The reverse-standings invariant is silently broken in season 2 onward. The C5 architect decision ("Annual = straight reverse-standings") is violated.

---

### HIGH AB-09 server/sim/draft.ts: Expansion draft cannot resume after pause — restarts from round 1
**Attack scenario:** Start expansion draft, pause mid-draft, resume.
**Evidence:**
- `server/sim/draft.ts:311` — the round loop unconditionally starts at `round = 1`.
- No persisted "last completed round/pick" state.
- When `onPickComplete` throws `DRAFT_PAUSED` (engine.ts:278), `runDraftTick` catches it (engine.ts:294-298), and `draftRunning` resets to false (line 300).
- On resume, `setSimSpeed → startTick → runOneTick → runDraftTick → runExpansionDraft` is invoked again, restarting from round 1.
- Because `draft_picks` has no UNIQUE(league_id, round, pick_number) constraint (`server/migrations/001_init.sql:98-109`), the table now contains DUPLICATE rows for picks 1..N.
- Players already drafted are filtered out (`selectTopN` requires `is_drafted=0`), so the second pass picks *different* players for picks 1..N — silently changing the draft board.
**Impact:**
- A user pausing the draft and resuming loses their original picks 1..N and gets a new set with the same round/pick numbers — board changes under them.
- `draft_picks` accumulates duplicate rows; UI `find(pick_number === N)` only shows the first, hiding the corruption.

---

### HIGH AB-10 server/sim/worldgen.ts: autoBalance parameter order bug breaks minors fallback
**Attack scenario:** Worldgen produces a roster missing a position with no surplus elsewhere; the auto-balance falls back to "promote from minors" branch.
**Evidence:** `server/sim/worldgen.ts:374-377`:
```
const minorPlayer = db.prepare(
  'SELECT id FROM players WHERE league_id = ? AND position = ? AND is_on_mlb_roster = 0 AND is_drafted = 1 ORDER BY overall_rating DESC LIMIT 1'
).get(position, leagueId) as { id: number } | undefined;
```
Parameter binding is positional. SQL placeholders are `league_id, position`; passed values are `position, leagueId`. So `league_id` gets bound to a position-string (e.g. "C"), and `position` gets bound to the integer leagueId. Both predicates always evaluate false → `minorPlayer` is always undefined → the function returns without filling the gap.
**Impact:** When the surplus-team path fails, the minors fallback is silently broken. Teams that were going to be positionally unfilled after the draft remain unfilled. Combined with `selectLineup`'s log-and-move-on behavior (`game.ts:86-88`), the team will play games with fewer than 9 batters in the lineup.

---

### HIGH AB-11 client/src/views/Draft.tsx: On-clock team and pick test-id use UI list order, not draft order
**Attack scenario:** During an expansion draft, the "on the clock" indicator and the data-testids point to the wrong team.
**Evidence:**
- `client/src/views/Draft.tsx:33` fetches `/api/teams`. The route at `server/routes/teams.ts:14` orders by `wins DESC`. Initially all wins are 0 (tie → fallback to id order), but after even one regular-season game later this changes. More importantly, the *draft order* is `generateExpansionDraftOrder(leagueId, seed)` (`server/sim/draft.ts:252-261`) — a shuffled order completely independent of the API's listing order.
- `Draft.tsx:90-92` computes `onClockTeamId` from the API listing order with snake-reversal applied, *not* the actual draft order from the server. The UI displays "on the clock: Team X" for the wrong team for ~95% of picks.
- `data-testid="draft-pick-${round}-${teamIdx + 1}"` (line 194) uses the column index, not the snake-adjusted pickNumber. Per spec the testid is `draft-pick-{round}-{pickNumber}` (`v0.1.0-app-spec-section.md:283`), so even-round picks are mis-labeled.
**Impact:**
- The Draft tab visibly misidentifies which team is picking.
- Tests that depend on the spec'd `data-testid="draft-pick-{round}-{pickNumber}"` selector won't find the cells they expect on even rounds (snake-reversed picks have testid suffixes that don't match the pickNumber stored in the DB).

---

### MEDIUM AB-12 server/sim/offseason.ts: Free-agent contract years use Date.now() inside loop — broken determinism + same seed every iteration
**Attack scenario:** Run free agency. Check contract-year distributions across reruns and within one rerun.
**Evidence:** `server/sim/offseason.ts:175`:
```
const contractYears = randInt(seedFor('fa_contract', Date.now()), 1, 3);
```
- Uses `Date.now()` as the seed source, so the value is non-deterministic across reruns (D7 violation).
- Worse, within a single offseason, this is called per FA inside a tight loop. Two FAs processed in the same millisecond get the same `seedFor('fa_contract', t)` and thus the same `randInt(rng, 1, 3)` first draw — biasing the distribution.

---

### MEDIUM AB-13 server/sim/offseason.ts: free_agent_signing transaction hardcoded to season_number = 1
**Attack scenario:** Sign a free agent in season 2 or later. Inspect the `transactions` row.
**Evidence:** `server/sim/offseason.ts:181-187`:
```
db.prepare(
  'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
).run(
  leagueId, 1, 'free_agent_signing',   // ← hardcoded season_number = 1
  ...
);
```
**Impact:** Every FA signing across the dynasty is recorded as a season-1 transaction. `GET /api/transactions` will keep returning them clustered as "season 1". The Timeline transaction view (`Timeline.tsx`) misattributes signings. Free-agency history is corrupted forever.

---

### MEDIUM AB-14 server/sim/draft.ts: handleExhaustedPool seeds with Date.now() — non-deterministic
**Attack scenario:** Rare path where the position-and-rating-band pool is empty mid-draft.
**Evidence:** `server/sim/draft.ts:232`: `const rng = seedFor('draft_fill', Date.now());`. Same D7 violation as AB-12. Also the synthesized players are all named "Replacement Player" with position LF regardless of what position the team needed.
**Impact:** Low-frequency code path, but breaks the determinism contract and produces a roomful of duplicate placeholder names if it triggers more than once.

---

### MEDIUM AB-15 server/sim/season.ts: Inter-conference quota fallback can produce 24/26 or 23/27 home/away split
**Attack scenario:** Construct a worldgen that yields specific team IDs and run the schedule.
**Evidence:** `server/sim/season.ts:101-104`:
```
} else if (aQuota > 0) {
  homeTeam = aTeam; awayTeam = nTeam;
} else {
  homeTeam = nTeam; awayTeam = aTeam;
}
```
There is no third branch for "both quotas are zero." If iteration order causes both teams to hit zero simultaneously, the next pair forces nTeam home, *taking its quota negative*. The function does log a warning at line 124-129 if balance is off but does not roll back, regenerate, or throw. With the current pairKey hash (`(aTeam.id + nTeam.id) % 10`) and 20 teams generated as consecutive IDs from worldgen, the algorithm appears to balance — but it's fragile to id renumbering (e.g. after `archived` leagues leave gaps).
**Impact:** Schedule could silently produce 23-home/27-away (or worse) for some teams. The runtime warning is the only signal; no test in the suite calls the real `generateSchedule` (the schedule test re-implements the algorithm in-test).

---

### MEDIUM AB-16 server/sim/engine.ts: `archived` leagues never have player rows pruned — DB grows unboundedly
**Attack scenario:** Repeatedly create new leagues. Watch `players` table size.
**Evidence:** `server/sim/engine.ts:147-150`:
```
for (const arch of toDelete) {
  prepared('DELETE FROM league_state_cache WHERE league_id = ?').run(arch.id);
  // Note: don't cascade-delete players/teams in v0.1.0 for simplicity
}
```
The comment is honest: archived players (800/league) and team rows are not pruned. With the 30-second rate limit (CISO F5), a user can churn ~2 leagues/minute. Over hours, the players table can hit tens of thousands of rows. Per-query JOINs in routes (e.g. `/api/players/leaders`, `/api/transactions`) start scanning these.
**Impact:** SQLite-side performance degrades over time. Foreign-key references from archived `transactions` and `season_narratives` still resolve, but query plans get worse.

---

### MEDIUM AB-17 server/sim/playoffs.ts: Tiebreaker `compareTeams` is invoked once per sort comparison but `rng` mutates — pairwise comparison breaks
**Attack scenario:** Two teams tied on all earlier criteria; sort with a comparator that calls `rng()` once per call.
**Evidence:** `server/sim/playoffs.ts:31-59`. The final tiebreaker (line 58: `return rng() > 0.5 ? 1 : -1`) returns +/-1 randomly. A sort comparator must be deterministic for any pair — calling `compareTeams(a, b, ...)` returns either +1 or -1 nondeterministically, *and `compareTeams(a, b)` can disagree with `compareTeams(b, a)`*. JS sort with an inconsistent comparator yields undefined results.
**Impact:** Playoff seeding under tied teams becomes unpredictable; same season may seed different brackets on repeated runs. Not a determinism violation against the spec per se (D18 allows coin flip), but the implementation is mathematically incoherent because it doesn't memoize the coin-flip result per (a,b) pair.

---

### MEDIUM AB-18 server/sim/draft.ts: PAV selectTopN can miss high-PAV candidates outside the LIMIT-50 prefix
**Attack scenario:** Construct a roster where the top-50 by overall_rating contains few high-PAV candidates (e.g. only 1B/3B/RF, no C/SS/CF/SP).
**Evidence:** `server/sim/draft.ts:104-106`:
```
'SELECT * FROM players WHERE league_id = ? AND is_drafted = 0 AND overall_rating >= ? AND overall_rating <= ? ORDER BY overall_rating DESC LIMIT 50'
```
PAV adds up to +9 to a player's effective score. A 60-rated catcher (PAV 65 with +5 scarcity) would be more valuable to the draft than a 67-rated LF (PAV 67) — but if the top-50 by overall is dominated by LF/RF, the C never enters the candidate pool. The sort by PAV (line 109) only re-ranks within the prefix.
**Impact:** The top-10 list shown to the LLM systematically under-represents scarcity-bonused positions late in the draft. Procedural fallback re-runs the same query and has the same limitation.

---

### LOW AB-19 server/sim/engine.ts: TypeScript strict-optional violation on WorldgenOptions
**Evidence:** `server/sim/engine.ts:123`: passes `{ seed: options.seed, leagueName: options.leagueName }` where the body schema marks both as optional (zod), but `WorldgenOptions` (in worldgen.ts) declares them as required-when-present (`exactOptionalPropertyTypes: true`). Compile fails. Cosmetic — fixable by guarding the spread — but contributes to the can't-build state in AB-01.

---

### LOW AB-20 server/sim/playoffs.ts: World Series uses Best-of-7, but champion is recorded with no series detail
**Evidence:** `server/sim/playoffs.ts:144-148`. Only the champion ID is written to `season_narratives`. No MVP. No `mvp_player_id`. `Timeline.tsx` will always show "MVP: (null)" for every season.

---

### LOW AB-21 server/services/llm.ts: Daily budget check counts *attempted* calls, not *spent* calls
**Evidence:** `recordLlmCall()` is invoked before the API call (`server/services/llm.ts:212`). If `client.messages.create` throws (network error, 401), the call still increments `llm_usage`. Over time the budget deflates without value delivered.
**Impact:** Cost guardrail is conservative — slightly tighter than intended, not looser. Annoying but not dangerous.

---

### LOW AB-22 server/sim/season.ts: shouldFireTradeDeadline COUNT(DISTINCT CASE WHEN...) is needlessly fragile
**Evidence:** `server/sim/season.ts:189-197`. The construction uses a subquery with `CASE WHEN home_team_id IS NOT NULL` — but `home_team_id` is `NOT NULL` per schema. The whole expression collapses to `COUNT(DISTINCT home_team_id)` from a `HAVING gc >= 35` subselect, which (per AB-06) only counts teams with 35 *home* games — but the intent is total games. Both the SQL pattern and the semantics are wrong.

---

## Attack Surface Summary

**Most dangerous if left unfixed (must-fix before COMPLETE):**

1. **AB-01 (Critical)** — The server cannot start. Fix the import path *before* anything else; nothing else can be exercised at runtime until this is resolved. Also fix the two collateral TS errors at engine.ts:123 and :234.
2. **AB-02 + AB-14 + AB-12 (Critical/Medium)** — `Math.random()` and `Date.now()` calls inside the seeded sim path. Determinism is a load-bearing claim in the spec (D7) and the test strategy. Until these are replaced with the threaded `rng`, "same seed, same outcome" is false.
3. **AB-04 (High)** — Playoff series sizes wrong. Visible-on-first-screen spec violation.
4. **AB-05 (High)** — Walk-off flagged on every home win; home-team pitcher IP biased every home win. Visible-on-first-screen and pollutes ERA stats.
5. **AB-07 + AB-08 (High/High)** — `simulateGame` writes to `teams.wins` during playoffs, then the offseason resets wins to 0 *before* the annual draft uses them. Net effect: the standings the user just watched get nuked before season 2's draft reverse-order can use them. Season 2's draft is broken from day one.
6. **AB-06 (High)** — Trade deadline never fires; transactions table gets no `trade_deadline` row this season or any other.
7. **AB-09 (High)** — Pausing the draft creates phantom duplicate picks on resume.
8. **AB-10 (High)** — Auto-balance minors fallback is broken by reversed SQL parameters; teams missing positions stay missing.

**Lower-priority but should fix:**

- AB-11 (UI on-clock teams wrong; data-testids on snake-reversed cells don't match spec)
- AB-13 (FA signings recorded as season 1 forever)
- AB-15 (schedule quota algorithm has an uncovered both-zero branch)
- AB-17 (tiebreaker coin-flip in a comparator is mathematically incoherent)
- AB-18 (PAV top-10 misses scarcity candidates outside the top-50 overall)

**Things the prior review feared but the build actually got right:**

- Default seed defaults to `Date.now()` (no more "every league is identical").
- LLM narratives are sanitized AND rendered as React text nodes. XSS surface is closed.
- Tier-based player distribution uses exact counts, not normal-distribution sampling (no flaky tolerances).
- `validatePostDraftRosters` exists and runs auto-balance for C/SS/CF/SP/CL minimums (though see AB-10 for the broken inner fallback).
- Schedule generator produces 36 intra + 14 inter (when it runs).
- LLM error responses are scrubbed; API key cannot leak to clients.
- Build-time grep for `sk-ant-*` in client bundle, and grep for SQL template-string interpolation, both present in `scripts/`.

**Bottom line:** The implementation is closer to ready than the pre-build defects predicted, but AB-01 alone blocks any runtime verification. Once the server starts, AB-02/04/05/06/07/08/09/10 are the next gate — each is independently a "user notices on day one" issue.

---

**End of adversary-post-build.md.**
