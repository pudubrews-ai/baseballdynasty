# Baseball Dynasty Simulator — v0.3.0

See the [root README](../README.md) for full project overview and feature descriptions.

---

## Prerequisites

- Node.js `>=20.0.0 <23.0.0`
- npm `>=10`

## Setup

```bash
# From the baseball-dynasty/ directory:
npm ci
cp .env.example .env
# Set ANTHROPIC_API_KEY in .env (optional — sim runs without it)
```

## Running

```bash
npm run dev       # Dev server: client on :5173, API on :3001
npm run build     # Production build to dist/
npm start         # Serve production build
```

## Testing

```bash
npm test          # Vitest (unit + integration)
npm run test:watch
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | — | Claude Haiku for LLM flavor text |
| `PORT` | No | `3001` | Server port |
| `DAILY_LLM_CALL_BUDGET` | No | `2000` | Max LLM calls/day |
| `DEFAULT_SEED` | No | — | Deterministic PRNG seed |

## Architecture

- **Frontend:** React 19 + Vite 6 + Tailwind CSS + Framer Motion
- **Backend:** Express 5 + better-sqlite3 (synchronous SQLite)
- **Database:** `data/dynasty.db` — created on first run, migrations applied automatically on startup
- **LLM:** Claude Haiku via Anthropic SDK — narrator only, all sim decisions are code

## Security

- API key never reaches the browser bundle (verified by `scripts/check-bundle-no-keys.mjs` on every build)
- All SQL uses parameterized queries (verified by `scripts/check-no-template-sql.mjs`)
- LLM responses are sanitized before storage and rendering
