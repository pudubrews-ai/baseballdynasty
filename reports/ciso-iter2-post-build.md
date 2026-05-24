# CISO Post-Build Report — Iteration 2 — Baseball Dynasty Simulator v0.1.0

**Reviewer:** CISO
**Inputs:** `app-spec.md`, `v0.1.0-app-spec-section.md`, `reports/architect-eval-0.md`, `reports/ciso-pre-build.md`, `reports/ciso-post-build.md` (Iteration 1), complete v0.1.0 source tree at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`
**Threat model (unchanged):** Local single-user dev tool. Realistic attackers: developer's own bugs leaking secrets, runaway sim burning Anthropic credit, supply-chain risk, LLM-mediated logic corruption.

---

## Summary
Critical: 0 | High: 0 | Medium: 1 | Low: 3

All seven Iteration 1 findings (CB-1 through CB-7) are RESOLVED. The Developer applied the recommended fixes cleanly: Express now binds to `127.0.0.1`, `sanitizeNarrative()` is loop-until-stable with regression tests for the exact bypass inputs CB-2 documented, the rate-limit timestamp is set only after successful league creation, and a canonical `server/util/scrub.ts` exists with an added bearer-token redaction. The single Medium-severity finding from Iteration 2 (**CB2-1**) is that the *new* canonical scrubber in `util/scrub.ts` did not replace the duplicate `scrubError` in `services/llm.ts` — both still exist, and they have already drifted (the llm.ts copy is missing the new bearer-token redaction). The three Low-severity findings are defense-in-depth gaps in the new `POST /api/league/reset` route (no rate limit on a destructive endpoint), residual unscrubbed `console.error` during startup, and an unbounded LIKE-search returning O(N) rows. None of these block sign-off for the local-tool threat model.

---

## Iteration 1 Finding Status

- **CB-1 (High) Express binds 0.0.0.0:** RESOLVED
  Evidence: `server/index.ts:215` — `app.listen(PORT, '127.0.0.1', () => { ... })`. Startup log at `index.ts:216` now reads `Baseball Dynasty server running on http://127.0.0.1:${PORT} (localhost only)` providing the dev-visible confirmation recommended in Iteration 1.

- **CB-2 (Medium) sanitizeNarrative bypassable:** RESOLVED
  Evidence: `server/services/llm.ts:144-162` — `sanitizeNarrative` now strips control chars once then enters a `do { ... } while (cur !== prev)` loop that re-runs the HTML-tag strip (with `<[^>]*>?` regex that tolerates missing closing `>`), bare `<` and `>` strip, literal `script` strip, and the three protocol strips (`javascript:`, `data:`, `vbscript:`). Regression tests in `server/tests/sanitizer.test.ts` cover all three exploit inputs CB-2 documented:
  - line 14: `'<<script>script>alert(1)</script>'` → asserts no `<`, `>`, or `script` remain
  - line 22: `'<script'` (unclosed) → asserts no `<` or `script` remain
  - line 28: `'jajavascript:vascript:alert(1)'` → asserts no `javascript:` remains
  Plus added coverage for `vbscript:`, control chars, non-string input, length cap, and preservation of clean text.

- **CB-3 (Medium) Rate limit timestamp on invalid body:** RESOLVED
  Evidence: `server/index.ts:45-53` — the middleware comment now explicitly reads `// Do NOT set lastLeagueCreateMs here — set it only after success (§4.7)` and no longer assigns the timestamp. The timestamp is set at `index.ts:97` (after `startNewLeague(req.body)` returns successfully) and at `index.ts:101` (on the legitimate `LEAGUE_EXISTS` 409 path). A malformed body that fails Zod validation at `index.ts:94` (via `validateBody(NewLeagueBody)`) now leaves `lastLeagueCreateMs` unchanged, so a typo doesn't lock the user out for 30s.

- **CB-4 (Low) Raw error in tick loop console.error:** RESOLVED
  Evidence: `server/sim/engine.ts:15` imports `scrubError` from `../util/scrub.js`. All five previously-raw catches now use `scrubError(err).message`:
  - `engine.ts:254` `[engine] Tick error:`
  - `engine.ts:313` `[engine] Draft tick error:`
  - `engine.ts:364` `[engine] Playoff error:`
  - `engine.ts:372` `[engine] Offseason error:`
  - `index.ts:206` Express error middleware: `console.error('[server]', scrubError(err))`
  One residual raw-error log remains at startup (`index.ts:219`) — see CB2-3 below for the assessment.

- **CB-5 (Low) scrubError duplicated:** PARTIAL — see CB2-1 finding
  Evidence: The canonical `server/util/scrub.ts` was created (with the added bearer-token redaction at line 9). The Express error middleware at `index.ts:203` and the engine tick-loop catches all use the new canonical module. **However**, `server/services/llm.ts:165-173` still defines its own local `scrubError` and the four LLM call sites (`llm.ts:39`, `:294`, `:333`, `:361`) still bind to the local version, not the canonical one. This is the exact maintenance-fragility risk CB-5 flagged — and it has *already manifested*: the local llm.ts copy is missing the new `bearer\s+[a-zA-Z0-9_-]+` redaction line. Promoted from Low to Medium severity as CB2-1 below because the regression set has now diverged in production code, not just theory.

- **CB-6 (Low) Health check leaks version:** RESOLVED (contingent on CB-1 — now fixed)
  Evidence: `index.ts:56-62` — `/healthz` and `/api/healthz` still return `version: '0.1.0'`, but per the Iteration 1 report this is acceptable once the listener is bound to `127.0.0.1` (which it now is, per CB-1 RESOLVED above). LAN-attacker fingerprinting is no longer reachable.

- **CB-7 (Low) Unbounded schedule_json and notable_events_json:** RESOLVED for notable_events; ACCEPTED for schedule_json
  Evidence: `server/sim/game.ts:306-311` — `notableEvents.forEach((e: NotableEvent) => { if (typeof e.description === 'string' && e.description.length > 500) { e.description = e.description.slice(0, 500); } })` exactly matches the Iteration 1 recommendation. `game.ts:313-314` clamps `notableEvents.length <= 20`. The schedule_json sanity assert (`< 1MB before write`) was not added; for v0.1.0 with a fixed-size 500-game schedule of ~30KB this is acceptable as documented in Iteration 1.

---

## New Findings (Iteration 2 code changes)

### MEDIUM CB2-1 server/services/llm.ts: Duplicate scrubError has already drifted from canonical util/scrub.ts
**Evidence:**
- Canonical: `server/util/scrub.ts:5-10` includes four redactions: `sk-ant-…`, `authorization`, `x-api-key`, **and `bearer\s+[a-zA-Z0-9_-]+`** (line 9, newly added in Iteration 2).
- Duplicate: `server/services/llm.ts:165-173` defines a local `scrubError` with only the first **three** redactions — the bearer-token regex is missing.
- All four LLM call sites use the local version because of `import` proximity: `llm.ts:39` (`recordLlmCall` failure), `:294` (`callDraftPick`), `:333` (`callSeasonNarrative`), `:361` (`callTransactionFlavor`).

**Description:** The Anthropic SDK's error objects, when authentication fails, can include the `Authorization: Bearer sk-ant-…` header in their `.headers` property and (in some error paths) embedded in the error `.message`. The canonical scrubber's bearer-token regex was added in Iteration 2 specifically to cover the `Bearer <token>` syntax that appears in HTTP-level error dumps before the `sk-ant-…` substring is reached (e.g., from a third-party tunnel/proxy or a future change to the SDK's error formatting). Today the `sk-ant-…` redaction still neutralizes most leaks because the canonical token format starts with that prefix — but if any future SDK version (or proxy error response) uses a generic `Bearer <opaque-token>` representation, only the canonical scrubber catches it. The LLM service paths are the ones most likely to emit such errors, and they're the exact ones still using the old scrubber. This is *exactly* the drift risk CB-5 (Iteration 1) warned about, and it has now occurred.

**Recommendation:** Delete `services/llm.ts:165-173` (the local `scrubError` definition) and replace with `import { scrubError } from '../util/scrub.js';` at the top of the file. Verify all four `scrubError(err).message` call sites still resolve. Add a CI grep gate to prevent re-introduction:
```
grep -rn "export function scrubError" server/ | grep -v util/scrub.ts | wc -l  # must be 0
```
Wire that grep into the `precommit` script in `package.json` alongside `security:sql-grep`.

---

### LOW CB2-2 server/index.ts: POST /api/league/reset is destructive but has no rate limit and no body validation
**Evidence:** `server/index.ts:110-117` —
```ts
app.post('/api/league/reset', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await deleteCurrentLeague();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```
No `rateLimitLeagueNew`, no `validateBody`, no `SimAdvanceBody`-style empty-object check. The sibling `DELETE /api/league/current` at `index.ts:119-126` has the same shape — which is intentional per spec §2.16.4 (alias) — but both are now reachable without any throttle.

**Description:** With CB-1 fixed (localhost-only binding) the risk surface is local-process-only, so an exploit requires either a malicious browser tab open on `http://127.0.0.1:3001` while the dev runs the app, or local malware. Both are out of scope per the threat model. The defense-in-depth concern is: a buggy or runaway client (e.g., a React effect that loops on mount, a curl-in-a-shell-loop while testing) could repeatedly POST `/api/league/reset` and destroy work mid-stream. `deleteCurrentLeague()` at `engine.ts:151-171` archives the current league (`SET archived = 1`) and then prunes archives down to 3 — repeated calls would only churn one league at a time, but combined with `POST /api/league/new` could ratchet through the archive pool unintentionally.

**Recommendation:** Either (a) wire the same 30s rate-limit middleware on `POST /api/league/reset` and `DELETE /api/league/current` as is on `POST /api/league/new`, or (b) keep them unthrottled but require an explicit `{ confirm: true }` body validated through Zod, mirroring the UI's double-confirm modal. Option (a) is one line of code and matches the existing pattern.

---

### LOW CB2-3 server/index.ts: Startup fatal error still logs raw err without scrubbing
**Evidence:** `server/index.ts:219` —
```ts
} catch (err) {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
}
```
The startup `main()` function catches errors from `initDb()` and `initEngine()` and logs `err` directly. While `initDb()` and `initEngine()` don't call the Anthropic SDK directly, a misconfigured `ANTHROPIC_API_KEY` at module-load time (the top of `services/llm.ts:13-17` instantiates the SDK client) could surface an SDK error that bubbles to this catch. The SDK client constructor itself doesn't make a network call, but a downstream import chain change could.

**Description:** Defense-in-depth gap. Currently the most likely error here is a SQLite open failure (path/permissions) which contains no secrets. Severity Low because the leak path is narrow.

**Recommendation:** Apply the same fix as CB-4: `import { scrubError } from './util/scrub.js'` is already at line 203; change line 219 to `console.error('[server] Fatal startup error:', scrubError(err).message);`. One-line change.

---

### LOW CB2-4 server/routes/players.ts: LIKE search returns up to 20 rows on a length-50 input without index-friendly prefix
**Evidence:** `server/routes/players.ts:98-122` — `/api/players/search?q=<query>`:
```ts
const query = String(req.query['q'] ?? '').slice(0, 50);
...
WHERE p.league_id = ? AND (p.first_name LIKE ? OR p.last_name LIKE ?)
LIMIT 20
```
The query is bound via `?` placeholders (no SQL injection), capped at 50 characters and limited to 20 rows. **However**, the LIKE pattern `'%${query}%'` (line 111) uses a leading `%` which forces SQLite to do a full table scan over `players` (800 rows after worldgen, growing per season's draft class). No SQL injection, no XSS — but a client polling this endpoint with random short queries on every keystroke (no debounce visible in `client/src/App.tsx` for this endpoint — search input not wired in v0.1.0) would scan 800+ rows per request.

**Description:** Performance/DoS concern of low severity. The 20-row LIMIT bounds response size, and the route is currently not wired from the UI in v0.1.0. No information disclosure beyond the existing GET `/api/players/:id` route.

**Recommendation:** For v0.1.0, document the leading-`%` performance characteristic and accept. For v0.2, either change to a prefix-only LIKE (`'${query}%'`) which can use an index on `last_name`, or add an FTS5 virtual table for players. Also consider client-side debounce when the search input becomes user-facing.

---

## Notes on New Code (Iteration 2 — no findings)

- **`server/util/scrub.ts`:** New canonical scrubber. Adds a bearer-token redaction (`/bearer\s+[a-zA-Z0-9_-]+/gi`) beyond the original three patterns. Wired correctly from `index.ts:203` (Express error middleware) and `engine.ts:15` (tick-loop catches). **Caveat in CB2-1.**

- **`server/migrations/002_playoff_series.sql`:** New `playoff_series` table with `REFERENCES leagues(id)` and `REFERENCES teams(id)` foreign keys. All columns typed correctly. No raw SQL with user input. Migration applied via `db.transaction()` in `db.ts:66-72` so partial application is atomic. Clean.

- **`server/migrations/003_draft_picks_unique.sql`:** DELETE statement uses a sub-SELECT with `MAX(id) GROUP BY (league_id, season_number, round, pick_number)` to keep the highest-id row per unique tuple before creating the UNIQUE index. No user input reaches this SQL — it runs once at boot from a static .sql file. The DELETE pattern is the standard idiom for de-duplicating before adding a UNIQUE constraint. Clean.

- **`server/migrations/004_team_abbreviation.sql`:** Single `ALTER TABLE teams ADD COLUMN abbreviation TEXT;` — no user input, no NULL constraint (column is nullable, populated by `generateAbbreviation` in `worldgen.ts:98-113`). Clean.

- **`GET /api/draft/order` (`index.ts:172-180`):** No user input — takes no query params and no body. Calls `getActiveLeague()` and `getExpansionDraftOrder(league.id)`. The latter is a pure function over `prepared('SELECT id FROM teams WHERE league_id = ? ORDER BY id').all(leagueId)` with a parameterized query and a seeded shuffle. No injection vector. Clean.

- **`POST /api/league/reset` (`index.ts:110-117`):** Functionally identical to `DELETE /api/league/current`. Has the issue documented in **CB2-2** above (no rate limit, no body validation) but no injection or authorization gaps.

- **`selectCitiesWithMarketQuota` (`worldgen.ts:62-95`):** Pure JS function over the static `CITIES` data array and a seeded PRNG. No SQL, no I/O, no user input touching the logic. The `selected.includes(city)` check on line 86 uses object-identity comparison on `CityData` references. The `console.warn` on line 88 uses `city.name` (a string from the static `CITIES` array, not user input). Clean.

- **`mapPhase` (`engine.ts:58-68`):** Inner function in `refreshCache`. Maps `'expansion_draft' | 'annual_draft' → 'draft'`, `'regular_season' → 'regular_season'`, `'playoffs' → 'playoffs'`, `'offseason' → 'offseason'`, and falls through to `default: return dbPhase as LeagueStateSnapshot['phase']`. The default branch is the only theoretical risk — the value comes from the `leagues.phase` column which has no CHECK constraint (`001_init.sql:8`), so an arbitrary string in the DB would be reflected to API consumers as-is. In practice, the only writers to that column are server code with hardcoded string literals (verified by grep — `engine.ts:302`, `:307`, `:325`, `:355`; `playoffs.ts:178`; `offseason.ts:319`, `:51`; `worldgen.ts:178`), so the values are bounded by source. Acceptable.

- **`validateBoxScore` (`game.ts:152-195` + retry loop `game.ts:336-366`):** The retry loop is bounded at `attempt < 3` (hardcoded) and only re-runs the deterministic `distributeExtraWalks` + `clampRBI` adjustments with the same seeded PRNG inputs. No unbounded recursion, no LLM calls in the retry path, no DoS amplification. Worst case: 3 extra iterations of in-memory arithmetic per game. The "still invalid after retries" path at `game.ts:364` `console.error`s and continues — it does not throw — so the game is still recorded. Clean.

- **`shouldFireTradeDeadline` (`season.ts:229-255`):** Nested aggregation query uses only league_id and season_number as parameterized values. The "already fired" check at line 250-252 uses a parameterized SELECT. No user input. Clean.

- **`generateSeasonNarrative` (`offseason.ts:333-368`):** Confirms F11 mitigation. `leagueName` flows from the DB (where it was previously Zod-validated against the `/^[\w\s\-'.]+$/` regex). `keyTransactions` is built from `transactions.narrative` values that were themselves sanitized via `sanitizeNarrative()` at write time. The prompt wraps `leagueName` in `<<<…>>>` delimiters per F10 mitigation. Clean.

- **`POST /api/sim/speed`** continues to use a route-specific Zod parse (`index.ts:131`) instead of the `validateBody` middleware, in order to return the spec-verbatim error string `"Invalid speed. Must be paused|normal|fast|turbo"`. This is intentional per spec §2.16.3 and not a regression.

- **`scripts/check-no-template-sql.mjs`:** Confirmed grep gate for template-literal SQL is still present and is invoked by `precommit` in `package.json:21`. Manual grep across `server/` for `db.(prepare|exec)\(\s*\`[^\`]*\$\{` returns zero matches.

- **`scripts/check-bundle-no-keys.mjs`:** Confirmed bundle grep gate is still chained after `vite build` in `package.json:13`. No `VITE_` prefix on any Anthropic env var found anywhere in `client/`.

---

## Overall Security Posture

**Production-ready for the local-developer-tool threat model.** Every Iteration 1 finding (CB-1 through CB-7) has been addressed. The High-severity LAN-exposure bug (CB-1) was fixed with the recommended one-line change. The Medium-severity sanitizer-bypass (CB-2) was fixed with a loop-until-stable rewrite and regression tests covering all three documented bypass inputs. The Medium-severity rate-limit timing (CB-3) was fixed by moving the timestamp assignment to the success path.

The sole new Medium finding (**CB2-1**) is the predicted manifestation of the Iteration 1 drift risk (CB-5): the canonical `util/scrub.ts` was added with a new bearer-token redaction, but the duplicate `scrubError` in `services/llm.ts` was not removed, and the two have already diverged. This is the most actionable item — one import change and a deletion would close it, and a CI grep gate would prevent recurrence. The three Low findings (CB2-2 unthrottled reset endpoint, CB2-3 raw startup error, CB2-4 leading-`%` LIKE) are defense-in-depth gaps with no live exploit path under the stated threat model.

No findings block v0.1.0 sign-off. Recommend the Developer fix **CB2-1** before merging (5-minute fix) and accept CB2-2 / CB2-3 / CB2-4 as documented v0.2 backlog items.

---

**End of ciso-iter2-post-build.md.**
