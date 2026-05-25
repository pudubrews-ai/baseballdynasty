# build-rules.md
# Baseball Dynasty Simulator — Build Harness

---

## The Agent Team

| Agent | Model | Role |
|---|---|---|
| Orchestrator | Sonnet | Manages workflow, enforces rules, maintains governance log |
| Architect | Opus | Owns all design and quality decisions, issues ITERATE or COMPLETE |
| CISO | Opus | Security review at spec stage and post-build |
| Adversary | Opus | Attacks spec and implementation to find what others missed |
| Developer | Sonnet | Builds and maintains all code |
| API Tester | Sonnet | Black box HTTP testing only |
| UI Tester A | Sonnet | Playwright browser automation — regression groups |
| UI Tester B | Sonnet | Playwright browser automation — new feature groups |

> Not every build requires all agents. If a feature has no new UI, UI Testers may be omitted. The Orchestrator declares the active agent set at the start of each build.

---

## Document Set

| Document | Scope | Lifespan |
|---|---|---|
| `build-rules.md` | How the process works | Permanent |
| `app-spec.md` | What the app currently does in production | Living — updated after every successful deploy |
| `[version]-app-spec-section.md` | What this feature adds or changes | Feature-specific |
| `[version]-test-spec.md` | How this feature gets verified | Feature-specific |

---

## Lane Rules

| Agent | May read |
|---|---|
| Orchestrator | All files — never modifies content other than governance log |
| Architect | App spec, feature spec section, all reports, prior architect evals |
| CISO | App spec, feature spec section, source code, prior CISO reports, architect-eval-0 |
| Adversary | App spec, feature spec section, source code, prior Adversary reports, architect-eval-0, CISO reports |
| Developer | Feature spec section, developer-instructions-[n] only |
| API Tester | Test spec, server-port.md only — never source code |
| UI Tester A | Test spec, server-port.md only — never source code |
| UI Tester B | Test spec, server-port.md only — never source code |

**Hard violations that trigger immediate halt:**
- Testers read source code
- Developer reads test results or CISO/Adversary reports
- Orchestrator modifies any file other than the governance log
- Orchestrator writes, edits, or creates code or application files
- Orchestrator performs implementation work instead of spawning agents

---

## Severity Classification

| Severity | Definition |
|---|---|
| **Critical** | System broken or serious vulnerability. Must fix before any other work. |
| **High** | Significant functional or security gap. Must fix before COMPLETE. |
| **Medium** | Meaningful issue affecting correctness or safety. Must fix before COMPLETE. |
| **Low** | Minor issue. Fix at Architect's discretion. |

Build is **complete** when all post-build reports contain zero Critical, High, or Medium findings AND the Architect formally issues COMPLETE.

---

## Workflow

### Phase 1 — Pre-Build (runs once)
1. Architect reads feature spec section and writes `reports/architect-eval-0.md`
2. CISO and Adversary review spec in parallel and write pre-build reports
3. Architect synthesizes findings and writes `reports/developer-instructions-1.md`

### Phase 2 — Build and Verify (iterates until COMPLETE)
4. Developer reads only feature spec section and developer-instructions-[n] and implements
5. CISO and Adversary review implementation in parallel
6. API Tester, UI Tester A, and UI Tester B run in parallel
7. Architect evaluates all reports and issues ITERATE or COMPLETE
8. If ITERATE: Architect writes next developer-instructions, loop to step 4

### Phase 3 — Ship (Founder-triggered)
1. Developer creates PR
2. Orchestrator notifies Founder and waits for "merge" approval
3. Orchestrator triggers merge — Founder does NOT merge manually
4. Post-merge hook runs automatically
5. Founder notifies Claude PM that deploy succeeded
6. Claude PM merges feature spec section into `app-spec.md`

---

## Governance and Authority

The Architect owns ITERATE/COMPLETE decisions, false negative declarations, and severity calls. The Orchestrator enforces process and coordinates agents but never interprets or modifies content.

**False negative declarations require all three:** (1) root cause, (2) corroborating evidence, (3) specific test fix.

---

## Agent Rules

**Orchestrator:**
- You are a coordinator, not a doer. Your only tools are spawning agents, reading output files, and writing the governance log.
- NEVER write, edit, or create code or application files directly.
- No human in the loop until COMPLETE. Never pause to ask the founder questions. If ambiguity arises, make a reasonable decision, document it in the governance log, and continue.
- NEVER push directly to main.

**Developer:**
- Never commit directly to main — always work on the feature branch
- Commits are checkpoints, not pause points — push to remote immediately after every commit
- Never reframe remaining spec items as optional or deferrable

**API Tester:**
- HTTP only — never read source code
- Kill existing processes on test ports before starting server
- Write port AND fresh server PID to `reports/server-port.md` immediately after server start
- A test passes only if both status code AND response body match exactly
- NEVER use real user accounts — use dedicated QA test accounts only

**UI Testers:**
- Playwright only — never read source code
- `data-testid` attributes only — never by class, ID, or element type
- Use Playwright auto-retry assertions for all state assertions

---

## Claude Code Lane Rules

**DO NOT update `build-rules.md` or `app-spec.md`.** These are maintained by Claude PM only. Include any lessons or app spec updates in the PM handoff report.

**PM report must be echoed to screen.** The Orchestrator must print the full PM handoff report to stdout at the end of every build so the founder can copy and paste it.

---

## Spec Quality Standards

Feature spec section must include:
- Every error message string verbatim
- Validation rules in explicit order
- Explicit handling of every known edge case
- `data-testid` attributes for every new UI element

Test spec must include:
- Group 0 environment setup — port discovery, server start, health check
- Foundational tests that halt all testing if they fail
- Every error message tested verbatim
- Severity assigned to every test group
- Each UI test group marked with worker assignment (A or B)

---

## Universal Lessons Learned

- `data-testid` on third-party wrapper components (e.g. Recharts ResponsiveContainer) is silently dropped — always wrap in a div with data-testid
- Return `null` on error and `[]` for genuine empty results — never return `[]` on error
- Never use `select('*')` in API routes — always use an explicit field list
- Responsive layouts can duplicate data-testid — each testid must appear exactly once in the DOM
- When a fix is applied to one call in a file, check ALL similar calls in the same file
- last_xxx_game per-team counters must be included in the offseason season-reset query alongside wins/losses/games_played — omitting them silently breaks all game-loop timers after season 1
- current_payroll is additive-only during FA — reset from SUM(annual_salary) each offseason before FA bidding begins
- LLM news batch prompts must explicitly instruct "always include player name when provided" and show a named example — without this, Haiku defaults to team-centric generic phrasing
- For structural news events with names already in scope at call site (signings, non-tenders, waivers, releases, milestones), set headlineText directly — bypasses LLM, guarantees names, costs nothing

---

## Project-Specific Config

### Repository
```
https://github.com/pudubrews-ai/baseballdynasty
Main branch: main
Feature branches: feature/v[version]-[description]
Never push directly to main.
```

### Credentials
```
Stored in .env — never committed.
Required:
  ANTHROPIC_API_KEY      # Claude Haiku for GM decisions and narrative
  PORT                   # Express server port, default 3001
```

### Stack-Specific Issues
```
- Sim engine runs on Node — do NOT move game logic to the frontend
- All Claude API calls go through the Express backend — API key never touches the browser
- SQLite via better-sqlite3 — all DB ops are synchronous, no async/await needed for queries
- Sim speed is controlled by a server-side tick loop — frontend polls /api/state, never drives the sim
- Season sim can run thousands of game ticks — never block the event loop; use setImmediate between game batches
```
