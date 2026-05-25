// Coaches routes — v0.4.0 Step 6
import { Router, Request, Response, NextFunction } from 'express';
import { prepared, getActiveLeague } from '../db.js';

export const coachesRouter = Router();

// GET /api/coaches/available — available coaching candidates league-wide
coachesRouter.get('/available', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const candidates = prepared(
      `SELECT cc.id, cc.player_id, cc.specialty, cc.coaching_rating, cc.available_since,
              p.first_name || ' ' || p.last_name AS name,
              COALESCE(p.career_overall, p.overall_rating) AS career_overall
       FROM coaching_candidates cc
       JOIN players p ON p.id = cc.player_id
       WHERE cc.league_id = ? AND cc.available = 1
       ORDER BY cc.coaching_rating DESC`
    ).all(league.id) as Array<{
      id: number; player_id: number; name: string; specialty: string;
      coaching_rating: number; available_since: number; career_overall: number;
    }>;

    res.json(candidates);
  } catch (err) { next(err); }
});
