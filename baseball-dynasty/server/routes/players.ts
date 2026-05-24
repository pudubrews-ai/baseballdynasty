import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prepared, getActiveLeague, type PlayerRow } from '../db.js';

export const playersRouter = Router();

const playerIdSchema = z.coerce.number().int().positive();

// §2.15: Leaders response shape — {hitting: [...], pitching: [...]} with player_name, team_name, stat_value
playersRouter.get('/leaders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json({ hitting: [], pitching: [] }); return; }

    const season = league.season_number;

    type LeaderRow = { first_name: string; last_name: string; team_name: string; value: number; };
    const mapLeader = (category: string) => (row: LeaderRow) => ({
      player_name: `${row.first_name} ${row.last_name}`,
      team_name: row.team_name,
      stat_value: row.value,
      category,
    });

    // Batting avg leaders (min 150 AB — raised from 100 per §3.6)
    const battingAvg = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       CAST(ss.hits AS REAL) / NULLIF(ss.at_bats, 0) as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.at_bats >= 150
       ORDER BY value DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader('AVG'));

    // HR leaders
    const homeRuns = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       ss.home_runs as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ?
       ORDER BY ss.home_runs DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader('HR'));

    // RBI leaders
    const rbi = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       ss.rbi as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ?
       ORDER BY ss.rbi DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader('RBI'));

    // ERA leaders (min 75 IP — raised from 50 per §2.5 Iter 4 to improve realism)
    const era = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       (ss.earned_runs * 9.0) / ss.innings_pitched as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched >= 75
       ORDER BY value ASC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader('ERA'));

    // Strikeout leaders (pitchers)
    const strikeouts = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       ss.strikeouts_pitching as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched > 0
       ORDER BY ss.strikeouts_pitching DESC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader('K'));

    // WHIP leaders (min 75 IP — raised from 50 per §2.5 Iter 4 to improve realism)
    const whip = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       (ss.walks_pitching + ss.hits) / ss.innings_pitched as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.innings_pitched >= 75
       ORDER BY value ASC LIMIT 10`
    ).all(league.id, season) as LeaderRow[]).map(mapLeader('WHIP'));

    res.json({
      hitting: [...battingAvg, ...homeRuns, ...rbi],
      pitching: [...era, ...strikeouts, ...whip],
    });
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
      first_name: p.first_name,
      last_name: p.last_name,
      age: p.age,
      position: p.position,
      overall_rating: p.overall_rating,
      team_name: p.team_name,
    })));
  } catch (err) { next(err); }
});

playersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = playerIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const league = getActiveLeague();
    const player = prepared('SELECT * FROM players WHERE id = ?').get(idResult.data) as PlayerRow | undefined;
    if (!player) { res.status(404).json({ error: 'Player not found' }); return; } // §2.16.2

    const team = player.team_id
      ? prepared('SELECT city, name FROM teams WHERE id = ?').get(player.team_id) as { city: string; name: string } | undefined
      : undefined;

    const seasonStats = league
      ? prepared('SELECT * FROM season_stats WHERE league_id = ? AND season_number = ? AND player_id = ?')
          .get(league.id, league.season_number, player.id)
      : null;

    res.json({
      id: player.id,
      first_name: player.first_name,
      last_name: player.last_name,
      age: player.age,
      position: player.position,
      overall_rating: player.overall_rating,
      potential: player.potential,
      potential_revealed: player.potential_revealed === 1,
      team_id: player.team_id,
      team_name: team ? `${team.city} ${team.name}` : null,
      is_on_mlb_roster: player.is_on_mlb_roster === 1,
      minor_level: player.minor_level,
      contact: player.contact,
      power: player.power,
      speed: player.speed,
      fielding: player.fielding,
      arm: player.arm,
      pitching_velocity: player.pitching_velocity,
      pitching_control: player.pitching_control,
      pitching_stamina: player.pitching_stamina,
      annual_salary: player.annual_salary,
      contract_years_remaining: player.contract_years_remaining,
      origin: player.origin,
      birthplace_country: player.birthplace_country,
      career_hits: player.career_hits,
      career_hr: player.career_hr,
      career_rbi: player.career_rbi,
      career_ip: player.career_ip,
      career_k: player.career_k,
      career_wins: player.career_wins,
      season_stats: seasonStats,
    });
  } catch (err) { next(err); }
});
