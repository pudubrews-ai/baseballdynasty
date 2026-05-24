// Front Office Events API Route — v0.2.0 §3.3
// GET /api/front-office-events — league-wide read of front_office_events (firings, owner events, resignations)
// CB-4: limit clamped at 200. CB-10: scoped by active league_id.
// §0.4: /api/front-office-events was not in the v0.2.0 spec originally, but is added here so
// black-box testers can verify Test Groups 2 (owner events) and 8 (firings) without team scoping.
// The data already exists in front_office_events; this is a thin read-only harness-enablement route.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prepared } from '../db.js';

export const frontOfficeRouter = Router();

frontOfficeRouter.get('/', (req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = prepared(
      "SELECT id FROM leagues WHERE archived = 0 ORDER BY id DESC LIMIT 1"
    ).get() as { id: number } | undefined;

    if (!league) {
      res.json([]);
      return;
    }

    // CB-4: clamp limit at 200
    const limitSchema = z.coerce.number().int().min(1).max(200).catch(50);
    const limit = limitSchema.parse(req.query['limit'] ?? 50);

    // Explicit columns only (CB-10 / security-in-depth — no SELECT *)
    const rows = prepared(
      `SELECT id, season_number, team_id, event_type, departing_person, incoming_person, narrative, created_at
       FROM front_office_events
       WHERE league_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(league.id, limit);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});
