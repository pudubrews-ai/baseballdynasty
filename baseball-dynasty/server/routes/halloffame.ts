// Hall of Fame routes — v0.4.0 Step 7
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prepared, getActiveLeague } from '../db.js';

export const hallOfFameRouter = Router();

const playerIdSchema = z.coerce.number().int().positive();

// GET /api/halloffame — all inductees, 200 + [] before any retirements
hallOfFameRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const inductees = prepared(
      `SELECT hof.id, hof.player_id, hof.induction_season, hof.vote_share,
              hof.veterans_committee, hof.ped_flag, hof.wing, hof.memorial,
              hof.career_stats_at_induction,
              p.first_name || ' ' || p.last_name AS player_name
       FROM hall_of_fame hof
       JOIN players p ON p.id = hof.player_id
       WHERE hof.league_id = ?
       ORDER BY hof.induction_season ASC, hof.vote_share DESC`
    ).all(league.id) as Array<{
      id: number; player_id: number; player_name: string; induction_season: number;
      vote_share: number; veterans_committee: number; ped_flag: number;
      wing: string; memorial: number; career_stats_at_induction: string | null;
    }>;

    res.json(inductees);
  } catch (err) { next(err); }
});

// GET /api/halloffame/:playerId — single inductee full card
hallOfFameRouter.get('/:playerId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = playerIdSchema.safeParse(req.params['playerId']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const league = getActiveLeague();
    if (!league) { res.status(404).json({ error: 'Not found' }); return; }

    const inductee = prepared(
      `SELECT hof.id, hof.player_id, hof.induction_season, hof.vote_share,
              hof.veterans_committee, hof.ped_flag, hof.wing, hof.memorial,
              hof.career_stats_at_induction,
              p.first_name || ' ' || p.last_name AS player_name,
              p.position, p.age
       FROM hall_of_fame hof
       JOIN players p ON p.id = hof.player_id
       WHERE hof.league_id = ? AND hof.player_id = ?`
    ).get(league.id, idResult.data) as {
      id: number; player_id: number; player_name: string; induction_season: number;
      vote_share: number; veterans_committee: number; ped_flag: number;
      wing: string; memorial: number; career_stats_at_induction: string | null;
      position: string; age: number;
    } | undefined;

    if (!inductee) { res.status(404).json({ error: 'Not found' }); return; }

    // Also fetch ballot history (best_vote_share, years_on_ballot before induction)
    const ballotHistory = prepared(
      `SELECT years_on_ballot, best_vote_share FROM hof_ballot WHERE league_id = ? AND player_id = ?`
    ).get(league.id, idResult.data) as { years_on_ballot: number; best_vote_share: number } | undefined;

    res.json({
      ...inductee,
      ballot_years: ballotHistory?.years_on_ballot ?? null,
      best_vote_share_on_ballot: ballotHistory?.best_vote_share ?? null,
    });
  } catch (err) { next(err); }
});
