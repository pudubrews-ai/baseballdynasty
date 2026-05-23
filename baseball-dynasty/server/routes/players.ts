import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prepared, getActiveLeague, type PlayerRow } from '../db.js';

export const playersRouter = Router();

const playerIdSchema = z.coerce.number().int().positive();

playersRouter.get('/leaders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json({}); return; }

    const season = league.season_number;

    // Batting avg leaders (min 50 AB)
    const battingAvg = prepared(
      `SELECT p.id, p.first_name, p.last_name, t.city || ' ' || t.name as team_name, t.id as team_id,
       CAST(ss.hits AS REAL) / NULLIF(ss.at_bats, 0) as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.at_bats >= 50
       ORDER BY value DESC LIMIT 10`
    ).all(league.id, season);

    // HR leaders
    const homeRuns = prepared(
      `SELECT p.id, p.first_name, p.last_name, t.city || ' ' || t.name as team_name, t.id as team_id,
       ss.home_runs as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ?
       ORDER BY ss.home_runs DESC LIMIT 10`
    ).all(league.id, season);

    // RBI leaders
    const rbi = prepared(
      `SELECT p.id, p.first_name, p.last_name, t.city || ' ' || t.name as team_name, t.id as team_id,
       ss.rbi as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ?
       ORDER BY ss.rbi DESC LIMIT 10`
    ).all(league.id, season);

    // ERA leaders (min 20 IP)
    const era = prepared(
      `SELECT p.id, p.first_name, p.last_name, t.city || ' ' || t.name as team_name, t.id as team_id,
       CASE WHEN ss.innings_pitched >= 20 THEN (ss.earned_runs * 9.0) / ss.innings_pitched ELSE 99.0 END as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched >= 20
       ORDER BY value ASC LIMIT 10`
    ).all(league.id, season);

    // Strikeout leaders (pitchers)
    const strikeouts = prepared(
      `SELECT p.id, p.first_name, p.last_name, t.city || ' ' || t.name as team_name, t.id as team_id,
       ss.strikeouts_pitching as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched > 0
       ORDER BY ss.strikeouts_pitching DESC LIMIT 10`
    ).all(league.id, season);

    // WHIP leaders (min 20 IP)
    const whip = prepared(
      `SELECT p.id, p.first_name, p.last_name, t.city || ' ' || t.name as team_name, t.id as team_id,
       CASE WHEN ss.innings_pitched >= 20 THEN (ss.walks_pitching + ss.hits) / ss.innings_pitched ELSE 99.0 END as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched >= 20
       ORDER BY value ASC LIMIT 10`
    ).all(league.id, season);

    res.json({ battingAvg, homeRuns, rbi, era, strikeouts, whip });
  } catch (err) { next(err); }
});

playersRouter.get('/search', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const query = String(req.query['q'] ?? '').slice(0, 50);
    if (!query) { res.json([]); return; }

    const players = prepared(
      `SELECT p.*, t.city || ' ' || t.name as team_name FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = ? AND (p.first_name LIKE ? OR p.last_name LIKE ?)
       LIMIT 20`
    ).all(league.id, `%${query}%`, `%${query}%`) as Array<PlayerRow & { team_name: string | null }>;

    res.json(players.map(p => ({
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      age: p.age,
      position: p.position,
      overallRating: p.overall_rating,
      teamName: p.team_name,
    })));
  } catch (err) { next(err); }
});

playersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = playerIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const league = getActiveLeague();
    const player = prepared('SELECT * FROM players WHERE id = ?').get(idResult.data) as PlayerRow | undefined;
    if (!player) { res.status(404).json({ error: 'not_found' }); return; }

    const team = player.team_id
      ? prepared('SELECT city, name FROM teams WHERE id = ?').get(player.team_id) as { city: string; name: string } | undefined
      : undefined;

    const seasonStats = league
      ? prepared('SELECT * FROM season_stats WHERE league_id = ? AND season_number = ? AND player_id = ?')
          .get(league.id, league.season_number, player.id)
      : null;

    res.json({
      id: player.id,
      firstName: player.first_name,
      lastName: player.last_name,
      age: player.age,
      position: player.position,
      overallRating: player.overall_rating,
      potential: player.potential,
      potentialRevealed: player.potential_revealed === 1,
      teamId: player.team_id,
      teamName: team ? `${team.city} ${team.name}` : null,
      isOnMlbRoster: player.is_on_mlb_roster === 1,
      minorLevel: player.minor_level,
      contact: player.contact,
      power: player.power,
      speed: player.speed,
      fielding: player.fielding,
      arm: player.arm,
      pitchingVelocity: player.pitching_velocity,
      pitchingControl: player.pitching_control,
      pitchingStamina: player.pitching_stamina,
      annualSalary: player.annual_salary,
      contractYearsRemaining: player.contract_years_remaining,
      origin: player.origin,
      birthplaceCountry: player.birthplace_country,
      careerHits: player.career_hits,
      careerHR: player.career_hr,
      careerRBI: player.career_rbi,
      careerIP: player.career_ip,
      careerK: player.career_k,
      careerWins: player.career_wins,
      seasonStats,
    });
  } catch (err) { next(err); }
});
