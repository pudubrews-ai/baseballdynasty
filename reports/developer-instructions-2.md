# Developer Instructions — Iteration 2 (Baseball Dynasty Simulator v0.1.0)

**Author:** Architect
**Audience:** Developer
**Base commit:** `4a8588d` on `feature/v0.1.0-initial-build`
**Inputs you read:** this file + `v0.1.0-app-spec-section.md`. **Nothing else.** Do NOT read any test results, the CISO report, or the Adversary report — those have been synthesized here. Do not consult `developer-instructions-1.md` for these fixes — every requirement from that document still applies, but this file is the authoritative delta for Iteration 2.

**Where this file conflicts with the spec, this file wins.**

---

## 0. CRITICAL — DO NOT START THE SERVER UNTIL ALL FIXES ARE APPLIED

The committed build at `4a8588d` cannot start. Running `npx tsx server/index.ts` will exit immediately with a module resolution error. Do **not** attempt to start the server until you have applied at least the fixes in §1 below.

Order of work in this iteration:
1. Apply §1 (Critical fixes that unblock startup and determinism).
2. Apply §2 (High fixes — correctness defects).
3. Apply §3 (Spec compliance: error messages and response shapes).
4. Apply §4 (Medium fixes).
5. Apply §5 (Low / cleanup).
6. Run `cd baseball-dynasty && npm run test`. All tests must pass.
7. Add the new tests required in §6.
8. Start the server with `npx tsx server/index.ts` and verify the §7 Definition-of-Done acceptance checks.
9. Commit + push to the feature branch (do not merge).

Do not skip steps. Do not declare "done" while any item in §1–§4 is incomplete. Do not silently downgrade or defer any spec violation. If something genuinely cannot be implemented, document why in the commit message and proceed; the Architect will evaluate.

---

## 1. Critical Fixes — Apply These First

### 1.1 Fix the broken import in `server/sim/engine.ts` (server cannot start without this)

**File:** `baseball-dynasty/server/sim/engine.ts`
**Bug:** Line 8 imports `validatePostDraftRosters` from `./draft.js`, but the symbol is exported from `worldgen.ts:323`.
**Current:**
```ts
import { validatePostDraftRosters, runExpansionDraft } from './draft.js';
```
**Fix:** Move `validatePostDraftRosters` to its actual source file:
```ts
import { runExpansionDraft } from './draft.js';
import { validatePostDraftRosters } from './worldgen.js';
```

**Verify:** `cd baseball-dynasty && npx tsc --noEmit -p tsconfig.server.json` reports zero TS2305 errors related to `validatePostDraftRosters`.

---

### 1.2 Fix the two collateral TypeScript errors in `engine.ts`

**File:** `baseball-dynasty/server/sim/engine.ts`
**Bug 1 (line ~123):** `exactOptionalPropertyTypes` strict-optional violation when passing `{ seed: options.seed, leagueName: options.leagueName }` to `WorldgenOptions`. Optional fields cannot be passed as explicit `undefined`.
**Fix:** Build the options object conditionally:
```ts
const wgOptions: { seed?: number; leagueName?: string } = {};
if (options.seed !== undefined) wgOptions.seed = options.seed;
if (options.leagueName !== undefined) wgOptions.leagueName = options.leagueName;
const result = await generateWorld(wgOptions);
```

**Bug 2 (line ~234):** Comparison between non-overlapping union members. Inspect the discriminated-union check and add a type guard or `as` narrowing so the comparison typechecks. If the comparison is `if (someUnion === 'literal')` where `someUnion` does not include `'literal'`, that branch is dead — remove it. Otherwise add an `as` cast with an inline comment explaining why.

**Verify:** `npx tsc --noEmit -p tsconfig.server.json` exits 0 with no errors.

---

### 1.3 Remove the duplicate `export { initEngine }` in `engine.ts`

**File:** `baseball-dynasty/server/sim/engine.ts`
**Bug:** Line 361 has `export { initEngine };` even though `initEngine` is already exported at the function declaration (`export async function initEngine`). This causes a build error under `tsx`'s ESM module loader: "Multiple exports with the same name 'initEngine'".
**Fix:** Delete the entire line 361 (`export { initEngine };`) and any other redundant re-exports at the bottom of the file. Do not change the declaration-site `export async function initEngine`.

**Verify:** `grep -c "export.*initEngine" server/sim/engine.ts` returns exactly `1`.

---

### 1.4 Replace `Math.random()` with the seeded `rng` in `clampRBI`

**File:** `baseball-dynasty/server/sim/game.ts`
**Bug:** Lines 405 and 418 use `Math.floor(Math.random() * ...)` inside `clampRBI`. The rest of `simulateGame` correctly threads a seeded `rng`, but `clampRBI` does not receive it. Determinism is broken end-to-end because `clampRBI` is called on every game (twice — once per team) at lines 236-237.

**Fix step A:** Change the `clampRBI` signature to accept `rng`:
```ts
function clampRBI(lines: BatterBoxLine[], teamRuns: number, rng: () => number): void {
  // ... same body, but replace BOTH Math.random() calls with rng() ...
  const idx = Math.floor(rng() * highRBI.length);   // was: Math.random()
  // ...
  const idx = Math.floor(rng() * hasHits.length);   // was: Math.random()
}
```

**Fix step B:** Update the two call sites (lines ~236-237) to pass the existing per-game `rng`:
```ts
clampRBI(homeBatterLines, homeScore, rng);
clampRBI(awayBatterLines, awayScore, rng);
```

**Verify:** `grep -n "Math.random" server/sim/game.ts` returns zero matches. Replays from the same seed (see new test in §6.1) produce byte-identical box scores.

---

### 1.5 Make `validateBoxScore` actually run, and fix its bug

**File:** `baseball-dynasty/server/sim/game.ts`
**Bug A:** The `validateBoxScore` function (lines 152-173) is exported but never called by `simulateGame`. It is dead code.
**Bug B:** Inside the function, line 167-168 uses `b.teamId === homeScore` (comparing a `team_id` integer to a *score* integer). This is wrong — it should compare against `homeTeam.id` and `awayTeam.id`.

**Fix step A — make the function correct:** Change the signature so it receives the team IDs explicitly, not the scores:
```ts
export function validateBoxScore(
  result: GameResult,
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number,
  awayScore: number
): string[] {
  const errors: string[] = [];

  // Rule 1: team_hits >= team_runs - team_walks
  if (result.homeHits < homeScore - result.homeWalks) {
    errors.push(`Home hits ${result.homeHits} < runs ${homeScore} - walks ${result.homeWalks}`);
  }
  if (result.awayHits < awayScore - result.awayWalks) {
    errors.push(`Away hits ${result.awayHits} < runs ${awayScore} - walks ${result.awayWalks}`);
  }

  // Rule 2: total_rbi <= team_runs AND >= max(0, team_runs - 1)
  const homeRBI = result.batterLines.filter(b => b.teamId === homeTeamId).reduce((s, b) => s + b.rbi, 0);
  const awayRBI = result.batterLines.filter(b => b.teamId === awayTeamId).reduce((s, b) => s + b.rbi, 0);
  if (homeRBI > homeScore) errors.push(`Home RBI ${homeRBI} > runs ${homeScore}`);
  if (awayRBI > awayScore) errors.push(`Away RBI ${awayRBI} > runs ${awayScore}`);
  if (homeRBI < Math.max(0, homeScore - 1)) errors.push(`Home RBI ${homeRBI} < min ${Math.max(0, homeScore - 1)}`);
  if (awayRBI < Math.max(0, awayScore - 1)) errors.push(`Away RBI ${awayRBI} < min ${Math.max(0, awayScore - 1)}`);

  // Rule 3: starting pitcher IP between 4.0 and 9.0
  const homeStarterLine = result.pitcherLines.find(p => p.teamId === homeTeamId);
  const awayStarterLine = result.pitcherLines.find(p => p.teamId === awayTeamId);
  if (homeStarterLine && (homeStarterLine.inningsPitched < 4.0 || homeStarterLine.inningsPitched > 9.0)) {
    errors.push(`Home starter IP ${homeStarterLine.inningsPitched} out of range`);
  }
  if (awayStarterLine && (awayStarterLine.inningsPitched < 4.0 || awayStarterLine.inningsPitched > 9.0)) {
    errors.push(`Away starter IP ${awayStarterLine.inningsPitched} out of range`);
  }

  return errors;
}
```

(Adjust to the actual field names on `GameResult`; the principle is `homeTeamId`/`awayTeamId` are explicit args, never inferred from scores.)

**Fix step B — call it from `simulateGame`:** After all box-score generators have run (after `clampRBI`, after `generatePitcherLines`, before the `writeGame` transaction), invoke the validator and, on error, regenerate the affected slices (up to 3 retries) before committing. Pseudocode to insert around line 285 (just before `const writeGame = db.transaction(...)`):
```ts
// §5.1 Box-score consistency gate
const validationErrors = validateBoxScore(
  { homeHits, awayHits, homeWalks, awayWalks, batterLines: allBatterLines, pitcherLines: allPitcherLines },
  homeTeam.id,
  awayTeam.id,
  homeScore,
  awayScore
);
if (validationErrors.length > 0) {
  console.warn(`[game ${gameId}] box-score validation failed: ${validationErrors.join('; ')}`);
  // Regenerate walks deficit (Rule 1) and re-clamp RBI (Rule 2)
  // Up to 3 retries
  for (let attempt = 0; attempt < 3 && validateBoxScore(/* same args */).length > 0; attempt++) {
    // Re-run distributeExtraWalks if the rule-1 error is there
    // Re-run clampRBI(homeBatterLines, homeScore, rng) and clampRBI(awayBatterLines, awayScore, rng) if rule-2 error is there
    // (You may need to inline the fix logic here — the goal is: after this block, validateBoxScore returns [].)
  }
  // Final assert — if still failing, log loudly but proceed (do not crash the sim)
  const finalErrors = validateBoxScore(/* same args */);
  if (finalErrors.length > 0) {
    console.error(`[game ${gameId}] box-score still invalid after retries: ${finalErrors.join('; ')}`);
  }
}
```

**Verify:** Run a 500-game season (via the new test in §6.2) — `validateBoxScore` returns `[]` for every game.

---

## 2. High Fixes — Correctness Defects

### 2.1 Bind the server to localhost only

**File:** `baseball-dynasty/server/index.ts`, line 179.
**Bug:** `app.listen(PORT, () => {...})` binds to `0.0.0.0` (all network interfaces), exposing the API to anyone on the LAN.
**Fix:**
```ts
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] Baseball Dynasty server running on http://127.0.0.1:${PORT} (localhost only)`);
});
```

**Verify:** After server start, `lsof -i :3001` shows `127.0.0.1:3001 (LISTEN)`, not `*:3001`. `curl http://127.0.0.1:3001/healthz` returns 200; `curl http://<your-LAN-IP>:3001/healthz` connection refused.

---

### 2.2 Fix walk-off detection

**File:** `baseball-dynasty/server/sim/game.ts`, line 196 (`const isWalkOff = homeWins;`).
**Bug:** Every home win is flagged as a walk-off. A walk-off is specifically when the home team scores the winning run in the bottom of the 9th (or later) — i.e., walk-offs are a *subset* of home wins.
**Fix:** Define walk-off probabilistically:
- If `homeWins === false`, `isWalkOff = false`.
- If `homeWins === true`, `isWalkOff = rng() < 0.18` (approximately 18% of home wins are walk-offs, which yields ~9.7% of all games — within MLB-typical 8–11% walk-off rate).

```ts
const isWalkOff = homeWins && (rng() < 0.18);
```

**Also fix the IP truncation logic** at line ~448 (`const totalIP = isWalkOff ? 8.5 : 9.0;`):
- Walk-off home win: home team pitches **8.0 IP** (visiting team batted top of 9; home didn't bat bottom of 9 because winning run scored mid-frame). Set `totalIP = 8.0` for walk-offs.
- Non-walk-off home win: home team pitches **9.0 IP** (visiting team batted top of 9; home batted bottom of 9 in a normal close-but-non-walk-off game where the home team had led entering the 9th… for v0.1.0 simplicity: treat as 9.0 IP).
- Home loss: home team pitches **9.0 IP**.

```ts
const totalIP = isWalkOff ? 8.0 : 9.0;
```

**Verify:** Over 500 games, count walk-off `notable_events`:
- Expected count: ~45–55 (≈10% of 500). Definitely under 100.
- Old buggy behavior: ~270 (54%).

---

### 2.3 Fix trade-deadline trigger (count total games, not home games)

**File:** `baseball-dynasty/server/sim/season.ts`, function `shouldFireTradeDeadline` (lines 187-205).
**Bug:** Current SQL counts only games where the team is `home_team_id`. Max possible is 25 home games per season, so the HAVING `>= 35` threshold is unreachable.
**Fix:** Count total games per team across both home and away appearances:
```ts
export function shouldFireTradeDeadline(leagueId: number, seasonNumber: number): boolean {
  // Count games-played per team for the season, then count teams at >= 35
  const teamsAt35 = prepared(
    `SELECT COUNT(*) as cnt FROM (
       SELECT team_id, SUM(cnt) as gc FROM (
         SELECT home_team_id as team_id, COUNT(*) as cnt
         FROM game_log
         WHERE league_id = ? AND season_number = ? AND is_complete = 1
         GROUP BY home_team_id
         UNION ALL
         SELECT away_team_id as team_id, COUNT(*) as cnt
         FROM game_log
         WHERE league_id = ? AND season_number = ? AND is_complete = 1
         GROUP BY away_team_id
       )
       GROUP BY team_id
       HAVING gc >= 35
     )`
  ).get(leagueId, seasonNumber, leagueId, seasonNumber) as { cnt: number };

  const alreadyFired = prepared(
    "SELECT id FROM transactions WHERE league_id = ? AND season_number = ? AND transaction_type = 'trade_deadline'"
  ).get(leagueId, seasonNumber);

  return teamsAt35.cnt >= 10 && !alreadyFired;
}
```

**Verify:** Sim a 50-game season. `SELECT COUNT(*) FROM transactions WHERE transaction_type = 'trade_deadline' AND season_number = N` returns exactly 1 for each completed season.

---

### 2.4 Stop `simulateGame` from polluting regular-season standings during playoffs

**File:** `baseball-dynasty/server/sim/game.ts` (around lines 317-328) and `baseball-dynasty/server/sim/playoffs.ts` (call site at line 181).
**Bug:** `simulateGame` unconditionally updates `teams.wins/losses/runs_scored/runs_allowed/games_played`. Playoff games therefore contaminate regular-season standings.

**Fix step A:** Add an `isPlayoff` parameter to `simulateGame`:
```ts
export async function simulateGame(
  gameId: number,
  homeTeam: TeamRow,
  awayTeam: TeamRow,
  gameNumber: number,
  dateMs: number,
  seasonNumber: number,
  leagueId: number,
  isPlayoff: boolean = false
): Promise<void> {
```

**Fix step B:** Wrap the team W/L update block (lines 317-328) so it only runs when `!isPlayoff`:
```ts
if (!isPlayoff) {
  if (homeWins) {
    db.prepare('UPDATE teams SET wins = wins + 1, runs_scored = runs_scored + ?, runs_allowed = runs_allowed + ?, games_played = games_played + 1 WHERE id = ?')
      .run(homeScore, awayScore, homeTeam.id);
    // ... etc.
  } else {
    // ... etc.
  }
}
```

**Fix step C:** Pass `true` from `playoffs.ts` (line 181-184):
```ts
await simulateGame(
  gameNum, homeTeam, awayTeam, gameNum,
  league.current_game_date, league.season_number, leagueId,
  true   // isPlayoff
);
```

**Fix step D:** Record playoff series outcomes in a dedicated location. Add a `playoff_series` table in a new migration (`002_playoff_series.sql`) OR — simpler — write the series result to `transactions` with `transaction_type = 'playoff_series'`, including which round and which team won. Choose the migration approach because it gives the Timeline a clean source. Schema:
```sql
CREATE TABLE IF NOT EXISTS playoff_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  round_name TEXT NOT NULL,           -- 'DS' | 'CS' | 'WS'
  conference TEXT,                    -- 'American' | 'National' | NULL for WS
  team1_id INTEGER NOT NULL REFERENCES teams(id),
  team2_id INTEGER NOT NULL REFERENCES teams(id),
  winner_team_id INTEGER NOT NULL REFERENCES teams(id),
  team1_wins INTEGER NOT NULL,
  team2_wins INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```
Insert one row at the end of each `runSeries` call in `playoffs.ts`.

**Verify:** After season 1 ends (regular season + playoffs), `SELECT wins FROM teams` shows max wins = 50 (the regular-season max), not 50+playoff_wins. `SELECT COUNT(*) FROM playoff_series WHERE season_number = 1` = 5 (2 American DS + 2 National DS + ... wait, let me recount: 2 DS American + 2 DS National + 1 CS American + 1 CS National + 1 WS = 7 series per season).

---

### 2.5 Lock playoff series lengths to DS=5, CS=7, WS=7

**File:** `baseball-dynasty/server/sim/playoffs.ts`, lines 116-119, 127-128, 136.
**Architect ruling:** Division Series = **best-of-5** (winner needs 3 wins). Championship Series = **best-of-7** (winner needs 4 wins). World Series = **best-of-7** (winner needs 4 wins). These values are now part of the v0.1.0 spec.

**Current code is already DS=5, CS=7, WS=7.** The Adversary's finding cited `app-spec.md` (Division=3) but the v0.1.0-app-spec-section.md is silent on series lengths. Architect locks the existing values.

**No code change required for the bestOf numbers themselves.** But verify that `runSeries`'s wins-to-clinch math is correct (`winsNeeded = Math.ceil(bestOf / 2)`): for bestOf=5, winsNeeded=3 ✓; for bestOf=7, winsNeeded=4 ✓.

**Add code comment to `playoffs.ts` documenting the locked values:**
```ts
// Architect-locked v0.1.0 series lengths:
// Division Series = best-of-5 (first to 3)
// Championship Series = best-of-7 (first to 4)
// World Series = best-of-7 (first to 4)
```

---

### 2.6 Fix the offseason "wins reset" so annual draft order is correct

**File:** `baseball-dynasty/server/sim/offseason.ts`, line 290.
**Bug:** Front office step resets `wins=0, losses=0` for all teams *before* the annual draft step runs. The annual draft reads from `teams ORDER BY wins ASC, losses DESC`. After the reset all teams are tied → falls to insertion (rowid) order, breaking reverse-standings.

**Fix:** Do NOT reset wins/losses inside the front_office step. Move the reset to the very end of the offseason, AFTER `annual_draft` step has read the previous-season standings.

Specifically:
1. Remove line 290 entirely from the front_office step.
2. Add the reset to the `finalizeOffseason` function (around line 302+), inside the same transaction that bumps `season_number`:
```ts
async function finalizeOffseason(leagueId: number, previousSeason: number): Promise<void> {
  const db = getDb();
  const newSeason = previousSeason + 1;

  db.prepare('UPDATE leagues SET season_number = ?, phase = ?, offseason_step = NULL WHERE id = ?').run(newSeason, 'regular_season', leagueId);

  // Reset W/L/runs/games_played for the new season — must happen AFTER annual_draft
  db.prepare('UPDATE teams SET wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0 WHERE league_id = ?').run(leagueId);

  // ... regenerate schedule, etc.
}
```

**Verify:** Sim into season 2. Inspect the first 5 picks of the annual draft:
```sql
SELECT dp.round, dp.pick_number, t.id, t.name, t.wins, t.losses
FROM draft_picks dp JOIN teams t ON t.id = dp.team_id
WHERE dp.league_id = 1 AND dp.season_number = 2 AND dp.round = 1
ORDER BY dp.pick_number ASC LIMIT 5;
```
The teams ordered should be the worst 5 teams from season 1 (lowest wins). Currently they would be teams in id-order.

---

### 2.7 Fix draft resume: persist progress + add UNIQUE constraint

**File:** `baseball-dynasty/server/sim/draft.ts` (`runExpansionDraft` at line 302+) and `baseball-dynasty/server/migrations/`.

**Bug A:** The round loop unconditionally starts at `round = 1`. If a pause interrupts mid-draft, on resume the loop restarts from round 1, drafting different players for picks 1..N and creating duplicate rows.

**Bug B:** `draft_picks` has no UNIQUE constraint on `(league_id, season_number, round, pick_number)`. Duplicate rows can accumulate silently.

**Fix step A — Add the UNIQUE constraint.** Create a new migration `server/migrations/002_draft_picks_unique.sql`:
```sql
-- Add UNIQUE constraint on draft_picks to prevent duplicate picks
CREATE UNIQUE INDEX IF NOT EXISTS uniq_draft_picks
  ON draft_picks(league_id, season_number, round, pick_number);
```

**Fix step B — Make the draft loop resume-aware.** Before the loop, query the highest already-completed `pick_number` for this league+season:
```ts
export async function runExpansionDraft(
  league: LeagueRow,
  isTurbo: boolean,
  onPickComplete?: (pickId: number, round: number, pick: number) => void
): Promise<void> {
  const leagueId = league.id;
  const teamOrder = generateExpansionDraftOrder(leagueId, league.worldgen_seed);
  const totalRounds = 30;
  const totalPicks = totalRounds * 20;

  // Resume: find the last completed pick_number for this league+season
  const lastCompleted = prepared(
    'SELECT COALESCE(MAX(pick_number), 0) as max_pick FROM draft_picks WHERE league_id = ? AND season_number = ? AND is_expansion = 1'
  ).get(leagueId, league.season_number) as { max_pick: number };

  for (let pickNumber = lastCompleted.max_pick + 1; pickNumber <= totalPicks; pickNumber++) {
    const round = Math.floor((pickNumber - 1) / 20) + 1;
    const pickIdxInRound = (pickNumber - 1) % 20;
    // Snake order: odd rounds go forward, even rounds reverse
    const orderForRound = round % 2 === 1 ? teamOrder : [...teamOrder].reverse();
    const teamId = orderForRound[pickIdxInRound]!;
    const team = prepared('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow;

    const currentLeague = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as LeagueRow;
    const pickId = await runDraftPick(currentLeague, team, round, pickNumber, true, isTurbo);

    if (pickId && onPickComplete) {
      onPickComplete(pickId, round, pickNumber);
    }
  }

  // After draft: assign roster levels
  assignRosterLevels(leagueId);
}
```

Apply the same resume logic to `runAnnualDraft`.

**Verify:**
1. Run expansion draft to pick 200, send `POST /api/sim/speed {speed:"paused"}`, wait, send `POST /api/sim/speed {speed:"turbo"}`. Draft completes with picks 201..600 — no duplicate `(league_id, season_number, round, pick_number)` rows.
2. `SELECT COUNT(*) FROM draft_picks WHERE league_id = 1 AND season_number = 1 AND is_expansion = 1` returns exactly 600.

---

### 2.8 Fix the autoBalance SQL parameter binding

**File:** `baseball-dynasty/server/sim/worldgen.ts`, lines 374-377.
**Bug:** SQL placeholders are `league_id, position`; the values passed are `position, leagueId` (reversed).
**Fix:**
```ts
const minorPlayer = db.prepare(
  'SELECT id FROM players WHERE league_id = ? AND position = ? AND is_on_mlb_roster = 0 AND is_drafted = 1 ORDER BY overall_rating DESC LIMIT 1'
).get(leagueId, position) as { id: number } | undefined;
```

**Verify:** Add a unit test that constructs a worldgen scenario in which the surplus path fails (e.g., zero teams have surplus at a position) and confirms the minors fallback promotes someone.

---

### 2.9 Fix Draft.tsx team ordering and data-testid

**File:** `baseball-dynasty/client/src/views/Draft.tsx`.

**Bug A:** Line 33 fetches `/api/teams` (which returns teams ordered by `wins DESC`). For the expansion draft the order is whatever the server returns, which is *not* the actual draft order (`generateExpansionDraftOrder` is a shuffled order based on the worldgen seed).

**Bug B:** Lines 95-99 and 194 compute `data-testid="draft-pick-${round}-${teamIdx + 1}"` using the column index. The spec requires `draft-pick-{round}-{pickNumber}` where `pickNumber` is the actual pick number (1..600 for expansion). For even (snake-reversed) rounds, `teamIdx+1` does NOT equal `pickNumber`.

**Fix step A — surface the draft order from the server.** Add to `server/sim/draft.ts` an exported `getExpansionDraftOrder(leagueId): number[]` function that returns the deterministic shuffled team ID array for the league. Add a route `GET /api/draft/order` that returns `{ teamOrder: number[] }`.

Inside `server/index.ts`:
```ts
app.get('/api/draft/order', async (_req, res, next) => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json({ teamOrder: [] }); return; }
    const { getExpansionDraftOrder } = await import('./sim/draft.js');
    res.json({ teamOrder: getExpansionDraftOrder(league.id) });
  } catch (err) { next(err); }
});
```

**Fix step B — Draft.tsx consumes the draft order.** Replace the `teams` ordering used for draft cell rendering with an array sorted by `teamOrder`:
```tsx
const [teamOrder, setTeamOrder] = useState<number[]>([]);
useEffect(() => {
  if (state?.phase === 'expansion_draft' || state?.phase === 'annual_draft') {
    fetch('/api/draft/order')
      .then(r => r.json())
      .then((data: { teamOrder: number[] }) => setTeamOrder(data.teamOrder));
  }
}, [state?.phase]);

// Compute teamsInDraftOrder
const teamsInDraftOrder: TeamInfo[] = teamOrder
  .map(id => teams.find(t => t.id === id))
  .filter((t): t is TeamInfo => t !== undefined);
```

Then everywhere the table iterates over `teams.map(team => ...)` (header row and body cells), iterate over `teamsInDraftOrder` instead.

**Fix step C — correct the data-testid.** Replace line 194:
```tsx
data-testid={`draft-pick-${round}-${teamIdx + 1}`}
```
with the actual pick number for snake order:
```tsx
{teamsInDraftOrder.map((team, teamIdx) => {
  // Snake order: odd rounds forward, even rounds reversed
  const pickInRound = round % 2 === 1 ? teamIdx + 1 : (teamsInDraftOrder.length - teamIdx);
  const pickNumber = (round - 1) * teamsInDraftOrder.length + pickInRound;
  const pick = allPicks.find(p => p.pick_number === pickNumber);
  return (
    <td
      key={team.id}
      data-testid={`draft-pick-${round}-${pickNumber}`}
      style={{ ... }}
    >
      ...
    </td>
  );
})}
```

**Fix step D — fix the on-clock team detection.** Replace lines 88-92:
```tsx
let onClockTeamId: number | null = null;
if (teamsInDraftOrder.length > 0 && (state?.phase === 'expansion_draft' || state?.phase === 'annual_draft')) {
  const totalPicksMade = allPicks.length;
  const currentRound = Math.floor(totalPicksMade / teamsInDraftOrder.length) + 1;
  const pickInRoundIdx = totalPicksMade % teamsInDraftOrder.length;
  const isSnakeReversedRound = currentRound % 2 === 0;
  const lookupIdx = isSnakeReversedRound ? (teamsInDraftOrder.length - 1 - pickInRoundIdx) : pickInRoundIdx;
  onClockTeamId = teamsInDraftOrder[lookupIdx]?.id ?? null;
}
```

**Verify:**
1. Open Chrome DevTools after a fresh dynasty. The "On the Clock" badge shows a team that matches `draft_picks.team_id` for the next pick number in DB.
2. Inspect any cell in the draft board: its `data-testid` matches `draft-pick-{round}-{pickNumber}` where pickNumber is the DB pick_number for that team in that round.
3. For round 2 (even), the leftmost data cell has `data-testid="draft-pick-2-40"` (snake reversed) not `draft-pick-2-21`.

---

### 2.10 Restart the tick loop after expansion-draft phase completes

**File:** `baseball-dynasty/server/sim/engine.ts`, the `setSimSpeed` function (search for the function that handles `/api/sim/speed`).

**Bug:** After expansion draft completes, `simRunning = false` and `currentSpeed = 'turbo'` (because the draft ran at turbo). When the user sends `POST /api/sim/speed {speed: "normal"}` next, the engine checks `if (prevSpeed !== 'paused') ...` and skips restarting the tick loop because `prevSpeed === 'turbo' !== 'paused'`. Result: regular season never starts.

**Fix:** Change the restart guard so it restarts the tick whenever the engine is not currently running, regardless of `prevSpeed`:

```ts
export function setSimSpeed(newSpeed: SimSpeed): void {
  const prevSpeed = currentSpeed;
  currentSpeed = newSpeed;

  // Persist to DB
  if (currentLeagueId) {
    prepared('UPDATE leagues SET sim_speed = ? WHERE id = ?').run(newSpeed, currentLeagueId);
  }

  // Restart tick loop if newSpeed is non-paused AND engine is not currently running
  if (newSpeed !== 'paused' && !simRunning) {
    startTick();
    return;
  }

  // If transitioning paused -> non-paused but already running (shouldn't happen, but defensive)
  if (prevSpeed === 'paused' && newSpeed !== 'paused' && !simRunning) {
    startTick();
  }
}
```

The exact patch depends on the existing function structure. The principle is: **whenever the requested speed is non-paused and `simRunning === false`, restart the tick loop.**

**Verify:** Run a turbo expansion draft to completion → phase transitions to `regular_season` → send `POST /api/sim/speed {speed:"normal"}` → after 5 seconds, `SELECT COUNT(*) FROM game_log WHERE season_number = 1` is `> 0`.

---

### 2.11 Fix the market-size distribution (2 mega / 4 large / 8 medium / 6 small)

**File:** `baseball-dynasty/server/sim/worldgen.ts`, the city selection block (lines 102-122).

**Bug:** The current selection picks 20 cities at random from the pool with only a region-uniqueness constraint. The pool is 6 mega + 8 large + 14 medium + 5 small = 33 cities. The resulting market-size distribution is roughly proportional to the pool, not 2/4/8/6.

**Required distribution:** exactly **2 mega + 4 large + 8 medium + 6 small = 20**.

**Fix step A — adjust the city pool so it has enough small markets.** The current pool has only 5 small-market cities; the spec requires 6. Add one more small-market city to `server/data/cities.ts` in a region that's currently underrepresented (e.g., Mountain West or Mid-Atlantic). Pick a name in the established fictional-name style (e.g., "Brookhaven", "Ashfield", "Ironbrook" — check it's not already in the list).

**Fix step B — change the selection algorithm to quota-respect:**
```ts
function selectCitiesWithMarketQuota(
  rng: () => number,
  allCities: CityData[]
): CityData[] {
  const quotas: Record<string, number> = { mega: 2, large: 4, medium: 8, small: 6 };
  const remaining: Record<string, number> = { ...quotas };

  const shuffled = [...allCities];
  shuffle(rng, shuffled);

  const usedRegions = new Set<string>();
  const selected: CityData[] = [];

  // First pass: greedy by market size, honoring region uniqueness
  for (const city of shuffled) {
    if (selected.length >= 20) break;
    if (remaining[city.market_size]! <= 0) continue;
    if (usedRegions.has(city.region)) continue;
    selected.push(city);
    usedRegions.add(city.region);
    remaining[city.market_size]!--;
  }

  // Second pass: if any quota unmet (because of region exhaustion), relax region uniqueness
  if (selected.length < 20) {
    for (const city of shuffled) {
      if (selected.length >= 20) break;
      if (selected.includes(city)) continue;
      if (remaining[city.market_size]! <= 0) continue;
      console.warn(`[worldgen] Relaxing region uniqueness to satisfy market-size quota for ${city.name}`);
      selected.push(city);
      remaining[city.market_size]!--;
    }
  }

  return selected;
}
```

Use this function in place of the existing loop at lines 102-122.

**Verify:** Add a unit test in `server/tests/worldgen.test.ts`:
```ts
it('selects exactly 2 mega, 4 large, 8 medium, 6 small market teams', async () => {
  const { leagueId } = await generateWorld({ seed: 42 });
  const counts = prepared(
    'SELECT market_size, COUNT(*) as cnt FROM teams WHERE league_id = ? GROUP BY market_size'
  ).all(leagueId) as Array<{ market_size: string; cnt: number }>;
  const map = Object.fromEntries(counts.map(c => [c.market_size, c.cnt]));
  expect(map.mega).toBe(2);
  expect(map.large).toBe(4);
  expect(map.medium).toBe(8);
  expect(map.small).toBe(6);
});
```

---

### 2.12 Fix the blowout rate (currently 26%, spec requires 12-18%)

**File:** `baseball-dynasty/server/sim/game.ts`, line 191.
**Bug:** `randTriangular(rng, 3, 4, 12)` — min=3, mode=4, max=12. Mode at the bottom of the range and max=12 produces too-heavy a tail. ~26% of winner scores are ≥ 8 (blowouts), vs spec target 12-18%.
**Fix:** Tighten the distribution. Use `randTriangular(rng, 3, 4, 9)` (max=9 instead of 12), then on a small probability bonus add 1-3 extra runs:

```ts
// Winner score: triangular base 3..9 with mode 4, plus rare high-end tail to allow 10-12
let winnerScore = Math.round(randTriangular(rng, 3, 4, 9));
// 10% chance of high-end tail (adds 1-3 extra runs, capped at 12)
if (rng() < 0.10) {
  winnerScore = Math.min(12, winnerScore + randInt(rng, 1, 3));
}
```

This yields ~14% blowouts (winner ≥ 8) over many trials, comfortably inside the 12-18% window, while preserving the rare 10-12-run blowout.

**Verify:** Add a unit test that simulates 1000 games with a fixed seed and asserts:
- `blowouts / total` in `[0.12, 0.18]`.
- `winner_score` in `[3, 12]` for every game.

---

### 2.13 Fix the 1/500 hits-less-than-runs edge case

**File:** `baseball-dynasty/server/sim/game.ts`, lines 222-233.
**Bug:** `if (homeHits < homeScore - homeWalks)` — the deficit branch correctly bumps walks, but the check is `<` so if `homeHits === homeScore - homeWalks` exactly (boundary), it does nothing. The actual spec rule is `team_hits >= team_runs - team_walks` (which is satisfied when `hits === runs - walks`). Inspection of the API tester's evidence (game #163: home_score=11, home_hits=10) suggests the issue is that the `distributeExtraWalks` function may not always add the requested number due to floor() / array index logic, OR the bumped walks happen *after* `homeWalks` was already captured.

**Fix step A:** Make the bump unconditional when there is any deficit, and refresh the local `homeWalks` count from the array sum *after* `distributeExtraWalks`:
```ts
if (homeHits < homeScore - homeWalks) {
  const deficit = (homeScore - homeWalks) - homeHits;
  distributeExtraWalks(homeBatterLines, deficit, rng);
  homeWalks = homeBatterLines.reduce((s, b) => s + b.walks, 0);
}
if (awayHits < awayScore - awayWalks) {
  const deficit = (awayScore - awayWalks) - awayHits;
  distributeExtraWalks(awayBatterLines, deficit, rng);
  awayWalks = awayBatterLines.reduce((s, b) => s + b.walks, 0);
}
```

**Fix step B:** Combined with the §1.5 fix (post-generation validateBoxScore + retry), the runtime gate will catch any remaining edge case.

**Verify:** Sim 500 games. For every game in `game_log`: `home_hits + home_walks >= home_score AND away_hits + away_walks >= away_score`.

---

### 2.14 Fix `POST /api/league/new` response shape

**File:** `baseball-dynasty/server/index.ts`, lines 79-90, and `baseball-dynasty/server/sim/engine.ts` (the `startNewLeague` function).

**Three sub-bugs:**
1. Returns HTTP 201; spec requires 200.
2. Response is `{leagueId, worldgenSeed}`; spec requires `{leagueId, phase: "draft"}`.
3. The phase persisted in DB is `'expansion_draft'`; spec wants the phase value `'draft'` in the API response (the DB can keep `'expansion_draft'` internally).

**Fix:**
```ts
app.post('/api/league/new', rateLimitLeagueNew, validateBody(NewLeagueBody), async (req, res, next) => {
  try {
    const result = await startNewLeague(req.body);
    res.status(200).json({ leagueId: result.leagueId, phase: 'draft' });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'LEAGUE_EXISTS') {
      res.status(409).json({ error: 'League already exists. Use /api/league/reset to start over.' });
      return;
    }
    next(err);
  }
});
```

Also: make the API surface a `phase: "draft"` value in `GET /api/state` whenever `league.phase === 'expansion_draft' || league.phase === 'annual_draft'`. Map internally:
- DB phase `'expansion_draft'` → API phase `'draft'`
- DB phase `'annual_draft'` → API phase `'draft'`
- DB phase `'regular_season'` → API phase `'regular_season'`
- DB phase `'playoffs'` → API phase `'playoffs'`
- DB phase `'offseason'` → API phase `'offseason'`

Apply the mapping in `server/sim/engine.ts` where `LeagueStateSnapshot.phase` is set.

**Verify:** `curl -X POST http://127.0.0.1:3001/api/league/new -H "Content-Type: application/json" -d '{}'` returns:
```
HTTP/1.1 200 OK
{"leagueId":1,"phase":"draft"}
```

---

### 2.15 Fix `GET /api/players/leaders` response shape

**File:** `baseball-dynasty/server/routes/players.ts`, lines 9-84.
**Bug:** Current response is `{battingAvg, homeRuns, rbi, era, strikeouts, whip}` with each row as `{id, first_name, last_name, team_name, team_id, value}`. Spec requires `{hitting: [...], pitching: [...]}` with each row as `{player_name, team_name, stat_value}`.

**Fix:** Restructure the response. Group batting categories under `hitting`, pitching categories under `pitching`. Use `player_name = first_name + ' ' + last_name`. Rename `value` to `stat_value`. Also raise the min-AB threshold to 100 (currently 50) and min-IP to 30 (currently 20) so leaders show realistic ranges after a 50-game season.

```ts
playersRouter.get('/leaders', async (req, res, next) => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json({ hitting: [], pitching: [] }); return; }

    const season = league.season_number;

    // Helper that wraps a query result row into the spec shape
    type LeaderRow = { first_name: string; last_name: string; team_name: string; value: number; category: string; };
    const mapLeader = (row: LeaderRow) => ({
      player_name: `${row.first_name} ${row.last_name}`,
      team_name: row.team_name,
      stat_value: row.value,
      category: row.category,
    });

    const battingAvg = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
              CAST(ss.hits AS REAL) / NULLIF(ss.at_bats, 0) as value,
              'AVG' as category
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.at_bats >= 100
       ORDER BY value DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader);

    const homeRuns = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
              ss.home_runs as value, 'HR' as category
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ?
       ORDER BY ss.home_runs DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader);

    const rbi = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
              ss.rbi as value, 'RBI' as category
       FROM season_stats ss JOIN players p ON p.id = ss.player_id LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ?
       ORDER BY ss.rbi DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader);

    const era = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
              (ss.earned_runs * 9.0) / ss.innings_pitched as value, 'ERA' as category
       FROM season_stats ss JOIN players p ON p.id = ss.player_id LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched >= 30
       ORDER BY value ASC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader);

    const strikeouts = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
              ss.strikeouts_pitching as value, 'K' as category
       FROM season_stats ss JOIN players p ON p.id = ss.player_id LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched > 0
       ORDER BY ss.strikeouts_pitching DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader);

    const whip = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
              (ss.walks_pitching + ss.hits) / ss.innings_pitched as value, 'WHIP' as category
       FROM season_stats ss JOIN players p ON p.id = ss.player_id LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched >= 30
       ORDER BY value ASC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader);

    res.json({
      hitting: [...battingAvg, ...homeRuns, ...rbi],
      pitching: [...era, ...strikeouts, ...whip],
    });
  } catch (err) { next(err); }
});
```

**Verify:** `curl http://127.0.0.1:3001/api/players/leaders` returns:
```json
{"hitting":[{"player_name":"Juan Garcia","team_name":"Silverpine Permafrost","stat_value":0.342,"category":"AVG"}, ...],"pitching":[{"player_name":"...","team_name":"...","stat_value":2.85,"category":"ERA"}, ...]}
```

Also update the `Players.tsx` view to consume the new shape.

---

### 2.16 Fix the four error messages to match spec exactly

The spec mandates exact error message strings. The build-rules.md §"Spec Quality Standards" requires "Every error message string verbatim."

**Files:** `baseball-dynasty/server/routes/teams.ts`, `players.ts`, and `baseball-dynasty/server/index.ts`.

#### 2.16.1 `GET /api/teams/:id` not found
**File:** `server/routes/teams.ts`, line 38.
**Current:** `res.status(404).json({ error: 'not_found' });`
**Fix:** `res.status(404).json({ error: 'Team not found' });`

#### 2.16.2 `GET /api/players/:id` not found
**File:** `server/routes/players.ts`, line 120.
**Current:** `res.status(404).json({ error: 'not_found' });`
**Fix:** `res.status(404).json({ error: 'Player not found' });`

#### 2.16.3 `POST /api/sim/speed` invalid speed
**File:** `server/index.ts`, the `validateBody` middleware behaviour for the `SimSpeedBody` schema (line 31-41).
**Current:** Returns the generic `{"error":"invalid_body","details": <Zod error>}`.
**Fix:** Add a route-specific error responder that returns the exact spec string when the Zod failure is on the `speed` field of `SimSpeedBody`. The cleanest fix: replace the generic `validateBody(SimSpeedBody)` on the `/api/sim/speed` route with a route-specific validator:

```ts
app.post('/api/sim/speed', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = SimSpeedBody.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid speed. Must be paused|normal|fast|turbo' });
      return;
    }
    await setSimSpeed(result.data.speed);
    res.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'NO_ACTIVE_LEAGUE') {
      res.status(409).json({ error: 'no_active_league' });
      return;
    }
    next(err);
  }
});
```

#### 2.16.4 `POST /api/league/new` when league exists
**File:** `server/index.ts`, line 84-86.
**Current:** `res.status(409).json({ error: 'active_league_exists', message: 'An active league already exists. DELETE /api/league/current first.' });`
**Fix:** `res.status(409).json({ error: 'League already exists. Use /api/league/reset to start over.' });`

Note: the spec error message references `/api/league/reset` but the implemented endpoint is `DELETE /api/league/current`. **Add an alias route** so both work:

```ts
app.post('/api/league/reset', async (_req, res, next) => {
  try {
    await deleteCurrentLeague();
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

Update the client's "Start New Dynasty" flow to call `POST /api/league/reset` (or keep using `DELETE /api/league/current` — either works now that both exist).

**Verify all four:**
```
curl http://127.0.0.1:3001/api/teams/99999
→ HTTP 404 {"error":"Team not found"}

curl http://127.0.0.1:3001/api/players/99999
→ HTTP 404 {"error":"Player not found"}

curl -X POST http://127.0.0.1:3001/api/sim/speed -H "Content-Type: application/json" -d '{"speed":"warp"}'
→ HTTP 400 {"error":"Invalid speed. Must be paused|normal|fast|turbo"}

# First create a league, then attempt to create another:
curl -X POST http://127.0.0.1:3001/api/league/new -H "Content-Type: application/json" -d '{}'
curl -X POST http://127.0.0.1:3001/api/league/new -H "Content-Type: application/json" -d '{}'
→ Second call: HTTP 409 {"error":"League already exists. Use /api/league/reset to start over."}
```

---

## 3. Spec-Compliance Response Shape Fixes

### 3.1 Add `abbreviation` to team responses

**Files:** `baseball-dynasty/server/migrations/`, `server/routes/teams.ts`, `server/sim/worldgen.ts`.

**Bug:** Spec requires every team to have an `abbreviation` field. The DB schema has no `abbreviation` column and the API doesn't return one.

**Fix step A:** Create a new migration `server/migrations/003_team_abbreviation.sql`:
```sql
ALTER TABLE teams ADD COLUMN abbreviation TEXT;
```

**Fix step B:** In `server/sim/worldgen.ts`, generate an abbreviation for each team. Rule: take the first 3 letters of the team nickname, uppercased; if a collision occurs with another team in the same league, take the first 2 letters of the city + first letter of nickname.
```ts
function generateAbbreviation(nickname: string, city: string, takenAbbrevs: Set<string>): string {
  let abbrev = nickname.slice(0, 3).toUpperCase();
  if (!takenAbbrevs.has(abbrev)) {
    takenAbbrevs.add(abbrev);
    return abbrev;
  }
  abbrev = (city.slice(0, 2) + nickname.slice(0, 1)).toUpperCase();
  let suffix = 0;
  while (takenAbbrevs.has(abbrev)) {
    suffix++;
    abbrev = (city.slice(0, 2) + suffix).toUpperCase();
    if (suffix > 99) break; // safety
  }
  takenAbbrevs.add(abbrev);
  return abbrev;
}
```
Call it inside the worldgen team-insert loop and pass the abbreviation to the INSERT.

**Fix step C:** Update both team routes (`teams.ts`) to include `abbreviation` in the response. For both `GET /api/teams` and `GET /api/teams/:id`:
```ts
abbreviation: t.abbreviation,
```

**Verify:** `curl http://127.0.0.1:3001/api/teams | jq '.[0].abbreviation'` returns a 3-character uppercase string. All 20 teams have unique abbreviations.

---

### 3.2 Return `gm_personality` as a nested object

**File:** `baseball-dynasty/server/routes/teams.ts`, lines 40-62 (the `GET /api/teams/:id` handler).

**Bug:** Returns flat `gmPhilosophy`, `gmRiskTolerance`, `gmFocus`. Spec wants nested:
```json
"gm_personality": {
  "philosophy": "win-now",
  "risk_tolerance": "aggressive",
  "focus": "pitching"
}
```

**Note:** The DB schema (flat columns) and the LLM prompt builder do not change — they were correct per D1 (flat storage). Only the API serializer changes.

**Fix:**
```ts
res.json({
  id: team.id,
  name: team.name,
  city: team.city,
  abbreviation: team.abbreviation,
  region: team.region,
  conference: team.conference,
  division: team.division,
  wins: team.wins,
  losses: team.losses,
  runs_scored: team.runs_scored,
  runs_allowed: team.runs_allowed,
  market_size: team.market_size,
  color: team.color,
  gm_name: team.gm_name,
  gm_personality: {
    philosophy: team.gm_philosophy,
    risk_tolerance: team.gm_risk_tolerance,
    focus: team.gm_focus,
  },
  manager_name: team.manager_name,
  owner_name: team.owner_name,
  payroll_budget: team.payroll_budget,
  current_payroll: team.current_payroll,
  revenue: team.revenue,
  minors: { /* see §3.3 */ },
});
```

Also flip all camelCase field names in this route to snake_case to match spec. The internal codebase can keep camelCase types in `shared/types.ts`, but the API layer normalizes to snake_case at the boundary.

**Verify:**
```
curl http://127.0.0.1:3001/api/teams/1 | jq '.gm_personality'
→ {"philosophy":"win-now","risk_tolerance":"aggressive","focus":"pitching"}
```

---

### 3.3 Embed `minors` object in `GET /api/teams/:id`

**File:** `baseball-dynasty/server/routes/teams.ts`.

**Bug:** Spec wants the team detail response to include `minors: { AAA: [], AA: [], A: [], Rookie: [] }` as a nested object grouping players by minor level. Current `GET /api/teams/:id/minors` returns a flat array.

**Fix:** Add a helper inside `GET /api/teams/:id` to query minors and group them by `minor_level`:
```ts
const minorsRaw = prepared(
  'SELECT id, first_name, last_name, age, position, overall_rating, potential, minor_level FROM players WHERE team_id = ? AND is_on_mlb_roster = 0 AND is_drafted = 1'
).all(team.id) as Array<{ id: number; first_name: string; last_name: string; age: number; position: string; overall_rating: number; potential: string; minor_level: string }>;

const minors: Record<string, typeof minorsRaw> = { AAA: [], AA: [], A: [], Rookie: [] };
for (const p of minorsRaw) {
  const level = p.minor_level ?? 'Rookie';
  if (minors[level]) minors[level]!.push(p);
}
```

Include `minors` in the response object. Keep the `GET /api/teams/:id/minors` route as well (it can return either the flat array or the grouped object; pick the grouped object for consistency).

**Verify:**
```
curl http://127.0.0.1:3001/api/teams/1 | jq '.minors | keys'
→ ["A","AA","AAA","Rookie"]
```

---

### 3.4 Fix `GET /api/timeline` response shape

**File:** `baseball-dynasty/server/routes/timeline.ts`.

**Bug:** Current response is camelCase. Spec requires snake_case, plus a `notable_events` field per season.

**Fix:** Rewrite the response mapper. Pull aggregated notable events per season from `game_log.notable_events_json`:
```ts
const seasons = prepared(
  `SELECT sn.season_number, sn.narrative,
          t.id as champion_team_id,
          t.city || ' ' || t.name as champion_team_name,
          p.id as mvp_player_id,
          p.first_name || ' ' || p.last_name as mvp_player_name
   FROM season_narratives sn
   LEFT JOIN teams t ON t.id = sn.champion_team_id
   LEFT JOIN players p ON p.id = sn.mvp_player_id
   WHERE sn.league_id = ?
   ORDER BY sn.season_number DESC`
).all(league.id) as Array<{...}>;

// For each season, pull top 5 notable events from game_log
const result = seasons.map(s => {
  const eventsRaw = prepared(
    `SELECT notable_events_json FROM game_log
     WHERE league_id = ? AND season_number = ? AND notable_events_json != '[]'
     LIMIT 100`
  ).all(league.id, s.season_number) as Array<{ notable_events_json: string }>;
  const allEvents: unknown[] = [];
  for (const row of eventsRaw) {
    try {
      const arr = JSON.parse(row.notable_events_json);
      if (Array.isArray(arr)) allEvents.push(...arr);
    } catch { /* ignore */ }
  }
  // Take the top 10 most "interesting" events (you can simply slice the first 10)
  const top = allEvents.slice(0, 10);

  return {
    season_number: s.season_number,
    champion_team_id: s.champion_team_id,
    champion_team_name: s.champion_team_name,
    mvp_player_id: s.mvp_player_id,
    mvp_player_name: s.mvp_player_name,
    narrative: s.narrative,
    year: 2025 + s.season_number,
    notable_events: top,
  };
});

res.json(result);
```

Update `client/src/views/Timeline.tsx` to consume snake_case fields (`season_number`, `champion_team_name`, `notable_events`).

**Verify:** `curl http://127.0.0.1:3001/api/timeline | jq '.[0] | keys'` returns an array containing `notable_events`, `season_number`, `champion_team_name`.

---

### 3.5 Fix `GET /api/state` pre-league shape

**File:** `baseball-dynasty/server/index.ts`, lines 64-77.

**Bug:** When no league exists, returns `{"noLeague": true}` — missing `phase`, `seasonNumber`, `simSpeed` fields that the spec requires to always be present.

**Fix:**
```ts
app.get('/api/state', async (req, res, next) => {
  try {
    const sincePickId = req.query['sincePickId'] ? parseInt(String(req.query['sincePickId']), 10) : 0;
    const sinceGameId = req.query['sinceGameId'] ? parseInt(String(req.query['sinceGameId']), 10) : 0;
    const state = await getActiveLeagueState(sincePickId, sinceGameId);
    if (!state) {
      res.json({
        leagueId: null,
        phase: 'no_league',
        seasonNumber: 0,
        simSpeed: 'paused',
        noLeague: true,
        currentGameDate: 0,
        currentGameNumber: 0,
        lastPickId: 0,
        lastGameId: 0,
        llmStatus: { dailyBudgetRemaining: 2000, circuitBreakerOpen: false, retryAfterMs: 0 },
        worldgenSeed: 0,
        picksDelta: [],
        gamesDelta: [],
      });
      return;
    }
    res.json(state);
  } catch (err) { next(err); }
});
```

**Verify:** Start a fresh DB → `curl http://127.0.0.1:3001/api/state | jq '.phase'` returns `"no_league"` (not undefined or missing).

---

## 4. Medium Fixes

### 4.1 Replace remaining `Date.now()` seed sources with deterministic seeds

**Files:** `baseball-dynasty/server/sim/offseason.ts` line 175; `baseball-dynasty/server/sim/draft.ts` line 232.

**Bug:** Both use `seedFor('...', Date.now())` inside loops or rare code paths, violating D7 determinism.

**Fix offseason.ts:175 — FA contract years:**
Use the player's id as the deterministic input, combined with the season + league worldgen_seed:
```ts
// At top of free_agency step, get the league once:
// const fa_seed_base = league.worldgen_seed ^ league.season_number;

// Inside the loop, per player:
const contractYears = randInt(seedFor(`fa_contract_${player.id}`, fa_seed_base), 1, 3);
```

**Fix draft.ts:232 — exhausted-pool replacement:**
```ts
// Use the team_id + round + pickNumber as the input:
const rng = seedFor(`draft_fill_${teamId}_${round}_${pickNumber}`, league.worldgen_seed);
```

**Verify:** Re-run the determinism test (see §6.1) — back-to-back runs produce identical FA distributions and identical replacement-player names.

---

### 4.2 Fix the hardcoded `season_number = 1` in FA signing transactions

**File:** `baseball-dynasty/server/sim/offseason.ts`, line 181-187.

**Bug:** `INSERT INTO transactions (..., season_number, ...) VALUES (..., 1, ...)` — hardcodes 1.

**Fix:** Pass through the actual season number from the league row at the top of the step:
```ts
const seasonNumber = league.season_number;
// ...
db.prepare(
  'INSERT INTO transactions (league_id, season_number, transaction_type, team_id, player_id, narrative, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
).run(leagueId, seasonNumber, 'free_agent_signing', team.id, player.id, narrative, Date.now());
```

Search the entire `offseason.ts` for any other hardcoded `season_number` integers and fix them.

**Verify:** After sim into season 2 and an FA signing occurs: `SELECT season_number FROM transactions WHERE transaction_type = 'free_agent_signing' ORDER BY id DESC LIMIT 1` returns `2` (or whatever the current season is).

---

### 4.3 Fix the inter-conference schedule both-zero-quota edge case

**File:** `baseball-dynasty/server/sim/season.ts`, lines 81-108.

**Bug:** When both `aQuota` and `nQuota` reach zero simultaneously, the algorithm falls into the else branch and assigns `homeTeam = nTeam`, taking nTeam's quota negative. The 25/25 invariant can break silently.

**Fix:** Add an explicit both-zero branch that rolls back the most-recent assignment and retries with the swap, OR — simpler — re-run the entire inter-conference assignment with a different initial sort order if the final quotas don't balance. Pseudocode:
```ts
function assignInterConferenceHomeAway(/* ... */) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = tryAssign(/* ... */);
    if (validateBalance(result)) return result;
  }
  throw new Error('Inter-conference schedule could not balance 25H/25A within 5 attempts');
}
```

Where `tryAssign` shuffles the pair iteration order with a sub-stream (`seedFor('schedule_attempt_${attempt}', baseSeed)`) and `validateBalance` checks that every team has exactly 25 home + 25 away.

Also: **change the schedule test (`server/tests/schedule.test.ts`) so it actually calls `generateSchedule` from the production code**, not its own re-implementation. The test currently re-implements the algorithm; that's why the production bug isn't caught.

**Verify:** New test (see §6.3) asserts: for 100 different seeds, every team has exactly 25 home and 25 away games.

---

### 4.4 Fix the tiebreaker comparator memoization

**File:** `baseball-dynasty/server/sim/playoffs.ts`, lines 31-59.

**Bug:** `compareTeams` returns `rng() > 0.5 ? 1 : -1` at the final tiebreaker. JavaScript `Array.prototype.sort` may call the comparator multiple times for the same (a,b) pair; non-deterministic returns produce undefined sort behavior.

**Fix:** Memoize the coin-flip result per unordered pair:
```ts
const tiebreakerCache = new Map<string, number>();
function pairKey(a: TeamRow, b: TeamRow): string {
  const lo = Math.min(a.id, b.id);
  const hi = Math.max(a.id, b.id);
  return `${lo}_${hi}`;
}

function compareTeams(a: TeamRow, b: TeamRow, league: LeagueRow, rng: () => number): number {
  // ... existing checks for win pct, H2H, run diff ...

  // Final tiebreaker: memoized coin flip per pair
  const key = pairKey(a, b);
  if (!tiebreakerCache.has(key)) {
    tiebreakerCache.set(key, rng() > 0.5 ? 1 : -1);
  }
  const cached = tiebreakerCache.get(key)!;
  // The cached value represents "lower id team is preferred (returns -1)" or vice versa.
  // We need to flip the sign if (a,b) is in reversed order from (lo,hi).
  return a.id < b.id ? cached : -cached;
}
```

Important: clear the cache between leagues / between calls to `buildPlayoffBracket`. Either make `tiebreakerCache` a local Map inside `buildPlayoffBracket` and pass it down, or clear it at the top of `buildPlayoffBracket`.

**Verify:** Sort the same array of tied teams 10 times in a row — final order is identical.

---

### 4.5 Improve PAV candidate pool (LIMIT 50 misses scarce positions)

**File:** `baseball-dynasty/server/sim/draft.ts`, lines 104-106.

**Bug:** `LIMIT 50 ORDER BY overall_rating DESC` filters out catchers, SSes, CFs, and SPs whose effective PAV (with the +5 to +12 scarcity bonus) would beat in-prefix players.

**Fix:** Pull the top 50 by `overall_rating + scarcity_bonus` directly in SQL:
```ts
const topAvailable = prepared(
  `SELECT *, (overall_rating + CASE position
     WHEN 'C' THEN 5
     WHEN 'SS' THEN 4
     WHEN 'CF' THEN 3
     WHEN 'CL' THEN 4
     WHEN 'SP' THEN MAX(0, (overall_rating - 60) * 0.6)
     ELSE 0
   END) as estimated_pav
   FROM players
   WHERE league_id = ? AND is_drafted = 0 AND overall_rating >= ? AND overall_rating <= ?
   ORDER BY estimated_pav DESC LIMIT 50`
).all(leagueId, ratingMin, ratingMax) as Array<PlayerRow & { estimated_pav: number }>;
```

Then sort by full PAV (with age bonus) in JS and slice to top 10.

**Verify:** Add a test that constructs a player pool with several 65-rated catchers and many 70-rated LFs, then asserts the top 10 includes at least one catcher.

---

### 4.6 Strengthen `sanitizeNarrative` (loop strips until stable)

**File:** `baseball-dynasty/server/services/llm.ts`, lines 144-152.

**Bug:** Single-pass replaces have known bypasses (e.g., `<<script>script>alert(1)</script>` → `script>alert(1)`).

**Fix:**
```ts
export function sanitizeNarrative(s: string): string {
  if (typeof s !== 'string') return '';
  // Strip control chars first
  let cur = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Loop HTML and protocol strips until input is stable
  let prev: string;
  do {
    prev = cur;
    cur = cur
      .replace(/<[^>]*>?/g, '')          // tolerate missing closing >
      .replace(/javascript:/gi, '')
      .replace(/data:/gi, '')
      .replace(/vbscript:/gi, '');
  } while (cur !== prev);
  return cur.slice(0, 280).trim();
}
```

**Verify:** Existing tests in `server/tests/llmParser.test.ts` should still pass; add new test cases for the three bypass inputs:
- `'<<script>script>alert(1)</script>'` → no `<`, `>`, `script` substring remaining.
- `'<script'` → no `<` or `script` remaining.
- `'jajavascript:vascript:alert(1)'` → no `javascript:` remaining.

---

### 4.7 Move the rate-limit timestamp set to after success

**File:** `baseball-dynasty/server/index.ts`, lines 44-53 (the `rateLimitLeagueNew` middleware) and the handler at 79-90.

**Bug:** The middleware sets `lastLeagueCreateMs = now` before `validateBody` runs. A request with a malformed body consumes the 30-second window without doing any work.

**Fix:** Remove the assignment from the middleware. Set it inside the route handler only after `startNewLeague` succeeds:
```ts
function rateLimitLeagueNew(_req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  if (now - lastLeagueCreateMs < 30_000) {
    res.status(429).json({ error: 'rate_limited', retryAfterMs: 30_000 - (now - lastLeagueCreateMs) });
    return;
  }
  next();
}

app.post('/api/league/new', rateLimitLeagueNew, validateBody(NewLeagueBody), async (req, res, next) => {
  try {
    const result = await startNewLeague(req.body);
    lastLeagueCreateMs = Date.now();  // ← set only on success
    res.status(200).json({ leagueId: result.leagueId, phase: 'draft' });
  } catch (err) {
    if (err instanceof Error && err.message === 'LEAGUE_EXISTS') {
      lastLeagueCreateMs = Date.now();  // also lock on legitimate 409, so retry storms are throttled
      res.status(409).json({ error: 'League already exists. Use /api/league/reset to start over.' });
      return;
    }
    next(err);
  }
});
```

**Verify:** `curl -X POST http://127.0.0.1:3001/api/league/new -H "Content-Type: application/json" -d '{"seed":"not-a-number"}'` returns 400. A second valid request immediately afterward returns 200 (or 409) — *not* 429.

---

## 5. Low / Cleanup

### 5.1 Extract `scrubError` to a shared util

**Files:** `server/index.ts:159-167`, `server/services/llm.ts:155-163`.
Create `server/util/scrub.ts` with the canonical `scrubError`. Import from both call sites. Add `bearer` token redaction to the regex set for future-proofing:
```ts
export function scrubError(err: unknown): { code: string; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as Record<string, unknown>)?.['status'] ? `http_${(err as Record<string, unknown>)['status']}` : 'server_error';
  const scrubbed = msg
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/authorization[^,}\n]*/gi, 'authorization: [REDACTED]')
    .replace(/x-api-key[^,}\n]*/gi, 'x-api-key: [REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9_-]+/gi, 'bearer [REDACTED]');
  return { code, message: scrubbed };
}
```

### 5.2 Replace raw `console.error('[engine] error:', err)` with scrubbed messages

**Files:** `server/sim/engine.ts` lines ~238, 297, 348, 356 and `server/index.ts` line 183.
Replace each occurrence:
```ts
console.error('[engine] Tick error:', scrubError(err).message);
```

### 5.3 Size-cap `notable_events` descriptions

**File:** `server/sim/game.ts`, the `generateNotableEvents` block (around line 280).
After building the array, before the `.length > 20` cap:
```ts
notableEvents.forEach((e: any) => {
  if (typeof e.description === 'string' && e.description.length > 500) {
    e.description = e.description.slice(0, 500);
  }
});
```

### 5.4 Generate a procedural MVP for season_narratives

**File:** `server/sim/playoffs.ts`, around lines 144-148.
After determining `worldSeriesWinner`, query the highest-OPS hitter on the winning team and the lowest-ERA pitcher; pick whichever stat is more impressive (procedural rule: hitter MVP if `winning_team_highest_OPS > 0.950`, else pitcher MVP). Update the INSERT:
```ts
const mvp = pickSeasonMVP(leagueId, league.season_number, winnerId);
prepared('INSERT OR REPLACE INTO season_narratives (league_id, season_number, champion_team_id, mvp_player_id) VALUES (?, ?, ?, ?)')
  .run(leagueId, league.season_number, winnerId, mvp?.id ?? null);
```
Implement `pickSeasonMVP` as a small query + select.

### 5.5 Count *successful* LLM calls in the daily budget

**File:** `server/services/llm.ts`, line ~212.
Move `recordLlmCall()` from before the API call to after a successful response (or move it into the `try` block after `client.messages.create()` resolves). On error, do NOT increment.

### 5.6 Remove `version` field from `/healthz` once CB-1 is fixed

**File:** `server/index.ts`, lines 56-62. Keep the field — it's fine once localhost-bind is in place. No action required. (CISO ranked this contingent on CB-1.)

---

## 6. Required New Tests

Add these tests in `server/tests/`. They are the gates that prevent regressions in Iteration 3+.

### 6.1 Determinism replay test
**File:** `server/tests/determinism.test.ts` (new).
- Generate world with `seed: 12345`.
- Run expansion draft.
- Simulate a 50-game season.
- Capture every game's box score (hits, runs, walks, every batter line, every pitcher line) into a checksum.
- Wipe the DB.
- Re-run with the same seed.
- Assert the checksum is identical.

This test is the AB-02 regression gate.

### 6.2 Box-score validator runtime invocation test
**File:** `server/tests/boxScore.test.ts` (extend existing).
- Sim 500 games against a fixed seed.
- For every `game_log` row, run `validateBoxScore` with the actual team IDs and scores.
- Assert zero validation errors across all 500 games.

This test is the AB-03 + hits-less-than-runs regression gate.

### 6.3 Schedule production-path test
**File:** `server/tests/schedule.test.ts` (replace the existing re-implementation).
- For 100 different seeds, call the actual production `generateSchedule(leagueId)`.
- For each generated schedule:
  - Assert exactly 500 total games (20 teams × 50 / 2).
  - Assert every team has exactly 50 games.
  - Assert every team has exactly 25 home and 25 away games.
  - Assert exactly 36 intra-conference games and 14 inter-conference games per team.

### 6.4 Trade-deadline test
**File:** `server/tests/tradeDeadline.test.ts` (new).
- Generate a league, run expansion draft, sim regular season to game 30.
- Assert no `trade_deadline` row in transactions.
- Continue sim to game 35 (median team).
- Assert exactly one `trade_deadline` row for the season.
- Continue sim to game 50.
- Assert still exactly one `trade_deadline` row (not duplicated).

### 6.5 Playoff isolation test
**File:** `server/tests/playoffIsolation.test.ts` (new).
- Sim a season through playoffs.
- Capture `teams.wins` for all 20 teams immediately before playoffs start.
- Run playoffs.
- Assert `teams.wins` is unchanged from the captured snapshot.
- Assert `playoff_series` table has exactly 7 rows for the season.

### 6.6 Annual draft order test
**File:** `server/tests/annualDraftOrder.test.ts` (new).
- Sim into season 2.
- Assert pick 1 of round 1 of the annual draft is the team with the lowest wins in season 1.
- Assert pick 20 of round 1 is the team with the highest wins (or the World Series champion if AB-08 fix is implemented correctly).

### 6.7 Draft resume test
**File:** `server/tests/draftResume.test.ts` (new).
- Start an expansion draft, run 200 picks.
- Pause.
- Resume.
- Assert `SELECT COUNT(*) FROM draft_picks WHERE league_id = ? AND season_number = 1 AND is_expansion = 1` returns exactly 600 after completion.
- Assert no duplicate `(league_id, round, pick_number)` rows.

### 6.8 Market-size quota test
Already documented in §2.11. Add to `server/tests/worldgen.test.ts`.

### 6.9 Blowout rate test
Already documented in §2.12. Add to `server/tests/boxScore.test.ts`.

### 6.10 Sanitizer bypass test
Already documented in §4.6. Add cases to `server/tests/llmParser.test.ts`.

---

## 7. Definition of Done — Iteration 2

The Architect will issue COMPLETE only when ALL of the following are true. The Developer must verify each before declaring the iteration finished and re-spawning reviewers.

### 7.1 Build and test gates
- [ ] `cd baseball-dynasty && npx tsc --noEmit -p tsconfig.server.json` exits with zero errors.
- [ ] `cd baseball-dynasty && npm run test` passes — all 97 existing tests + the new tests in §6 (target: 110+ tests, 0 failures).
- [ ] `cd baseball-dynasty && npm run lint` passes.
- [ ] `cd baseball-dynasty && npm run security:sql-grep` passes.
- [ ] `cd baseball-dynasty && npm run build` succeeds; `npm run security:bundle-grep` passes.

### 7.2 Server startup
- [ ] `cd baseball-dynasty && npx tsx server/index.ts` starts without crashing.
- [ ] Server log shows `[server] Baseball Dynasty server running on http://127.0.0.1:3001 (localhost only)`.
- [ ] `lsof -i :3001` shows the listener bound to `127.0.0.1:3001`, not `*:3001` or `0.0.0.0:3001`.
- [ ] `curl http://127.0.0.1:3001/healthz` returns `{"ok":true,"version":"0.1.0"}`.

### 7.3 API contract gates
- [ ] `curl -X POST http://127.0.0.1:3001/api/league/new -H "Content-Type: application/json" -d '{}'` returns **HTTP 200** with body `{"leagueId":1,"phase":"draft"}`.
- [ ] After a league is created, a second `POST /api/league/new` returns **HTTP 409** with body `{"error":"League already exists. Use /api/league/reset to start over."}`.
- [ ] `curl http://127.0.0.1:3001/api/teams/99999` returns **HTTP 404** with body `{"error":"Team not found"}`.
- [ ] `curl http://127.0.0.1:3001/api/players/99999` returns **HTTP 404** with body `{"error":"Player not found"}`.
- [ ] `curl -X POST http://127.0.0.1:3001/api/sim/speed -H "Content-Type: application/json" -d '{"speed":"warp"}'` returns **HTTP 400** with body `{"error":"Invalid speed. Must be paused|normal|fast|turbo"}`.
- [ ] `GET /api/teams` and `GET /api/teams/:id` include `abbreviation`.
- [ ] `GET /api/teams/:id` includes `gm_personality` as a nested object with `philosophy`, `risk_tolerance`, `focus`.
- [ ] `GET /api/teams/:id` includes a nested `minors: { AAA: [], AA: [], A: [], Rookie: [] }` object.
- [ ] `GET /api/players/leaders` returns `{hitting: [...], pitching: [...]}` with each entry having `player_name`, `team_name`, `stat_value`.
- [ ] `GET /api/timeline` entries include `notable_events` and use snake_case field names.
- [ ] `GET /api/state` before any league returns an object with `phase`, `seasonNumber`, `simSpeed` (not just `{noLeague: true}`).

### 7.4 Functional smoke test (manual end-to-end)
- [ ] Start a new dynasty → expansion draft runs to completion → 600 picks in `draft_picks` with no duplicate `(round, pick_number)` rows.
- [ ] After draft completes, send `POST /api/sim/speed {speed:"normal"}` → games start accumulating within 5 seconds.
- [ ] Sim a full 50-game season at Turbo → standings populated, every team has exactly 50 regular-season games.
- [ ] Trade deadline row recorded in `transactions` for the season.
- [ ] Playoffs run → `playoff_series` table populated with 7 rows → World Series champion recorded in `season_narratives`.
- [ ] After playoffs, `teams.wins` is unchanged from end-of-regular-season (no playoff contamination).
- [ ] Offseason runs → season 2 starts → annual draft order has the worst team picking first.
- [ ] Walk-off rate over 500 games is between 6% and 14% (not 54%).
- [ ] Blowout rate (winner score ≥ 8) over 500 games is between 12% and 18%.
- [ ] Determinism: sim a season with `seed=12345`, capture final standings + box scores; reset; re-sim; standings + box scores identical.

### 7.5 UI verification (Draft tab — Iteration 1's only known UI defect)
- [ ] During an expansion draft, the "On the Clock" badge shows a team that matches the next undrafted `pick_number`'s `team_id` in `draft_picks` order.
- [ ] Every draft cell has `data-testid="draft-pick-{round}-{pickNumber}"` where `pickNumber` is the DB pick_number (so round 2's leftmost cell is `draft-pick-2-40` for snake-reversed picks, not `draft-pick-2-21`).

### 7.6 Security verification
- [ ] No `sk-ant-*` substring in any API response (grep the network traffic during a Normal-speed draft).
- [ ] `sanitizeNarrative('<<script>script>alert(1)</script>')` returns a string with no `<`, `>`, or `script` substring.

---

## 8. What You Must NOT Do

- **Do not start the server** until §1.1 through §1.5 are applied.
- **Do not read test results, the CISO report, or the Adversary report.** All defects are translated into instructions in this file.
- **Do not skip any §1, §2, or §3 item.** These are all blockers for COMPLETE.
- **Do not change the database column names** (e.g., do not rename `gm_philosophy` → `gm_personality.philosophy` in the schema). The API serializer should produce nested shapes from flat columns; storage stays flat.
- **Do not merge to `main`.** Push commits to `feature/v0.1.0-initial-build` only.
- **Do not skip the new tests in §6.** They are the regression gates for Iteration 3.
- **Do not introduce new dependencies.** Stay within the pinned versions in `package.json`.

---

## 9. Commit Message Template

When you finish all fixes, commit with a message like:

```
fix(v0.1.0): iteration 2 — critical, high, and medium defect remediation

Critical:
- Fix engine.ts import of validatePostDraftRosters (from worldgen.js, not draft.js)
- Replace Math.random() with seeded rng in clampRBI (game.ts)
- Wire validateBoxScore into simulateGame; fix teamId vs score bug

High:
- Bind Express to 127.0.0.1
- Restrict walk-off flag to 18% of home wins; fix IP truncation
- Fix trade deadline SQL to count total games, not home games
- Add isPlayoff flag to simulateGame; record series in playoff_series table
- Move offseason wins-reset from front_office step to finalizeOffseason
- Make draft resume aware of last completed pick; add UNIQUE constraint
- Fix autoBalance reversed SQL parameter binding
- Draft.tsx: consume /api/draft/order and use spec-compliant data-testids
- Restart tick loop after expansion draft completes (regardless of prev speed)
- Fix market-size quota selection (2/4/8/6)
- Tighten triangular distribution to hit 12-18% blowout rate
- Fix all 4 API error message bodies to spec-verbatim strings
- Return phase "draft" + HTTP 200 on POST /api/league/new

Medium:
- Replace remaining Date.now() seeds with deterministic keys
- Fix hardcoded season_number=1 in FA transactions
- Add retry-on-imbalance to schedule generator
- Memoize tiebreaker comparator pair flip
- Improve PAV candidate pool query (include scarcity in SQL)
- Strengthen sanitizeNarrative with loop-until-stable strips
- Move rate-limit timestamp set to after successful league create
- Embed minors object + gm_personality nested object in /api/teams/:id
- Add abbreviation column + populate in worldgen
- Reshape /api/players/leaders and /api/timeline per spec

Adds:
- 7 new test files: determinism, box score runtime gate, schedule prod path,
  trade deadline, playoff isolation, annual draft order, draft resume
- Migration 002_draft_picks_unique.sql, 003_team_abbreviation.sql,
  002_playoff_series.sql (renumber as appropriate)
- Util scrub.ts (deduplicates scrubError)
- Route GET /api/draft/order, POST /api/league/reset alias

All 110+ tests pass. Server starts. All 4 error messages match spec. End-to-end
smoke test passes through season 2.
```

---

**End of developer-instructions-2.md. Apply fixes in order. Verify §7 before re-spawning reviewers.**
