# Baseball Dynasty Simulator v0.1.0

A single-player baseball dynasty simulation game. Build a franchise from an expansion draft, simulate full seasons, manage your roster through trades and free agency, and build a dynasty across multiple seasons.

## Prerequisites

- Node.js >= 20.0.0 < 23.0.0

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your Anthropic API key:
   ```
   cp .env.example .env
   ```
3. Install dependencies:
   ```
   npm ci
   ```

## Running

Development mode (both server and client):
```
npm run dev
```

- Client: http://localhost:5173
- Server API: http://localhost:3001

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | No* | Claude Haiku API key for LLM features. Get one at https://console.anthropic.com |
| `PORT` | No | Server port (default: 3001) |
| `DAILY_LLM_CALL_BUDGET` | No | Max LLM calls per day (default: 2000) |
| `DEFAULT_SEED` | No | Deterministic PRNG seed for testing |

*Without an API key, LLM features (draft reasoning, season narratives) will use procedural fallbacks.

## Testing

```
npm test
```

## Building

```
npm run build
```

## Architecture

- **Frontend**: React + Vite (TypeScript)
- **Backend**: Express 5 + better-sqlite3
- **LLM**: Claude Haiku via Anthropic SDK (optional, gracefully degrades)
- **Database**: SQLite (created at `data/dynasty.db`)

See `v0.1.0-app-spec-section.md` for full specifications.

## Security Notes

- API key never touches the browser bundle
- All SQL uses parameterized queries
- LLM responses are sanitized before storage and rendering
