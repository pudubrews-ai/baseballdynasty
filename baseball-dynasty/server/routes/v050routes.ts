// v0.5.0 API routes — Section 7
// GET /api/draft/rule5
// POST /api/draft/rule5/protect
// GET /api/international/prospects
// GET /api/international/signings
// GET /api/arbitration/eligible
// GET /api/rivalries
// GET /api/awards/current
// GET /api/awards/history
// GET /api/teams/:id/stadium
// GET /api/franchise/dashboard/:teamId

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getActiveLeague, prepared } from '../db.js';
import { getFranchiseState } from '../sim/franchise.js';

export const v050Router = Router();

// =========================================================
// GET /api/draft/rule5 — Rule 5 eligible players grouped by team
// Never expose eligibility before the protection window (offseason only)
// =========================================================
v050Router.get('/draft/rule5', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    // Only show in offseason/protection window phases
    const eligiblePhases = ['offseason', 'rule5_protect', 'rule5_draft'];
    if (!eligiblePhases.includes(league.phase) && league.offseason_step !== 'rule5_protect' && league.offseason_step !== 'rule5_draft') {
      res.json([]);
      return;
    }

    // Rule 5 eligible: on_40man=0, years_in_org >= 3 for under-25, >= 4 for 25+
    // Players with team_id, not already rule5_drafted, not on 40-man
    const rows = prepared(
      `SELECT p.id, p.first_name, p.last_name, p.age, p.position,
              p.overall_rating, p.years_in_org, p.service_time,
              p.is_on_40man, p.potential, p.minor_level,
              t.id AS team_id, t.name AS team_name, t.city AS team_city
       FROM players p
       JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = ? AND p.is_on_40man = 0
         AND p.team_id IS NOT NULL AND p.rule5_drafted = 0
         AND (
           (p.age < 25 AND p.years_in_org >= 3) OR
           (p.age >= 25 AND p.years_in_org >= 4)
         )
         AND p.is_on_mlb_roster = 0
       ORDER BY t.id ASC, p.overall_rating DESC`
    ).all(league.id) as Array<{
      id: number; first_name: string; last_name: string; age: number; position: string;
      overall_rating: number; years_in_org: number; service_time: number | null;
      is_on_40man: number; potential: string | null; minor_level: string | null;
      team_id: number; team_name: string; team_city: string;
    }>;

    // Group by team
    const byTeam: Record<number, { team_id: number; team_name: string; team_city: string; players: typeof rows }> = {};
    for (const r of rows) {
      if (!byTeam[r.team_id]) {
        byTeam[r.team_id] = { team_id: r.team_id, team_name: r.team_name, team_city: r.team_city, players: [] };
      }
      byTeam[r.team_id]!.players.push(r);
    }

    res.json(Object.values(byTeam));
  } catch (err) { next(err); }
});

// =========================================================
// POST /api/draft/rule5/protect — server-authoritative 40-man protection
// Derives protecting team from franchise_state.owned_team_id (CISO V5-6)
// =========================================================
const Rule5ProtectBody = z.object({
  playerId: z.number().int().positive(),
}).strict();

v050Router.post('/draft/rule5/protect', (req: Request, res: Response, next: NextFunction): void => {
  try {
    const bodyResult = Rule5ProtectBody.safeParse(req.body);
    if (!bodyResult.success) { res.status(400).json({ error: 'invalid body', details: bodyResult.error.flatten() }); return; }

    const { playerId } = bodyResult.data;
    const league = getActiveLeague();
    if (!league) { res.status(400).json({ error: 'no active league' }); return; }

    // Gate: only during protection window
    if (league.offseason_step !== 'rule5_protect') {
      res.status(409).json({ error: 'draft window closed' }); return;
    }

    // Derive owned team from franchise_state (never from request body)
    const fs = getFranchiseState(league.id);
    if (!fs || fs.owned_team_id == null) { res.status(409).json({ error: 'not your org — no franchise selected' }); return; }
    const ownedTeamId = fs.owned_team_id;

    // Validate player exists and belongs to owned org
    const player = prepared(
      `SELECT id, team_id, is_on_40man, years_in_org, age, is_on_mlb_roster
       FROM players WHERE id = ? AND league_id = ?`
    ).get(playerId, league.id) as {
      id: number; team_id: number | null; is_on_40man: number;
      years_in_org: number; age: number; is_on_mlb_roster: number;
    } | undefined;

    if (!player) { res.status(404).json({ error: 'player not found' }); return; }
    if (player.team_id !== ownedTeamId) { res.status(409).json({ error: 'not your org' }); return; }
    if (player.is_on_40man === 1) { res.status(409).json({ error: 'player already on 40-man' }); return; }

    // Check Rule 5 eligibility
    const isEligible = (player.age < 25 && player.years_in_org >= 3) || (player.age >= 25 && player.years_in_org >= 4);
    if (!isEligible) { res.status(409).json({ error: 'player not eligible for Rule 5' }); return; }

    // Enforce 40-man cap (<= 40)
    const currentCount = (prepared(
      'SELECT COUNT(*) AS cnt FROM players WHERE team_id = ? AND is_on_40man = 1'
    ).get(ownedTeamId) as { cnt: number }).cnt;
    if (currentCount >= 40) { res.status(409).json({ error: '40-man full' }); return; }

    // Protect: add to 40-man
    prepared('UPDATE players SET is_on_40man = 1 WHERE id = ?').run(playerId);

    res.json({ success: true, playerId, teamId: ownedTeamId, message: 'Player added to 40-man roster' });
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/international/prospects — current prospect pool
// NEVER expose true_overall or unrevealed potential (CISO V5-1)
// =========================================================
v050Router.get('/international/prospects', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const rows = prepared(
      `SELECT ip.id, ip.name, ip.age, ip.origin_country,
              ip.scouted_overall, ip.potential,
              ip.signed, ip.signing_team_id,
              t.name AS signing_team_name, t.city AS signing_team_city
       FROM international_prospects ip
       LEFT JOIN teams t ON t.id = ip.signing_team_id
       WHERE ip.league_id = ? AND ip.season_number = ?
       ORDER BY ip.scouted_overall DESC`
    ).all(league.id, league.season_number) as Array<{
      id: number; name: string; age: number; origin_country: string;
      scouted_overall: number; potential: string | null;
      signed: number; signing_team_id: number | null;
      signing_team_name: string | null; signing_team_city: string | null;
    }>;

    // CISO V5-1: never expose true_overall; only expose potential if signed and revealed
    const safe = rows.map(r => ({
      id: r.id,
      name: r.name,
      age: r.age,
      origin_country: r.origin_country,
      scouted_overall: r.scouted_overall,
      // potential visible only if signed (revealed on signing)
      potential: r.signed === 1 ? r.potential : null,
      signed: r.signed === 1,
      signing_team: r.signing_team_id ? {
        id: r.signing_team_id,
        name: r.signing_team_name,
        city: r.signing_team_city,
      } : null,
      // true_overall NEVER returned
    }));

    res.json(safe);
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/international/signings — completed signings this offseason
// No true_overall or unrevealed potential even for signed players (CISO V5-1)
// =========================================================
v050Router.get('/international/signings', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const rows = prepared(
      `SELECT ip.id, ip.name, ip.age, ip.origin_country,
              ip.scouted_overall, ip.signing_team_id,
              t.name AS team_name, t.city AS team_city
       FROM international_prospects ip
       JOIN teams t ON t.id = ip.signing_team_id
       WHERE ip.league_id = ? AND ip.season_number = ? AND ip.signed = 1
       ORDER BY ip.scouted_overall DESC`
    ).all(league.id, league.season_number) as Array<{
      id: number; name: string; age: number; origin_country: string;
      scouted_overall: number; signing_team_id: number;
      team_name: string; team_city: string;
    }>;

    // CISO V5-1: never expose true_overall; potential deliberately excluded
    const safe = rows.map(r => ({
      id: r.id,
      name: r.name,
      age: r.age,
      origin_country: r.origin_country,
      scouted_overall: r.scouted_overall,
      team: { id: r.signing_team_id, name: r.team_name, city: r.team_city },
    }));

    res.json(safe);
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/arbitration/eligible — arb-eligible players with projected salary
// =========================================================
v050Router.get('/arbitration/eligible', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    // PINNED position multipliers (Section 5a.2)
    const POSITION_MULTIPLIERS: Record<string, number> = {
      'C': 1.3, 'SS': 1.25, '2B': 1.15, 'CF': 1.15, 'SP': 1.2, 'RP': 0.9,
      '3B': 1.05, 'LF': 1.05, 'RF': 1.05, '1B': 1.0, 'DH': 1.0, 'CL': 0.9,
    };

    const rows = prepared(
      `SELECT p.id, p.first_name, p.last_name, p.age, p.position,
              p.overall_rating, p.arb_year, p.service_time, p.annual_salary,
              p.team_id, t.name AS team_name, t.city AS team_city
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = ? AND p.arb_year IS NOT NULL
         AND p.team_id IS NOT NULL
       ORDER BY p.arb_year ASC, p.overall_rating DESC`
    ).all(league.id) as Array<{
      id: number; first_name: string; last_name: string; age: number; position: string;
      overall_rating: number; arb_year: number; service_time: number | null; annual_salary: number;
      team_id: number; team_name: string; team_city: string;
    }>;

    const result = rows.map(p => {
      const posMult = POSITION_MULTIPLIERS[p.position] ?? 1.0;
      const ageMod = Math.max(0.7, 1.0 - Math.max(0, p.age - 30) * 0.05);
      const marketValue = p.overall_rating * posMult * ageMod * 10000;
      const arbSalary = p.arb_year === 1 ? marketValue * 0.40
        : p.arb_year === 2 ? marketValue * 0.60
        : marketValue * 0.80;

      return {
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        age: p.age,
        position: p.position,
        overall_rating: p.overall_rating,
        arb_year: p.arb_year,
        service_time: p.service_time,
        current_salary: p.annual_salary,
        projected_arb_salary: Math.round(arbSalary),
        team: { id: p.team_id, name: p.team_name, city: p.team_city },
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/rivalries — all active rivalries with score > 0
// =========================================================
v050Router.get('/rivalries', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const rows = prepared(
      `SELECT r.id, r.team_a_id, r.team_b_id, r.rivalry_score,
              r.formed_season, r.last_updated_season, r.origin_type,
              ta.name AS team_a_name, ta.city AS team_a_city, ta.color AS team_a_color,
              tb.name AS team_b_name, tb.city AS team_b_city, tb.color AS team_b_color
       FROM rivalries r
       JOIN teams ta ON ta.id = r.team_a_id
       JOIN teams tb ON tb.id = r.team_b_id
       WHERE r.league_id = ? AND r.rivalry_score > 0
       ORDER BY r.rivalry_score DESC`
    ).all(league.id) as Array<{
      id: number; team_a_id: number; team_b_id: number; rivalry_score: number;
      formed_season: number; last_updated_season: number; origin_type: string;
      team_a_name: string; team_a_city: string; team_a_color: string;
      team_b_name: string; team_b_city: string; team_b_color: string;
    }>;

    res.json(rows.map(r => ({
      id: r.id,
      rivalry_score: r.rivalry_score,
      formed_season: r.formed_season,
      last_updated_season: r.last_updated_season,
      origin_type: r.origin_type,
      team_a: { id: r.team_a_id, name: r.team_a_name, city: r.team_a_city, color: r.team_a_color },
      team_b: { id: r.team_b_id, name: r.team_b_name, city: r.team_b_city, color: r.team_b_color },
    })));
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/awards/current — live award race standings (all 6 slots)
// Uses "American"/"National" as data keys (Orchestrator Decision 2)
// =========================================================
v050Router.get('/awards/current', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const rows = prepared(
      `SELECT ar.award_type, ar.league AS league, ar.leader_player_id,
              ar.leader_value, ar.second_player_id, ar.second_value, ar.last_updated_game,
              lp.first_name AS leader_first, lp.last_name AS leader_last,
              lp.team_id AS leader_team_id, lp.position AS leader_position,
              sp.first_name AS second_first, sp.last_name AS second_last,
              sp.team_id AS second_team_id
       FROM award_races ar
       LEFT JOIN players lp ON lp.id = ar.leader_player_id
       LEFT JOIN players sp ON sp.id = ar.second_player_id
       WHERE ar.league_id = ? AND ar.season_number = ?
       ORDER BY ar.award_type ASC, ar.league ASC`
    ).all(league.id, league.season_number) as Array<{
      award_type: string; league: string;
      leader_player_id: number | null; leader_value: number | null;
      second_player_id: number | null; second_value: number | null;
      last_updated_game: number;
      leader_first: string | null; leader_last: string | null;
      leader_team_id: number | null; leader_position: string | null;
      second_first: string | null; second_last: string | null; second_team_id: number | null;
    }>;

    res.json(rows.map(r => ({
      award_type: r.award_type,
      league: r.league === 'American' ? 'AL' : r.league === 'National' ? 'NL' : r.league,
      last_updated_game: r.last_updated_game,
      leader: r.leader_player_id ? {
        player_id: r.leader_player_id,
        name: `${r.leader_first ?? ''} ${r.leader_last ?? ''}`.trim(),
        team_id: r.leader_team_id,
        position: r.leader_position,
        value: r.leader_value,
      } : null,
      second: r.second_player_id ? {
        player_id: r.second_player_id,
        name: `${r.second_first ?? ''} ${r.second_last ?? ''}`.trim(),
        team_id: r.second_team_id,
        value: r.second_value,
      } : null,
    })));
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/awards/history — all past award winners
// LEFT JOIN players; render name: 'Unknown' if player row gone (CISO V5-9)
// =========================================================
v050Router.get('/awards/history', (_req: Request, res: Response, next: NextFunction): void => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json([]); return; }

    const rows = prepared(
      `SELECT aw.id, aw.season_number, aw.award_type, aw.league AS league,
              aw.player_id, aw.vote_share,
              p.first_name, p.last_name, p.team_id, p.position,
              t.name AS team_name, t.city AS team_city
       FROM award_winners aw
       LEFT JOIN players p ON p.id = aw.player_id
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE aw.league_id = ?
       ORDER BY aw.season_number DESC, aw.award_type ASC, aw.league ASC`
    ).all(league.id) as Array<{
      id: number; season_number: number; award_type: string; league: string;
      player_id: number; vote_share: number;
      first_name: string | null; last_name: string | null;
      team_id: number | null; position: string | null;
      team_name: string | null; team_city: string | null;
    }>;

    // CISO V5-9: always render a name, never blank or 500
    res.json(rows.map(r => ({
      id: r.id,
      season_number: r.season_number,
      award_type: r.award_type,
      league: r.league === 'American' ? 'AL' : r.league === 'National' ? 'NL' : r.league,
      vote_share: r.vote_share,
      player: {
        id: r.player_id,
        name: r.first_name && r.last_name ? `${r.first_name} ${r.last_name}` : 'Unknown',
        position: r.position,
        team: r.team_id ? { id: r.team_id, name: r.team_name, city: r.team_city } : null,
      },
    })));
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/teams/:id/stadium — stadium details + upgrade history
// Full guard chain: Zod→400, existence→404, league-scoped (CISO V5-3)
// =========================================================
v050Router.get('/teams/:id/stadium', (req: Request, res: Response, next: NextFunction): void => {
  try {
    const idResult = z.coerce.number().int().positive().safeParse(req.params['id']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid team id' }); return; }
    const teamId = idResult.data;

    const league = getActiveLeague();
    if (!league) { res.status(400).json({ error: 'no active league' }); return; }

    const team = prepared(
      `SELECT id, name, city, market_size, stadium_capacity,
              stadium_upgrade_in_progress, stadium_upgrade_complete_season,
              stadium_upgrade_type, new_stadium_honeymoon_seasons_remaining
       FROM teams WHERE id = ? AND league_id = ?`
    ).get(teamId, league.id) as {
      id: number; name: string; city: string; market_size: string;
      stadium_capacity: number;
      stadium_upgrade_in_progress: number; stadium_upgrade_complete_season: number | null;
      stadium_upgrade_type: string | null; new_stadium_honeymoon_seasons_remaining: number;
    } | undefined;

    if (!team) { res.status(404).json({ error: 'team not found' }); return; }

    // Upgrade history
    const upgrades = prepared(
      `SELECT id, upgrade_type, cost, season_started, season_completed,
              capacity_delta, revenue_delta
       FROM stadium_upgrades WHERE team_id = ?
       ORDER BY season_started DESC`
    ).all(teamId) as Array<{
      id: number; upgrade_type: string; cost: number; season_started: number;
      season_completed: number | null; capacity_delta: number; revenue_delta: number;
    }>;

    res.json({
      team_id: team.id,
      team_name: `${team.city} ${team.name}`,
      stadium_name: `${team.city} ${team.name} Park`,
      stadium_capacity: team.stadium_capacity,
      upgrade_in_progress: team.stadium_upgrade_in_progress === 1,
      upgrade_complete_season: team.stadium_upgrade_complete_season,
      upgrade_type: team.stadium_upgrade_type,
      honeymoon_seasons_remaining: team.new_stadium_honeymoon_seasons_remaining,
      upgrade_history: upgrades,
    });
  } catch (err) { next(err); }
});

// =========================================================
// GET /api/franchise/dashboard/:teamId — aggregate franchise view (Section 8)
// Single snapshot to avoid torn view during turbo (X-F1)
// =========================================================
v050Router.get('/franchise/dashboard/:teamId', (req: Request, res: Response, next: NextFunction): void => {
  try {
    const idResult = z.coerce.number().int().positive().safeParse(req.params['teamId']);
    if (!idResult.success) { res.status(400).json({ error: 'invalid team id' }); return; }
    const teamId = idResult.data;

    const league = getActiveLeague();
    if (!league) { res.status(400).json({ error: 'no active league' }); return; }

    // Single current_game_number snapshot to avoid torn view (X-F1)
    const currentGameNumber = league.current_game_number;

    // Team
    const team = prepared(
      `SELECT id, name, city, color, market_size, conference, division,
              wins, losses, games_played, winning_streak, losing_streak,
              owner_name, owner_personality, owner_age,
              gm_name, gm_archetype, manager_name,
              interim_gm, interim_manager,
              payroll_budget, revenue, franchise_value, chemistry_score
       FROM teams WHERE id = ? AND league_id = ?`
    ).get(teamId, league.id) as {
      id: number; name: string; city: string; color: string;
      market_size: string; conference: string; division: string;
      wins: number; losses: number; games_played: number;
      winning_streak: number; losing_streak: number;
      owner_name: string; owner_personality: string; owner_age: number;
      gm_name: string; gm_archetype: string; manager_name: string;
      interim_gm: number; interim_manager: number;
      payroll_budget: number; revenue: number; franchise_value: number;
      chemistry_score: number | null;
    } | undefined;

    if (!team) { res.status(404).json({ error: 'team not found' }); return; }

    const gamesPlayed = team.wins + team.losses;
    const winPct = gamesPlayed > 0 ? Math.round((team.wins / gamesPlayed) * 1000) / 1000 : 0;

    // Standings position in division
    const divTeams = prepared(
      `SELECT id, wins, losses FROM teams WHERE league_id = ? AND division = ? ORDER BY wins DESC`
    ).all(league.id, team.division) as Array<{ id: number; wins: number; losses: number }>;
    const standingsPos = divTeams.findIndex(t => t.id === teamId) + 1;

    // GM confidence (franchise_state)
    const fs = getFranchiseState(league.id);
    const gmConfidence = fs?.owned_team_id === teamId ? (fs.gm_confidence ?? 100) : null;

    // Roster — 25-man active
    const roster25 = prepared(
      `SELECT id, first_name, last_name, position, overall_rating, age,
              annual_salary, contract_years_remaining, is_injured, suspension_games_remaining,
              streak_type, streak_games_remaining
       FROM players
       WHERE team_id = ? AND league_id = ? AND is_on_25man = 1
       ORDER BY position ASC, overall_rating DESC`
    ).all(teamId, league.id) as Array<{
      id: number; first_name: string; last_name: string; position: string;
      overall_rating: number; age: number; annual_salary: number;
      contract_years_remaining: number; is_injured: number; suspension_games_remaining: number;
      streak_type: string | null; streak_games_remaining: number;
    }>;

    // Top 10 prospects (minor leaguers, sorted by overall)
    const prospects10 = prepared(
      `SELECT id, first_name, last_name, position, overall_rating, age,
              potential, minor_level, is_international_signee
       FROM players
       WHERE team_id = ? AND league_id = ? AND is_on_mlb_roster = 0
         AND minor_level IS NOT NULL
       ORDER BY overall_rating DESC LIMIT 10`
    ).all(teamId, league.id) as Array<{
      id: number; first_name: string; last_name: string; position: string;
      overall_rating: number; age: number; potential: string | null;
      minor_level: string; is_international_signee: number;
    }>;

    // Recent news — last 10 for this team
    const recentNews = prepared(
      `SELECT id, event_type, badge, headline_text, game_number, created_at
       FROM news_items
       WHERE league_id = ? AND team_id = ?
       ORDER BY id DESC LIMIT 10`
    ).all(league.id, teamId) as Array<{
      id: number; event_type: string; badge: string | null;
      headline_text: string | null; game_number: number; created_at: number;
    }>;

    // History snapshot
    const history = prepared(
      `SELECT COUNT(*) AS seasons_played,
              COALESCE(SUM(won_championship), 0) AS championships,
              COALESCE(SUM(made_playoffs), 0) AS playoff_appearances,
              COALESCE(SUM(wins), 0) AS career_wins
       FROM franchise_season_history WHERE league_id = ? AND team_id = ?`
    ).get(league.id, teamId) as {
      seasons_played: number; championships: number; playoff_appearances: number; career_wins: number;
    } | undefined;

    // Current payroll (live)
    const currentPayroll = (prepared(
      'SELECT COALESCE(SUM(annual_salary), 0) AS total FROM players WHERE team_id = ? AND contract_years_remaining > 0 AND annual_salary > 0'
    ).get(teamId) as { total: number }).total;

    // Luxury tax status
    const luxuryThreshold = 220_000_000;
    const overLuxury = currentPayroll > luxuryThreshold;
    const luxuryTaxOwed = overLuxury ? Math.round((currentPayroll - luxuryThreshold) * 0.20) : 0;

    res.json({
      team_id: teamId,
      current_game_number: currentGameNumber,
      record: { wins: team.wins, losses: team.losses, win_pct: winPct },
      standings_position: standingsPos,
      division: team.division,
      conference: team.conference,
      market_size: team.market_size,
      streaks: {
        winning_streak: team.winning_streak ?? 0,
        losing_streak: team.losing_streak ?? 0,
      },
      at_a_glance: {
        wins: team.wins,
        losses: team.losses,
        win_pct: winPct,
        standings_position: standingsPos,
        payroll_vs_budget: {
          current_payroll: currentPayroll,
          budget: team.payroll_budget,
          over_budget: currentPayroll > team.payroll_budget,
          luxury_tax_owed: luxuryTaxOwed,
          over_luxury_threshold: overLuxury,
        },
        gm_confidence: gmConfidence,
        chemistry_score: team.chemistry_score,
      },
      front_office: {
        owner_name: team.owner_name,
        owner_personality: team.owner_personality,
        owner_age: team.owner_age,
        gm_name: team.gm_name,
        gm_archetype: team.gm_archetype,
        interim_gm: team.interim_gm === 1,
        manager_name: team.manager_name,
        interim_manager: team.interim_manager === 1,
      },
      roster_25man: roster25.map(p => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        position: p.position,
        overall_rating: p.overall_rating,
        age: p.age,
        annual_salary: p.annual_salary,
        contract_years_remaining: p.contract_years_remaining,
        is_injured: p.is_injured === 1,
        suspended: p.suspension_games_remaining > 0,
        streak_type: p.streak_type,
        streak_games_remaining: p.streak_games_remaining,
      })),
      prospects_top10: prospects10.map(p => ({
        id: p.id,
        name: `${p.first_name} ${p.last_name}`,
        position: p.position,
        overall_rating: p.overall_rating,
        age: p.age,
        level: p.minor_level,
        // potential revealed on signing (is_international_signee=1 means potential shown)
        potential: p.potential,
        is_international: p.is_international_signee === 1,
      })),
      recent_news_10: recentNews,
      financials_snapshot: {
        revenue: team.revenue,
        current_payroll: currentPayroll,
        payroll_budget: team.payroll_budget,
        franchise_value: team.franchise_value,
        luxury_tax_threshold: luxuryThreshold,
        luxury_tax_owed: luxuryTaxOwed,
        over_luxury_threshold: overLuxury,
      },
      history_snapshot: {
        seasons_played: history?.seasons_played ?? 0,
        championships: history?.championships ?? 0,
        playoff_appearances: history?.playoff_appearances ?? 0,
        career_wins: history?.career_wins ?? 0,
      },
    });
  } catch (err) { next(err); }
});
