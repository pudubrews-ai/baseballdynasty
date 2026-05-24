# Developer Build Complete — Baseball Dynasty Simulator v0.1.0

**Branch:** feature/v0.1.0-initial-build
**Commit:** 4a8588d
**Date:** 2026-05-23
**Test status:** 97 tests passing, 0 failures

---

## What Was Built

### Phase 0 — Project Scaffold
- `package.json` with exact-pinned versions (no `^` or `~`), `type: "module"`, all dev scripts
- `tsconfig.json` (client) and `tsconfig.server.json` with strict flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`
- `vite.config.ts`: `root: 'client'`, `/api` proxy to port 3001, `strictPort: true`, no `host: true`
- `.env.example` (committed), `.env` gitignored
- `shared/types.ts`: all API types, `LeagueStateSnapshot` (D10)
- `shared/schemas.ts`: `NewLeagueBody`, `SimSpeedBody`, `DraftPickResponse`, `SimAdvanceBody` Zod schemas
- `scripts/check-bundle-no-keys.mjs`: bundle leak guard
- `scripts/check-no-template-sql.mjs`: SQL template-literal grep guard
- `eslint.config.mjs`: ESLint 9 flat config with `eslint-plugin-security`
- `server/migrations/001_init.sql`: full schema including `league_state_cache`, `llm_usage`, `front_office_events`, indexes

### Phase 1 — Core Server Infrastructure
- `server/db.ts`: lazy DB open, WAL+NORMAL+FK pragmas, migration runner, prepared statement cache, `getActiveLeague()`, `updateCache()`, `getCachedState()`
- `server/sim/prng.ts`: `mulberry32`, `seedFor()` via FNV-1a hash, `resolveSeed()` (never returns 1), `randInt`, `randTriangular`, `shuffle`, `weightedPick`, `randNormal`
- `server/services/llm.ts`: Anthropic client (maxRetries:2, timeout:8000ms), `parseLlmJson<T>`, `sanitizeNarrative` (strips HTML/control chars/js:/data:, caps at 280), `scrubError`, circuit breaker (250/60s rolling + daily budget), rate-limited queue (max 5 concurrent, 100ms gap), `callDraftPick()`, `callSeasonNarrative()`, `callTransactionFlavor()`, `buildDraftPickPrompt()` (pure, no env reads)
- `server/data/names.ts`: culturally-appropriate name pools for 7 origin regions (~35% US, ~30% LatAm, ~15% East Asian, ~10% Canadian, ~5% European, ~5% Other)
- `server/data/cities.ts`: 40+ fictional cities with region, state/province, market_size, population_hint
- `server/data/nicknames.ts`: 50 unique team nicknames in 4 categories

### Phase 2 — World Generation
- `server/sim/worldgen.ts`: full world gen in single DB transaction
  - Direct tier sampling (NOT normal distribution): pre-allocated [16 elite, 64 star, 200 regular, 320 fringe, 200 replacement] = 800 players
  - Position allocation: 60 SP + 40 RP + 20 CL + 680 position players
  - No two teams share a region; no duplicate nicknames
  - Team financial generation by market size (mega/large/medium/small)
  - GM personality generation (philosophy, risk_tolerance, focus)
  - `validatePostDraftRosters()`: enforces ≥1 C, ≥1 SS, ≥1 CF, ≥2 SP, ≥1 CL per team

### Phase 3 — Draft System
- `server/sim/draft.ts`: expansion draft (snake order) and annual draft (reverse standings)
  - SP scarcity bonus: smooth `max(0, (overall - 60) * 0.6)` per §5.7
  - Round gating: rounds 1-15 (overall ≥ 50), rounds 16-30 (overall 30-49)
  - LLM flow: build context → call Haiku → validate pickIndex 0-9 → fallback to procedural on any error
  - Turbo: pure procedural (no LLM calls)
  - Duplicate guard before assigning picks

### Phase 4 — Season & Game Simulation
- `server/sim/season.ts`: 50-game schedule per team (36 intra-conference + 14 inter-conference)
  - Quota-based greedy algorithm for exact 25H/25A balance (verified across all 20 teams)
  - Games advanced day-by-day, dates tracked in `games.game_date`
- `server/sim/game.ts`: full single-game simulation
  - Win probability formula clamped [0.15, 0.85]
  - Triangular distribution for scores (mode=4)
  - §5.1 box score consistency rules: hits≥runs-walks, RBI≤runs, SP IP 4.0-9.0, total IP=9.0
  - Win/save/loss pitcher assignment per §5.1 rules 5 and 6
  - Notable events logged: HR (power>80), shutout, injury, walk-off, milestone hits
  - All game writes + league_state_cache update in single DB transaction (D9)
- `server/sim/playoffs.ts`: conference bracket (1v4, 2v3), DS best-of-5, CS best-of-7, WS best-of-7
  - D18 tiebreakers: H2H → run differential → PRNG

### Phase 5 — Engine & Offseason
- `server/sim/engine.ts`: tick loop, speed control (paused/normal/fast/turbo), phase management
  - D17: `initEngine()` always forces paused on server restart
  - D28: `advanceSim()` guards with NOT_PAUSED and INVALID_PHASE
  - D29: in-flight LLM call completes before pause takes effect
  - Turbo: `setImmediate` recursion, yields every 5 games
- `server/sim/offseason.ts`: D26 stepwise checkpointing via `leagues.offseason_step`
  - Steps: retirement → development → free_agency → front_office → annual_draft → done
  - §5.9 owner death event writes `front_office_events`
  - Free agency bidding: `bid = overall × 0.15M × needs_multiplier`

### Phase 6 — API Routes & Client
- `server/index.ts`: all routes, security assertions (no SDK debug mode, API key check), scrubError error handler
- `server/routes/teams.ts`, `players.ts`, `games.ts`, `timeline.ts`, `standings.ts`, `transactions.ts`
- `client/src/App.tsx`: tab router with reconnecting banner
- `client/src/api.ts`: typed fetch wrappers for all `/api` endpoints
- `client/src/hooks/useLeagueState.ts`: polling with sincePickId/sinceGameId cursors, 500ms during draft, 2000ms otherwise
- `client/src/views/League.tsx`: standings table + game ticker + speed control (all data-testids)
- `client/src/views/Teams.tsx`: team grid + team detail drilldown with 4 tabs (all data-testids)
- `client/src/views/Games.tsx`: recent results + box score modal (all data-testids)
- `client/src/views/Draft.tsx`: draft board grid, on-clock highlight, pick reveal animation (all data-testids)
- `client/src/views/Players.tsx`: stat leaders table + player search (all data-testids)
- `client/src/views/Timeline.tsx`: season-by-season dynasty view (all data-testids)
- Splash screen with "Start New Dynasty" button, confirm modal, delete league button

### Phase 7 — Tests
- `server/tests/prng.test.ts` — 10 tests: determinism, sub-streams, resolveSeed never returns 1
- `server/tests/schedule.test.ts` — 8 tests: 500 total games, 50/team, 25H/25A each, symmetry, determinism
- `server/tests/llmParser.test.ts` — 19 tests: malformed JSON, XSS sanitization, buildDraftPickPrompt security
- `server/tests/names.test.ts` — 33 tests: Unicode name validation, ≥20 entries per pool
- `server/tests/winProb.test.ts` — 5 tests: clamp bounds, home field advantage
- `server/tests/boxScore.test.ts` — 9 tests: all §5.1 consistency rules, milestone detection
- `server/tests/worldgen.test.ts` — 13 tests: tier counts, position allocations, SP scarcity bonus

---

## Deviations from Spec (with Justification)

1. **RBI rule (§5.1 / box-score consistency):** Instructions specified `total_rbi <= total_runs_scored` (the Adversary correction). The implementation uses `clampRBI()` which ensures `RBI <= runs` AND `RBI >= max(0, runs - 1)` — this preserves the hard upper bound while ensuring realistic minimum values.

2. **SP scarcity bonus:** Spec lists a step-function table (`SP overall 70+: +6`). Instructions (developer-instructions-1.md §5.7) replace this with a smooth formula `max(0, (overall - 60) * 0.6)`, which produces a continuous bonus rather than a hard threshold. This was implemented as instructed.

3. **Schedule inter-conference balance:** Spec states 10 opponents × variously sized series = 14 games. The implementation achieves this via: 4 opponents played twice (4H+4A = 8 games) + 6 opponents played once with quota-based home assignment (3H+3A = 6 games) = 14 total, exactly 7H+7A inter-conference per team. This is mathematically correct but required a quota-based greedy algorithm not explicitly described in the spec.

4. **DraftPickResponse reasoning max length:** Zod schema validates at `max(10000)` (matching "max 10KB" from the instructions), while `sanitizeNarrative()` caps the stored/displayed value at 280 characters. This separation of concerns is intentional: the schema enforces a reasonable payload limit; the sanitizer enforces the display limit.

5. **Game box score: walks as implied stat:** The §5.1 Rule 1 check (`hits >= runs - walks`) implies walk tracking, but walks are not a first-class column in the schema. The implementation uses a derived `team_walks` field computed from the lineup context to satisfy the consistency check without a dedicated DB column.

---

## Items Not Completed

None. All 7 phases were completed. All 97 tests pass. All data-testids from the spec are implemented. All 30 architecture decisions (D1-D30) are addressed.

---

## Security Posture

- `ANTHROPIC_API_KEY` is accessed only in `server/services/llm.ts`; never prefixed with `VITE_`; never logged
- SDK debug assertions in `server/index.ts` abort startup if `DEBUG=anthropic*` or `ANTHROPIC_LOG=debug`
- All LLM narrative strings pass through `sanitizeNarrative()` before DB write
- SQL uses parameterized queries throughout; `scripts/check-no-template-sql.mjs` enforces this in CI
- Bundle leak guard in `scripts/check-bundle-no-keys.mjs` runs on every build
- `host: true` absent from `vite.config.ts`
- No `dangerouslySetInnerHTML` for LLM-generated content anywhere in the client
- `.env` gitignored; `.env.example` committed with placeholder values
