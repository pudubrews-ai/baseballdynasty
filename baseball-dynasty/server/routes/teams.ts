import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prepared, getActiveLeague, type TeamRow, type PlayerRow } from '../db.js';

export const teamsRouter = Router();

const teamIdSchema = z.coerce.number().int().positive();

// Helper to build the minors nested object (§3.3)
function buildMinorsObject(teamId: number): Record<string, unknown[]> {
  const minorsRaw = prepared(
    'SELECT id, first_name, last_name, age, position, overall_rating, potential, minor_level FROM players WHERE team_id = ? AND is_on_mlb_roster = 0 AND is_drafted = 1'
  ).all(teamId) as Array<{ id: number; first_name: string; last_name: string; age: number; position: string; overall_rating: number; potential: string; minor_level: string }>;

  const minors: Record<string, typeof minorsRaw> = { AAA: [], AA: [], A: [], Rookie: [] };
  for (const p of minorsRaw) {
    const level = p.minor_level ?? 'Rookie';
    if (minors[level]) {
      minors[level]!.push(p);
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
      gm_name: t.gm_name,
      gm_personality: {
        philosophy: t.gm_philosophy,
        risk_tolerance: t.gm_risk_tolerance,
        focus: t.gm_focus,
      },
      manager_name: t.manager_name,
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

    const team = prepared('SELECT * FROM teams WHERE id = ?').get(idResult.data) as TeamRow | undefined;
    if (!team) { res.status(404).json({ error: 'Team not found' }); return; } // §2.16.1

    const minors = buildMinorsObject(team.id); // §3.3

    // §2.1: Add roster array to team detail response
    const roster = prepared(
      'SELECT id, first_name, last_name, age, position, overall_rating, potential, annual_salary, contract_years_remaining FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 ORDER BY overall_rating DESC'
    ).all(team.id);

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
      gm_personality: {                   // §3.2 — nested object from flat DB columns
        philosophy: team.gm_philosophy,
        risk_tolerance: team.gm_risk_tolerance,
        focus: team.gm_focus,
      },
      manager_name: team.manager_name,
      owner_name: team.owner_name,
      payroll_budget: team.payroll_budget,
      current_payroll: team.current_payroll,
      revenue: team.revenue,
      minors,                              // §3.3
      roster,                              // §2.1
    });
  } catch (err) { next(err); }
});

teamsRouter.get('/:id/roster', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const players = prepared(
      'SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 1 ORDER BY overall_rating DESC'
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

    const history = prepared(
      'SELECT * FROM front_office_events WHERE team_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(idResult.data);

    res.json(history);
  } catch (err) { next(err); }
});
