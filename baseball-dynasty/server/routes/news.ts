// News Feed API Route — Phase 10 (v0.2.0)
// GET /api/news — full news feed, supports ?team=id&type=eventType&limit=50
// GET /api/news?type=invalid → 400 { error: "Invalid event type filter" }
// Returns 200 empty array when no events generated.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prepared } from '../db.js';
import { getNewsFeed, VALID_NEWS_FILTERS, type NewsFilter } from '../sim/news.js';

export const newsRouter = Router();

// GET /api/news
newsRouter.get('/', (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Get active league (CB-10: scope all queries by active league)
    const league = prepared(
      "SELECT id FROM leagues WHERE archived = 0 ORDER BY id DESC LIMIT 1"
    ).get() as { id: number } | undefined;

    if (!league) {
      res.json([]);
      return;
    }

    // Validate type filter
    const rawType = req.query['type'];
    if (rawType !== undefined) {
      const isValid = VALID_NEWS_FILTERS.includes(rawType as NewsFilter);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid event type filter' });
        return;
      }
    }

    const filterSchema = z.enum(['all', 'roster', 'transactions', 'frontoffice', 'injuries', 'milestones'] as const)
      .catch('all');
    const filter = filterSchema.parse(rawType ?? 'all');

    const limitSchema = z.coerce.number().int().min(1).max(200).catch(50);
    const limit = limitSchema.parse(req.query['limit'] ?? 50);

    const teamSchema = z.coerce.number().int().positive().optional().catch(undefined);
    const teamId = teamSchema.parse(req.query['team']);

    const feedParams: { leagueId: number; filter: typeof filter; limit: number; teamId?: number } = {
      leagueId: league.id,
      filter,
      limit,
    };
    if (teamId !== undefined) feedParams.teamId = teamId;

    const items = getNewsFeed(feedParams);

    res.json(items);
  } catch (err) {
    next(err);
  }
});
