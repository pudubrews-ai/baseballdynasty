import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prepared, getActiveLeague, type TeamRow, type PlayerRow } from '../db.js';

export const teamsRouter = Router();

const teamIdSchema = z.coerce.number().int().positive();

teamsRouter.get('/', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const teams = prepared('SELECT * FROM teams WHERE league_id = ? ORDER BY wins DESC').all(league.id) as TeamRow[];
    res.json(teams.map(t => ({
      id: t.id,
      name: t.name,
      city: t.city,
      region: t.region,
      conference: t.conference,
      division: t.division,
      wins: t.wins,
      losses: t.losses,
      runsScored: t.runs_scored,
      runsAllowed: t.runs_allowed,
      marketSize: t.market_size,
      color: t.color,
    })));
  } catch (err) { next(err); }
});

teamsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const team = prepared('SELECT * FROM teams WHERE id = ?').get(idResult.data) as TeamRow | undefined;
    if (!team) { res.status(404).json({ error: 'not_found' }); return; }

    res.json({
      id: team.id,
      name: team.name,
      city: team.city,
      region: team.region,
      conference: team.conference,
      division: team.division,
      wins: team.wins,
      losses: team.losses,
      runsScored: team.runs_scored,
      runsAllowed: team.runs_allowed,
      marketSize: team.market_size,
      color: team.color,
      gmName: team.gm_name,
      gmPhilosophy: team.gm_philosophy,
      gmRiskTolerance: team.gm_risk_tolerance,
      gmFocus: team.gm_focus,
      managerName: team.manager_name,
      ownerName: team.owner_name,
      payrollBudget: team.payroll_budget,
      currentPayroll: team.current_payroll,
      revenue: team.revenue,
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
      firstName: p.first_name,
      lastName: p.last_name,
      age: p.age,
      position: p.position,
      overallRating: p.overall_rating,
      potential: p.potential,
      annualSalary: p.annual_salary,
      contractYearsRemaining: p.contract_years_remaining,
    })));
  } catch (err) { next(err); }
});

teamsRouter.get('/:id/minors', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const idResult = teamIdSchema.safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid_id' }); return; }

    const players = prepared(
      'SELECT * FROM players WHERE team_id = ? AND is_on_mlb_roster = 0 AND is_drafted = 1 ORDER BY overall_rating DESC'
    ).all(idResult.data) as PlayerRow[];

    res.json(players.map(p => ({
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      age: p.age,
      position: p.position,
      overallRating: p.overall_rating,
      potential: p.potential,
      minorLevel: p.minor_level,
    })));
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
