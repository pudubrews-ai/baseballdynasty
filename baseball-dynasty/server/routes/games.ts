import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prepared, getActiveLeague, type GameLogRow } from '../db.js';

export const gamesRouter = Router();

const gameIdSchema = z.coerce.number().int().positive();

gamesRouter.get('/recent', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const games = prepared(
      `SELECT gl.*, ht.city || ' ' || ht.name as home_team_name, at2.city || ' ' || at2.name as away_team_name
       FROM game_log gl
       JOIN teams ht ON ht.id = gl.home_team_id
       JOIN teams at2 ON at2.id = gl.away_team_id
       WHERE gl.league_id = ? AND gl.is_complete = 1
       ORDER BY gl.id DESC LIMIT 20`
    ).all(league.id) as Array<GameLogRow & { home_team_name: string; away_team_name: string }>;

    res.json(games.map(g => ({
      id: g.id,
      gameNumber: g.game_number,
      gameDate: g.game_date,
      homeTeamId: g.home_team_id,
      awayTeamId: g.away_team_id,
      homeTeamName: g.home_team_name,
      awayTeamName: g.away_team_name,
      homeScore: g.home_score,
      awayScore: g.away_score,
    })));
  } catch (err) { next(err); }
});

gamesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = gameIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const league = getActiveLeague();
    if (!league) { res.status(404).json({ error: 'not_found' }); return; }

    const game = prepared(
      `SELECT gl.*, ht.city || ' ' || ht.name as home_team_name, at2.city || ' ' || at2.name as away_team_name
       FROM game_log gl
       JOIN teams ht ON ht.id = gl.home_team_id
       JOIN teams at2 ON at2.id = gl.away_team_id
       WHERE gl.id = ? AND gl.league_id = ?`
    ).get(idResult.data, league.id) as (GameLogRow & { home_team_name: string; away_team_name: string }) | undefined;

    if (!game) { res.status(404).json({ error: 'not_found' }); return; }

    let notableEvents: unknown[] = [];
    try {
      notableEvents = JSON.parse(game.notable_events_json) as unknown[];
    } catch { /* use empty array */ }

    // Get batter lines from season_stats for this game
    // Note: In a more complete implementation we'd store per-game batter lines separately
    // For v0.1.0, we return what we have
    const batterStats = prepared(
      `SELECT ss.*, p.first_name, p.last_name, p.position
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       WHERE ss.league_id = ? AND ss.season_number = ?
       AND p.team_id IN (?, ?)
       LIMIT 20`
    ).all(league.id, game.season_number, game.home_team_id, game.away_team_id);

    res.json({
      id: game.id,
      gameNumber: game.game_number,
      gameDate: game.game_date,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamName: game.home_team_name,
      awayTeamName: game.away_team_name,
      homeScore: game.home_score,
      awayScore: game.away_score,
      homeHits: game.home_hits,
      awayHits: game.away_hits,
      homeErrors: game.home_errors,
      awayErrors: game.away_errors,
      homeWalks: game.home_walks,
      awayWalks: game.away_walks,
      notableEvents,
      winningPitcherId: game.winning_pitcher_id,
      losingPitcherId: game.losing_pitcher_id,
      savePitcherId: game.save_pitcher_id,
    });
  } catch (err) { next(err); }
});
