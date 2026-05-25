// Franchise selection routes — v0.3.0 §11
// CB-1: server-authoritative, server reads team ID, validates ownership, shown-once lock.

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getActiveLeague, prepared } from '../db.js';
import {
  getFranchiseState,
  selectFranchise,
  skipFranchise,
  isSelectionResolved,
} from '../sim/franchise.js';

export const franchiseRouter = Router();

const FranchiseSelectBody = z.object({ teamId: z.coerce.number().int().positive() }).strict();

// POST /api/franchise/select
franchiseRouter.post('/select', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyResult = FranchiseSelectBody.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'invalid_body', details: bodyResult.error.flatten() });
      return;
    }

    const league = getActiveLeague();
    if (!league) {
      res.status(409).json({ error: 'no_active_league' });
      return;
    }

    // Check already resolved (shown-once lock)
    if (isSelectionResolved(league.id)) {
      res.status(409).json({ error: 'selection_already_resolved' });
      return;
    }

    // Validate teamId belongs to active league
    const teamRow = prepared('SELECT id FROM teams WHERE id = ? AND league_id = ?').get(bodyResult.data.teamId, league.id);
    if (!teamRow) {
      res.status(404).json({ error: 'team_not_found' });
      return;
    }

    selectFranchise(league.id, bodyResult.data.teamId);
    res.json({ ok: true, ownedTeamId: bodyResult.data.teamId });
  } catch (err) { next(err); }
});

// POST /api/franchise/skip
franchiseRouter.post('/skip', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyResult = z.object({}).strict().safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'invalid_body', details: bodyResult.error.flatten() });
      return;
    }

    const league = getActiveLeague();
    if (!league) {
      res.status(409).json({ error: 'no_active_league' });
      return;
    }

    if (isSelectionResolved(league.id)) {
      res.status(409).json({ error: 'selection_already_resolved' });
      return;
    }

    skipFranchise(league.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/franchise
franchiseRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) {
      res.json({ ownedTeamId: null, selectionResolved: false });
      return;
    }

    const fs = getFranchiseState(league.id);
    res.json({
      ownedTeamId: fs?.owned_team_id ?? null,
      selectionResolved: fs?.selection_resolved === 1,
    });
  } catch (err) { next(err); }
});
