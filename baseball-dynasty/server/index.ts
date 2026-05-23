// SECURITY:
// - Startup assertions run before any module that touches the API key.
// - Never prefix Anthropic-related env vars with VITE_.
// - API key is only accessible from services/llm.ts

// 1. Abort if SDK debug mode is enabled — it logs auth headers.
if (process.env['DEBUG']?.match(/anthropic/i) || process.env['ANTHROPIC_LOG'] === 'debug') {
  console.error('ERROR: Anthropic SDK debug logging would expose API keys. Unset DEBUG / ANTHROPIC_LOG.');
  process.exit(1);
}

// 2. Verify API key is loaded.
if (!process.env['ANTHROPIC_API_KEY']?.startsWith('sk-ant-')) {
  console.warn('WARNING: ANTHROPIC_API_KEY missing or malformed. LLM features will use procedural fallback.');
}

import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { initDb } from './db.js';
import { SimSpeedBody, NewLeagueBody, SimAdvanceBody } from '../shared/schemas.js';
import { startNewLeague, deleteCurrentLeague, getActiveLeagueState, initEngine, setSimSpeed, advanceSim } from './sim/engine.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

const app = express();

// Middleware
app.use(express.json({ limit: '8kb' }));

// Validate body middleware factory
function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'invalid_body', details: result.error.flatten() });
      return;
    }
    req.body = result.data;
    next();
  };
}

// Rate limiting for POST /api/league/new (1 per 30s)
let lastLeagueCreateMs = 0;
function rateLimitLeagueNew(_req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  if (now - lastLeagueCreateMs < 30_000) {
    res.status(429).json({ error: 'rate_limited', retryAfterMs: 30_000 - (now - lastLeagueCreateMs) });
    return;
  }
  // Do NOT set lastLeagueCreateMs here — set it only after success (§4.7)
  next();
}

// Routes
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, version: '0.1.0' });
});

app.get('/api/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, version: '0.1.0' });
});

app.get('/api/state', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sincePickId = req.query['sincePickId'] ? parseInt(String(req.query['sincePickId']), 10) : 0;
    const sinceGameId = req.query['sinceGameId'] ? parseInt(String(req.query['sinceGameId']), 10) : 0;
    const state = await getActiveLeagueState(sincePickId, sinceGameId);
    if (!state) {
      // §3.5: Return full shape even when no league exists
      res.json({
        leagueId: null,
        phase: 'no_league',
        seasonNumber: 0,
        simSpeed: 'paused',
        noLeague: true,
        currentGameDate: 0,
        currentGameNumber: 0,
        lastPickId: 0,
        lastGameId: 0,
        llmStatus: { dailyBudgetRemaining: 2000, circuitBreakerOpen: false, retryAfterMs: 0 },
        worldgenSeed: 0,
        picksDelta: [],
        gamesDelta: [],
      });
      return;
    }
    res.json(state);
  } catch (err) {
    next(err);
  }
});

app.post('/api/league/new', rateLimitLeagueNew, validateBody(NewLeagueBody), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await startNewLeague(req.body);
    lastLeagueCreateMs = Date.now(); // Set only on success (§4.7)
    res.status(200).json({ leagueId: result.leagueId, phase: 'draft' }); // HTTP 200, phase:"draft" (§2.14)
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'LEAGUE_EXISTS') {
      lastLeagueCreateMs = Date.now(); // Also lock on legitimate 409 (§4.7)
      res.status(409).json({ error: 'League already exists. Use /api/league/reset to start over.' }); // §2.16.4
      return;
    }
    next(err);
  }
});

// Alias POST /api/league/reset → same as DELETE /api/league/current (§2.16.4)
app.post('/api/league/reset', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await deleteCurrentLeague();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/league/current', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await deleteCurrentLeague();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// §2.16.3: Route-specific validator to return spec-verbatim error for invalid speed
app.post('/api/sim/speed', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = SimSpeedBody.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid speed. Must be paused|normal|fast|turbo' });
      return;
    }
    await setSimSpeed(result.data.speed);
    res.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'NO_ACTIVE_LEAGUE') {
      res.status(409).json({ error: 'no_active_league' });
      return;
    }
    next(err);
  }
});

app.post('/api/sim/advance', validateBody(SimAdvanceBody), async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await advanceSim();
    res.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'NOT_PAUSED' || err.message === 'INVALID_PHASE' || err.message === 'NO_ACTIVE_LEAGUE')) {
      res.status(409).json({ error: err.message.toLowerCase() });
      return;
    }
    next(err);
  }
});

// Team routes
import { teamsRouter } from './routes/teams.js';
import { playersRouter } from './routes/players.js';
import { gamesRouter } from './routes/games.js';
import { timelineRouter } from './routes/timeline.js';

app.use('/api/teams', teamsRouter);
app.use('/api/players', playersRouter);
app.use('/api/games', gamesRouter);
app.use('/api/timeline', timelineRouter);

// §2.9: Draft order endpoint for UI to show correct pick order
app.get('/api/draft/order', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { getActiveLeague } = await import('./db.js');
    const league = getActiveLeague();
    if (!league) { res.json({ teamOrder: [] }); return; }
    const { getExpansionDraftOrder } = await import('./sim/draft.js');
    res.json({ teamOrder: getExpansionDraftOrder(league.id) });
  } catch (err) { next(err); }
});

app.get('/api/standings', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { getStandings } = await import('./routes/standings.js');
    const standings = await getStandings();
    res.json(standings);
  } catch (err) {
    next(err);
  }
});

app.get('/api/transactions', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { getRecentTransactions } = await import('./routes/transactions.js');
    const txns = await getRecentTransactions();
    res.json(txns);
  } catch (err) {
    next(err);
  }
});

// §5.1: Use shared scrubError utility
import { scrubError } from './util/scrub.js';

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('[server]', scrubError(err));
  res.status(500).json({ error: 'internal_error' });
});

// Start server
async function main() {
  try {
    await initDb();
    await initEngine(); // D17: Restore active league, force paused
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`[server] Baseball Dynasty server running on http://127.0.0.1:${PORT} (localhost only)`);
    });
  } catch (err) {
    console.error('[server] Fatal startup error:', err);
    process.exit(1);
  }
}

main();
