# CISO Post-Build Report — Iteration 4 — Baseball Dynasty Simulator v0.1.0

**Reviewer:** CISO
**Inputs:** prior CISO reports (`ciso-pre-build.md`, `ciso-post-build.md`, `ciso-iter2-post-build.md`, `ciso-iter3-post-build.md`), `developer-iter4-complete.md`, iter-4 source tree at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`
**Threat model (unchanged):** Local single-user dev tool bound to `127.0.0.1`. Realistic attackers: developer's own bugs leaking secrets, runaway sim burning Anthropic credit, supply-chain risk, LLM-mediated logic corruption.

---

## Summary
Critical: 0 | High: 0 | Medium: 0 | Low: 0

All iter-4 focus-area changes were reviewed against the new-code checklist. No new High/Medium/Low findings. The cooperative pause flag, turbo single-transaction batch, schema migrations 005/006, the App.tsx auto-navigation effect, and the new front-office fields on `GET /api/teams` are all clean under the localhost-only threat model. CB3-1 (existence-oracle) and CB2-4 (LIKE leading-`%`) remain the only carried-forward Low / accepted-backlog items.

---

## Focus Area Review

### 1. Cooperative pause in draft.ts — PASS
**Evidence:**
- `server/sim/engine.ts:64-66` — `export function isPaused(): boolean { return currentSpeed === 'paused'; }` — reads a single module-level `let currentSpeed: SimSpeed` (`engine.ts:21`). The only writers to `currentSpeed` are `initEngine` (`:48`), `startNewLeague` (`:169`), `deleteCurrentLeague` (`:195`), and `setSimSpeed` (`:203`). All four are invoked from request handlers on the single-threaded Node event loop. Node has no shared-memory concurrency for plain `let` bindings — read/write of a JS variable is atomic at the language level. No mutex needed.
- `server/sim/draft.ts:446-450, :533-537` — the loops call `const { isPaused } = await import('./engine.js'); if (isPaused()) { ... return; }` after each pick. The dynamic import is fine: ES modules are cached after first resolution, so this is a cheap map lookup after pick 1.
- **Infinite-loop risk:** None. Each loop iteration unconditionally advances `pickNumber`. The bounded outer `for (let pickNumber = startPick; pickNumber <= totalPicks; pickNumber++)` (`:429`, `:518`) guarantees termination at `totalPicks = 600` regardless of pause state. There is no `while(true)` and no path that decrements or resets `pickNumber`.
- **Pause-flag freshness:** Between the `isPaused()` check and the next iteration, control passes through `await new Promise(r => setTimeout(r, delay))` (`:455`, `:542`) which yields to the event loop. Any inbound `POST /api/sim/speed` request from the user lands on that yield and updates `currentSpeed` before the next iteration's check. No livelock.

### 2. runDraftPickSync() turbo batch — PASS
**Evidence:**
- `server/sim/draft.ts:399-426` (expansion) and `:490-516` (annual) wrap the entire 600-pick loop in a single `db.transaction(() => { ... }); turboTx();` from `better-sqlite3`.
- **Partial-failure rollback:** `better-sqlite3`'s `Database#transaction()` wraps the callback in `BEGIN` / `COMMIT`, and **any thrown exception inside the callback triggers an automatic `ROLLBACK`** before re-throwing (this is the documented behavior of the library — see `better-sqlite3` README "Transactions"). Therefore if `runDraftPickSync` throws on pick 437, picks 1-436 are rolled back atomically. The caller (`runExpansionDraft` / `runAnnualDraft`) does not catch the throw inside the turbo path, so propagation reaches `runDraftTick` (`engine.ts:346`) which catches, scrubs, and sets `simRunning = false`. Clean.
- **SQL injection:** Every statement inside `runDraftPickSync` (`draft.ts:148-198`) uses parameterized `?` placeholders. The values bound are:
  - `leagueId`, `team.id`, `round`, `pickNumber`, `selectedPlayer.id`, `Date.now()` — all integers from server-trusted sources.
  - `isExpansion ? 1 : 0` — integer literal.
  - `league.season_number` — integer column.
  - `'Pool exhausted — generated replacement player'` and `null` — string literals.
  - The 12-column `INSERT INTO players ... VALUES (..., 'Replacement', 'Player', 25, 'LF', ?, 'D', ?, ?, ...)` uses literal strings for the name/position fields and `?` for all numeric values.
  No string concatenation, no template-literal SQL, no `eval`-style construction. The instruction's concern about SQL injection in the batch is unfounded — the batch reuses the same prepared-statement pattern as the rest of the codebase.
- **Note:** Inside the turbo transaction, `runDraftPickSync` calls `selectTopN` (`:157`) which uses `prepared(...)` (the module-level cache). `prepared()` reads from a separate `Database` connection? No — it reuses `getDb()`, the same singleton. Calling a prepared statement inside an open transaction on the same connection is the standard pattern and is safe.

### 3. Migration 005 — PASS
**Evidence:**
- `server/migrations/005_draft_picks_unique_v2.sql` — only contains `DROP INDEX IF EXISTS uniq_draft_picks;` and `CREATE UNIQUE INDEX IF NOT EXISTS uniq_draft_picks ON draft_picks(league_id, season_number, is_expansion_draft, round, pick_number);`.
- **Correction to instruction premise:** Migration 005 does **not** add the `is_expansion_draft` column. That column was created in `001_init.sql:107` (`is_expansion_draft INTEGER NOT NULL DEFAULT 0`) and has been present since the original schema. Migration 005 only rebuilds the UNIQUE index to include that column. No `ALTER TABLE` is performed in migration 005, so existing rows are untouched — their `is_expansion_draft` values (set by the application at INSERT time) are preserved.
- **Migration runner safety:** `db.ts:54-72` runs each migration inside a `db.transaction(() => { db.exec(sql); ... })`. A failure during `DROP INDEX` or `CREATE UNIQUE INDEX` (e.g., if pre-existing rows would violate the new uniqueness) would roll back atomically and abort startup. The version row is inserted in the same transaction (`:68`), so a half-applied migration cannot mark itself complete.
- **Order-of-operations risk:** If a pre-existing dev DB had rows that violated the new tighter uniqueness (`(league_id, season_number, is_expansion_draft, round, pick_number)`), the `CREATE UNIQUE INDEX` would fail. The new constraint is *strictly looser* than the old one (the old `(league_id, season_number, round, pick_number)` was strictly tighter — adding a column to the unique key can only relax, never tighten), so any DB that satisfied the old constraint will satisfy the new one. Safe migration.

### 4. Migration 006 — PASS (informational)
**Evidence:**
- `server/migrations/006_player_draft_index.sql` — single `CREATE INDEX IF NOT EXISTS idx_players_league_drafted_rating ON players(league_id, is_drafted, overall_rating);` statement. No security impact. The index is non-unique, write amplification is minor, and it serves the `selectTopN` hot path (`draft.ts:106-118`).
- No findings.

### 5. App.tsx auto-navigation — PASS
**Evidence:**
- `client/src/App.tsx:48` — `const hasUserNavigatedRef = useRef(false);`
- `client/src/App.tsx:50-54` — `useEffect` runs only when `state?.phase` changes; checks `if (state?.phase === 'draft' && !hasUserNavigatedRef.current) setActiveTab('draft');`.
- **Infinite render loop risk:** None. The effect's only dependency is `state?.phase`. The effect calls `setActiveTab('draft')`, which mutates `activeTab` (a different state slice). `state.phase` is **not** derived from `activeTab`, so the setState does not re-trigger the effect. The effect re-runs only when `state.phase` changes value (e.g., `'draft' → 'regular_season'`).
- **Unexpected phase values:** `state.phase` comes from `useLeagueStatePolling` which deserializes the server's typed `LeagueStateSnapshot`. The server's `mapPhase` (`engine.ts:74-85`) throws on any unrecognized DB phase, so the client never sees a phase outside the typed union `'draft' | 'regular_season' | 'playoffs' | 'offseason'`. Even if a malformed phase did arrive, the strict-equality check `=== 'draft'` falls through to no-op rather than crashing.
- **Sticky ref behavior:** Once the user clicks any nav button (`:126-129`), `hasUserNavigatedRef.current = true` and the auto-nav stays disabled for the lifetime of the `AppContent` component. This is a UX intent, not a security boundary, but worth noting.

### 6. nav data-testid additions — PASS
Cosmetic only. `data-testid="nav-${tab.id}"` where `tab.id` is from the hardcoded `tabs` array (`App.tsx:77-84`). No user input flows in.

### 7. Front-office fields in team list — PASS
**Evidence — sanitization & provenance:**
- `server/routes/teams.ts:31-58` adds `owner_name`, `gm_name`, `gm_personality` (nested object of `philosophy`/`risk_tolerance`/`focus`), `manager_name`, `revenue`, `payroll_budget`, `current_payroll` to the list response. Output is `res.json(...)` — Express applies JSON encoding (escapes `"`, `\`, control chars), preventing JSON-context injection.
- **LLM XSS concern is unfounded.** Owner / GM / manager names are **not** LLM-generated. `server/sim/worldgen.ts:237-242` shows all three are generated as `pickRandomName(rng, 'us', 'first/last')` — a function (`worldgen.ts:357-362`) that indexes into a static `NAME_POOLS` array of curated US first/last names. No LLM call, no user input.
- The only place LLM output reaches the DB is `draft_picks.reasoning` via `callDraftPick()` (`draft.ts:232-239`), and that field is not part of the team list response.
- **Off-cycle name changes** (offseason owner death, GM dismissal, manager firing) at `server/sim/offseason.ts:215-290` also use `pickRandomName(rng, 'us', ...)` — same static-pool source. No LLM-generated names ever land in `owner_name` / `gm_name` / `manager_name`.
- **Client rendering** (`client/src/views/Teams.tsx:201, :205, :206`): `{teamDetail.gm_name}`, `{teamDetail.manager_name}`, `{teamDetail.owner_name}` are all React text-node interpolations. React auto-escapes; no `dangerouslySetInnerHTML`.
- **Numeric fields** (`revenue`, `payroll_budget`, `current_payroll`) are integers from `randInt()` (`worldgen.ts:212-227`) — no string content, no injection vector.

### 8. hitProbFormula change — SKIPPED per instruction
No security review needed; documented in developer report §11.

---

## Carried-Forward Findings

- **CB3-1 (Low — accepted)** existence-oracle in `rateLimitLeagueNew` ordering. Architect-mandated, no change in iter-4. No remediation needed under local-dev threat model.
- **CB2-4 (Low — backlog)** LIKE leading-`%` performance. Deferred to v0.2 per spec. No change in iter-4.

No iter-4 changes affected either item.

---

## Notes on New Code (no findings)

- **Pause-flag implementation pattern:** Single-writer/single-reader on the Node event loop with no `await` between read and use inside the draft loop body, except for the deliberate `setTimeout` yield that's *meant* to let pause requests interleave. This is the correct cooperative-cancellation pattern for Node.
- **Turbo transaction scope:** Wrapping 600 picks in one transaction does increase the WAL size temporarily, but `better-sqlite3` handles this with `journal_mode=WAL` (the project default). No DoS concern at the single-user scale. A future v0.2 enhancement could chunk into 50-pick sub-transactions for finer-grained checkpointing, but not required for v0.1.0.
- **Auto-nav UX state:** The `hasUserNavigatedRef` ref is process-local — a page refresh resets it, which means a user who refreshes mid-draft will get auto-navigated back to the Draft tab. Intentional per spec.
- **Field exposure on `/api/teams`:** Revenue / payroll figures are now visible in the list endpoint. Under the local-dev threat model, no privilege boundary exists (single user owns the league), so this is not a confidentiality issue. If the threat model ever changes to multi-tenant, these fields should be considered for owner-only filtering — documenting only.

---

## Overall Security Posture

**Production-ready for the local-developer-tool threat model.** Iteration 4 introduced no new High/Medium/Low findings. The cooperative pause refactor is a clear improvement over the prior throw-based control flow (no more spurious `DRAFT_PAUSED` exceptions in logs). The turbo single-transaction batch correctly uses `better-sqlite3`'s automatic rollback semantics and reuses parameterized statements throughout. Migrations 005 and 006 are minimal, idempotent (`IF EXISTS` / `IF NOT EXISTS`), and run inside the existing transactional migration runner. The new front-office fields on `GET /api/teams` are sanitized by React's text-node auto-escape and Express's JSON serialization, and the underlying values are sourced from a static `NAME_POOLS` array — not from any LLM call — so the speculative XSS concern is not realized.

No findings block v0.1.0 sign-off.

---

**End of ciso-iter4-post-build.md.**
