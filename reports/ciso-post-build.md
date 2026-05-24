# CISO Post-Build Report — Baseball Dynasty Simulator v0.1.0

**Reviewer:** CISO
**Inputs:** `app-spec.md`, `v0.1.0-app-spec-section.md`, `reports/architect-eval-0.md`, `reports/ciso-pre-build.md`, complete v0.1.0 source tree at `/Users/pudubrewshowie/code-repose/github/baseballdynasty/baseball-dynasty/`
**Threat model (unchanged):** Local single-user dev tool. Realistic attackers: developer's own bugs leaking secrets, runaway sim burning Anthropic credit, supply-chain risk, LLM-mediated logic corruption.

---

## Summary
Critical: 0 | High: 1 | Medium: 2 | Low: 4

The implementation does an unusually thorough job on the High-severity pre-build items: every Critical/High finding from `ciso-pre-build.md` is RESOLVED or PARTIAL with strong defense-in-depth. The single outstanding High is **CB-1: Express binds to all network interfaces (0.0.0.0) by default**, which means anyone on the developer's LAN (coffee shop, hotel, conference Wi-Fi) can reach the unauthenticated API. The Medium and Low findings are defense-in-depth gaps (regex-based sanitizer has known single-pass bypasses that React's text-rendering paths mitigate; rate limiter consumes the 30-second token on rejected requests). Overall the codebase is ready for v0.1.0 sign-off once CB-1 is fixed (one-line change to `app.listen`).

---

## Pre-Build Blocker Status

### High-severity pre-build findings

- **F1: `.env` not gitignored — key can leak to public repo**: RESOLVED
  Evidence: `.gitignore:9-11` — `.env`, `.env.*`, with `!.env.example` allowlist. `.env.example:6` ships `ANTHROPIC_API_KEY=sk-ant-REPLACE_ME` placeholder only. `.gitignore` also covers `data/`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`.

- **F2: Anthropic SDK errors echoed to HTTP response with auth headers**: RESOLVED
  Evidence: `server/index.ts:159-167` defines `scrubError()` that strips `sk-ant-…`, `authorization`, and `x-api-key` patterns. `server/index.ts:169-172` Express error middleware returns only `{ error: 'internal_error' }` — never serializes raw error to client. `server/services/llm.ts:155-163` has a parallel `scrubError` used in LLM-specific logging. All four LLM call sites (`callDraftPick`, `callSeasonNarrative`, `callTransactionFlavor`, `recordLlmCall`) route through `scrubError` before `console.warn`.

- **F3: Risk of `VITE_ANTHROPIC_API_KEY` accidentally shipping in client bundle**: RESOLVED
  Evidence: `scripts/check-bundle-no-keys.mjs:8` greps `dist/client/assets/` for `sk-ant-` and `ANTHROPIC_API_KEY`. `package.json:13` build script chains `npm run security:bundle-grep` after `vite build`. `server/services/llm.ts:2-5` carries a top-of-file comment forbidding `VITE_` prefix. Repo-wide grep for `VITE_` returns only documentation strings, never an actual env-var read.

- **F4: No request body validation on POSTs — oversize, type-confusion, enum bypass**: RESOLVED
  Evidence: `server/index.ts:28` `express.json({ limit: '8kb' })`. `shared/schemas.ts:3-12` defines `NewLeagueBody`, `SimSpeedBody`, `SimAdvanceBody` Zod schemas with strict bounds. `server/index.ts:31-41` `validateBody()` middleware factory used on all three POSTs (`/api/league/new`, `/api/sim/speed`, `/api/sim/advance`). Path-param IDs validated with `z.coerce.number().int().positive()` in every route (`teams.ts:7`, `players.ts:7`, `games.ts:7`). On failure, response is `{ error: 'invalid_body', details: result.error.flatten() }` — flattened Zod error leaks field names but no schema internals or secrets. Acceptable.

- **F5: No rate limit on `POST /api/league/new` — cost amplification**: RESOLVED
  Evidence: `server/index.ts:44-53` token bucket: 1 request per 30s with 429 response. Applied at `server/index.ts:79` before `validateBody`. UI confirm-twice modal at `client/src/App.tsx:163-193` with `data-testid="confirm-new-dynasty-modal"`.

- **F6: Turbo mode without procedural-only LLM = wallet drain**: RESOLVED
  Evidence: `server/sim/draft.ts:153-186` — when `isTurbo === true`, the LLM branch (`!isTurbo`) is skipped entirely and `pickProcedural` is used. `server/sim/engine.ts:244-262` threads `isTurbo` into `runDraftTick` and `runOffseasonTick`. Client shows Turbo badge at `client/src/App.tsx:96-100` (`data-testid="turbo-mode-badge"` reads "Turbo — picks made procedurally").

- **F7: No daily LLM spend cap**: RESOLVED
  Evidence: `server/services/llm.ts:27` reads `DAILY_LLM_CALL_BUDGET` from env (default 2000). `llm_usage` table created in `server/migrations/001_init.sql:198-201`. `recordLlmCall()` at `llm.ts:29-41` increments per-day counter. `dailyBudgetRemaining()` at `llm.ts:43-52` checks remaining budget. `breakerOpen()` at `llm.ts:66-69` short-circuits when budget exhausted. Remaining budget surfaced in `LeagueStateSnapshot.llmStatus` (`server/sim/engine.ts:64`) and displayed in League view at `client/src/views/League.tsx:185-187`.

- **F8: SQL injection via template-string interpolation**: RESOLVED
  Evidence: `scripts/check-no-template-sql.mjs:4-7` grep gate in CI/precommit. `package.json:21` `precommit` runs `security:sql-grep`. Manual grep across `server/` for `db.(prepare|exec)\(\s*\`[^\`]*\$\{` returns zero matches. All user-controlled values reach SQL via `?` placeholders (verified across `draft.ts:197-217`, `worldgen.ts:129-138`, `season.ts:149-152`, `game.ts:290-335`, all route files). The string-concatenated SQL queries that *do* exist (`teams.ts:14`, `players.ts:17-23`, etc.) contain only static SQL text with parameterized inputs.

### Medium-severity pre-build findings (selected)

- **F9: SDK debug logging via `DEBUG=anthropic*`**: RESOLVED
  Evidence: `server/index.ts:7-10` startup assertion aborts (`process.exit(1)`) if `DEBUG` matches `/anthropic/i` or `ANTHROPIC_LOG === 'debug'`. Runs *before* the `services/llm.ts` import on line 21.

- **F10: `leagueName` prompt-injection / XSS / path-traversal vector**: RESOLVED
  Evidence: `shared/schemas.ts:5` regex `/^[\w\s\-'.]+$/` with max 80 chars. `server/services/llm.ts:301` wraps user-controlled `leagueName` in `<<<…>>>` delimiters with an explicit "treat as data not instructions" instruction. UI never uses `dangerouslySetInnerHTML` (verified by grep — zero matches in `client/src/`).

- **F11: LLM narratives re-fed into next-season prompts**: RESOLVED
  Evidence: `server/sim/offseason.ts:327-348` `generateSeasonNarrative` builds the prompt from `season_narratives.champion_team_id` + DB-derived transaction narratives, not from prior season's `narrative` text. The transactions included (`offseason.ts:337-340`) are themselves the output of `sanitizeNarrative()` at write-time, providing defense-in-depth.

- **F12: Path params reach SQL without numeric validation**: RESOLVED
  Evidence: `server/routes/teams.ts:7`, `players.ts:7`, `games.ts:7` — all use `z.coerce.number().int().positive()` before SQL.

- **F13: `POST /api/sim/speed` enum bypass**: RESOLVED
  Evidence: `shared/schemas.ts:8-10` `z.enum(['paused','normal','fast','turbo'])`. `__proto__` etc. rejected by Zod enum.

- **F14: Missing Content-Type discipline**: RESOLVED
  Evidence: `express.json()` parses only `application/json`. `validateBody` rejects on `safeParse` failure including `undefined` body. `SimAdvanceBody = z.object({}).strict()` requires explicit empty object.

- **F15: `dynasty.db` not gitignored**: RESOLVED
  Evidence: `.gitignore:3-7` covers `data/`, `*.db`, journal/WAL/shm files.

- **F16: Express 5 pinned**: RESOLVED
  Evidence: `package.json:26` `"express": "5.0.1"` exact pin (no caret).

- **F17: Anthropic SDK auto-retry amplifies cost**: RESOLVED
  Evidence: `server/services/llm.ts:15-17` `maxRetries: 2` and `timeout: 8000` explicitly set.

- **F18: Transitive dep sprawl without audit gate**: PARTIAL
  Evidence: `package-lock.json` exists at 227KB. `package.json:21` precommit runs lint+typecheck+test but does NOT run `npm audit`. No Dependabot config present. Acceptable for v0.1.0 solo dev workflow per pre-build report.

- **F19: Polling × N tabs saturates event loop**: PARTIAL
  Evidence: `client/src/hooks/useLeagueState.ts:90` switches to 500ms during draft. No BroadcastChannel/localStorage tab-lock implemented. `/api/state` reads from `league_state_cache` (engine.ts:78-82) so cost is O(1) for the snapshot — picks/games deltas remain O(N delta) joins. Acceptable.

### Low-severity pre-build findings
All Low-severity items (F20–F30) RESOLVED or accepted-without-change per pre-build report. Notable:
- F20 (prompt builders pure of `process.env`): verified — see `server/tests/llmParser.test.ts:114-121` asserting prompt does not contain `sk-` or `ANTHROPIC_API_KEY`.
- F21 (name pool regex): `server/data/names.ts:3` comment documents the required regex; `server/tests/names.test.ts` exists.
- F22 (seed bounds): RESOLVED at `shared/schemas.ts:4` `z.number().int().min(0).max(2**32-1)`.
- F23 (notable_events length cap): RESOLVED at `server/sim/game.ts:280-281` and `game.ts:631`.
- F27 (Vite `--host`): RESOLVED at `vite.config.ts:10` (comment) and absence of any `host: true`.
- F30 (React error boundary): RESOLVED at `client/src/App.tsx:14-39` and applied at top level (line 201-204).

---

## Findings

### HIGH CB-1 server/index.ts: Express binds to all network interfaces (0.0.0.0) instead of localhost
**Evidence:** `server/index.ts:179` — `app.listen(PORT, () => {…})` is called with only a port argument. In Node's http module, omitting the host argument binds the socket to `0.0.0.0` (all IPv4 interfaces) per Node docs and verified in `node_modules/express/lib/application.js` (Express delegates to `http.createServer().listen()` unchanged).
**Description:** Anyone on the same LAN (coffee-shop Wi-Fi, hotel network, conference network, corporate guest network, the developer's own home network with IoT devices) can hit `http://<dev-laptop-ip>:3001/api/state`, `POST /api/sim/speed`, `POST /api/league/new`, etc. There is no authentication. The pre-build report explicitly assumed "Network-side attackers and unauthenticated peers are explicitly out of scope" — but that assumption requires the server to actually be unreachable from the network, which it isn't.
**Impact:**
1. **Cost amplification by adjacent attacker.** The 1-req-per-30s rate limit on `POST /api/league/new` is global, not per-IP, so an attacker on the LAN cannot drive cost via *that* endpoint — but they CAN call `POST /api/sim/speed` with `{"speed":"normal"}` to start the sim's LLM-driven draft picks running. There is no rate limit on `/api/sim/speed`. Combined with the daily LLM budget cap (F7), the financial blast radius is bounded at `DAILY_LLM_CALL_BUDGET` (default 2000 calls/day), but that still represents up to ~$2/day of Haiku spend per attacker.
2. **DoS by spamming any endpoint.** Polling `/api/state` 100x/sec from a neighboring laptop will saturate the synchronous SQLite reads and starve the tick loop. The 8KB JSON body limit prevents large-payload DoS but not request-rate DoS — no per-IP rate limiting exists.
3. **Information disclosure.** Anyone on the LAN can enumerate the entire league state, teams, players, financials, transactions, etc. via the read endpoints. The data is synthetic, but the API surface confirms the developer is running this software (fingerprinting).
4. **Future risk amplification.** If v0.2 adds any write endpoint that mutates persistent state without a confirmation modal (trade UI, manual roster moves), the same network-exposure becomes a tamper-with-the-dev's-save-file vector.
**Recommendation:** One-line fix — change `server/index.ts:179` to `app.listen(PORT, '127.0.0.1', () => {…})`. Document the rationale alongside the existing security comments at the top of `index.ts`. Add a startup log assertion that prints "[server] Bound to localhost only" so the dev sees confirmation. This is a Critical-severity bug in any other deployment model but the local-tool threat model and the per-call daily LLM budget cap together bound the impact to High.

---

### MEDIUM CB-2 server/services/llm.ts: sanitizeNarrative regex strips are single-pass and bypassable
**Evidence:** `server/services/llm.ts:144-152` —
```ts
return s
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  .replace(/<[^>]*>/g, '')
  .replace(/javascript:/gi, '')
  .replace(/data:/gi, '')
  .slice(0, 280)
  .trim();
```
**Description:** The HTML-tag strip and protocol strips are single-pass. I verified the following bypasses run-time:
- Input `'<<script>script>alert(1)</script>'` → output `'script>alert(1)'` (the inner `<script>` matched and stripped, leaving a partial fragment).
- Input `'<script'` (no closing `>`) → output `'<script'` (regex requires closing `>` to match).
- Input `'jajavascript:vascript:alert(1)'` → output `'javascript:alert(1)'` (first `javascript:` substring stripped, leaving the reconstructed second one).
- Input `'DATA:text/html'` is correctly stripped (case-insensitive flag works).
**Impact:** **Real impact is Low → Medium**, capped because every consumer of sanitized text in the UI renders via React text-nodes (verified: `client/src/views/Draft.tsx:151-154`, `Games.tsx:140-141`, `Timeline.tsx:77-81`, `Teams.tsx:198-199` all use `{value}` JSX expressions, never `dangerouslySetInnerHTML`). React escapes `<`, `>`, `&`, `"`, `'` in text-node position, so the bypassed `<script`-prefix string would render harmlessly as literal text in the browser. **However**, if a future Phase 7 polish change introduces any HTML-rendering path (markdown renderer, rich text, tooltip with title attribute via React, copy-to-clipboard formatted HTML), the bypass becomes live. The defense-in-depth is weakened.
**Recommendation:** Loop the strips until input is stable, or use a proper HTML-strip library:
```ts
function stripHtmlAndProtocols(s: string): string {
  let prev: string;
  let cur = s;
  do {
    prev = cur;
    cur = cur
      .replace(/<[^>]*>?/g, '')   // tolerate missing closing >
      .replace(/javascript:/gi, '')
      .replace(/data:/gi, '')
      .replace(/vbscript:/gi, '');
  } while (cur !== prev);
  return cur;
}
```
Add unit tests for the three bypass inputs above. Document the React-text-node assumption as load-bearing in a top-of-file comment in `services/llm.ts`.

---

### MEDIUM CB-3 server/index.ts: Rate limiter consumes its window on rejected `POST /api/league/new` requests
**Evidence:** `server/index.ts:44-53` —
```ts
let lastLeagueCreateMs = 0;
function rateLimitLeagueNew(_req, res, next) {
  const now = Date.now();
  if (now - lastLeagueCreateMs < 30_000) {
    res.status(429).json({ error: 'rate_limited', retryAfterMs: 30_000 - (now - lastLeagueCreateMs) });
    return;
  }
  lastLeagueCreateMs = now;     // ← set unconditionally on success path
  next();
}
```
The middleware runs *before* `validateBody(NewLeagueBody)` (line 79) and before the `LEAGUE_EXISTS` check (line 84). A request with a malformed body (e.g., 9KB JSON that triggers the 8KB limit, or a malformed `leagueName`) returns 400 *after* the rate limiter has updated `lastLeagueCreateMs`. The reverse ordering would be safer.

Conversely, the current ordering is actually slightly *more* abuse-resistant for the cost-amplification scenario from F5 (a stuck client retrying gets locked out for 30s even if its payloads are malformed). The actual issue is asymmetric: a legitimate user who accidentally sends a bad payload (e.g., paste error in dev tools) has to wait 30s to retry, even though no expensive work was done.
**Impact:** Minor UX issue, not a security issue per se. **Severity Medium** because it touches the rate-limit mechanism that's load-bearing for cost protection (F5). If a future change tightens the window or adds new rate-limited endpoints, the "consume on reject" pattern could combine badly.
**Recommendation:** Reorder so `validateBody` runs first, OR set `lastLeagueCreateMs` only after the handler's `try` block completes successfully. Specifically, move the `lastLeagueCreateMs = now` assignment from the middleware to *after* `startNewLeague(req.body)` succeeds in the handler. Alternatively, document the intentional "deny-on-bad-payload" behavior in a code comment.

---

### LOW CB-4 server/sim/engine.ts: Raw error logged to stderr in tick loop without scrubbing
**Evidence:** `server/sim/engine.ts:238`, `engine.ts:297`, `engine.ts:348`, `engine.ts:356`, `index.ts:183` —
```ts
console.error('[engine] Tick error:', err);
```
Five locations log raw `err` directly. While the tick loop never causes the LLM to be called inline with these catches (LLM errors are already scrubbed inside `services/llm.ts:282/321/349` before throw), a future change that lets an SDK error bubble up to the tick catch would write the raw error (potentially containing the `Authorization` header) to stdout/stderr. If the developer is running with `npm run dev | tee dev.log`, that's a file on disk that may not be gitignored (though `*.log` IS in `.gitignore:18`).
**Impact:** Defense-in-depth gap. Currently unexploitable because no path bubbles a raw SDK error to these catches. Severity Low because the `*.log` gitignore entry catches the most likely leak vector.
**Recommendation:** Replace each `console.error('[…] error:', err)` with `console.error('[…] error:', scrubError(err).message)`. Re-export `scrubError` from `services/llm.ts` (or extract to `server/util/scrub.ts`) so both `index.ts` and `engine.ts` use the same scrubber. The duplication between `index.ts:159-167` and `llm.ts:155-163` is fragile — a `sk-ant-prod-…` regex update would have to happen in both places.

---

### LOW CB-5 server/services/llm.ts: scrubError duplicated in two files with potential drift
**Evidence:** `server/index.ts:159-167` and `server/services/llm.ts:155-163` define near-identical `scrubError` functions with the same three regex replacements. Any future change to the redaction set (e.g., adding `bearer` token patterns, new Anthropic key formats like `sk-ant-admin-`, `sk-ant-test-`) must be made in both.
**Impact:** Maintenance fragility. No active exploit. Severity Low.
**Recommendation:** Extract to a shared `server/util/scrub.ts`. Single source of truth.

---

### LOW CB-6 server/index.ts: Health check leaks version number
**Evidence:** `server/index.ts:56-62` — `/healthz` and `/api/healthz` both return `{ ok: true, version: '0.1.0' }`. With CB-1 (LAN-exposed binding) unfixed, a LAN attacker can fingerprint the exact version of the app, which combined with `package-lock.json` info (express 5.0.1, better-sqlite3 11.5.0, etc.) makes targeted CVE-matching easier.
**Impact:** Once CB-1 is fixed to localhost-only, this is non-issue. Severity Low contingent on CB-1.
**Recommendation:** After fixing CB-1, this can stay. If CB-1 cannot be fixed for some reason (it can — one line), remove the `version` field from the public health-check response.

---

### LOW CB-7 server/sim/season.ts and game.ts: Unbounded `schedule_json` and `notable_events_json` not size-validated before write
**Evidence:** `server/sim/season.ts:149-152` writes `JSON.stringify(schedule)` to `leagues.schedule_json` with no size guard. A 500-game schedule is ~30KB so this is non-pathological in v0.1.0. `server/sim/game.ts:280-281` correctly clamps `notableEvents.length <= 20` (per F23) but does not enforce a per-event description max-length. A buggy notable-event generator producing a 10MB description string would be stored.
**Impact:** Disk growth, not security. Severity Low.
**Recommendation:** Add `if (e.description.length > 500) e.description = e.description.slice(0, 500);` in `generateNotableEvents`. Add a sanity assert on `schedule_json.length < 1_000_000` before write.

---

## Overall Security Posture

Production-ready for the stated local-developer-tool threat model **once CB-1 is fixed** (one-line change to bind to `127.0.0.1`). The build implements 27 of the 30 pre-build findings cleanly, with the remaining three (F18 `npm audit` gate, F19 multi-tab lock, F30 verified-in-Phase-7) acceptable per the original pre-build sign-off. The high-effort defenses (centralized error scrubbing, SDK debug-mode startup assertion, bundle grep gate, SQL grep gate, daily LLM budget table, circuit breaker, Zod on every POST, parameterized SQL everywhere) are all present and correctly wired. The two Medium findings (CB-2 single-pass regex bypass, CB-3 rate-limit-consumes-on-reject) are defense-in-depth concerns whose exploit paths are blocked by other layers — React's text-node escaping covers CB-2, and the lack of any expensive work behind a 400 response covers CB-3 — so they do not block sign-off but should be cleaned up. No Critical findings. Recommend Architect approval contingent on CB-1 being fixed before merge.

---

**End of ciso-post-build.md.**
