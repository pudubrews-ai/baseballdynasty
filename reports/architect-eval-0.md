# Architect Evaluation — v0.1.0 (Pre-Build)

**Reviewer:** Architect
**Inputs:** `app-spec.md`, `v0.1.0-app-spec-section.md`
**Status:** Pre-build gate. This document feeds `developer-instructions-1.md`.

---

## TL;DR

The spec is unusually concrete for a v0.1.0 (good prompts, formulas, edge cases, testids). But it has **structural contradictions** between the two documents and several **runtime correctness traps** that will cause rework if not resolved before the Developer starts. The single highest-risk issue is **mixing synchronous better-sqlite3 with a 2s polling loop and a tick-based LLM-driven sim** — without explicit transaction discipline and a write-then-tick invariant, the UI will display torn state. Resolve the items in Section 3 before writing code.

---

## 1. Spec Completeness Assessment

### 1a. Cross-document contradictions (MUST resolve before build)

| # | Field | `app-spec.md` says | `v0.1.0-app-spec-section.md` says | Resolution |
|---|---|---|---|---|
| C1 | GM philosophy enum | `analytics / old-school / balanced` | `Win-now / Rebuild / Balanced` | Use the v0.1.0 section values. They drive LLM prompts and are richer. Update `app-spec.md` after build. |
| C2 | GM aggression vs risk tolerance | `gm_aggression: conservative/moderate/aggressive` | `Risk Tolerance: Conservative/Moderate/Aggressive` + a new `Focus` axis | Use the v0.1.0 three-axis model (Philosophy + Risk Tolerance + Focus). Rename DB column `gm_aggression` to `gm_risk_tolerance` and add `gm_focus`. |
| C3 | Storage shape for GM personality | Flat columns on `teams` | "stored ... as a JSON object" | Pick one. **Use flat columns** (`gm_philosophy`, `gm_risk_tolerance`, `gm_focus`) — better for SQL, indexing, and migrations. The "serialize as string" step is a render concern, not a storage concern. |
| C4 | Draft pool talent gating | "First 15 rounds: MLB-level players ... Rounds 16-30: minor league players assigned to org levels" | "First 15 rounds: players rated overall 50+; Rounds 16-30: players rated overall 30-49" | Use the v0.1.0 numeric thresholds. Also add post-draft step: top 25 picks per team → MLB/40-man, picks 26-30 → AAA/AA/A/Rookie by rating tier. |
| C5 | Draft order | "snake order" for expansion (v0.1.0) | App spec implies straight order for annual draft (reverse standings, 30 rounds) | Expansion = snake, Annual = straight reverse-standings. Document both in code comments. |
| C6 | Local dev URL | `http://localhost:3001` (app-spec) | Vite at `5173`, Express at `3001`, proxy `/api` (v0.1.0) | Both are correct — clarify: **user-facing URL is 5173**, API is 3001. Fix `app-spec.md` after build. |
| C7 | Tick rate | "Normal: 1 game per 800ms" | not restated | OK — adopt as-is. |
| C8 | Notable events list | App-spec lists "HR, injuries, ejections" | v0.1.0 lists HR > 80 power, shutout, in-game injury, walk-off, career milestones | Use v0.1.0 list. Ejections deferred. |

### 1b. Gaps the Developer will hit and have to guess at

1. **Schedule generation algorithm is undefined.** "Round-robin scheduling, 50 games, 20 teams" — 50 games over 20 teams in a round-robin doesn't divide cleanly (19 opponents × ~2.6 games each ≈ 50). The Developer needs a deterministic generator. **Decision:** each team plays every other team in its **conference (9 opponents × 4 games = 36)** + selected opponents in the other conference (10 opponents × 1.4 games... no). Cleaner: each team plays its 9 conference opponents 4 times each = 36 games + each of the 10 cross-conference opponents ~1.4 times. Pick: **conference rivals × 4 + interconference × 1 + 4 extra divisional games = 50.** Document the exact formula in `season.ts`.
2. **Roster size is implied but never stated.** App-spec mentions `is_on_40man` and `is_on_25man`. v0.1.0 does not specify how the 800-player pool maps to `20 teams × (25 active + 15 reserve + ~25 minors) = ~1300 slots`. **Math doesn't work.** 800 players / 20 teams = 40 per org. So: 25 MLB + 15 minors per org. Drop the "40-man" concept for v0.1.0 (or rename — it's actually a 25-man + 15-man minors).
3. **Bullpen, lineup, and rotation construction.** Game sim references "starting pitcher rating", "lineup avg", "bullpen avg". Nothing says how the 25 players become a lineup of 9 + rotation of 5 + bullpen of 6+. **Add:** `selectLineup(team)` and `selectStartingPitcher(team, gameNumber)` helpers in `sim/game.ts`. Rotation rotates SP1-SP5 by gameNumber % 5. Bullpen = all RP/CL on roster.
4. **"Active sim status" on `GET /api/state`.** Not defined what fields are returned. Define a TypeScript interface (`LeagueStateSnapshot`) before the Developer writes the polling hook.
5. **Tier-1 endpoints listed in app-spec but not in scope for v0.1.0 feature section:** `/api/timeline`, `/api/players/leaders`, `/api/transactions`, `/api/games/recent`. The v0.1.0 feature scope says "Everything in app-spec.md is in scope" so these are in. Confirm the Timeline, Players, Games tabs all have minimum viable implementations in v0.1.0 (the roadmap suggests they're for v0.2/v0.3 — **this is a scope contradiction**). **Decision:** v0.1.0 ships all 6 tabs with thin implementations; full polish is roadmap.
6. **Seeded random.** Spec says "Use a seeded random with normal distribution" for ratings but never says the seed source. **Decision:** seed = league `id` (or `created_at` epoch) so a regenerated league with the same id is reproducible. Use a deterministic PRNG (mulberry32 or seedrandom).
7. **LLM cost ceiling.** ~600 calls on expansion draft day at Haiku pricing is fine, but no per-day or per-league budget guard exists. **Add:** a circuit breaker — if >1500 LLM calls in a 10-minute window, force `procedural fallback only` mode and log loudly.
8. **Free agency mechanism.** App-spec mentions it. v0.1.0 doesn't detail it (only `/sim/offseason.ts` is in the file map). The Developer needs at least a procedural fallback rule: "team bids salary = (player_overall × 0.15M) × needs_multiplier, highest bid wins, capped at budget remaining."
9. **No /api/league/new request body.** Does it accept a seed? Team count override? Define: `POST /api/league/new` body `{ seed?: number, leagueName?: string }`. Both optional.
10. **`current_game_date` field type and progression.** Stored as what — ISO string? Epoch? How does it advance per game? **Decision:** epoch ms. Start at season1 = `2026-04-01`. Advance 1 day per game (50 games = 50 days, ~2 months — short but acceptable for v0.1.0).
11. **Trade deadline (game 35) is in scope but undefined in v0.1.0 detail.** Roadmap puts the *UI* in v0.2. The backend trigger should still fire, even with a no-op log. Confirm.
12. **Playoff seeding tiebreakers.** "Top 4 teams per conference" — what if W/L is tied? **Decision:** tiebreaker order: head-to-head, then run differential, then coin flip (deterministic via seed).
13. **Player ID generation.** Auto-increment integer is implied. Confirm consistent FK behavior across all tables.

### 1c. Test spec exists

A `v0.1.0-test-spec.md` is present in the repo root — the Developer must read it before starting and align implementation to its contracts. (Not part of this audit, but flagging it as a required input.)

---

## 2. Architecture Risks

### A1. SQLite synchronous I/O on the request thread *and* the sim tick (HIGH)
`better-sqlite3` is synchronous. Per-tick writes are fine on their own, but:
- Each tick will do: write `game_log`, update `season_stats` for ~20 players, update `teams` (W/L/RS/RA). At Fast (100ms) and Turbo (burst), that's ~25 writes/tick × 10/sec = sustained 250 writes/sec.
- If `GET /api/state` runs a 5-table JOIN during a Turbo burst, it will block the tick.
- **Mitigation:** (a) Wrap each tick's writes in a single `BEGIN/COMMIT` transaction. (b) Enable `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` at db init. (c) Build a denormalized `league_state_cache` row that `/api/state` reads from in O(1) — the tick updates it last.

### A2. Tick loop using `setImmediate` can starve the event loop in Turbo (HIGH)
`setImmediate` recursively scheduled will yield to I/O between ticks, but a Turbo burst that says "sim entire remaining season in one burst, then pause" is described as synchronous. 50 games × N tasks each will block HTTP for seconds.
- **Mitigation:** Turbo should *still* yield every N games (e.g., every 5 games → `await new Promise(r => setImmediate(r))`). Polling at 2s will still feel instant but won't hang requests.

### A3. 2-second polling will miss draft picks at Fast speed (MEDIUM)
Fast draft pick = 200ms. Polling at 2s = miss ~9 picks between polls. The "Pick reveal animation" requires every pick to be shown.
- **Mitigation:** Either (a) drop to 500ms polling during draft phase, or (b) `/api/state` returns a `picks_since: lastSeenPickId` delta. Recommend option (b) — pull all unseen picks since client's last cursor; animate them in sequence.

### A4. LLM concurrency vs sim correctness (MEDIUM)
Draft phase blocks on LLM calls but max 5 concurrent + 100ms gap = ~12 picks/sec ceiling. Spec says "Fast = 200ms/pick" — barely fits. "Turbo = instant" cannot be achieved while waiting on LLM.
- **Mitigation:** In Turbo mode, **bypass LLM entirely** and use procedural fallback for all picks. Surface this in the UI: "Turbo mode — picks made procedurally." Same applies to trade/FA in Turbo.

### A5. LLM JSON parsing fragility (MEDIUM)
"Returns ONLY valid JSON" is a hope, not a guarantee. Haiku can prepend text.
- **Mitigation:** Parser must (a) strip code fences, (b) grab the first `{...}` block via regex, (c) `JSON.parse`, (d) validate shape (Zod or hand-rolled), (e) on any failure → fallback. Tested with deliberate malformed responses.

### A6. No DB migration story (MEDIUM)
"Runs migrations" is mentioned but no migration tool. For v0.1.0 the schema is fixed, but the moment v0.2 adds a column, an ad-hoc `ALTER TABLE` in `db.ts` will become a mess.
- **Mitigation:** Even a trivial `migrations/001_init.sql`, `002_*.sql` system with a `schema_versions` table is enough. Use one now.

### A7. Server restart resume is under-specified (MEDIUM)
"On server restart: read current league state from DB, resume from where sim left off." But what speed? Paused. Always resume at `paused`. Document this — auto-resuming Turbo on restart would surprise the user.

### A8. No request validation layer (LOW)
`POST /api/sim/speed` with body `{ speed: "warp" }` should 400, not crash. Add minimal input validation (Zod) on all POSTs.

### A9. Singleton league assumption (LOW)
All endpoints are `/api/league/...` (no `:leagueId`). Spec implies one league per DB instance. Either lock this in (`DELETE` old league before `POST /api/league/new`) or scope by `current_league_id`. Pick one and document.

### A10. Frontend has no global error boundary (LOW)
"Never crash on missing data" requires both null-safe accessors and a top-level React error boundary. Add one.

### A11. Vite proxy + Express CORS (LOW)
Vite dev proxy is mentioned. Document the `vite.config.ts` proxy block explicitly to avoid the Developer enabling permissive CORS instead.

---

## 3. Critical Implementation Decisions (Spec Leaves Implicit — Architect Decides Now)

These are **prescriptive** — Developer must implement as stated unless they raise a blocking concern.

| ID | Decision area | Architect's decision |
|---|---|---|
| D1 | GM personality storage | **Flat columns** on `teams`: `gm_philosophy`, `gm_risk_tolerance`, `gm_focus`. Build the LLM string at call site. |
| D2 | Enum values for GM | Philosophy: `win-now`/`rebuild`/`balanced`. Risk: `conservative`/`moderate`/`aggressive`. Focus: `hitting`/`pitching`/`defense`. Store lowercase, render title-case. |
| D3 | Roster size for v0.1.0 | 25 active (MLB) + 15 minors per team. Drop `is_on_40man`, keep `is_on_25man`. Add `is_on_mlb_roster` boolean for clarity. |
| D4 | Schedule generator | 9 intra-conference opponents × 4 games (36) + 10 inter-conference opponents × 1.4 games — round to: each team gets 36 intra + 14 inter (14 cross-opponents × 1 game + 4 random extras). Document the exact pairing algorithm in `season.ts`. Schedule generated once at season start, stored in a `schedule` table or as JSON on `leagues`. |
| D5 | Game date model | `current_game_date` = epoch ms. Season starts at `2026-04-01` (configurable). Advances 1 day per game. |
| D6 | Lineup/rotation/bullpen | `selectLineup(team)` = top 9 position players by `overall` excluding pitchers, one per position (C, 1B, 2B, 3B, SS, LF, CF, RF + DH = best remaining). `selectStartingPitcher(team, gameNumber)` = SP1-SP5 rotated by `gameNumber % 5`. Bullpen = all RP+CL. |
| D7 | Seeded PRNG | Use `mulberry32(seed)` from a local helper. Seed = `league.id`. All worldgen and game outcome rolls draw from it (separate streams per concern: `seedFor('worldgen')`, `seedFor('games')`, etc.). |
| D8 | DB pragmas | `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON` at startup. |
| D9 | Per-tick transaction | Wrap each game's writes in a single transaction. Update a `league_state_cache` row last. |
| D10 | State endpoint contract | Define `LeagueStateSnapshot` TS interface in `shared/types.ts`. Includes `lastPickId` cursor for draft phase delta. |
| D11 | Polling cadence | 2s normal. During draft phase, client switches to 500ms. Always send a `since` cursor for picks and game results so we get deltas. |
| D12 | Turbo + LLM | In Turbo, all LLM-driven decisions use procedural fallback. UI shows a "Turbo mode" badge. |
| D13 | LLM circuit breaker | If >150 LLM calls in 60s OR >1500 in 10min, fall back to procedural for the next 5min and surface a warning in `/api/state`. |
| D14 | LLM response parsing | Strip ` ```json ` fences → regex-extract first `{...}` → JSON.parse → shape-validate → on any failure, fallback. Centralize in `services/llm.ts`. |
| D15 | Migrations | Sequential `.sql` files under `server/migrations/`, applied at startup, tracked in `schema_versions`. v0.1.0 ships `001_init.sql`. |
| D16 | Singleton league | Only one active league per DB. `POST /api/league/new` archives any existing league (renames table rows with `archived = 1`) before creating new. v0.1.0 reads `archived = 0` rows only. |
| D17 | League restart behavior | On boot, restore last `archived=0` league at `paused`. Never auto-resume an active sim. |
| D18 | Tiebreakers (playoff seeding) | head-to-head W/L → run differential → deterministic coin flip (PRNG with `seedFor('tiebreaker')`). |
| D19 | Trade deadline in v0.1.0 | Backend logs `transactions` row of type `trade` at game 35 — picks 1 fake trade per contender procedurally if LLM unavailable. No UI required in v0.1.0. |
| D20 | Free agency v0.1.0 | Procedural fallback only is acceptable for v0.1.0: bid = `overall × 0.15M × needs_multiplier`, capped at budget remaining, highest bidder wins. LLM upgrade in v0.2. |
| D21 | World gen → draft pool sizing | If after expansion draft (20×30=600 picks) <800 players are exhausted, remaining 200 become free agent pool. |
| D22 | Server framework | Express 5. No middleware sprawl — just `express.json()`, request validator, error handler. |
| D23 | Test coverage gate | v0.1.0 ships unit tests for: PRNG determinism, schedule generator, win-prob clamp, box-score consistency rules, LLM parser malformed-input cases, fallback path. No browser/E2E required at v0.1.0. |
| D24 | `data-testid` enforcement | All testids in the spec must exist or v0.1.0 doesn't pass review. |
| D25 | Naming | Project on disk: `baseball-dynasty/` per the file structure. Match the spec exactly. |

---

## 4. Sequencing Recommendation

Build in this order. Each phase is independently testable before the next begins.

### Phase 0 — Skeleton (½ day)
1. Repo bootstrap: `package.json`, `tsconfig`, ESLint, Prettier, Vitest.
2. Server: Express app, `/healthz`, error middleware, request validator.
3. Client: Vite + React + Tailwind, tab shell with all 6 tab stubs.
4. Vite proxy `/api → :3001`.
5. `.env` with `ANTHROPIC_API_KEY`, `PORT`.

### Phase 1 — Data layer (1 day)
6. `db.ts` with `better-sqlite3`, pragmas (D8), migrations runner (D15).
7. `001_init.sql` — all tables from `app-spec.md` adjusted per D1/D2/D3.
8. Add `league_state_cache` table (D9).
9. Shared types in `shared/types.ts` including `LeagueStateSnapshot` (D10).
10. **Gate:** unit tests for migration + cache update.

### Phase 2 — World generation (1 day)
11. Seeded PRNG helper (D7).
12. `data/cities.ts`, `data/nicknames.ts`, `data/names.ts` (origin-segregated).
13. `worldgen.ts` — generate league, 20 teams (no two share a region or nickname), 800 players.
14. `POST /api/league/new` wired to worldgen.
15. **Gate:** `npm test` — same seed produces identical league.

### Phase 3 — Expansion draft + Draft UI (1.5 days)
16. `draft.ts` — snake order, position-adjusted value formula, procedural fallback `pickBestAvailable(needs)`.
17. `services/llm.ts` — Anthropic SDK client, queue with 5-concurrency + 100ms gap, 8s timeout, robust JSON parser (D14), circuit breaker (D13).
18. `POST /api/sim/speed` and tick loop (paused-only at this point) so a draft pick is one tick.
19. `GET /api/state` returning current phase + draft cursor.
20. Client `Draft.tsx` — board grid, pick reveal, 500ms polling during draft.
21. **Gate:** start a new league, run expansion draft end-to-end, all 600 picks land in DB, every testid present.

### Phase 4 — Schedule + Game sim + Standings (1.5 days)
22. `season.ts` — deterministic schedule generator (D4), stores schedule.
23. `game.ts` — lineup/rotation/bullpen selectors (D6), win-prob formula, score gen with blowout enforcement, box-score consistency rules, notable events.
24. Tick loop full implementation (per-tick transaction, cache update, yield in Turbo) (A1/A2/D9/D12).
25. `GET /api/standings`, `GET /api/games/recent`, `GET /api/games/:id`.
26. Client `League.tsx` — standings table, ticker, speed control. `Games.tsx` — recent feed + box modal.
27. **Gate:** sim a 50-game season at normal speed, standings update live, 1000+ games written without DB lock, box scores pass internal consistency tests.

### Phase 5 — Team detail + Players + Timeline thin (1 day)
28. `GET /api/teams`, `GET /api/teams/:id`, `GET /api/teams/:id/roster`, `GET /api/teams/:id/minors`.
29. `GET /api/players/leaders`, `GET /api/players/:id`.
30. `GET /api/transactions`, `GET /api/timeline` (thin: just season records + champion).
31. Client `Teams.tsx`, `Players.tsx`, `Timeline.tsx`.
32. **Gate:** drill down into any team, any player, view timeline of season 1.

### Phase 6 — Offseason + Front office churn (1 day)
33. `offseason.ts` — player development per spec, age++, retirement at 40 (D + edge case), injury, potential reveal at 25.
34. Procedural free agency (D20).
35. Procedural + LLM trade deadline at game 35 (D19).
36. Front office instability rules (manager/GM fire, owner sell, owner death + heir).
37. Annual draft (straight reverse-standings, snake order off).
38. Season narrative LLM call (1/season).
39. **Gate:** advance into season 2 and 3, verify no orphan FKs, no crashed sim, narrative renders.

### Phase 7 — Polish + Hardening (½ day)
40. Error boundary in client, `Reconnecting...` banner.
41. `data-testid` audit across all views.
42. Restart-resume verification (D17).
43. Coverage report.
44. Manual smoke test at all 4 speeds.

**Total estimate: ~7–8 working days for one Developer.**

---

## 5. Risk Register (Top 5)

| Rank | Risk | Likelihood | Impact | Score | Mitigation owner |
|---|---|---|---|---|---|
| R1 | **Tick loop + sync SQLite causes UI freezes or torn state during Turbo** | High | High | 9 | Developer must implement D8/D9 (WAL + per-tick transaction + state cache). Architect verifies before merging Phase 4. |
| R2 | **LLM JSON parsing fails silently or under load, draft hangs** | High | High | 9 | Robust parser + circuit breaker + procedural fallback in Turbo (D12–D14). Test deliberately with bad-JSON fixtures. |
| R3 | **Schedule generation is wrong or non-deterministic — season can't finish 50 games per team** | Medium | High | 6 | D4 + unit test asserting every team has exactly 50 games and matchup symmetry. Block Phase 4 gate on this. |
| R4 | **Spec contradictions (GM enums, roster size, draft thresholds) cause rework when discovered mid-build** | High | Medium | 6 | Resolve via Section 1a + Section 3 *before* Phase 1 begins. Developer instructions doc inherits these as ground truth. |
| R5 | **Frontend polling at 2s misses draft picks at Fast speed → board has gaps** | High | Medium | 6 | D11 (cursor-based deltas + 500ms during draft). Verify in Phase 3 gate. |

**Honorable mentions (watch list):**
- R6: LLM cost overrun if a user hammers New Dynasty repeatedly. Circuit breaker (D13) covers it.
- R7: Server restart mid-tick loses a game. The "write before advance tick" rule must be reviewed in code.
- R8: Singleton league assumption breaks if anyone tries to support multiple leagues later. Document D16 prominently.

---

## 6. Inputs for `developer-instructions-1.md`

The Developer should be handed:
1. All 8 contradictions from Section 1a marked **resolved as Architect decides in Section 3**.
2. The 25 decisions in Section 3 as **non-negotiable defaults** (developer may push back with reasoning, but must implement these unless overridden).
3. The 7-phase sequence in Section 4 as the build plan, with phase gates.
4. The top-5 risks in Section 5 with mitigation owners.
5. A reminder to read `v0.1.0-test-spec.md` before starting Phase 0.

---

**End of architect-eval-0.md.**
