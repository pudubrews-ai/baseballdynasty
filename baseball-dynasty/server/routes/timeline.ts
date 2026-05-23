import { Router, Request, Response, NextFunction } from 'express';
import { prepared, getActiveLeague } from '../db.js';

export const timelineRouter = Router();

// §3.4: snake_case fields + notable_events per season
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

    const result = seasons.map(s => {
      // Pull notable events from game_log for this season
      const eventsRaw = prepared(
        `SELECT notable_events_json FROM game_log
         WHERE league_id = ? AND season_number = ? AND notable_events_json != '[]'
         LIMIT 100`
      ).all(league.id, s.season_number) as Array<{ notable_events_json: string }>;

      const allEvents: unknown[] = [];
      for (const row of eventsRaw) {
        try {
          const arr = JSON.parse(row.notable_events_json);
          if (Array.isArray(arr)) allEvents.push(...arr);
        } catch { /* ignore malformed JSON */ }
      }
      const notable_events = allEvents.slice(0, 10);

      return {
        season_number: s.season_number,
        champion_team_id: s.champion_team_id,
        champion_team_name: s.champion_team_name,
        mvp_player_id: s.mvp_player_id,
        mvp_player_name: s.mvp_player_name,
        narrative: s.narrative,
        year: 2025 + s.season_number,
        notable_events,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});
