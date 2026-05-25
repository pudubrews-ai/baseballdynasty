# ⚾ Baseball Dynasty Simulator

A fully simulated, single-player baseball dynasty engine. Start from an expansion draft, pick a franchise to own, and watch 20 procedurally generated teams play out decades of baseball — trades, firings, breakout prospects, collapses, and championships — all unfolding in real time while you issue directives from the owner's box.

**Current version:** v0.3.0 — Aquarium Mode  
**Repo:** https://github.com/pudubrews-ai/baseballdynasty

---

## What It Does

- **20 fully simulated teams** — each with an owner (personality-driven), GM (archetype-driven), manager, coaching staff, 25-man roster, and a four-level minor league system (AAA/AA/A/Rookie)
- **Continuous 50-game seasons** from expansion draft forward with no predetermined end
- **All decisions are procedural** — trades, call-ups, send-downs, firings, draft picks, free agent bids. The LLM writes flavor text only
- **Watch tab (Aquarium Mode)** — live animated ballpark, city skyline, and front office sprites. Not a data table. An actual scene
- **Owner nudge mechanic** — issue directives (Go For It, Start Rebuilding, Fire the Manager, Trust the Process) that shift GM behavior and cost confidence
- **Newspaper dynasty timeline** — every season gets a front page with LLM headlines, below-the-fold stories, and expandable broadsheet view
- **Turbo mode** — calendar pages tear, headlines flash, scoreboard spins. Season ends with a newspaper splash before returning to offseason

---

## Screenshots

> Watch tab — night game in progress, crowd filling in, scoreboard live  
> *(add your own screenshot here)*

---

## Prerequisites

- **Node.js** `>=20.0.0 <23.0.0`
- **npm** `>=10`
- An **Anthropic API key** *(optional — the sim runs fully without one; LLM headlines and narratives will be empty strings)*

---

## Install & Run

```bash
# 1. Clone
git clone https://github.com/pudubrews-ai/baseballdynasty.git
cd baseballdynasty/baseball-dynasty

# 2. Install dependencies
npm ci

# 3. Configure environment
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY if you want LLM features
```

### Development (hot reload)

```bash
npm run dev
```

- **Client:** http://localhost:5173
- **API:** http://localhost:3001

### Production build + run

```bash
npm run build
npm start
```

The server serves the built client at port 3001 in production.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | — | Claude Haiku key for LLM narratives, headlines, and draft reasoning. Get one at [console.anthropic.com](https://console.anthropic.com) |
| `PORT` | No | `3001` | Server port |
| `DAILY_LLM_CALL_BUDGET` | No | `2000` | Max LLM calls per 24h window |
| `DEFAULT_SEED` | No | — | Deterministic PRNG seed (useful for reproducible testing) |

The app degrades gracefully without `ANTHROPIC_API_KEY` — all sim logic runs, LLM-generated strings are empty.

---

## How to Play

1. Start the dev server and open http://localhost:5173
2. Click **New Dynasty** to generate the league (20 teams, full player pool, ~2–3 seconds)
3. The **Franchise Selection** screen appears — pick a team to own or dismiss to watch as a neutral observer
4. The expansion draft runs automatically
5. Use the **Watch tab** to follow your franchise in real time
6. Issue **Owner Directives** from the panel in the Watch tab (Go For It, rebuild, target a player, fire the manager, or trust the process)
7. Use the speed controls to run at Normal, Fast, or Turbo
8. Check the **Timeline tab** after each season for the newspaper front page

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express 5 |
| Database | SQLite via `better-sqlite3` (synchronous, file at `data/dynasty.db`) |
| Frontend | React 19 + Vite 6 + Tailwind CSS |
| Animations | Framer Motion 11 |
| Fonts | Bebas Neue (scoreboards/headlines), Inter (data/body) |
| LLM | Claude Haiku (`claude-haiku-4-5-20251001`) via Anthropic SDK — narrator only |
| Testing | Vitest (unit) + Playwright (UI) |
| Language | TypeScript throughout |

---

## Project Structure

```
baseball-dynasty/
├── client/
│   └── src/
│       ├── views/          # Tab-level views (Watch, League, Teams, Timeline, News)
│       └── components/
│           └── watch/      # Ballpark, CitySkyline, FrontOfficeSprite, OwnerDirectivesPanel
├── server/
│   ├── routes/             # Express route handlers (state, teams, watch, directives, timeline…)
│   ├── sim/                # All simulation logic
│   │   ├── engine.ts       # Main tick loop
│   │   ├── worldgen.ts     # League + player generation
│   │   ├── game.ts         # Game resolution
│   │   ├── tradeDeadline.ts
│   │   ├── firings.ts
│   │   ├── directives.ts   # Owner nudge mechanic
│   │   └── …
│   ├── migrations/         # SQLite schema migrations (run on startup)
│   └── tests/              # Regression test suites
└── shared/
    └── types.ts            # Shared TypeScript types
```

---

## Testing

```bash
npm test              # Vitest unit + integration tests
npm run test:watch    # Watch mode
```

UI tests (Playwright) require the dev server to be running:
```bash
npm run dev &
npx playwright test
```

---

## Sim Design Philosophy

The LLM is a narrator, not a decision-maker. Every trade, call-up, send-down, firing, draft pick, and free agent bid is driven by procedural logic — owner patience thresholds, GM archetypes, roster need scores, waiver priority, service time rules. The LLM receives finished facts and writes flavor around them.

This means the sim runs entirely without an API key. It also means outcomes are reproducible with `DEFAULT_SEED`.

---

## Version History

| Version | What Shipped |
|---|---|
| v0.1.0 | World gen, expansion draft, full 50-game season sim, standings, team drilldown, draft room, basic timeline |
| v0.2.0 | Minor league system (DFA/waivers/call-ups/send-downs/service time), market dynamics, GM archetypes, in-season firings, news feed |
| v0.3.0 | Watch tab (Aquarium Mode), franchise selection, owner nudge mechanic, newspaper dynasty timeline, front office reasons in 4 locations |

---

## Roadmap

| Version | Planned |
|---|---|
| v0.4.0 | International draft, Rule 5 draft, minor league free agency |
| v0.5.0 | Stadium upgrades, revenue model depth, ownership drama arcs |
| v1.0.0 | 10-season dynasty playthrough, exportable history, shareable recaps |
