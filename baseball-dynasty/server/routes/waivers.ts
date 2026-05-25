// GET /api/waivers — current waiver wire
// CB-10: scoped by active league; empty → [] 200
// Returns players with waiver_state IN ('dfa','waivers')

import { Router, Request, Response, NextFunction } from 'express';
import { prepared, getActiveLeague } from '../db.js';

export const waiversRouter = Router();

waiversRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) {
      res.json([]);
      return;
    }

    // CB-10: scope by active league_id
    // Return players on waiver wire with claim window remaining
    const rows = prepared(
      `SELECT
         p.id as player_id,
         p.first_name || ' ' || p.last_name as player_name,
         p.position,
         p.overall_rating as overall,
         MAX(0, p.claim_game_window_end - t.games_played) as claim_window_games_remaining,
         p.dfa_team_id,
         dfa_t.city || ' ' || dfa_t.name as dfa_team_name
       FROM players p
       JOIN teams t ON t.id = p.dfa_team_id
       JOIN teams dfa_t ON dfa_t.id = p.dfa_team_id
       WHERE p.league_id = ?
         AND p.waiver_state IN ('dfa','waivers')
         AND p.dfa_team_id IS NOT NULL
       ORDER BY p.id ASC`
    ).all(league.id) as Array<{
      player_id: number;
      player_name: string;
      position: string;
      overall: number;
      claim_window_games_remaining: number;
      dfa_team_id: number;
      dfa_team_name: string;
    }>;

    res.json(rows);
  } catch (err) {
    next(err);
  }
});
