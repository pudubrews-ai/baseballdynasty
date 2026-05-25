# Baseball Dynasty Simulator

A fully-simulated baseball franchise management game running in the browser. Build a dynasty, manage your roster, and watch your team compete through procedurally generated seasons — powered by a deterministic sim engine and Claude Haiku for narrative flavor.

**Current version: v0.5.0 — Immersion Release**

---

## Features

- **Your Franchise** — persistent team lens: standings, roster, pipeline, front office, financials, history
- **Full Season Sim** — 50-game seasons with platoon splits, bullpen roles, streaks, and realistic win probability
- **Offseason Engine** — free agency, arbitration, opt-outs, Rule 5 draft, international signing, annual draft
- **Rivalries** — form from playoff rematches and division battles; affect attendance and narrative
- **Award Races** — live MVP / Cy Young / Rookie of the Year tracking per conference
- **Records Chasing** — milestone approach triggers news coverage (500 HR, 3000 hits, 300 wins…)
- **Stadium Upgrades** — invest in capacity and revenue; new stadiums have honeymoon attendance boosts
- **Franchise History** — Hall of Fame, newspaper timeline, coaching pipeline, tragedy events
- **Aquarium Mode** — sit back and watch the league run; or own a team and make decisions
- **20 Teams** — procedurally generated across 4 divisions, with GM archetypes, owner personalities, and city rivalries

---

## Prerequisites

- Node.js `>=20.0.0 <23.0.0`
- npm `>=10`

---

## Setup

```bash
cd baseball-dynasty
npm ci
cp .env.example .env
# Set ANTHROPIC_API_KEY in .env (optional — sim runs without it; LLM used only for flavor text)
```

---

## Running

```bash
npm run dev       # Dev server: client on :5173, API on :3001
npm run build     # Production build to dist/
npm start         # Serve production build (PORT env var, default 3001)
```

---

## Testing

```bash
npm test              # Vitest — 448 tests across unit + integration
npm run test:watch    # Watch mode
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | — | Claude Haiku for LLM flavor text (news, awards, milestones) |
| `PORT` | No | `3001` | Express server port |
| `DAILY_LLM_CALL_BUDGET` | No | `2000` | Max LLM calls/day (cost guard) |
| `DEFAULT_SEED` | No | — | Deterministic PRNG seed for reproducible worlds |

---

## Architecture

| Layer | Stack |
|---|---|
| Frontend | React 19 + Vite 6 + Tailwind CSS + Framer Motion |
| Backend | Express 5 + better-sqlite3 (synchronous SQLite) |
| Database | `data/dynasty.db` — auto-created, 15 migrations applied on startup |
| LLM | Claude Haiku via Anthropic SDK — narrative only, all sim logic is deterministic code |
| Testing | Vitest — unit + integration, schema validation, bundle security gates |

**Key design rules:**
- Sim engine runs server-side only — game logic never touches the browser
- All SQL uses parameterized queries (enforced by `scripts/check-no-template-sql.mjs` on every build)
- API key never reaches the client bundle (enforced by `scripts/check-bundle-no-keys.mjs` on every build)
- Seeded PRNG (`server/sim/prng.ts`) — deterministic outcomes given the same seed

---

## Project Structure

```
baseball-dynasty/
├── client/src/          # React frontend
│   ├── views/           # Page-level components (Home, League, Watch, Teams, Franchise…)
│   └── components/      # Shared UI (Ballpark, charts, badges)
├── server/
│   ├── sim/             # Sim engine (game, offseason, worldgen, rosterMaintenance…)
│   ├── routes/          # Express API routes
│   └── migrations/      # SQLite migrations (001–015)
├── shared/              # Shared types
└── data/                # SQLite DB (git-ignored)
```

---

## API

All endpoints return JSON. Base: `http://localhost:3001/api`

| Endpoint | Description |
|---|---|
| `GET /state` | Full sim state |
| `GET /standings` | Current league standings |
| `GET /teams/:id` | Team detail |
| `GET /players` | Player list |
| `GET /news` | News feed |
| `GET /awards/current` | Live award race standings |
| `GET /rivalries` | Active rivalries |
| `GET /franchise/dashboard/:teamId` | Franchise tab aggregate |
| `GET /draft/rule5` | Rule 5 eligible players |
| `GET /international/prospects` | International signing pool |
| `GET /arbitration/eligible` | Arb-eligible players |
| `POST /sim/advance` | Advance simulation one tick |

---

## License

MIT
