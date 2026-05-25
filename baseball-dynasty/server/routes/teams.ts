import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prepared, getActiveLeague, type TeamRow, type PlayerRow } from '../db.js';

// Derived owner patience — §9
function ownerPatience(personality: string): number {
  const map: Record<string, number> = {
    meddling: 2, 'win-now': 4, moderate: 6, patient: 8, 'hands-off': 10,
  };
  return map[personality] ?? 6;
}

// Derived owner net worth tier — §9
function ownerNetWorthTier(marketSize: string, ownerAge: number): string {
  const baseTier: Record<string, string> = {
    mega: 'billionaire', large: 'wealthy', medium: 'wealthy', small: 'modest',
  };
  const tierOrder = ['modest', 'wealthy', 'billionaire', 'mega'];
  let tier = baseTier[marketSize] ?? 'wealthy';
  if (ownerAge >= 65) {
    const idx = tierOrder.indexOf(tier);
    tier = tierOrder[Math.min(idx + 1, tierOrder.length - 1)] ?? tier;
  }
  return tier;
}

export const teamsRouter = Router();

const teamIdSchema = z.coerce.number().int().positive();

// Helper to build the minors nested object (§3.3)
// v0.2.0: includes live stats from season_stats for minor leaguers
function buildMinorsObject(teamId: number): Record<string, unknown[]> {
  const league = getActiveLeague();

  const minorsRaw = prepared(
    `SELECT p.id, p.first_name, p.last_name, p.age, p.position, p.overall_rating, p.potential,
            p.minor_level, p.prospect_visible, p.service_time_days
     FROM players p
     WHERE p.team_id = ? AND p.minor_level IS NOT NULL AND p.is_drafted = 1`
  ).all(teamId) as Array<{
    id: number; first_name: string; last_name: string; age: number; position: string;
    overall_rating: number; potential: string; minor_level: string;
    prospect_visible: number; service_time_days: number;
  }>;

  // Fetch live stats if league is active
  const statsMap = new Map<number, Record<string, unknown>>();
  if (league) {
    const statsRaw = prepared(
      `SELECT ss.player_id,
              ss.games_played, ss.at_bats, ss.hits, ss.home_runs, ss.rbi,
              ss.innings_pitched, ss.earned_runs, ss.strikeouts_pitching
       FROM season_stats ss
       WHERE ss.league_id = ? AND ss.season_number = ? AND ss.player_id IN
         (SELECT id FROM players WHERE team_id = ? AND minor_level IS NOT NULL AND is_drafted = 1)`
    ).all(league.id, league.season_number, teamId) as Array<{
      player_id: number; games_played: number; at_bats: number; hits: number;
      home_runs: number; rbi: number; innings_pitched: number; earned_runs: number;
      strikeouts_pitching: number;
    }>;

    for (const s of statsRaw) {
      const isPitcher = s.innings_pitched > 0;
      if (isPitcher) {
        statsMap.set(s.player_id, {
          // D12-documented keys (season_stats sub-object)
          games_played: s.games_played,
          ip: s.innings_pitched,
          era: s.innings_pitched > 0 ? Math.round((s.earned_runs * 9.0 / s.innings_pitched) * 100) / 100 : null,
          k: s.strikeouts_pitching,
        });
      } else {
        const battingAvg = s.at_bats > 0 ? Math.round(s.hits / s.at_bats * 1000) / 1000 : null;
        statsMap.set(s.player_id, {
          // D12-documented keys (season_stats sub-object)
          games_played: s.games_played,
          at_bats: s.at_bats,
          hits: s.hits,
          home_runs: s.home_runs,
          battingAvg,
          // keep legacy keys for compatibility
          rbi: s.rbi,
        });
      }
    }
  }

  const minors: Record<string, unknown[]> = { AAA: [], AA: [], A: [], Rookie: [] };
  for (const p of minorsRaw) {
    const level = p.minor_level ?? 'Rookie';
    if (minors[level]) {
      minors[level]!.push({
        ...p,
        season_stats: statsMap.get(p.id) ?? null,
      });
    }
  }
  return minors;
}

teamsRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const teams = prepared('SELECT * FROM teams WHERE league_id = ? ORDER BY wins DESC').all(league.id) as TeamRow[];
    res.json(teams.map(t => ({
      id: t.id,
      name: t.name,
      city: t.city,
      abbreviation: t.abbreviation,    // §3.1
      region: t.region,
      conference: t.conference,
      division: t.division,
      wins: t.wins,
      losses: t.losses,
      runs_scored: t.runs_scored,
      runs_allowed: t.runs_allowed,
      market_size: t.market_size,
      color: t.color,
      // §3.1 Iter4: Add front-office fields per Architect ruling (REVERSING Iter 2)
      owner_name: t.owner_name,
      owner_personality: t.owner_personality,
      gm_name: t.gm_name,
      gm_archetype: t.gm_archetype,
      gm_personality: {
        philosophy: t.gm_philosophy,
        risk_tolerance: t.gm_risk_tolerance,
        focus: t.gm_focus,
      },
      manager_name: t.manager_name,
      manager_tactics: t.manager_tactics,
      manager_motivation: t.manager_motivation,
      manager_communication: t.manager_communication,
      interim_gm: t.interim_gm,
      interim_manager: t.interim_manager,
      job_security: t.job_security,
      revenue: t.revenue,
      payroll_budget: t.payroll_budget,
      current_payroll: t.current_payroll,
    })));
  } catch (err) { next(err); }
});

teamsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const team = prepared(
      `SELECT id, league_id, name, city, state_province, region, market_size, conference, division, color, abbreviation,
              wins, losses, runs_scored, runs_allowed, games_played, payroll_budget, current_payroll, revenue,
              gm_name, gm_philosophy, gm_risk_tolerance, gm_focus, gm_archetype,
              manager_name, manager_style, manager_tactics, manager_motivation, manager_communication,
              owner_name, owner_personality, owner_age,
              job_security, trade_posture, interim_gm, interim_manager,
              last_call_up_check_game, last_firing_check_game, last_gm_firing_check_game,
              last_service_time_update_game, deadline_trades_this_season,
              chemistry_score, franchise_value, relocation_threat_active, stadium_capacity
       FROM teams WHERE id = ?`
    ).get(idResult.data) as TeamRow | undefined;
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; } // §2.16.1

    const minors = buildMinorsObject(team.id); // §3.3

    // §2.1: Add roster array to team detail response
    const roster = prepared(
      'SELECT id, first_name, last_name, age, position, overall_rating, potential, annual_salary, contract_years_remaining FROM players WHERE team_id = ? AND is_on_25man = 1 ORDER BY overall_rating DESC'
    ).all(team.id);

    // Front office history
    const frontOfficeHistory = prepared(
      `SELECT id, event_type, departing_person, incoming_person, reason, hired_person_context,
              season_number, created_at
       FROM front_office_events
       WHERE team_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    ).all(team.id) as Array<{
      id: number; event_type: string; departing_person: string | null;
      incoming_person: string | null; reason: string | null;
      hired_person_context: string | null; season_number: number; created_at: number;
    }>;

    // Hire context for current GM/manager — M-01: unconditional fallback for original worldgen GMs/managers
    const gmHireEvent = frontOfficeHistory.find(e => e.event_type === 'gm_fired');
    const gmHiredContext = gmHireEvent
      ? (gmHireEvent.hired_person_context ?? (team.interim_gm === 1 ? 'Interim appointment' : 'Hired in offseason'))
      : (team.interim_gm === 1 ? 'Interim appointment' : 'Founding GM (league inception)');
    const managerHireEvent = frontOfficeHistory.find(e =>
      e.event_type === 'manager_fired' || e.event_type === 'manager_resigned');
    const managerHiredContext = managerHireEvent
      ? (managerHireEvent.hired_person_context ?? (team.interim_manager === 1 ? 'Interim appointment' : 'Hired in offseason'))
      : (team.interim_manager === 1 ? 'Interim appointment' : 'Founding manager (league inception)');

    res.json({
      id: team.id,
      name: team.name,
      city: team.city,
      abbreviation: team.abbreviation,    // §3.1
      region: team.region,
      conference: team.conference,
      division: team.division,
      wins: team.wins,
      losses: team.losses,
      runs_scored: team.runs_scored,
      runs_allowed: team.runs_allowed,
      market_size: team.market_size,
      color: team.color,
      gm_name: team.gm_name,
      gm_archetype: team.gm_archetype,
      gm_personality: {                   // §3.2 — nested object from flat DB columns
        philosophy: team.gm_philosophy,
        risk_tolerance: team.gm_risk_tolerance,
        focus: team.gm_focus,
      },
      manager_name: team.manager_name,
      manager_tactics: team.manager_tactics,
      manager_motivation: team.manager_motivation,
      manager_communication: team.manager_communication,
      owner_name: team.owner_name,
      owner_personality: team.owner_personality,
      owner_age: team.owner_age,
      owner_patience: ownerPatience(team.owner_personality),
      owner_net_worth_tier: ownerNetWorthTier(team.market_size, team.owner_age),
      interim_gm: team.interim_gm,
      interim_manager: team.interim_manager,
      job_security: team.job_security,
      payroll_budget: team.payroll_budget,
      current_payroll: team.current_payroll,
      revenue: team.revenue,
      minors,                              // §3.3
      roster,                              // §2.1
      gm_hired_context: gmHiredContext,
      manager_hired_context: managerHiredContext,
      front_office_history: frontOfficeHistory,
      // Step 13: chemistry (server-only, A-5/I-1 — never submitted by client)
      chemistry_score: team.chemistry_score ?? 50,
      // Step 14: franchise value and relocation
      franchise_value: team.franchise_value ?? null,
      relocation_threat_active: team.relocation_threat_active === 1,
      stadium_capacity: team.stadium_capacity ?? null,
    });
  } catch (err) { next(err); }
});

teamsRouter.get('/:id/roster', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const players = prepared(
      'SELECT * FROM players WHERE team_id = ? AND is_on_25man = 1 ORDER BY overall_rating DESC'
    ).all(idResult.data) as PlayerRow[];

    res.json(players.map(p => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      age: p.age,
      position: p.position,
      overall_rating: p.overall_rating,
      potential: p.potential,
      annual_salary: p.annual_salary,
      contract_years_remaining: p.contract_years_remaining,
    })));
  } catch (err) { next(err); }
});

teamsRouter.get('/:id/minors', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const minors = buildMinorsObject(idResult.data);
    res.json(minors); // Returns grouped object for consistency (§3.3)
  } catch (err) { next(err); }
});

teamsRouter.get('/:id/history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const teamId = idResult.data;

    // Existence check — 404 for unknown team
    const teamExists = prepared('SELECT id, league_id FROM teams WHERE id = ?').get(teamId) as { id: number; league_id: number } | undefined;
    if (!teamExists) { res.status(404).json({ error: 'Team not found' }); return; }

    const leagueId = teamExists.league_id;

    // Season records from franchise_season_history
    const seasonRecords = prepared(
      `SELECT season_number, wins, losses, division_finish, playoff_round, made_playoffs, won_championship, city_label
       FROM franchise_season_history
       WHERE league_id = ? AND team_id = ?
       ORDER BY season_number ASC`
    ).all(leagueId, teamId) as Array<{
      season_number: number; wins: number; losses: number; division_finish: number | null;
      playoff_round: string | null; made_playoffs: number; won_championship: number; city_label: string | null;
    }>;

    // Manager history from front_office_events + franchise_season_history for record computation
    const managerEvents = prepared(
      `SELECT departing_person, incoming_person, reason, season_number, created_at,
              CASE WHEN reason LIKE '%Interim%' OR reason LIKE '%interim%' THEN 1 ELSE 0 END AS interim
       FROM front_office_events
       WHERE team_id = ? AND event_type = 'manager_fired'
       ORDER BY created_at ASC`
    ).all(teamId) as Array<{
      departing_person: string | null; incoming_person: string | null; reason: string | null;
      season_number: number; created_at: number; interim: number;
    }>;

    // Build manager history — each fired manager + aggregated record from franchise_season_history
    // Spec interpretation (documented): tenure_games is approximated from full seasons under that manager.
    // We use manager_name stored in franchise_season_history per season to attribute W/L.
    const managerHistory = managerEvents.map(ev => {
      const name = ev.departing_person ?? 'Unknown';
      const seasons = prepared(
        `SELECT SUM(wins) as wins, SUM(losses) as losses, COUNT(*) as seasons
         FROM franchise_season_history WHERE team_id = ? AND manager_name = ?`
      ).get(teamId, name) as { wins: number; losses: number; seasons: number } | undefined;
      return {
        name,
        tenure_seasons: seasons?.seasons ?? 0,
        tenure_games: (seasons?.wins ?? 0) + (seasons?.losses ?? 0),
        record: { wins: seasons?.wins ?? 0, losses: seasons?.losses ?? 0 },
        reason: ev.reason ?? null,
        interim: ev.interim === 1,
      };
    });

    // GM history — same pattern
    const gmEvents = prepared(
      `SELECT departing_person, incoming_person, reason, season_number, created_at,
              CASE WHEN reason LIKE '%Interim%' OR reason LIKE '%interim%' THEN 1 ELSE 0 END AS interim
       FROM front_office_events
       WHERE team_id = ? AND event_type = 'gm_fired'
       ORDER BY created_at ASC`
    ).all(teamId) as Array<{
      departing_person: string | null; incoming_person: string | null; reason: string | null;
      season_number: number; created_at: number; interim: number;
    }>;

    const gmHistory = gmEvents.map(ev => {
      const name = ev.departing_person ?? 'Unknown';
      const seasons = prepared(
        `SELECT SUM(wins) as wins, SUM(losses) as losses, COUNT(*) as seasons
         FROM franchise_season_history WHERE team_id = ? AND gm_name = ?`
      ).get(teamId, name) as { wins: number; losses: number; seasons: number } | undefined;
      return {
        name,
        tenure_seasons: seasons?.seasons ?? 0,
        tenure_games: (seasons?.wins ?? 0) + (seasons?.losses ?? 0),
        record: { wins: seasons?.wins ?? 0, losses: seasons?.losses ?? 0 },
        reason: ev.reason ?? null,
        interim: ev.interim === 1,
      };
    });

    // Owner history
    const ownerEvents = prepared(
      `SELECT departing_person, incoming_person, reason, event_type, season_number, created_at
       FROM front_office_events
       WHERE team_id = ? AND event_type IN ('owner_sold_team', 'owner_died')
       ORDER BY created_at ASC`
    ).all(teamId) as Array<{
      departing_person: string | null; incoming_person: string | null; reason: string | null;
      event_type: string; season_number: number; created_at: number;
    }>;

    const ownerHistory = ownerEvents.map((ev, idx) => {
      const nextEv = ownerEvents[idx + 1];
      return {
        name: ev.departing_person ?? 'Unknown',
        era_start: ev.season_number,
        era_end: nextEv ? nextEv.season_number - 1 : 'present',
        exit_reason: ev.event_type === 'owner_died' ? 'died' : 'sold',
      };
    });

    // Championships from franchise_season_history
    const championships = prepared(
      `SELECT fsh.season_number, fsh.manager_name, fsh.gm_name
       FROM franchise_season_history fsh
       WHERE fsh.team_id = ? AND fsh.won_championship = 1
       ORDER BY fsh.season_number ASC`
    ).all(teamId) as Array<{ season_number: number; manager_name: string | null; gm_name: string | null }>;

    // All-time stat leaders from franchise_player_season
    // Most HR (career as member of this franchise)
    const mostHr = prepared(
      `SELECT fps.player_id, p.first_name, p.last_name, SUM(fps.home_runs) AS total
       FROM franchise_player_season fps
       JOIN players p ON p.id = fps.player_id
       WHERE fps.team_id = ?
       GROUP BY fps.player_id, p.first_name, p.last_name
       ORDER BY total DESC LIMIT 1`
    ).get(teamId) as { player_id: number; first_name: string; last_name: string; total: number } | undefined;

    const mostHits = prepared(
      `SELECT fps.player_id, p.first_name, p.last_name, SUM(fps.hits) AS total
       FROM franchise_player_season fps
       JOIN players p ON p.id = fps.player_id
       WHERE fps.team_id = ?
       GROUP BY fps.player_id, p.first_name, p.last_name
       ORDER BY total DESC LIMIT 1`
    ).get(teamId) as { player_id: number; first_name: string; last_name: string; total: number } | undefined;

    const mostWins = prepared(
      `SELECT fps.player_id, p.first_name, p.last_name, SUM(fps.wins) AS total
       FROM franchise_player_season fps
       JOIN players p ON p.id = fps.player_id
       WHERE fps.team_id = ?
       GROUP BY fps.player_id, p.first_name, p.last_name
       ORDER BY total DESC LIMIT 1`
    ).get(teamId) as { player_id: number; first_name: string; last_name: string; total: number } | undefined;

    // Lowest ERA (min 50 IP as member of this franchise)
    const lowestEra = prepared(
      `SELECT fps.player_id, p.first_name, p.last_name,
              ROUND(SUM(fps.earned_runs) * 9.0 / NULLIF(SUM(fps.innings_pitched), 0), 2) AS era,
              SUM(fps.innings_pitched) AS ip
       FROM franchise_player_season fps
       JOIN players p ON p.id = fps.player_id
       WHERE fps.team_id = ?
       GROUP BY fps.player_id, p.first_name, p.last_name
       HAVING ip >= 50
       ORDER BY era ASC LIMIT 1`
    ).get(teamId) as { player_id: number; first_name: string; last_name: string; era: number; ip: number } | undefined;

    const statLeaders = {
      most_hr: mostHr ? { player_id: mostHr.player_id, name: `${mostHr.first_name} ${mostHr.last_name}`, value: mostHr.total } : null,
      most_hits: mostHits ? { player_id: mostHits.player_id, name: `${mostHits.first_name} ${mostHits.last_name}`, value: mostHits.total } : null,
      most_wins: mostWins ? { player_id: mostWins.player_id, name: `${mostWins.first_name} ${mostWins.last_name}`, value: mostWins.total } : null,
      lowest_era: lowestEra ? { player_id: lowestEra.player_id, name: `${lowestEra.first_name} ${lowestEra.last_name}`, value: lowestEra.era, ip: lowestEra.ip } : null,
    };

    res.json({
      season_records: seasonRecords.map(r => ({
        season_number: r.season_number,
        wins: r.wins,
        losses: r.losses,
        division_finish: r.division_finish,
        playoff_round: r.playoff_round ?? 'missed',
        made_playoffs: r.made_playoffs === 1,
        won_championship: r.won_championship === 1,
        city_label: r.city_label,
      })),
      manager_history: managerHistory,
      gm_history: gmHistory,
      owner_history: ownerHistory,
      championships: championships.map(c => ({
        season: c.season_number,
        manager_name: c.manager_name,
        gm_name: c.gm_name,
      })),
      stat_leaders: statLeaders,
    });
  } catch (err) { next(err); }
});

// GET /api/teams/:id/financials — financial history year-over-year (Step 5)
teamsRouter.get('/:id/financials', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const teamId = idResult.data;

    // Existence check — 404 for unknown team
    const teamExists = prepared('SELECT id, league_id FROM teams WHERE id = ?').get(teamId) as { id: number; league_id: number } | undefined;
    if (!teamExists) { res.status(404).json({ error: 'Team not found' }); return; }

    const leagueId = teamExists.league_id;

    const historyRows = prepared(
      `SELECT season_number, revenue, attendance_avg, payroll_actual, payroll_budget, luxury_tax_paid
       FROM franchise_season_history
       WHERE league_id = ? AND team_id = ?
       ORDER BY season_number ASC`
    ).all(leagueId, teamId) as Array<{
      season_number: number; revenue: number; attendance_avg: number;
      payroll_actual: number; payroll_budget: number; luxury_tax_paid: number;
    }>;

    // Also expose current franchise_value from teams table
    const teamRow = prepared(
      'SELECT franchise_value, relocation_threat_active FROM teams WHERE id = ?'
    ).get(teamId) as { franchise_value: number; relocation_threat_active: number } | undefined;

    res.json({
      revenue_history: historyRows.map(r => ({
        season_number: r.season_number,
        revenue: r.revenue,
        attendance_avg: r.attendance_avg,
        payroll_actual: r.payroll_actual,
        payroll_budget: r.payroll_budget,
        luxury_tax_paid: r.luxury_tax_paid,
      })),
      attendance_history: historyRows.map(r => ({
        season_number: r.season_number,
        attendance_avg: r.attendance_avg,
      })),
      payroll_history: historyRows.map(r => ({
        season_number: r.season_number,
        payroll_actual: r.payroll_actual,
        payroll_budget: r.payroll_budget,
        luxury_tax_paid: r.luxury_tax_paid,
      })),
      franchise_value: teamRow?.franchise_value ?? 0,
      relocation_threat_active: (teamRow?.relocation_threat_active ?? 0) === 1,
    });
  } catch (err) { next(err); }
});
