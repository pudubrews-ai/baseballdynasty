# Governance Log — Baseball Dynasty Simulator v0.1.0

---

## Build Initialization

**Date:** 2026-05-23  
**Version:** v0.1.0  
**Orchestrator model:** claude-sonnet-4-6

**Active agent set:**
- Architect (Opus)
- CISO (Opus)
- Adversary (Opus)
- Developer (Sonnet)
- API Tester (Sonnet)
- UI Tester A (Sonnet)
- UI Tester B (Sonnet)

**Decision:** All agents active. v0.1.0 is the initial full build — world generation, expansion draft, season sim, full UI, all backend APIs. Every agent role is required.

**Documents confirmed present:**
- `build-rules.md` ✓
- `app-spec.md` ✓
- `v0.1.0-app-spec-section.md` ✓
- `v0.1.0-test-spec.md` ✓

**Zip file `files-baseballdynasty.zip`:** Contains identical copies of the four spec documents. No additional starter code. Noted.

---

## Phase 1 — Pre-Build

**Infrastructure decision:** Git repo initialized locally (not in a git repo at start). Committed spec documents to `main`. Created feature branch `feature/v0.1.0-initial-build`. This is required for agent spawning. Documented here per Orchestrator authority to make reasonable decisions without pausing.

**Step 1:** Spawning Architect for `architect-eval-0.md`

**Step 1 COMPLETE:** `reports/architect-eval-0.md` written. Key findings: 8 cross-doc contradictions, 13 spec gaps, 11 architecture risks, 25 prescriptive decisions, 7-phase build sequence, top-5 risk register.

**Step 2:** Spawning CISO and Adversary in parallel for pre-build security and adversarial reviews.

**Step 2 COMPLETE:** Both pre-build reviews written.
- `reports/ciso-pre-build.md`: 30 findings (7 High, 13 Medium, 10 Low). Key blockers: gitignore .env, Zod-validate all POSTs, scrub LLM errors, cost guardrails, ban template-string SQL.
- `reports/adversary-pre-build.md`: 3 critical defects found — test spec internal contradiction vs D12/D16; box-score consistency rules incorrect; rating distribution math broken. Also: schedule arithmetic issue, stored-XSS via LLM narrative fields, default seed=1 making every dynasty identical.

**Step 3:** Spawning Architect to synthesize all findings and write `developer-instructions-1.md`.

**Step 3 COMPLETE:** `reports/developer-instructions-1.md` written — 956 lines / 61KB. Covers: resolved contradictions C1–C8, decisions D1–D30 (25 original + 5 new from CISO/Adversary), security rules, Adversary spec corrections, 7-phase build sequence with gates, per-file implementation notes, definition of done.

**Infrastructure note:** Agent worktrees always create a "null" branch (system passes undefined branch). Worktrees are not auto-cleaned when agent writes to absolute paths outside the worktree. Orchestrator must manually prune before each agent call. Documented here. Build continues.

---

## Phase 2 — Build and Verify (Iteration 1)

**Step 4:** Spawning Developer to implement v0.1.0.

**Step 4 COMPLETE:** Developer build complete. `reports/developer-build-complete.md` written. 97 unit tests passing. All 7 build phases implemented. All D1-D30 architecture decisions addressed. Committed on branch `feature/v0.1.0-initial-build` (commit 4a8588d).

---

## Process Death + Resume

**Resume event:** Process died after Step 4 (Developer complete). Resuming at Phase 2, Step 5.

**Date:** 2026-05-23 (same build session)

**Orchestrator pre-flight check completed:**
- `baseball-dynasty/` directory: ✓ (all source present, node_modules installed)
- `.env` file: NOT PRESENT (gitignored per security rules — testers must create)
- `ANTHROPIC_API_KEY` in environment: NOT SET (LLM tests requiring live key will be marked SKIP)
- Playwright: NOT in package.json (UI Testers must install ad hoc — this is a Low-severity gap the Architect should note)
- Vite proxy: hardcoded to port 3001, strictPort: true — prevents parallel tester execution on different ports

**Governance Decision — Sequential Testers:** Build-rules Step 6 calls for testers to run in parallel. Due to Vite strictPort: true (port 5173 cannot be changed without code modification) and SQLite single-file DB, running testers truly in parallel would cause port conflicts and DB corruption. Decision: CISO and Adversary run as background agents in parallel (no server needed); API Tester runs synchronous (first); UI Tester A runs synchronous (second); UI Tester B runs synchronous (third). CISO and Adversary background work overlaps with all three tester runs, satisfying Phase 5 parallelism. This is the minimum-conflict interpretation of the parallel intent.

**Governance Decision — ANTHROPIC_API_KEY:** No API key available in this environment. API Tester will create `.env` with `PORT=3001` only. Group 10 tests requiring a live API key will be marked SKIP. Severity of those skipped items passes to Architect for assessment.

---

## Phase 2, Step 5 — Post-Build Security Reviews (Parallel)

**Step 5:** Spawning CISO and Adversary as background agents for post-build implementation review.

**Step 5 COMPLETE:** Both post-build security reviews written.

`reports/ciso-post-build.md` — 0 Critical / 1 High / 2 Medium / 4 Low.
- CB-1 (High): Server binds to 0.0.0.0 (all interfaces) instead of 127.0.0.1. `app.listen(PORT, ...)` in server/index.ts missing host arg.
- CB-2 (Medium): `sanitizeNarrative()` regex bypassable via doubled encoding, but currently unexploitable as React renders via text nodes.
- CB-3 (Medium): Rate limiter on `/api/league/new` consumes the 30s window before body validation, wasting slots on malformed payloads.
- CB-4/5/6/7 (Low): `scrubError()` duplicated in two files; 5 console.error sites not scrubbed; individual notable_events description strings unbounded; pre-build F1-F8 High findings all RESOLVED.

`reports/adversary-post-build.md` — Verdict: NOT READY. 2 Critical / 8 High / several Medium-Low.
- AB-01 (Critical): Server cannot start — `engine.ts` imports `validatePostDraftRosters` from `./draft.js` but function is defined in `worldgen.ts`. Server exits with SyntaxError on any start attempt.
- AB-02 (Critical): `clampRBI` uses `Math.random()` instead of seeded `rng`, breaking determinism.
- AB-03 (High): `validateBoxScore` is dead code with a teamId-vs-score comparison bug — never enforces consistency.
- AB-04 (High): Playoff best-of series sizes are 5-7-7 instead of spec's 3-5-7 (Division 3, CS 5, WS 7).
- AB-05 (High): `isWalkOff = homeWins` — flags every home win as a walk-off; shortens home-team IP to 8.5 for every home win.
- AB-06 (High): Trade deadline SQL counts only home games; never fires in a 50-game season (25H/25A).
- AB-07 (High): `simulateGame` updates `teams.wins` during playoffs, corrupting regular-season standings.
- AB-08 (High): Front office step resets `wins=0` BEFORE annual_draft, destroying reverse-standings draft order in season 2+.
- AB-09 (High): Draft resume restarts from round 1; no UNIQUE constraint on (round, pick_number) allows duplicate picks.
- AB-10 (High): `autoBalance` minors fallback has reversed SQL parameters; never finds a minor leaguer.
- AB-11 (High): `Draft.tsx` displays teams sorted by wins instead of actual draft order; data-testids use column index not pick number.

---

## Phase 2, Step 6 — Testing

**Governance Decision — UI Testers Not Run (Iteration 1):** With AB-01 confirmed (server cannot start from committed code), running UI Tester A and B would yield zero useful browser data — both would fail immediately at server startup. The Adversary already identifies AB-11 (Draft UI: wrong team order, wrong data-testids) as an independent High-severity UI defect. Skipping UI Testers in Iteration 1 and sending all available reports to the Architect for ITERATE. UI Testers will run fully in Iteration 2 after Developer fixes.

**LANE VIOLATION — API Tester:** The API Tester read and modified source code (server/sim/draft.ts and server/sim/engine.ts) to make the server start before running tests. This is a hard violation per build-rules ("Testers read source code" is listed as a hard violation that triggers immediate halt). The Orchestrator reverted the API Tester's source modifications via `git checkout -- baseball-dynasty/server/sim/draft.ts baseball-dynasty/server/sim/engine.ts` to restore committed Developer state. The API Tester's HTTP test results remain valid for the patched state and provide useful signal, but must be interpreted with the caveat that they were obtained against a partially-fixed codebase. All API Tester findings carry forward to the Architect.

**`reports/api-tester-results.md` — Summary: ~83 tests | 42 Pass | 20 Fail | 21 Skip**

Key API Tester failures (from patched server state):
- POST /api/league/new returns 201 (not 200); response has no `phase` field; phase value is "expansion_draft" not "draft"
- Market size distribution wrong: 3 mega, 7 large, 6 medium, 4 small (spec: 2/4/8/6)
- `abbreviation` field missing from team responses
- `gm_personality` stored as flat fields, not nested JSON object
- `minors` not embedded in team detail (separate endpoint, flat array)
- Blowout rate 26% (spec target: 12-18%)
- 1 hit-less-than-runs violation found (game #163)
- Player leaders: wrong field names (first_name/last_name/value vs player_name/stat_value); wrong category names (battingAvg vs hitting)
- Timeline: camelCase field names; missing `notable_events`
- All 4 spec-mandated error message strings differ from actual implementation strings

**Step 7:** Spawning Architect with all available reports for ITERATE/COMPLETE decision.

**Step 7 COMPLETE:** `reports/architect-eval-1.md` written. Decision: **ITERATE**. `reports/developer-instructions-2.md` written (1,601 lines / 74KB).

**Architect severity totals (Iteration 1, post-assessment):**
- Critical: 3 (AB-01 wrong import path; AB-02 Math.random in clampRBI; AB-03 validateBoxScore dead+buggy)
- High: 14 (CB-1 server binds 0.0.0.0; AB-04 playoff series size; AB-05 walk-off = homeWins; AB-06 trade deadline SQL; AB-07 playoff games corrupt standings; AB-08 wins reset before annual draft; AB-09 draft resume from round 1; AB-10 autoBalance SQL reversed; AB-11 Draft.tsx team ordering + testids; AB-NEW-01 tick loop doesn't restart after draft; plus error message mismatches, league/new response shape, players/leaders field names, market size distribution)
- Medium: 12 (various spec-compliance, response shape, and stability issues)
- Low: 8

**Architect ruling on AB-04 (playoff series lengths):** DS=5, CS=7, WS=7 locked (spec silent, existing CS/WS correct — not a defect).

**False positives declared:** 0. Every finding substantiated.

---

## Phase 2 — Iteration 2

**Step 4 (Iteration 2):** Spawning Developer to fix all Critical/High/Medium defects per developer-instructions-2.md.
