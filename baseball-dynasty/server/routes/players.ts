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

    // Batting avg leaders (min 100 AB — lowered from 150 per §2.3 Iter-5)
    const battingAvg = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       CAST(ss.hits AS REAL) / NULLIF(ss.at_bats, 0) as value
       FROM season_stats ss
       JOIN players p ON p.id = ss.player_id
       LEFT JOIN teams t ON t.id = ss.team_id
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.at_bats >= 100
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

    // WHIP leaders (min 75 IP — AB-21: use hits_allowed not hits)
    const whip = (prepared(
      `SELECT p.first_name, p.last_name, t.city || ' ' || t.name as team_name,
       (ss.walks_pitching + ss.hits_allowed) / ss.innings_pitched as value
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

// GET /api/players/prospects — league-wide top 50 by composite score
// Static SQL only: weights are constants in the ORDER BY expression (check-no-template-sql.mjs gate)
playersRouter.get('/prospects', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    // Potential letter → numeric: A=90, B=75, C=60, D=45
    // Composite: potential_score*0.4 + current_overall*0.3 + (overall_rating as recent_performance proxy)*0.3
    // Static parameterized query — weights are literals, no interpolation.
    const prospects = prepared(
      `SELECT p.id, p.first_name, p.last_name, p.position, p.age, p.minor_level,
              p.overall_rating, p.potential, p.team_id,
              t.city || ' ' || t.name AS team_name,
              CASE p.potential WHEN 'A' THEN 90 WHEN 'B' THEN 75 WHEN 'C' THEN 60 ELSE 45 END AS potential_score,
              (CASE p.potential WHEN 'A' THEN 90 WHEN 'B' THEN 75 WHEN 'C' THEN 60 ELSE 45 END * 0.4
               + p.overall_rating * 0.3
               + p.overall_rating * 0.3) AS composite_score
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = ? AND p.minor_level IS NOT NULL AND p.is_drafted = 1
         AND p.rehab_games_remaining = 0
       ORDER BY composite_score DESC
       LIMIT 50`
    ).all(league.id) as Array<{
      id: number; first_name: string; last_name: string; position: string; age: number;
      minor_level: string | null; overall_rating: number; potential: string;
      team_id: number | null; team_name: string | null;
      potential_score: number; composite_score: number;
    }>;

    res.json(prospects.map((p, idx) => ({
      rank: idx + 1,
      player_id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      position: p.position,
      age: p.age,
      level: p.minor_level,
      team_id: p.team_id,
      team_name: p.team_name,
      overall: p.overall_rating,
      potential: p.potential,
    })));
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

// GET /api/players/:id/transactions — full transaction history for a player
// §4.4 (§0.5): returns 404 when the player id does not exist (was 200 []).
playersRouter.get('/:id/transactions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = playerIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    // §4.4: existence check — 404 if player not found at all (league-independent)
    const playerExists = prepared('SELECT id FROM players WHERE id = ?').get(idResult.data) as { id: number } | undefined;
    if (!playerExists) { res.status(404).json({ error: 'Player not found' }); return; }

    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const transactions = prepared(
      `SELECT t.id, t.league_id, t.season_number, t.transaction_type, t.team_id,
              t.player_id, t.narrative, t.created_at,
              tm.city || ' ' || tm.name as team_name
       FROM transactions t
       LEFT JOIN teams tm ON tm.id = t.team_id
       WHERE t.league_id = ? AND t.player_id = ?
       ORDER BY t.created_at DESC
       LIMIT 100`
    ).all(league.id, idResult.data) as Array<{
      id: number; league_id: number; season_number: number; transaction_type: string;
      team_id: number | null; player_id: number | null; narrative: string | null;
      created_at: number; team_name: string | null;
    }>;

    res.json(transactions);
  } catch (err) { next(err); }
});

playersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = playerIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const league = getActiveLeague();
    const player = prepared(
      `SELECT id, league_id, team_id, first_name, last_name, age, position, overall_rating, potential, potential_revealed,
              contact, power, speed, fielding, arm, pitching_velocity, pitching_control, pitching_stamina,
              is_on_mlb_roster, minor_level, annual_salary, contract_years_remaining, service_time, injury_prone,
              coachability, work_ethic, leadership, origin, birthplace_city, birthplace_country,
              is_drafted, career_hits, career_hr, career_rbi, career_ip, career_k, career_wins,
              is_on_25man, options_remaining, service_time_days, first_mlb_call_up_game, free_agent_eligible,
              manipulation_delay_until_game, prospect_visible, waiver_state, dfa_team_id, claim_game_window_end,
              injury_type, injury_tier, rehab_games_remaining, career_injuries, is_injured, injury_return_game,
              trade_demand_active, memorial, gambling_ban, ped_offenses, retired_number,
              suspension_games_remaining, suspension_type, is_malcontent, loyalty_discount_eligible
       FROM players WHERE id = ?`
    ).get(idResult.data) as PlayerRow | undefined;
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
      is_on_25man: player.is_on_25man === 1,
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
      // Step 10: injury fields
      is_injured: player.is_injured === 1,
      injury_type: player.injury_type ?? null,
      injury_tier: player.injury_tier ?? null,
      rehab_games_remaining: player.rehab_games_remaining ?? 0,
      career_injuries: player.career_injuries ?? 0,
      injury_return_game: player.injury_return_game ?? null,
      // Step 13 + 8: personality + suspension + memorial fields (NF-5, P5)
      trade_demand_active: (player as any).trade_demand_active === 1,
      is_malcontent: (player as any).is_malcontent === 1,
      loyalty_discount_eligible: (player as any).loyalty_discount_eligible === 1,
      suspension_games_remaining: (player as any).suspension_games_remaining ?? 0,
      suspension_type: (player as any).suspension_type ?? null,
      ped_offenses: (player as any).ped_offenses ?? 0,
      gambling_ban: (player as any).gambling_ban === 1,
      memorial: (player as any).memorial === 1,
      retired_number: (player as any).retired_number ?? null,
      // injury_history derived from transactions (notable_events type=injury)
      injury_history: league
        ? (prepared(
            `SELECT t.season_number, t.narrative, t.created_at, t.team_id,
                    tm.city || ' ' || tm.name AS team_name
             FROM transactions t
             LEFT JOIN teams tm ON tm.id = t.team_id
             WHERE t.league_id = ? AND t.player_id = ? AND t.transaction_type = 'injury_il'
             ORDER BY t.created_at DESC
             LIMIT 20`
          ).all(league.id, player.id) as Array<{
            season_number: number; narrative: string | null; created_at: number;
            team_id: number | null; team_name: string | null;
          }>)
        : [],
    });
  } catch (err) { next(err); }
});
