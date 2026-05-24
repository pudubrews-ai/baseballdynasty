# Developer Instructions — Iteration 3 (Baseball Dynasty Simulator v0.1.0)

**Author:** Architect
**Audience:** Developer
**Base commit:** current HEAD on `feature/v0.1.0-initial-build`
**Inputs you read:** this file + `v0.1.0-app-spec-section.md`. **Nothing else.** Do NOT read any test results, the CISO report, the Adversary report, or any prior developer-instructions file — every requirement is consolidated here.

**Where this file conflicts with the spec, this file wins.**

---

## 0. Iteration 2 Recap (What's Done, What Remains)

Iteration 2 fixed every Iteration 1 server-side defect (Critical, High, and Medium). The server now starts, the API surface is mostly correct, and end-to-end simulation runs through to season 2. However, two new Critical regressions and several previously-undetectable defects are now visible:

1. The Draft tab does not render at all (client/server `phase` contract mismatch).
2. Clicking the Minors tab crashes the app with a TypeError.
3. The draft board never appears even after the phase mismatch is fixed, because the picks-streaming mechanism never bootstraps.
4. Draft pick timing ignores `currentSpeed` — picks fire as fast as the JS event loop allows.
5. `roster: []` always empty in `GET /api/teams/:id`.
6. The `playoffs` phase exists for milliseconds and is unobservable via 2s polling.
7. Player-leaders table shows "No data yet" forever (UI consumes old data shape).
8. Timeline cards show only the year, no champion (UI consumes old data shape).
9. Reconnecting banner never clears after a server recovery.
10. Several Medium fixes (transactional offseason, validator gate, scrubError dedup, rate-limit ordering).

This document is the authoritative work list for Iteration 3. Apply fixes in order. Critical first — the server should not be tested until Critical fixes are applied.

---

## 1. Critical Fixes — Must Apply First

### 1.1 Fix the client/server `phase` contract — Add `subPhase` to the snapshot

**Architect ruling:** Keep `mapPhase()` collapsing `expansion_draft`/`annual_draft` → `'draft'` on the API surface. Update the client to check for `'draft'`. Add a new `subPhase` field on the snapshot to preserve the expansion-vs-annual distinction for the UI title.

**Files:**
- `baseball-dynasty/shared/types.ts` — add `subPhase` to `LeagueStateSnapshot`
- `baseball-dynasty/server/sim/engine.ts` — populate `subPhase` in `refreshCache`
- `baseball-dynasty/client/src/views/Draft.tsx` — replace `phase === 'expansion_draft'` checks
- `baseball-dynasty/client/src/hooks/useLeagueState.ts` — fix polling-interval check

#### 1.1.1 Add `subPhase` to `LeagueStateSnapshot`

Open `baseball-dynasty/shared/types.ts`. Find the `LeagueStateSnapshot` interface. Add:

```ts
subPhase: 'expansion' | 'annual' | null;
```

#### 1.1.2 Populate `subPhase` in `refreshCache`

Open `baseball-dynasty/server/sim/engine.ts`. In the `refreshCache` function (around line 53), inside the existing `mapPhase` block (lines 58-68), keep `mapPhase` as-is. Then build a sibling helper:

```ts
function mapSubPhase(dbPhase: string): 'expansion' | 'annual' | null {
  if (dbPhase === 'expansion_draft') return 'expansion';
  if (dbPhase === 'annual_draft') return 'annual';
  return null;
}
```

Add `subPhase: mapSubPhase(league.phase)` to the `snapshot` object (around line 70-82).

#### 1.1.3 Fix `Draft.tsx` — check for `'draft'` not `'expansion_draft'`

Open `baseball-dynasty/client/src/views/Draft.tsx`.

- Line 89 — currently: `if (teams.length > 0 && state?.phase === 'expansion_draft') {`
  - Change to: `if (teams.length > 0 && state?.phase === 'draft') {`
- Line 107 — currently: `if (state?.phase !== 'expansion_draft' && state?.phase !== 'annual_draft') {`
  - Change to: `if (state?.phase !== 'draft') {`
- Line 123 — currently: `{state.phase === 'expansion_draft' ? 'Expansion Draft' : 'Annual Draft'}`
  - Change to: `{state.subPhase === 'expansion' ? 'Expansion Draft' : 'Annual Draft'}`

#### 1.1.4 Fix `useLeagueState.ts` — check for `'draft'`

Open `baseball-dynasty/client/src/hooks/useLeagueState.ts`. Line 89:
- Currently: `const isDraft = state?.phase === 'expansion_draft' || state?.phase === 'annual_draft';`
- Change to: `const isDraft = state?.phase === 'draft';`

**Verify:** Start a fresh dynasty, open the Draft tab. The board renders. The title shows "Expansion Draft" during season 1's first draft and "Annual Draft" in season 2's offseason draft. Polling cadence drops to 500ms during draft phases (network tab shows /api/state every 500ms).

---

### 1.2 Fix Draft.tsx team ordering and data-testid (carried from Iter 2)

**File:** `baseball-dynasty/client/src/views/Draft.tsx`

**Bug A:** Line 33 fetches `/api/teams` (ordered by `wins DESC`), then computes draft cells based on that list order. The actual draft order comes from `/api/draft/order` which the server now exposes but the client never calls.

**Bug B:** Line 194 uses `data-testid="draft-pick-${round}-${teamIdx + 1}"` (column index) instead of `pickNumber`. For even (snake-reversed) rounds, `teamIdx+1` != pickNumber.

#### 1.2.1 Fetch `/api/draft/order` and use it for cell rendering

Add after line 28 (after the existing useState declarations):

```tsx
const [teamOrder, setTeamOrder] = useState<number[]>([]);

useEffect(() => {
  if (state?.phase === 'draft') {
    fetch('/api/draft/order')
      .then(r => r.json())
      .then((data: { teamOrder: number[] }) => setTeamOrder(data.teamOrder || []))
      .catch(console.error);
  }
}, [state?.phase, state?.subPhase]);

const teamsInDraftOrder: TeamInfo[] = teamOrder.length > 0
  ? teamOrder.map(id => teams.find(t => t.id === id)).filter((t): t is TeamInfo => t !== undefined)
  : teams; // fallback to /api/teams order until draft order loads
```

#### 1.2.2 Replace `teams` with `teamsInDraftOrder` everywhere in the rendered table

- Line 89-92 (on-clock logic): use `teamsInDraftOrder` instead of `teams`.
- Line 95-100 (getPickForCell helper): use `teamsInDraftOrder.length` instead of `teams.length`.
- Line 167 (`{teams.map(team => (...)`) inside the `<thead>`: change to `{teamsInDraftOrder.map(team => (...)`.
- Line 189 (`{teams.map((team, teamIdx) => {`) inside the `<tbody>`: change to `{teamsInDraftOrder.map((team, teamIdx) => {`.

#### 1.2.3 Fix the data-testid to use actual `pickNumber`

Inside the `<tbody>` cell loop (around line 189-214), change line 194 from:
```tsx
data-testid={`draft-pick-${round}-${teamIdx + 1}`}
```
to:
```tsx
data-testid={`draft-pick-${round}-${getPickNumberForCell(round, teamIdx, teamsInDraftOrder.length)}`}
```

Add a helper above the `return` statement:
```tsx
const getPickNumberForCell = (round: number, teamIdx: number, totalTeams: number): number => {
  // Snake order: odd rounds forward, even rounds reversed
  const pickInRound = round % 2 === 1 ? teamIdx + 1 : (totalTeams - teamIdx);
  return (round - 1) * totalTeams + pickInRound;
};
```

**Verify:** Start a fresh dynasty. Open DevTools. In the Draft tab, inspect any cell:
- Round 1 leftmost cell: `data-testid="draft-pick-1-1"`
- Round 1 rightmost cell: `data-testid="draft-pick-1-20"`
- Round 2 leftmost cell (snake-reversed): `data-testid="draft-pick-2-40"` (NOT `draft-pick-2-21`)
- Round 2 rightmost cell: `data-testid="draft-pick-2-21"`

The on-clock team matches the team_id at `(SELECT team_id FROM draft_picks WHERE pick_number = MAX(pick_number) + 1)`.

---

### 1.3 Fix `picksDelta` bootstrap — Draft board renders

**File:** `baseball-dynasty/client/src/hooks/useLeagueState.ts`

**Bug:** Initial poll sends `sincePickId: 0`. Server returns `picks: []` (per `engine.ts:100-109` — `sincePickId > 0 ? query : []`). Because `picks.length === 0`, `lastPickIdRef.current` is never updated (line 67-68). So `sincePickId` stays at 0 forever, server keeps returning `[]`, and the Draft tab never gets any picks via the streaming channel.

**Fix:** On the FIRST successful poll, bootstrap `lastPickIdRef.current` from `state.lastPickId` minus the batch size (50) so the next poll requests recent picks. Then continue streaming.

Inside `useLeagueStatePolling`, after line 51 (after `setNoLeague(false); setReconnecting(false);`), but before the snapshot assignment:

```ts
// On first successful poll, bootstrap lastPickIdRef so streaming picks up recent picks
const snapshot = response as unknown as LeagueStateSnapshot & {
  picksDelta?: unknown[];
  gamesDelta?: unknown[];
};
if (lastPickIdRef.current === 0 && snapshot.lastPickId > 0) {
  lastPickIdRef.current = Math.max(0, snapshot.lastPickId - 50);
}
if (lastGameIdRef.current === 0 && snapshot.lastGameId > 0) {
  lastGameIdRef.current = Math.max(0, snapshot.lastGameId - 50);
}
```

Note: this replaces the existing `const snapshot = response as ...` declaration on line 56-59 — move it earlier (right after the setReconnecting calls) and use it for the bootstrap logic.

**Verify:** Start a fresh dynasty, set speed to `normal`. Open DevTools Network tab. The `/api/state?sincePickId=N` calls show N incrementing over time. The Draft tab board fills in with picks as they happen.

---

### 1.4 Fix Minors tab crash (BUG-A02)

**File:** `baseball-dynasty/client/src/views/Teams.tsx`

**Bug:** Line 61 sets `setTabData(await getTeamMinors(selectedTeamId))`. `tabData` is typed `unknown[]`. The minors tab handler at line 152 casts it to array and calls `.map()`. But `/api/teams/:id/minors` returns the grouped object `{AAA: [], AA: [], A: [], Rookie: []}` (per `server/routes/teams.ts:117-119`). `Object.map` is not a function → crash.

**Fix:** Change `tabData` to accept either array or object, and rewrite the minors tab to render the four levels:

#### 1.4.1 Update the `tabData` state declaration

Line 36 — change:
```tsx
const [tabData, setTabData] = useState<unknown[]>([]);
```
to:
```tsx
const [tabData, setTabData] = useState<unknown>([]);
```

#### 1.4.2 Rewrite the minors tab render block

Replace the entire `{activeTab === 'minors' && (...)}` block (lines 150-161) with:

```tsx
{activeTab === 'minors' && (
  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
    {(() => {
      const minors = (tabData ?? {}) as Record<string, Array<{ id: number; first_name: string; last_name: string; position: string; overall_rating: number }>>;
      const levels: Array<'AAA' | 'AA' | 'A' | 'Rookie'> = ['AAA', 'AA', 'A', 'Rookie'];
      const hasAny = levels.some(lvl => Array.isArray(minors[lvl]) && minors[lvl]!.length > 0);
      if (!hasAny) return <p style={{ color: '#64748b', fontSize: '12px' }}>No minor league depth yet</p>;
      return levels.map(level => {
        const players = Array.isArray(minors[level]) ? minors[level]! : [];
        if (players.length === 0) return null;
        return (
          <div key={level} style={{ marginBottom: '8px' }}>
            <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>{level}</div>
            {players.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155', fontSize: '12px' }}>
                <span>{p.first_name} {p.last_name}</span>
                <span style={{ color: '#94a3b8' }}>{p.position}</span>
                <span style={{ color: '#60a5fa' }}>{p.overall_rating}</span>
              </div>
            ))}
          </div>
        );
      });
    })()}
  </div>
)}
```

#### 1.4.3 Update the roster tab field names

The roster endpoint returns snake_case (`first_name`, `last_name`, `overall_rating`, etc.) per `teams.ts:99-108`, but Teams.tsx line 140 reads camelCase (`firstName`, `lastName`, `overallRating`). Fix the roster tab render:

Replace the roster block (lines 138-148):

```tsx
{activeTab === 'roster' && (
  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
    {Array.isArray(tabData) && (tabData as Array<{ id: number; first_name: string; last_name: string; position: string; overall_rating: number; annual_salary: number }>).map(p => (
      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155', fontSize: '12px' }}>
        <span>{p.first_name} {p.last_name}</span>
        <span style={{ color: '#94a3b8' }}>{p.position}</span>
        <span style={{ color: '#60a5fa' }}>{p.overall_rating}</span>
      </div>
    ))}
  </div>
)}
```

#### 1.4.4 Update the financials tab field names

Lines 163-188 read `teamDetail.payrollBudget`, `teamDetail.currentPayroll`, `teamDetail.revenue`, `teamDetail.gmName`, `teamDetail.gmPhilosophy`, etc. These are camelCase but the API returns snake_case per `teams.ts:73-83`. Update the `TeamDetail` interface and the field accesses:

Replace lines 17-27:
```tsx
interface TeamDetail extends TeamSummary {
  gm_name: string;
  gm_personality: {
    philosophy: string;
    risk_tolerance: string;
    focus: string;
  };
  manager_name: string;
  owner_name: string;
  payroll_budget: number;
  current_payroll: number;
  revenue: number;
}
```

Also update `TeamSummary` (lines 4-15) — replace `marketSize` with `market_size` if applicable (check the API response shape — `teams.ts:42` returns `market_size`).

Replace lines 163-188 (financials tab):
```tsx
{activeTab === 'financials' && (
  <div style={{ fontSize: '13px' }}>
    <div style={{ marginBottom: '8px' }}>
      <span style={{ color: '#94a3b8' }}>Revenue: </span>
      <span style={{ color: '#4ade80' }}>{formatMoney(teamDetail.revenue)}</span>
    </div>
    <div style={{ marginBottom: '8px' }}>
      <span style={{ color: '#94a3b8' }}>Payroll Budget: </span>
      <span>{formatMoney(teamDetail.payroll_budget)}</span>
    </div>
    <div style={{ marginBottom: '8px' }}>
      <span style={{ color: '#94a3b8' }}>Current Payroll: </span>
      <span style={{ color: teamDetail.current_payroll > teamDetail.payroll_budget ? '#f87171' : '#4ade80' }}>
        {formatMoney(teamDetail.current_payroll)}
      </span>
    </div>
    <div style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
      <div style={{ marginBottom: '6px' }}>GM: {teamDetail.gm_name}</div>
      <div style={{ marginBottom: '6px', color: '#94a3b8', fontSize: '12px' }}>
        {teamDetail.gm_personality?.philosophy} / {teamDetail.gm_personality?.risk_tolerance} / {teamDetail.gm_personality?.focus}
      </div>
      <div style={{ marginBottom: '6px' }}>Manager: {teamDetail.manager_name}</div>
      <div>Owner: {teamDetail.owner_name}</div>
    </div>
  </div>
)}
```

**Verify:** Click any team card. Click Minors tab — no crash; either players grouped by AAA/AA/A/Rookie or "No minor league depth yet". Click Financials tab — shows GM name, philosophy, manager, owner, revenue. Click Roster tab — shows MLB roster with player names.

---

## 2. High-Severity Fixes

### 2.1 Add `roster` array to `GET /api/teams/:id`

**File:** `baseball-dynasty/server/routes/teams.ts`

**Bug:** The team detail response (lines 49-87) does not include a `roster` field, only `minors`. Spec test 5.4 expects at least 20 players in roster.

**Fix:** Inside the `GET /api/teams/:id` handler, after the `minors = buildMinorsObject(team.id)` line, add:

```ts
const roster = prepared(
  'SELECT id, first_name, last_name, age, position, overall_rating, potential, annual_salary, contract_years_remaining FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 ORDER BY overall_rating DESC'
).all(team.id);
```

Then add `roster,` to the response object (around line 84).

**Verify:**
```bash
curl http://127.0.0.1:3001/api/teams/<any team id> | jq '.roster | length'
# Should return >= 20 after expansion draft completes
```

---

### 2.2 Make playoffs phase observable (run incrementally)

**File:** `baseball-dynasty/server/sim/playoffs.ts`

**Bug:** `runPlayoffs` runs all 7 series synchronously in a single tick. The `playoffs` phase exists for milliseconds. Spec test 3.27 expects the phase to be observable.

**Fix:** Add `await new Promise(r => setImmediate(r))` between each series. Also refresh the cache after each series so the UI sees progress. After each series completes, also persist a `playoff_round` indicator that the UI can poll.

Around lines 142-167 in `runPlayoffs`, insert after each `await runSeries(...)`:

```ts
// Yield to event loop + refresh cache so /api/state shows playoffs phase
await new Promise(r => setImmediate(r));
```

And at the top of `runPlayoffs` (before the DS series), ensure phase is `'playoffs'`:

```ts
prepared('UPDATE leagues SET phase = ? WHERE id = ?').run('playoffs', leagueId);
```

(It's already set in engine.ts:325 before runPlayoffTick is called, but adding it here is defensive.)

Additionally, change `engine.ts:360-366` (`runPlayoffTick`) so each tick runs ONE series rather than the entire playoffs. Easiest implementation: add a `playoff_step` column to leagues (or reuse `offseason_step`) and step through 'ds1', 'ds2', 'cs', 'ws' over multiple ticks.

**Simpler architectural fix (recommended):** Don't change the playoff flow logic. Instead, ensure the cache is refreshed and the event loop yields between EVERY game (not just every series). In `runSeries` at `playoffs.ts:202-229`, after each `await simulateGame(...)`:

```ts
// Yield + refresh cache after each playoff game
await new Promise(r => setImmediate(r));
// Note: the engine.ts caller's refreshCache will pick up the phase change
```

This is still synchronous within a single tick but yields enough that a parallel /api/state request would catch the `playoffs` phase. Even better: persist a `current_playoff_game_number` indicator so the UI can show game-by-game progress.

**Architect-acceptable minimum:** Insert one `await new Promise(r => setTimeout(r, 50))` between each series in `runPlayoffs` (lines 142-162). At 50ms × 7 series = 350ms of phase=playoffs. With state polling at 1500ms (per §2.7 below), there's a ~25% chance to catch it — better than zero. Combined with the refactor in §2.7 to also poll on phase changes, this should pass test 3.27.

**Verify:** Sim a season at turbo. Use:
```bash
while true; do curl -s http://127.0.0.1:3001/api/state | jq -r .phase; sleep 0.1; done
```
Watch for `playoffs` between `regular_season` and `offseason`. It should appear for at least one observation.

---

### 2.3 Honor `currentSpeed` in draft pick timing

**Files:** `baseball-dynasty/server/sim/draft.ts`, `baseball-dynasty/server/sim/engine.ts`

**Bug:** `runExpansionDraft` and `runAnnualDraft` loops iterate through all remaining picks within a single tick, with no per-pick delay. The `TICK_INTERVALS` for normal=800ms and fast=100ms apply only to the OUTER tick scheduling, not to inter-pick timing. Result: picks fire at ~100ms regardless of speed.

**Fix step A:** Export a `getDraftPickDelay()` helper from `engine.ts`:

Add to `engine.ts` (near the top, after `TICK_INTERVALS`):

```ts
// Per-pick delays for draft pacing — must honor currentSpeed
export function getDraftPickDelay(): number {
  switch (currentSpeed) {
    case 'paused': return 0;
    case 'normal': return 1500;  // spec: 1400-1600ms
    case 'fast':   return 200;   // spec: 180-220ms
    case 'turbo':  return 0;     // immediate
    default:       return 1500;
  }
}
```

**Fix step B:** Use it in `draft.ts`. Add the import at the top:

```ts
import { getDraftPickDelay } from './engine.js';
```

In `runExpansionDraft` (around line 337-352), after the existing `if (pickId && onPickComplete) { onPickComplete(pickId, round, pickNumber); }` block but BEFORE the loop iteration ends, add:

```ts
const delay = getDraftPickDelay();
if (delay > 0) {
  await new Promise(r => setTimeout(r, delay));
}
```

Do the same in `runAnnualDraft`.

**Note:** This will dramatically slow normal-speed drafts (1500ms × 600 picks = 15 minutes). That matches the spec's intent — normal speed should be watch-the-draft-unfold cadence. Turbo remains <1s for the entire draft.

**Verify:** Start dynasty, set speed `normal`. Time between picks (via DB query or DevTools) is ~1500ms. Switch to `fast` — picks now arrive ~200ms apart. Switch to `turbo` — entire 600-pick draft completes in <2s.

---

### 2.4 Fix React key prop in League standings tbody (BUG-A01)

**File:** `baseball-dynasty/client/src/views/League.tsx`

**Bug:** Line 113 — the `<>` fragment containing the division header row + team rows has no key. React warning surfaces as console error.

**Fix:** Replace `<>` with `<React.Fragment key={div.name}>` and `</>` with `</React.Fragment>`. Add `React` to imports if not already there.

Around lines 111-138, change:
```tsx
{standings?.conferences.map(conf => (
  conf.divisions.map(div => (
    <>
      <tr key={div.name} ...>
        ...
      </tr>
      {div.teams.map(team => (...))}
    </>
  ))
))}
```
to:
```tsx
{standings?.conferences.map(conf => (
  conf.divisions.map(div => (
    <React.Fragment key={`${conf.name}-${div.name}`}>
      <tr style={{ background: '#0f172a' }}>
        <td colSpan={8} style={{ padding: '6px 8px', color: '#60a5fa', fontWeight: 'bold', fontSize: '12px' }}>
          {div.name}
        </td>
      </tr>
      {div.teams.map((team, teamIdx) => (
        <tr
          key={team.teamId}
          data-testid={`standings-row-${team.teamId}`}
          style={{
            borderBottom: '1px solid #1e293b',
            background: teamIdx === 0 ? 'rgba(96, 165, 250, 0.08)' : 'transparent',
            fontWeight: teamIdx === 0 ? 'bold' : 'normal',
          }}
        >
          ...
        </tr>
      ))}
    </React.Fragment>
  ))
))}
```

Note the `teamIdx === 0` styling: this also addresses the division-leader visual-distinction Low item (see §4.4).

Make sure `React` is imported at top:
```tsx
import React, { useState, useEffect } from 'react';
```

(Remove the duplicate inner `<tr key={div.name}>` — the original code had two ways of trying to set a key.)

**Verify:** Reload the app. Open DevTools console — no `Each child in a list should have a unique "key" prop` warning. Inspect the standings table — the division-leader row (first team in each division) has a subtle blue background tint and bold text.

---

### 2.5 Fix Reconnecting banner stuck after server recovery (BUG-A03)

**File:** `baseball-dynasty/client/src/hooks/useLeagueState.ts`

**Bug:** After the server is killed and restarted, the banner appears but never clears. The poll() catch sets `reconnecting=true`. On success, `setReconnecting(false)` is called — but the recovery doesn't happen. Likely causes: stale closure on `reconnecting` in `schedule()`, polling loop death after an exception, or React batching issues.

**Fix:** Restructure the polling loop to be robust against all failure modes. Replace the entire `useLeagueStatePolling` function body (lines 29-114) with:

```ts
export function useLeagueStatePolling(): LeagueStateContextValue {
  const [state, setState] = useState<LeagueStateSnapshot | null>(null);
  const [noLeague, setNoLeague] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [picksDelta, setPicksDelta] = useState<unknown[]>([]);
  const [gamesDelta, setGamesDelta] = useState<unknown[]>([]);
  const lastPickIdRef = useRef(0);
  const lastGameIdRef = useRef(0);
  const phaseRef = useRef<string | null>(null);
  const failureCountRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const poll = async (): Promise<void> => {
      try {
        const response = await getState({
          sincePickId: lastPickIdRef.current,
          sinceGameId: lastGameIdRef.current,
        }) as Record<string, unknown>;

        // Any success clears reconnecting state immediately
        failureCountRef.current = 0;
        setReconnecting(false);

        if (response['noLeague']) {
          setState(null);
          setNoLeague(true);
          phaseRef.current = 'no_league';
          return;
        }

        setNoLeague(false);
        const snapshot = response as unknown as LeagueStateSnapshot & {
          picksDelta?: unknown[];
          gamesDelta?: unknown[];
          lastPickId?: number;
          lastGameId?: number;
        };

        // Bootstrap refs on first successful poll so streaming picks up recent picks (§1.3)
        if (lastPickIdRef.current === 0 && (snapshot.lastPickId ?? 0) > 0) {
          lastPickIdRef.current = Math.max(0, (snapshot.lastPickId ?? 0) - 50);
        }
        if (lastGameIdRef.current === 0 && (snapshot.lastGameId ?? 0) > 0) {
          lastGameIdRef.current = Math.max(0, (snapshot.lastGameId ?? 0) - 50);
        }

        setState(snapshot);
        phaseRef.current = snapshot.phase;

        const picks = snapshot.picksDelta ?? [];
        const games = snapshot.gamesDelta ?? [];

        if (picks.length > 0) {
          const lastPick = picks[picks.length - 1] as { id: number };
          lastPickIdRef.current = lastPick.id;
          setPicksDelta(picks);
        }
        if (games.length > 0) {
          const lastGame = games[games.length - 1] as { id: number };
          lastGameIdRef.current = lastGame.id;
          setGamesDelta(games);
        }
      } catch {
        failureCountRef.current += 1;
        // Show reconnecting banner only after 2 consecutive failures (avoids flicker on transient blips)
        if (failureCountRef.current >= 2) {
          setReconnecting(true);
        }
      }
    };

    const schedule = (): void => {
      if (cancelledRef.current) return;
      const isReconnecting = failureCountRef.current >= 2;
      const isDraft = phaseRef.current === 'draft';
      const interval = isReconnecting ? 3000 : isDraft ? 500 : 1500;
      timeoutRef.current = setTimeout(async () => {
        try {
          await poll();
        } finally {
          schedule(); // ALWAYS reschedule, even if poll throws
        }
      }, interval);
    };

    poll().finally(() => schedule());

    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []); // Only run once on mount

  return {
    state,
    noLeague,
    reconnecting,
    lastPickId: lastPickIdRef.current,
    lastGameId: lastGameIdRef.current,
    picksDelta,
    gamesDelta,
  };
}
```

Key changes:
- `failureCountRef` — count consecutive failures; show banner only after 2 (debounce).
- `phaseRef` — track current phase via ref so `schedule()` doesn't have a stale-closure issue with `state`.
- `finally` in setTimeout callback — guarantees `schedule()` runs even if `poll()` throws.
- State polling interval changed from 2000ms to 1500ms during regular-season (addresses standings polling lag per §2.7).
- Bootstrap logic (§1.3) integrated into this function.

**Verify:**
1. Start the app, confirm normal operation.
2. Kill the server (`pkill -f tsx server/index.ts`).
3. Reconnecting banner appears within 3-6 seconds (2 consecutive failures × 1.5s interval).
4. Restart the server (`npm run dev` or similar).
5. Reconnecting banner DISAPPEARS within 4-7 seconds (next poll succeeds, sets reconnecting=false).

---

### 2.6 Fix Players.tsx leaders table data shape (UI Tester B finding)

**File:** `baseball-dynasty/client/src/views/Players.tsx`

**Bug:** Lines 41-48 declare `Leaders` interface as `{battingAvg, homeRuns, rbi, era, strikeouts, whip}` (the OLD shape from Iteration 1). The API now returns `{hitting: [...], pitching: [...]}` with each entry having `{player_name, team_name, stat_value, category}` (per Iter 2 §2.15).

**Fix:** Rewrite Players.tsx to consume the new shape.

Replace lines 5-11 (StatLeader interface):
```tsx
interface StatLeader {
  player_name: string;
  team_name: string;
  stat_value: number;
  category: string;
}
```

Replace lines 41-48 (Leaders interface):
```tsx
interface Leaders {
  hitting: StatLeader[];
  pitching: StatLeader[];
}
```

Replace line 52 (initial state):
```tsx
const [leaders, setLeaders] = useState<Leaders>({ hitting: [], pitching: [] });
```

Replace line 56 (activeCategory type):
```tsx
const [activeCategory, setActiveCategory] = useState<string>('AVG');
```

Replace lines 80-87 (CATEGORIES array):
```tsx
const CATEGORIES: Array<{ key: string; label: string; format: (v: number) => string; group: 'hitting' | 'pitching' }> = [
  { key: 'AVG',  label: 'AVG',  format: v => (v ?? 0).toFixed(3), group: 'hitting' },
  { key: 'HR',   label: 'HR',   format: v => String(v),           group: 'hitting' },
  { key: 'RBI',  label: 'RBI',  format: v => String(v),           group: 'hitting' },
  { key: 'ERA',  label: 'ERA',  format: v => (v ?? 0).toFixed(2), group: 'pitching' },
  { key: 'K',    label: 'SO',   format: v => String(v),           group: 'pitching' },
  { key: 'WHIP', label: 'WHIP', format: v => (v ?? 0).toFixed(3), group: 'pitching' },
];
```

Replace lines 89-90 (activeCat/activeLeaders):
```tsx
const activeCat = CATEGORIES.find(c => c.key === activeCategory) ?? CATEGORIES[0]!;
const activeLeaders: StatLeader[] = activeCat.group === 'hitting'
  ? leaders.hitting.filter(l => l.category === activeCat.key)
  : leaders.pitching.filter(l => l.category === activeCat.key);
```

Replace lines 153-166 (the leaders rows render):
```tsx
{activeLeaders.map((leader, idx) => (
  <tr
    key={`${leader.player_name}-${idx}`}
    style={{ borderBottom: '1px solid #1e293b' }}
  >
    <td style={{ padding: '6px', color: '#64748b' }}>{idx + 1}</td>
    <td style={{ padding: '6px' }}>{leader.player_name}</td>
    <td style={{ padding: '6px', color: '#94a3b8', fontSize: '12px' }}>{leader.team_name}</td>
    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>
      {activeCat.format(leader.stat_value)}
    </td>
  </tr>
))}
```

(The player card and search panel can stay as-is for v0.1.0; those use different endpoints.)

**Verify:** Sim a season to 25+ games per team. Open the Players tab. AVG, HR, RBI, ERA, SO, WHIP each show at least 5 rows of leaders with realistic values.

---

### 2.7 Fix Timeline.tsx field names (snake_case)

**File:** `baseball-dynasty/client/src/views/Timeline.tsx`

**Bug:** Lines 4-12 declare `TimelineSeason` interface with camelCase fields (`seasonNumber`, `championTeamName`, `mvpPlayerName`, `championTeamId`, `mvpPlayerId`). The API returns snake_case per §3.4 of Iter 2 (`season_number`, `champion_team_name`, etc.). The `data-testid` ends up as `timeline-season-undefined`, and champion/MVP don't render.

**Fix:** Update the `TimelineSeason` interface and field accesses to snake_case.

Replace lines 4-12:
```tsx
interface TimelineSeason {
  season_number: number;
  champion_team_id: number | null;
  champion_team_name: string | null;
  mvp_player_id: number | null;
  mvp_player_name: string | null;
  narrative: string | null;
  year: number;
  notable_events?: unknown[];
}
```

Replace line 57:
```tsx
key={season.season_number}
```

Replace line 58:
```tsx
data-testid={`timeline-season-${season.season_number}`}
```

Replace line 63:
```tsx
<span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '16px' }}>Season {season.season_number}</span>
```

Replace line 66:
```tsx
{season.champion_team_name && (
```

Replace line 68:
```tsx
Champion: {season.champion_team_name}
```

Replace line 72:
```tsx
{season.mvp_player_name && (
```

Replace line 74:
```tsx
MVP: {season.mvp_player_name}
```

Also update the `Transaction` interface (lines 14-22) similarly — check what `getTransactions` returns and ensure the interface matches. Look at `server/routes/transactions.ts` to confirm field names.

**Verify:** Sim a season to completion. Open the Timeline tab. The "Seasons" view shows a card with `data-testid="timeline-season-1"`, containing "Season 1", the year "2026", and a champion badge with the team name (e.g., "Champion: Pinecrest Lynx").

---

### 2.8 Wrap finalizeOffseason in a transaction (AB2-03)

**File:** `baseball-dynasty/server/sim/offseason.ts`

**Bug:** Lines 318-328 contain three sequential `db.prepare().run()` calls (update leagues, update teams, update players) with no `db.transaction()` wrapper. A crash between any two leaves the season transition partially applied.

**Fix:** Wrap the three statements:

```ts
async function finalizeOffseason(leagueId: number, previousSeason: number): Promise<void> {
  const db = getDb();
  const newSeason = previousSeason + 1;

  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE leagues SET season_number = ?, phase = ?, offseason_step = NULL, current_game_number = 0, current_game_date = 0, last_game_id = 0 WHERE id = ?'
    ).run(newSeason, 'regular_season', leagueId);

    db.prepare('UPDATE teams SET wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0 WHERE league_id = ?').run(leagueId);

    // Orphan-player cleanup (if any) — formerly outside the transaction
    db.prepare('UPDATE players SET team_id = NULL, is_on_mlb_roster = 0, minor_level = NULL WHERE league_id = ? AND ...').run(leagueId);
    // ... include any other writes that were outside the transaction
  });

  tx();
}
```

Adjust to match the actual code at offseason.ts:318-328 (preserve the exact SQL and field names). The principle is: every write that participates in the offseason→season-N+1 transition must be atomic.

**Verify:** Add a test in `server/tests/offseasonTransaction.test.ts`:
```ts
it('finalizeOffseason is atomic — wins reset never observed without season bump', async () => {
  // Sim into offseason at the front_office step
  // Verify season_number is still N AND teams.wins are non-zero (pre-reset state)
  // Run finalizeOffseason
  // Verify season_number is N+1 AND teams.wins are all 0 (atomic update)
});
```

---

### 2.9 Strengthen validateBoxScore as a real gate (AB2-02)

**File:** `baseball-dynasty/server/sim/game.ts`

**Bug:** Lines 336-366 — the 3-retry loop's final fallthrough commits the game even when validation still fails. Rule 4 (total IP = 9.0 / 8.0 walk-off) is missing from `validateBoxScore`.

**Fix step A:** Add Rule 4 to `validateBoxScore` (around line 152-195). After the existing rule checks, add:

```ts
// Rule 4: total IP = 9.0 (non-walk-off) or 8.0 (walk-off, home team)
const homeIPTotal = result.pitcherLines
  .filter(p => p.teamId === homeTeamId)
  .reduce((s, p) => s + p.inningsPitched, 0);
const awayIPTotal = result.pitcherLines
  .filter(p => p.teamId === awayTeamId)
  .reduce((s, p) => s + p.inningsPitched, 0);
const expectedHomeIP = isWalkOff ? 8.0 : 9.0;
const expectedAwayIP = 9.0; // away always pitches a full 9 (top of every inning)
if (Math.abs(homeIPTotal - expectedHomeIP) > 0.01) {
  errors.push(`Home total IP ${homeIPTotal.toFixed(2)} != expected ${expectedHomeIP}`);
}
if (Math.abs(awayIPTotal - expectedAwayIP) > 0.01) {
  errors.push(`Away total IP ${awayIPTotal.toFixed(2)} != expected ${expectedAwayIP}`);
}
```

(Pass `isWalkOff` into `validateBoxScore` — extend its signature.)

**Fix step B:** Make the retry loop fail-closed. Around line 360-366, change:

```ts
if (validationErrors.length > 0) {
  console.error(`[game ${gameId}] box-score still invalid after retries: ${validationErrors.join('; ')}`);
}
```

to:

```ts
if (validationErrors.length > 0) {
  // Final attempt: clamp values to satisfy validator (forced regeneration of the worst offender)
  // ... apply targeted fixes for each rule violation ...
  const finalErrors = validateBoxScore(/* same args */);
  if (finalErrors.length > 0) {
    // Last resort: do not write the invalid game; log and skip
    console.error(`[game ${gameId}] box-score validation failed after retries; SKIPPING game write: ${finalErrors.join('; ')}`);
    return; // do NOT call writeGame
  }
}
```

Alternatively, if skipping a game is too disruptive to the schedule, add a flag to the game_log row (`validation_failed = 1`) and surface it in /api/games/recent so test suites can detect it.

**Architect ruling:** Use the SKIP approach for v0.1.0. The schedule generator can be re-run for the missing game by advancing the date and letting the next tick attempt it again. This is acceptable for v0.1.0 (rare edge case) and prevents corrupt data from polluting stats.

**Verify:** Add a test in `server/tests/boxScore.test.ts`:
```ts
it('does not commit games that fail validation after 3 retries', async () => {
  // Construct a worst-case scenario (e.g., team scored 10 runs with all batters going 0-for-4)
  // simulateGame returns without writing a row to game_log
  // game_log count is unchanged
});
```

---

### 2.10 Auto-restart tick loop after natural draft completion (AB-NEW-01 / AB2-04)

**File:** `baseball-dynasty/server/sim/engine.ts`

**Bug:** `runDraftTick`'s finally at line 316-317 sets `simRunning = false` unconditionally. After the draft completes naturally at non-paused speed, the tick loop dies until the user touches the speed control.

**Fix:** Only set `simRunning = false` if the draft was PAUSED (error was DRAFT_PAUSED). On natural completion at a non-paused speed, leave `simRunning` true and schedule the next tick:

Replace lines 309-318:
```ts
} catch (err) {
  if (err instanceof Error && err.message === 'DRAFT_PAUSED') {
    console.log('[engine] Draft paused');
    simRunning = false;
  } else {
    console.error('[engine] Draft tick error:', scrubError(err).message);
    simRunning = false;
  }
} finally {
  draftRunning = false;
  // Do NOT unconditionally set simRunning=false.
  // If the draft completed naturally at a non-paused speed, leave simRunning=true
  // so the tick loop continues into regular_season.
  if (currentSpeed === 'paused') {
    simRunning = false;
  }
}
```

**Verify:** Start a fresh dynasty. Set speed to `turbo`. Wait for expansion draft to complete (~1s). Without touching the speed control, observe `GET /api/state` — `currentGameNumber` increments. The regular season runs automatically.

---

## 3. Medium-Severity Fixes

### 3.1 Reorder rate-limit and LEAGUE_EXISTS checks

**File:** `baseball-dynasty/server/index.ts`

**Bug:** Lines 45-53 rate-limit middleware runs before LEAGUE_EXISTS check. A duplicate-creation attempt within 30s returns 429 (rate_limited) instead of 409 (League already exists). Per Architect ruling, 409 should take precedence over the rate limit because a deterministic-state error doesn't need to be rate-limited.

**Fix:** Modify `rateLimitLeagueNew` middleware to short-circuit when a league already exists:

```ts
function rateLimitLeagueNew(_req: Request, res: Response, next: NextFunction): void {
  // Architect ruling: LEAGUE_EXISTS takes precedence over rate-limit window
  const existing = getActiveLeague(); // import from db.ts
  if (existing) {
    res.status(409).json({ error: 'League already exists. Use /api/league/reset to start over.' });
    return;
  }
  const now = Date.now();
  if (now - lastLeagueCreateMs < 30_000) {
    res.status(429).json({ error: 'rate_limited', retryAfterMs: 30_000 - (now - lastLeagueCreateMs) });
    return;
  }
  next();
}
```

Add `getActiveLeague` to the import from `./db.js` if not already imported (note: it's currently imported in engine.ts; add to index.ts imports).

Also remove the `lastLeagueCreateMs = Date.now();` on line 101 (inside the LEAGUE_EXISTS catch) because the rate-limit window should not be consumed by a 409 response.

**Verify:**
```bash
# Create first league
curl -X POST http://127.0.0.1:3001/api/league/new -H "Content-Type: application/json" -d '{}'
# → 200 {"leagueId":1,"phase":"draft"}

# Immediately try again
curl -X POST http://127.0.0.1:3001/api/league/new -H "Content-Type: application/json" -d '{}'
# → 409 {"error":"League already exists. Use /api/league/reset to start over."}
# NOT 429 rate_limited
```

---

### 3.2 Fix /api/draft/order to branch on phase (AB2-05)

**File:** `baseball-dynasty/server/index.ts` and `baseball-dynasty/server/sim/draft.ts`

**Bug:** Line 172-180 always calls `getExpansionDraftOrder`. During annual draft, this returns the wrong order.

**Fix:** Branch on league.phase. First, export `getAnnualDraftOrder` from `draft.ts`:

```ts
// In draft.ts, add:
export function getAnnualDraftOrder(leagueId: number): number[] {
  return generateAnnualDraftOrder(leagueId);
}
```

(Or reuse the existing `generateAnnualDraftOrder` if it's already exported.)

Then in `server/index.ts`:

```ts
app.get('/api/draft/order', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json({ teamOrder: [] }); return; }
    const { getExpansionDraftOrder, getAnnualDraftOrder } = await import('./sim/draft.js');
    const teamOrder = league.phase === 'annual_draft'
      ? getAnnualDraftOrder(league.id)
      : getExpansionDraftOrder(league.id);
    res.json({ teamOrder });
  } catch (err) { next(err); }
});
```

**Verify:** During annual draft (season 2 offseason), call `GET /api/draft/order`. The returned `teamOrder` matches the order in `SELECT team_id FROM draft_picks WHERE season_number = 2 AND round = 1 ORDER BY pick_number ASC`.

---

### 3.3 Quota-unsatisfiable cities throw (AB2-06)

**File:** `baseball-dynasty/server/sim/worldgen.ts`

**Bug:** `selectCitiesWithMarketQuota` (lines 62-95) silently returns fewer than 20 cities if the pool can't satisfy quotas. The downstream loop at `worldgen.ts:190+` then crashes with TypeError on `undefined.name`.

**Fix:** Throw a clear error if any quota is unsatisfied. After the second pass (around line 90), before `return selected;`:

```ts
if (selected.length < 20) {
  const unmet: string[] = [];
  for (const [size, remaining] of Object.entries(remaining)) {
    if (remaining > 0) unmet.push(`${size}=${remaining}`);
  }
  throw new Error(`[worldgen] Insufficient cities to satisfy market quotas: ${unmet.join(', ')}`);
}
```

**Verify:** Add a unit test that creates a city pool with only 5 small cities (quota 6) and asserts that `generateWorld` throws with a descriptive message.

---

### 3.4 Improve scrubError bearer regex (AB2-07)

**File:** `baseball-dynasty/server/util/scrub.ts`

**Bug:** Line 9 — `[a-zA-Z0-9_-]+` excludes `.`, truncating JWT-shaped tokens (`header.payload.signature`) after the first segment.

**Fix:** Expand the character class to include JWT and base64url chars:

```ts
.replace(/bearer\s+[a-zA-Z0-9._~+/=\-]+/gi, 'bearer [REDACTED]');
```

**Verify:** Add a test:
```ts
it('redacts JWT-shaped bearer tokens completely', () => {
  const err = new Error('Authorization: Bearer eyJhbGc.eyJ0eXAi.SflKxwRJSMeKKF2QT4');
  const scrubbed = scrubError(err);
  expect(scrubbed.message).not.toContain('eyJ');
  expect(scrubbed.message).not.toContain('SflKxw');
});
```

---

### 3.5 Delete duplicate scrubError in llm.ts (CB2-1)

**File:** `baseball-dynasty/server/services/llm.ts`

**Bug:** Lines 164-173 define a local `scrubError` that drifted from the canonical `server/util/scrub.ts` (the local copy is missing the bearer-token redaction added in Iter 2).

**Fix:** Delete lines 164-173 (the entire local `scrubError` definition). Add at the top of the file (with the other imports):

```ts
import { scrubError } from '../util/scrub.js';
```

Verify all four call sites (`llm.ts:39, 294, 333, 361`) now use the canonical version (no code change needed at the call sites — they'll resolve to the imported symbol).

Add a precommit grep gate. In `package.json`, find the `precommit` script and add:

```
&& test $(grep -rn 'export function scrubError' server/ | grep -v util/scrub.ts | wc -l) -eq 0
```

(Or extract to a `scripts/check-no-duplicate-scrub.mjs` if the inline grep is too unwieldy.)

**Verify:** `grep -rn "function scrubError" server/` returns exactly one result, in `server/util/scrub.ts`.

---

### 3.6 Raise AVG/ERA min thresholds for realistic leaders

**File:** `baseball-dynasty/server/routes/players.ts`

**Bug:** Lines 32, 65, 87 use min-AB 100 and min-IP 30. Over a 50-game season, ~100 ABs is still a small sample → top AVG of 0.516-0.575 (spec max 0.400) and top ERA of 0.509-1.442 (spec min 1.50).

**Fix:** Raise the thresholds:
- Line 32 (battingAvg): `ss.at_bats >= 150`
- Line 65 (ERA): `ss.innings_pitched >= 50`
- Line 87 (WHIP): `ss.innings_pitched >= 50`

**Architect ruling:** With these higher thresholds, fewer players qualify early in the season. If the test runs at mid-season (game 25-30), it may see "No data yet" briefly. That's acceptable — the alternative (showing unrealistic outliers) is worse. The leaders table will populate around game 35-40.

**Verify:** After a full 50-game season at turbo, top AVG leaders are in 0.300-0.400 range; top ERA leaders are in 1.50-3.50 range.

---

### 3.7 Standings polling — Refetch every 1500ms during regular season

**File:** `baseball-dynasty/client/src/views/League.tsx`

**Bug:** Standings re-fetch is gated on `state?.currentGameNumber` change. With state polling at 2s, this creates 2-3.5s lag. Per Architect ruling §2.7 above, state polling is reduced to 1500ms (already integrated into §2.5 useLeagueState rewrite). Additionally, add a dedicated standings refresh interval.

**Fix:** Add a separate `useEffect` for standings polling:

```tsx
useEffect(() => {
  if (state?.phase !== 'regular_season') return;
  const intervalId = setInterval(() => {
    getStandings().then(data => setStandings(data as StandingsData)).catch(console.error);
  }, 1500);
  return () => clearInterval(intervalId);
}, [state?.phase]);
```

Keep the existing `useEffect` at line 46-49 (initial fetch on game-number change) — that handles non-regular-season phases and initial load.

**Verify:** With sim running at normal speed (one game per ~800ms after the §2.3 timing fix is applied), standings update within 1.5-3s of any game completing.

---

## 4. Low-Severity Fixes

### 4.1 Walk-off IP truncation hits wrong team (AB2-08)

**File:** `baseball-dynasty/server/sim/game.ts`, lines 267-272.

**Bug:** Walk-off truncation applies to the HOME team's pitchers. Real baseball: in a walk-off home win, the home team pitches a FULL 9 innings (top of 9). The AWAY team's pitchers throw the partial bottom of 9 (couldn't get the 3rd out before the winning run).

**Fix:** Swap which team passes `isWalkOff = true`:

```ts
const homePitcherLines = generatePitcherLines(
  rng, homeStarter, homeBullpen, homeTeam.id, awayScore, false  // home pitches a full 9 in a walk-off
);
const awayPitcherLines = generatePitcherLines(
  rng, awayStarter, awayBullpen, awayTeam.id, homeScore, isWalkOff  // away has truncated final inning on walk-off
);
```

And in `generatePitcherLines` at `:533`, `totalIP = isWalkOff ? 8.0 : 9.0;` — keep this; just ensure it's correctly applied to the AWAY team.

(Wait — re-read the spec: "total IP for both teams = 9.0 innings" for non-walk-offs and on walk-offs the LOSING team has 8.0 IP. So: home walk-off win → home pitches 9.0, away pitches 8.0. Adjust the fix accordingly.)

**Verify:** Over 500 games at fixed seed, count walk-off games where home_team total IP < 9.0 — should be 0. Walk-off games where away_team total IP == 8.0 — should match walk-off count.

---

### 4.2 Validator missing Rule 4 — covered in §2.9 above

(See §2.9 for the Rule 4 implementation as part of the validateBoxScore gate.)

---

### 4.3 mapPhase default cast (AB2-10)

**File:** `baseball-dynasty/server/sim/engine.ts`, line 66.

**Bug:** `default: return dbPhase as LeagueStateSnapshot['phase'];` is unsafe. If `league.phase` is ever a value not in the switch, it leaks through.

**Fix:** Throw a clear error in the default branch:

```ts
default:
  throw new Error(`[engine] Unrecognized DB phase: ${dbPhase}`);
```

Or, more defensively, return a sentinel:
```ts
default:
  console.error(`[engine] Unrecognized DB phase: ${dbPhase}`);
  return 'no_league';
```

Pick the throw approach — it surfaces schema drift early.

---

### 4.4 Division leader row visual distinction

(Already integrated into §2.4 — `teamIdx === 0` styling.)

---

### 4.5 POST /api/league/reset rate limit (CB2-2)

**File:** `baseball-dynasty/server/index.ts`, lines 110-117.

**Bug:** `POST /api/league/reset` and `DELETE /api/league/current` lack rate limiting.

**Fix:** Add the same `rateLimitLeagueNew`-style middleware (or share the timestamp):

```ts
let lastLeagueResetMs = 0;
function rateLimitLeagueReset(_req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  if (now - lastLeagueResetMs < 5_000) {  // 5s, less restrictive than create
    res.status(429).json({ error: 'rate_limited', retryAfterMs: 5_000 - (now - lastLeagueResetMs) });
    return;
  }
  next();
}

app.post('/api/league/reset', rateLimitLeagueReset, async (_req, res, next) => {
  try {
    await deleteCurrentLeague();
    lastLeagueResetMs = Date.now();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/api/league/current', rateLimitLeagueReset, async (_req, res, next) => {
  // same handler as above
});
```

---

### 4.6 Startup catch scrubError (CB2-3)

**File:** `baseball-dynasty/server/index.ts`, line 219.

**Bug:** `console.error('[server] Fatal startup error:', err);` logs raw err.

**Fix:** Import `scrubError` (already imported at line 203, presumably). Change line 219:

```ts
console.error('[server] Fatal startup error:', scrubError(err).message);
```

---

## 5. Spec Test Adaptations (Architect Rulings)

The following spec test items have been adjusted by Architect ruling. The Developer does not need to change server code for these, but should be aware:

### 5.1 Player ID 99999 → 99999999

The spec error test for `GET /api/players/<id>` returning 404 originally used 99999. Because draft prospect IDs reach 99999+, the spec test must use **99999999** (eight nines) as the non-existent ID. The server's 404 handling at `server/routes/players.ts:138` already returns the correct shape:
```json
{"error":"Player not found"}
```
No server code change required.

### 5.2 Player rating distribution test

The spec test (Group 1.18-1.22) for tier distribution must sample players where `league_id = (active league's id)`, NOT by ID range (e.g., not IDs 1-800). Because player IDs are global auto-increment, sampling by ID range hits archived leagues with multi-season aging applied. The active league's worldgen tier distribution is correct (verified at `worldgen.ts:11-17`). Add a code comment in `worldgen.ts` documenting this.

### 5.3 GET /api/teams list endpoint

The list endpoint at `GET /api/teams` deliberately returns a summary (no front-office data). Full details are at `/api/teams/:id`. This is consistent with typical sports-management APIs. The spec test (Group 1.8-1.10) should either be moved to test `/api/teams/:id` or the spec should explicitly say "full details required in list endpoint" (it currently does not). No server code change required.

---

## 6. Required New / Updated Tests

Add or extend these tests in `server/tests/`:

### 6.1 `playoffsObservable.test.ts` (new)
- Start a season, sim to game 50, transition to playoffs.
- Poll /api/state every 50ms for 5 seconds.
- Assert at least one poll captured `phase: "playoffs"`.

### 6.2 `draftPickTiming.test.ts` (new)
- Set speed to `normal`, start expansion draft.
- Measure delta between consecutive picks (via /api/state polling).
- Assert mean inter-pick delay is between 1400ms and 1600ms.

### 6.3 `validateBoxScoreGate.test.ts` (new)
- Construct a game where the box-score generator cannot satisfy Rule 1 (e.g., team scored 10 runs but all 9 batters hit 0-for-4).
- Assert game is NOT written to `game_log`.

### 6.4 `offseasonTransaction.test.ts` (new)
- Verify `finalizeOffseason` is atomic: either both `season_number` is bumped AND `teams.wins` are zeroed, or neither.

### 6.5 `leagueExistsBefore429.test.ts` (new)
- Create a league.
- Immediately POST `/api/league/new` again.
- Assert HTTP 409 with body `{"error":"League already exists. Use /api/league/reset to start over."}` — NOT 429.

### 6.6 `scrubErrorJWT.test.ts` (new)
- Pass a JWT-shaped bearer token through `scrubError`.
- Assert no `eyJ` or other JWT segments remain in the output.

### 6.7 `scrubErrorDuplicate.test.ts` (new — or precommit grep)
- Either a test that asserts only one `scrubError` definition exists in `server/`, OR a precommit grep gate as described in §3.5.

### 6.8 Update existing `boxScore.test.ts`
- Add Rule 4 (total IP) check to the validator unit tests.

---

## 7. Definition of Done — Iteration 3

The Architect will issue COMPLETE only when ALL of the following are true. Verify each before declaring the iteration finished.

### 7.1 Build and test gates
- [ ] `cd baseball-dynasty && npx tsc --noEmit -p tsconfig.server.json` exits with zero errors.
- [ ] `cd baseball-dynasty && npm run test` passes — all existing tests + the new tests in §6 (target: 120+ tests, 0 failures).
- [ ] `cd baseball-dynasty && npm run lint` passes.
- [ ] `cd baseball-dynasty && npm run security:sql-grep` passes.
- [ ] `cd baseball-dynasty && npm run build` (client) succeeds; `npm run security:bundle-grep` passes.
- [ ] `grep -rn "function scrubError" server/` returns exactly 1 match (in util/scrub.ts).

### 7.2 Server startup
- [ ] `cd baseball-dynasty && npx tsx server/index.ts` starts without crashing.
- [ ] Server log shows `[server] Baseball Dynasty server running on http://127.0.0.1:3001 (localhost only)`.
- [ ] `curl http://127.0.0.1:3001/healthz` returns 200.

### 7.3 Critical UX verifications
- [ ] **Draft tab renders.** Start fresh dynasty → click Draft tab → see the 30-round × 20-team grid with an "On the Clock" badge. Inspect cells: `data-testid="draft-pick-{round}-{pickNumber}"` matches the actual pick numbers (e.g., row 2 leftmost cell is `draft-pick-2-40`, not `draft-pick-2-21`).
- [ ] **Minors tab does NOT crash.** Click any team card → click Minors tab → see either a list grouped by AAA/AA/A/Rookie or "No minor league depth yet". No React error boundary fires.
- [ ] **Draft picks tick at the correct speed.** At `normal`, picks arrive ~1500ms apart. At `fast`, ~200ms apart. At `turbo`, full draft completes in <2s.
- [ ] **Roster shows players.** Click any team card → Roster tab → see at least 20 MLB roster players with names, positions, ratings.
- [ ] **Playoffs phase is observable.** Sim a full season at turbo. Polling /api/state at 100ms intervals captures `phase: "playoffs"` at least once before `phase: "offseason"`.
- [ ] **Reconnecting banner clears.** Kill the server with the app open. Banner appears within 6s. Restart the server. Banner disappears within 6s.
- [ ] **Timeline shows champion.** After season 1 completes, Timeline tab shows a card with `data-testid="timeline-season-1"` (NOT `timeline-season-undefined`), containing "Season 1", the year, and "Champion: <team name>".
- [ ] **Player leaders table populates.** After 25+ games per team, Players tab shows leaders for AVG, HR, RBI, ERA, SO, WHIP — each with at least 5 rows.

### 7.4 API contract gates
- [ ] `curl http://127.0.0.1:3001/api/teams/<id>` returns a `roster` array with at least 20 entries (after draft).
- [ ] `curl http://127.0.0.1:3001/api/draft/order` during expansion returns the expansion order; during annual returns the annual order.
- [ ] `curl http://127.0.0.1:3001/api/players/99999999` returns HTTP 404 with body `{"error":"Player not found"}`.
- [ ] Duplicate `POST /api/league/new` returns HTTP 409 (not 429), even within the 30s rate-limit window.

### 7.5 Functional smoke test (manual end-to-end)
- [ ] Start a new dynasty → expansion draft renders, plays at chosen speed → completes 600 picks → transitions to regular_season automatically (no user input).
- [ ] Sim full season at normal → standings update within 3s of each game completing.
- [ ] Trade deadline transaction recorded.
- [ ] Playoffs run → World Series champion recorded in timeline.
- [ ] Offseason runs → season 2 starts → annual draft renders with reverse-standings order.

### 7.6 Security verification
- [ ] No `sk-ant-*` substring in any API response.
- [ ] JWT-shaped bearer tokens fully redacted in `scrubError` output.

---

## 8. What You Must NOT Do

- **Do not revert `mapPhase`.** The Architect ruling is to keep the API surface using `'draft'` and add `subPhase` for the UI title. Reverting mapPhase would break the test spec which expects `phase: "draft"`.
- **Do not change worldgen tier allocation.** The 16/64/200/320/200 distribution at `worldgen.ts:11-17` is correct. The API tester's finding is a test-spec artifact (sampling archived league IDs).
- **Do not change the v0.1.0 spec for series lengths** (DS=5, CS=7, WS=7 — already locked in Iter 2).
- **Do not skip the new tests in §6.** They are the regression gates for Iteration 4.
- **Do not commit until all §7 acceptance checks pass.**
- **Do not merge to `main`.** Push commits to `feature/v0.1.0-initial-build` only.
- **Do not read the test result reports.** Every defect is translated into instructions in this file.
- **Do not introduce new dependencies.**

---

## 9. Commit Message Template

```
fix(v0.1.0): iteration 3 — critical UI defects, contract mismatches, and gates

Critical:
- Add LeagueStateSnapshot.subPhase; update Draft.tsx/useLeagueState.ts to check phase==='draft'
- Wire Draft.tsx to /api/draft/order; fix data-testid to use pickNumber
- Bootstrap lastPickIdRef from snapshot.lastPickId so picksDelta streams correctly
- Rewrite Teams.tsx minors tab to consume {AAA,AA,A,Rookie} grouped object
- Snake_case all client interfaces (Players.tsx, Timeline.tsx, Teams.tsx)

High:
- Add roster array to GET /api/teams/:id
- Make playoffs phase observable (yield between series + games)
- Honor currentSpeed in draft pick timing (1500/200/0 per-pick delay)
- React.Fragment key in League standings tbody; division-leader styling
- Robust polling loop with failureCountRef debounce and finally-rescheduling
- Update Players.tsx Leaders interface to {hitting, pitching}
- Wrap finalizeOffseason in db.transaction
- Make validateBoxScore fail-closed (skip invalid games); add Rule 4

Medium:
- LEAGUE_EXISTS check before rate-limit; do not lock rate window on 409
- Branch /api/draft/order on league.phase (annual vs expansion)
- Throw on quota-unsatisfiable cities
- Expand scrubError bearer regex to include JWT chars
- Delete duplicate scrubError in llm.ts; import canonical from util/scrub
- Raise min-AB to 150 and min-IP to 50 for leaders
- Add 1500ms standings polling during regular_season

Low:
- Swap walk-off IP truncation to AWAY team (real baseball semantics)
- Throw on unrecognized DB phase in mapPhase default
- Rate-limit POST /api/league/reset and DELETE /api/league/current
- Use scrubError on startup catch

Tests:
- 7 new test files: playoffsObservable, draftPickTiming, validateBoxScoreGate,
  offseasonTransaction, leagueExistsBefore429, scrubErrorJWT, scrubErrorDuplicate
- Extended boxScore.test.ts with Rule 4 (total IP)

All 120+ tests pass. Server starts. Draft tab renders. Minors tab does not crash.
Playoffs phase observable. Reconnect banner clears. Pick timing honors speed.
Timeline shows champion. Player leaders populate.
```

---

**End of developer-instructions-3.md. Apply fixes in order. Verify §7 before re-spawning reviewers.**
