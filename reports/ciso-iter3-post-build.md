# CISO Post-Build Report — Iteration 3 — Baseball Dynasty Simulator v0.1.0

**Reviewer:** CISO
**Inputs:** `v0.1.0-app-spec-section.md`, `reports/architect-eval-0.md`, `reports/ciso-pre-build.md`, `reports/ciso-post-build.md`, `reports/ciso-iter2-post-build.md`, complete v0.1.0 source tree at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`
**Threat model (unchanged):** Local single-user dev tool. Realistic attackers: developer's own bugs leaking secrets, runaway sim burning Anthropic credit, supply-chain risk, LLM-mediated logic corruption.

---

## Summary
Critical: 0 | High: 0 | Medium: 0 | Low: 1

The single Iteration 2 Medium (**CB2-1**) is RESOLVED — the duplicate `scrubError` in `server/services/llm.ts` was deleted, the canonical `server/util/scrub.ts` is imported, and the canonical scrubber now redacts JWT-shaped bearer tokens (chars `[._~+/=\-]`). Two new test files (`scrubErrorJWT.test.ts`, `scrubErrorDuplicate.test.ts`) enforce both the JWT redaction and the single-definition gate via the existing `npm test` step in `precommit`. The Iteration 2 Low findings have also been addressed: **CB2-2** (unthrottled reset) is fixed by a new 5s `rateLimitLeagueReset` middleware applied to both `POST /api/league/reset` and `DELETE /api/league/current`; **CB2-3** (raw startup error) is fixed via `scrubError(err).message` in the `main()` catch. The Iteration 3 code changes (subPhase field, draft per-pick `setTimeout`, `finalizeOffseason` transaction wrap, `/api/draft/order` phase branch, rate-limit reorder) were reviewed against the focus checklist with no new High/Medium findings. One Low — **CB3-1**, an existence-oracle in the rate-limit reorder — is documented for awareness but is acceptable under the local-dev threat model.

---

## Iteration 2 Finding Status

- **CB2-1 (Medium) Duplicate scrubError drift:** RESOLVED
  Evidence:
  - `server/services/llm.ts:11` — `import { scrubError } from '../util/scrub.js';`
  - `server/services/llm.ts` no longer contains a local `function scrubError` (grep `export function scrubError` server-wide returns only `server/util/scrub.ts:2`).
  - All four LLM call sites (`llm.ts:40`, `:284`, `:323`, `:351`) call `scrubError(err).message` and bind to the canonical import.
  - `server/util/scrub.ts:9` — bearer regex updated to `/bearer\s+[a-zA-Z0-9._~+/=\-]+/gi`, which now covers JWT-shaped tokens (`.` separator + Base64URL `_-` + `+/=` padding).
  - `server/tests/scrubErrorJWT.test.ts` exercises the full JWT three-segment redaction, plus `sk-ant-` prefix and case-insensitive `Bearer`.
  - `server/tests/scrubErrorDuplicate.test.ts` is a process-spawn grep gate that fails the suite if any non-test file in `server/` defines `export function scrubError`. Runs as part of `npm test` → `precommit`. This is the CI grep gate I recommended in CB2-1, implemented as a unit test instead of a separate npm script (equivalent effect since `precommit` chains `npm run test`).

- **CB2-2 (Low) /api/league/reset and DELETE /api/league/current unthrottled:** RESOLVED
  Evidence: `server/index.ts:117-125` defines `rateLimitLeagueReset` (5s window, 429 with `retryAfterMs` on violation). Applied to `POST /api/league/reset` (`index.ts:128`) and `DELETE /api/league/current` (`index.ts:138`). The timestamp `lastLeagueResetMs` is set only after `deleteCurrentLeague()` succeeds (lines 131, 141), mirroring the CB-3 fix pattern — a failure does not engage the lockout. 5s (vs 30s on `/api/league/new`) is appropriate: reset is idempotent against an already-deleted league, while `/api/league/new` is the LLM-spend ingress.

- **CB2-3 (Low) Raw startup error log:** RESOLVED
  Evidence: `server/index.ts:241` — `console.error('[server] Fatal startup error:', scrubError(err).message);`. Same one-line fix CB2-3 recommended.

- **CB2-4 (Low) LIKE leading-`%` performance:** NOT ADDRESSED in Iteration 3 (per spec — backlog for v0.2). Accepted.

---

## Iteration 3 Focus Area Review

### 1. CB2-1 resolution (covered above): PASS
The local `scrubError` in `services/llm.ts` is deleted, the canonical import is wired, JWT-shaped tokens are redacted, and two regression tests gate the change. Clean.

### 2. Rate-limit reordering: PASS (with informational Low CB3-1)
`server/index.ts:46-60` — `rateLimitLeagueNew` now calls `getActiveLeague()` *before* the 30s window check, returning 409 if a league exists. **TOCTOU analysis:** `getActiveLeague()` (`db.ts:89`) is a synchronous `better-sqlite3` `.get()`. There is no `await` between the existence check and the eventual `startNewLeague()` execution other than the validate-body middleware (synchronous Zod) and the route handler entry. No race window is opened by the reorder. **See CB3-1 below for the existence-oracle observation.**

### 3. finalizeOffseason transaction: PASS
`server/sim/offseason.ts:319-333` — both the season-increment `UPDATE leagues …` and the wins-reset `UPDATE teams … wins = 0, losses = 0, runs_scored = 0, runs_allowed = 0, games_played = 0` are now inside a `const tx = db.transaction(() => { … }); tx();` along with the orphaned-undrafted free-agent conversion. Atomic — a crash between the two statements can no longer leave a half-finalized season.

### 4. Per-pick delay (setTimeout usage): PASS
`server/sim/draft.ts:362, :412` — `await new Promise(r => setTimeout(r, delay));`. This is Node's global `setTimeout` (timers/promises is not imported), which is correct: the `await new Promise(r => setTimeout(r, delay))` idiom is the standard non-blocking yield in Node and does **not** block the event loop. `delay` comes from `getDraftPickDelay()` (`engine.ts:33-41`) which returns a switch over `currentSpeed`: fixed values `0/1500/200/0`. No user input flows in — no risk of attacker-controlled delays or `setTimeout` callback abuse. The `tickTimeout = setTimeout(...)` in `engine.ts:246` is similarly fed by `TICK_INTERVALS[currentSpeed]` (`engine.ts:25-30`) — also fixed enum values. Clean.

### 5. subPhase field: PASS
`server/sim/engine.ts:83-87` — `mapSubPhase(dbPhase: string): 'expansion' | 'annual' | null` is a pure switch returning one of exactly three values:
```ts
if (dbPhase === 'expansion_draft') return 'expansion';
if (dbPhase === 'annual_draft') return 'annual';
return null;
```
The return type literal is enforced by TypeScript. Even if a corrupted `league.phase` arrives, `mapSubPhase` falls through to `null` (no string echo). The shared interface `LeagueStateSnapshot.subPhase` in `shared/types.ts:32` matches the same literal union. No adversary-controlled string can ever reach the client via `subPhase`. Note also that `mapPhase` (`engine.ts:69-80`) was strengthened from the iter-2 `default: return dbPhase as …` to `default: throw new Error(\`[engine] Unrecognized DB phase: ${dbPhase}\`)` — an improvement, since the bypass concern I noted in iter-2 about a corrupt DB phase being echoed verbatim is now closed. The thrown error will be caught by the Express error middleware and scrubbed.

### 6. /api/draft/order phase branching: PASS
`server/index.ts:192-202` —
```ts
const league = getActiveLeague();
if (!league) { res.json({ teamOrder: [] }); return; }
const { getExpansionDraftOrder, getAnnualDraftOrder } = await import('./sim/draft.js');
const teamOrder = league.phase === 'annual_draft' ? getAnnualDraftOrder(league.id) : getExpansionDraftOrder(league.id);
```
No body, no query params, no path params. The no-league case returns `{ teamOrder: [] }` (no crash). `league.phase` is bounded by server-side hardcoded writers (same analysis as iter-2 `mapPhase`). Both `getExpansionDraftOrder` and `getAnnualDraftOrder` take an integer `leagueId` from a server-trusted source. No authorization needed under the local-dev threat model. Clean.

### 7. New rate-limit on reset endpoints: PASS
Covered in CB2-2 RESOLVED above. The 5s window is shorter than `/api/league/new`'s 30s, which is intentional: reset is destructive but cheap, while `/api/league/new` is the expensive LLM-spend ingress. No bypass — both alias endpoints (`POST /api/league/reset` and `DELETE /api/league/current`) share the same `lastLeagueResetMs` variable, so a client cannot dodge the limit by alternating verbs.

### 8. Player leader threshold changes: SKIPPED (data filtering only, no injection vector)

### 9. Client file scan: PASS
- `client/src/views/Draft.tsx` — All dynamic interpolations (`{latestPick.first_name}`, `{latestPick.reasoning}`, `{team.city.slice(0, 6)}`, etc.) are React JSX text-nodes. Reasoning at line 175 explicitly comments `§4.4: LLM reasoning rendered as text node only`. No `dangerouslySetInnerHTML`, no `eval`, no `new Function`, no fetch of secret-bearing env vars.
- `client/src/views/Teams.tsx:220` — `<div>{event.narrative}</div>` with comment `§4.4: Render as text node, never dangerouslySetInnerHTML`. Clean.
- `client/src/views/Games.tsx`, `client/src/views/Timeline.tsx` — same pattern with `§4.4` comments. Clean.
- `client/src/hooks/useLeagueState.ts` — Pure polling hook. Uses `getState({ sincePickId, sinceGameId })` (typed) and `setTimeout`/`clearTimeout` for scheduling. Cancellation flag (`cancelledRef`) properly checked before scheduling and cleared on unmount. No `process.env`, no API key access. Reads `response['noLeague']` and `snapshot.lastPickId/lastGameId` defensively. Clean.
- Grep across `client/src/` for `dangerouslySetInnerHTML | eval( | new Function | process\.env | VITE_ | ANTHROPIC | sk-ant` returns **zero matches** (the three `dangerouslySetInnerHTML` strings found are inside `§4.4` *comments* explicitly stating it is **not** used).

---

## New Findings (Iteration 3 code changes)

### LOW CB3-1 server/index.ts: rateLimitLeagueNew ordering creates an existence-oracle (acceptable, defense-in-depth)
**Evidence:** `server/index.ts:46-60` —
```ts
function rateLimitLeagueNew(_req: Request, res: Response, next: NextFunction): void {
  const existing = getActiveLeague();
  if (existing) {
    res.status(409).json({ error: 'League already exists. ...' });
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
The 409 (league exists) is returned **before** the 429 (rate-limited) is even checked. This means an attacker can probe `POST /api/league/new` arbitrarily fast and learn from the response code whether a league currently exists, without ever consuming the rate-limit window.

**Description:** Architect §3.1 (`v0.1.0-app-spec-section.md`) explicitly mandates "LEAGUE_EXISTS takes precedence over rate-limit window," so this ordering is by design. The defensible reason: the legitimate user has just clicked "New Dynasty" and a stale 409 should be returned regardless of timing so they understand why the action is blocked. The existence-oracle is information that `GET /api/state` already exposes (it returns `noLeague: true` if no league, and a full snapshot if one exists), so there is no marginal disclosure. Under the local-dev threat model, no remote attacker can reach the endpoint at all (server is bound to `127.0.0.1`, CB-1 RESOLVED). No action required.

**Recommendation:** None for v0.1.0. Documenting only for traceability — if the threat model ever changes to "shared development server" or "cloud-hosted demo," reverse the order (check rate-limit first, return 429; only check existence if within window).

---

## Notes on New Code (Iteration 3 — no findings)

- **`server/util/scrub.ts:9`** — Bearer regex updated to `/bearer\s+[a-zA-Z0-9._~+/=\-]+/gi`. The character class now covers all valid Base64URL chars (`A-Za-z0-9_-`), JWT separator (`.`), and standard Base64 padding (`+/=`). The trailing `\-` (escaped hyphen at end of class) is harmless. Test coverage at `server/tests/scrubErrorJWT.test.ts` verifies redaction of a three-segment JWT with `.` separators, plus a case-insensitive `Bearer` match.

- **`server/tests/scrubErrorDuplicate.test.ts`** — Spawns `grep -rn "export function scrubError" server/ --include="*.ts" --exclude-dir=tests`. Asserts exactly one match (in `util/scrub.ts`). Prevents the iter-2 CB2-1 regression from recurring. The test is hermetic (no network, no DB).

- **`server/index.ts:117-125` `rateLimitLeagueReset`** — Set-after-success pattern (timestamp set inside the route handler post-`await deleteCurrentLeague()`, not in the middleware). Symmetric with the CB-3 fix on `/api/league/new`. A `deleteCurrentLeague()` exception propagates to `next(err)` without engaging the lockout, so a transient SQLite failure doesn't punish the user. Clean.

- **`server/sim/draft.ts:362, :412` per-pick delay** — Wrapped in `await new Promise(r => setTimeout(r, delay))`. `delay` is from `getDraftPickDelay()` which returns hardcoded enum-mapped values. The promise yields control to the event loop, so polling requests are serviced between picks. The two call sites (expansion draft loop and annual draft loop) are structurally identical. Clean.

- **`server/sim/offseason.ts:319-333` `finalizeOffseason` transaction** — Wraps three writes in one `db.transaction()`: season-number/phase/offseason_step update on `leagues`, W/L/runs/games_played reset on `teams`, and orphaned-undrafted-player free-agent conversion on `players`. The `tx()` invocation is at line 333. Atomic. No SQL injection (all values are integers or hardcoded strings, with parameterized `?` placeholders).

- **`server/sim/engine.ts:69-80` `mapPhase`** — Now throws on unknown phase instead of casting through. The throw is caught by either the `runTickLoop` catch (`engine.ts:273`) or the Express error middleware (`index.ts:227-230`), both of which scrub before logging. This is a correctness improvement over iter-2.

- **`server/index.ts:225-230` Express error middleware** — Unchanged from iter-2. `console.error('[server]', scrubError(err))` — note this logs the full `{ code, message }` object, not just `.message`. Acceptable because both fields are scrubbed.

- **`client/src/hooks/useLeagueState.ts`** — Polling cadence dynamically adjusts based on `phaseRef.current === 'draft'` (500ms) vs regular season (1500ms) vs reconnecting (3000ms). The 500ms cadence is fine — the server's draft endpoint is parameterized and indexed (`draft_picks.id > ?` with the unique index from migration `003_draft_picks_unique.sql`). No DoS concern. Failure handling: a thrown poll re-schedules in the `finally` to avoid stop-the-world on transient errors. Clean.

- **`package.json:21` `precommit`** — Chains `security:sql-grep` → `lint` → `typecheck` → `test`. The new `scrubErrorDuplicate.test.ts` runs in the `test` step. The `security:bundle-grep` step (`scripts/check-bundle-no-keys.mjs`) is chained after `vite build` in the `build` script. Both gates intact.

---

## Overall Security Posture

**Production-ready for the local-developer-tool threat model.** All Iteration 1 (CB-1 through CB-7) and Iteration 2 (CB2-1 through CB2-3) findings are RESOLVED; CB2-4 (LIKE leading-`%`) remains the only accepted-backlog item from prior iterations. The Iteration 3 code changes (CB2-1 scrubError dedup, new reset rate-limit, finalizeOffseason transaction, per-pick `setTimeout` delay, `subPhase` field, `/api/draft/order` phase branch, and the rate-limit reorder) introduce no new High or Medium findings. The sole new Low (**CB3-1**) is an existence-oracle that is mandated by Architect §3.1 and is acceptable under the localhost-only threat model.

The `scrubErrorDuplicate.test.ts` gate is exactly the kind of self-defending mechanism that closes the loop on iter-2's CB2-1 drift incident — the codebase now has a regression test that will prevent a future contributor from re-introducing a duplicate `scrubError`. Similarly, `scrubErrorJWT.test.ts` ensures the bearer regex stays expressive enough for SDK error formats that use JWT-shaped tokens.

No findings block v0.1.0 sign-off.

---

**End of ciso-iter3-post-build.md.**
