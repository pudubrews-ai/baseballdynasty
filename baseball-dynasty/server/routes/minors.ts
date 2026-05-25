// Minors routes — v0.4.0 Step 9
import { Router, Request, Response, NextFunction } from 'express';
import { prepared, getActiveLeague } from '../db.js';

export const minorsRouter = Router();

// GET /api/minors/standings — all 4 levels, 200 always (even 0-0 records)
minorsRouter.get('/standings', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) {
      res.json({ AAA: [], AA: [], A: [], Rookie: [] });
      return;
    }

    const LEVELS = ['AAA', 'AA', 'A', 'Rookie'] as const;

    // Build 20-team rows per level. If standings exist, use them; otherwise synthesize 0-0 rows.
    const result: Record<string, unknown[]> = { AAA: [], AA: [], A: [], Rookie: [] };

    for (const level of LEVELS) {
      const rows = prepared(
        `SELECT mls.team_id, t.city || ' ' || t.name AS team_name,
                mls.wins, mls.losses
         FROM minor_league_standings mls
         JOIN teams t ON t.id = mls.team_id
         WHERE mls.league_id = ? AND mls.season_number = ? AND mls.level = ?
         ORDER BY mls.wins DESC, mls.losses ASC`
      ).all(league.id, league.season_number, level) as Array<{
        team_id: number; team_name: string; wins: number; losses: number;
      }>;

      // If no standings rows yet, build 0-0 rows for all teams
      if (rows.length === 0) {
        const teams = prepared('SELECT id, city, name FROM teams WHERE league_id = ?').all(league.id) as Array<{ id: number; city: string; name: string }>;
        result[level] = teams.map(t => ({
          team_id: t.id,
          team_name: `${t.city} ${t.name}`,
          wins: 0,
          losses: 0,
          pct: 0,
          gb: 0,
        }));
      } else {
        const leader = rows[0];
        result[level] = rows.map(r => {
          const total = r.wins + r.losses;
          const pct = total > 0 ? Math.round((r.wins / total) * 1000) / 1000 : 0;
          const gb = leader
            ? Math.max(0, ((leader.wins - r.wins) + (r.losses - leader.losses)) / 2)
            : 0;
          return {
            team_id: r.team_id,
            team_name: r.team_name,
            wins: r.wins,
            losses: r.losses,
            pct,
            gb: Math.round(gb * 10) / 10,
          };
        });
      }
    }

    res.json(result);
  } catch (err) { next(err); }
});
