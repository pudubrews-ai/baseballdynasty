import { Router, Request, Response, NextFunction } from 'express';
import { prepared, getActiveLeague } from '../db.js';

export const timelineRouter = Router();

timelineRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const seasons = prepared(
      `SELECT sn.season_number, sn.narrative,
       t.id as champion_team_id, t.city || ' ' || t.name as champion_team_name,
       p.id as mvp_player_id, p.first_name || ' ' || p.last_name as mvp_player_name
       FROM season_narratives sn
       LEFT JOIN teams t ON t.id = sn.champion_team_id
       LEFT JOIN players p ON p.id = sn.mvp_player_id
       WHERE sn.league_id = ?
       ORDER BY sn.season_number DESC`
    ).all(league.id) as Array<{
      season_number: number;
      narrative: string | null;
      champion_team_id: number | null;
      champion_team_name: string | null;
      mvp_player_id: number | null;
      mvp_player_name: string | null;
    }>;

    res.json(seasons.map(s => ({
      seasonNumber: s.season_number,
      championTeamId: s.champion_team_id,
      championTeamName: s.champion_team_name,
      mvpPlayerId: s.mvp_player_id,
      mvpPlayerName: s.mvp_player_name,
      narrative: s.narrative,
      year: 2025 + s.season_number,
    })));
  } catch (err) { next(err); }
});
