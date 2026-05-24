# CISO Post-Build Report — Iteration 5 — Baseball Dynasty Simulator v0.1.0

**Reviewer:** CISO
**Inputs:** prior CISO reports (`ciso-pre-build.md`, `ciso-post-build.md`, `ciso-iter2-post-build.md`, `ciso-iter3-post-build.md`, `ciso-iter4-post-build.md`), `developer-iter5-complete.md`, iter-5 source tree at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`
**Threat model (unchanged):** Local single-user dev tool bound to `127.0.0.1`. Realistic attackers: developer's own bugs leaking secrets, runaway sim burning Anthropic credit, supply-chain risk, LLM-mediated logic corruption.

---

## Summary
Critical: 0 | High: 0 | Medium: 0 | Low: 0

All iter-5 changes are clean under the security checklist. The two new offseason validator calls, the offseason `isPaused()` gate, the `validateBody` undefined-body coercion, and the `season` alias on the snapshot introduce zero new attack surface. CB3-1 (existence-oracle, accepted) and CB2-4 (LIKE leading-`%`, backlog) remain the only carried-forward Low/backlog items, unchanged.

---

## Focus Area Review

### 1. `validatePostDraftRosters` in `finalizeOffseason` — PASS
**Evidence:**
- `server/sim/offseason.ts:312-318` — `runAnnualDraftStep` calls `validatePostDraftRosters(league.id)` via dynamic import. `league.id` is an integer from the in-memory `LeagueRow`, never from request bodies.
- `server/sim/offseason.ts:352-355` — `finalizeOffseason` calls `validatePostDraftRosters(leagueId)` after the W/L reset transaction commits. Same trusted-integer input.
- `server/sim/worldgen.ts:371-400` — `validatePostDraftRosters` body uses `prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId)` (parameterized) and `prepared('SELECT position, COUNT(*) ... WHERE team_id = ? AND is_on_mlb_roster = 1 GROUP BY position').all(team.id)` (parameterized). The downstream `autoBalance` helper (`worldgen.ts:402-448`) uses 100 % parameterized `?` placeholders for every read/update/insert. No string concatenation, no template-literal SQL.
- No new logging is emitted from the validator's hot path that could leak DB internals; the only `console.warn` (`worldgen.ts:395`) interpolates `team.id` / `team.name` / position constants — all server-generated, not user-controlled.
- **Injection / DoS risk:** None. The validator is bounded by the team count (20) and per-team position count (5 checks). Worst case `autoBalance` runs one transferring UPDATE per missing position per team — O(100) statements.
- **Belt-and-suspenders is safe:** Calling the validator twice (after `runAnnualDraft` and again in `finalizeOffseason`) is idempotent — once positions are filled, the second call is a no-op because `posMap.get(check.pos) >= check.min` short-circuits the auto-balance.

### 2. `isPaused()` check in `runOffseason` — PASS
**Evidence:**
- `server/sim/offseason.ts:24-25` — `const { isPaused } = await import('./engine.js');` (dynamic import inside the function body avoids the circular import that would otherwise occur between `engine.ts` ↔ `offseason.ts`).
- `server/sim/offseason.ts:51-54` — pause guard fires only when `!isTurbo && isPaused()`. `isTurbo` is a function parameter (boolean) threaded from `runOffseasonTick` (`engine.ts:415-421`), which derives it from the trusted module-level `currentSpeed` enum.
- `isPaused()` (`engine.ts:64-66`) is a one-line boolean accessor on a module-private `currentSpeed` variable. No state is leaked through the return value beyond the enum literal `true|false`.
- No information disclosure: the only side-effect on pause is `console.log('[offseason] Paused at step annual_draft — preserving checkpoint')` — a static log line with no DB or request data interpolated.
- Concurrency safety is identical to iter-4's draft-loop `isPaused()` pattern: single-writer/single-reader on Node's event loop, no shared-memory hazard.

### 3. `validateBody` body coercion (`undefined` → `{}`) — PASS
**Evidence:**
- `server/index.ts:32-44` — middleware reads `req.body`, substitutes `{}` when undefined, then calls `schema.safeParse(body)`. Coercion happens BEFORE the schema runs, so the schema's own validation rules still gate the request.
- **POST endpoints using `validateBody`:**
  - `POST /api/league/new` (`index.ts:104`) → `NewLeagueBody` (`shared/schemas.ts:3-6`): all fields are `.optional()`. An empty object yields `{seed: undefined, leagueName: undefined}`, and `startNewLeague({})` (`engine.ts:158-173`) handles undefined optionals correctly — it builds `wgOptions` conditionally (`engine.ts:164-166`) so no `undefined` ever reaches `generateWorld`. **No bypass.**
  - `POST /api/sim/advance` (`index.ts:170`) → `SimAdvanceBody = z.object({}).strict()` (`shared/schemas.ts:12`). `.strict()` rejects any unknown keys; an empty object is the only valid input. The undefined-coerce-to-`{}` path is functionally identical to an explicit empty body — no behavior change, and the strict-object schema still blocks arbitrary keys.
- **POST endpoints that DO NOT use `validateBody` (sanity check, unaffected by the change):**
  - `POST /api/league/reset` (`index.ts:131`) — no body validation; handler ignores body.
  - `POST /api/sim/speed` (`index.ts:152`) — uses inline `SimSpeedBody.safeParse(req.body)` (line 154), which still passes the raw `req.body` (no coercion). If `req.body` is `undefined`, `SimSpeedBody` (`z.object({speed: z.enum(...)})`) `.safeParse(undefined)` returns `success: false` → 400. This is the desired behavior because `/api/sim/speed` requires a `speed` field. The iter-5 coercion does NOT affect this route.
- **No privilege escalation:** All authenticated/authorized behavior is gated by `getActiveLeague()` checks downstream of the body parse. No request that previously failed authorization now succeeds because of the coercion.
- **No additional attack surface beyond league creation:** Confirmed by enumerating all four POST endpoints. Only `POST /api/league/new` is functionally affected, and the affected schema (`NewLeagueBody`) is all-optional by design (architect spec, §2.16).

### 4. AVG leaders min-AB lowered to 100 — SKIPPED per instruction
No security review needed; the change is a single integer literal in a parameterized SELECT.

### 5. `hitProb` formula change — SKIPPED per instruction
No security review needed; the change is arithmetic constants inside `generateBatterLines`. No new input vectors.

---

## Carried-Forward Findings

- **CB3-1 (Low — accepted)** existence-oracle in `rateLimitLeagueNew` ordering. Architect-mandated, no change in iter-5.
- **CB2-4 (Low — backlog)** LIKE leading-`%` performance. Deferred to v0.2 per spec. No change in iter-5.

No iter-5 changes affected either item.

---

## Notes on New Code (no findings)

- **Dynamic imports for `engine.ts` / `worldgen.ts` inside `offseason.ts`:** Used to break circular import cycles (offseason → engine → offseason via `runOffseasonTick`). ES module resolution is cached after first import, so the per-tick overhead is a single map lookup. No security impact; standard Node pattern.
- **`season` alias in `LeagueStateSnapshot`** (`shared/types.ts:34`, `engine.ts:99`, `index.ts:84`): The field is a duplicate of `seasonNumber` (`league.season_number`, an integer from a server-trusted DB column). No new data path. The "no-league" branch (`index.ts:79-96`) writes `season: 0` alongside `seasonNumber: 0` — consistent with the populated branch's behavior. JSON encoding is automatic via `res.json`; no string interpolation.
- **`game.ts` SP-guard advance** (`game.ts:253-258`): The new defensive guard reads `nextGame.gameNumber` and writes it back via `UPDATE leagues SET current_game_number = ?` — fully parameterized. No SQL injection. The downstream `console.error` interpolates `gameId`, two booleans, and `gameNumber` — all integers. Safe.
- **`game.ts` validation-failure advance** (`game.ts:392-399`): Same pattern — parameterized UPDATE, integer interpolation only. The `console.error` joins `validationErrors` (an internally-generated string[] of format messages with player/team integers) into a single line. No request/LLM-derived content reaches this log.
- **`standings.ts` JS-side sort** (`standings.ts:11-20`): No new DB queries, no new inputs. The sort closure operates purely on integer columns (`wins`, `losses`, `runs_scored`, `runs_allowed`) from the existing parameterized SELECT. No information disclosure; the response shape is unchanged.

---

## Overall Security Posture

**Production-ready for the local-developer-tool threat model.** Iteration 5 introduced no new High/Medium/Low findings. All new code paths reuse the existing parameterized-statement pattern, dynamic imports are bounded and circular-safe, and the body-coercion change is constrained to a single optional-only schema. No findings block v0.1.0 sign-off.

---

**End of ciso-iter5-post-build.md.**
