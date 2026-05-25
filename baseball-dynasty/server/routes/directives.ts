// Owner Directives endpoints — v0.3.0 §7
// CB-1: server-authoritative, team from franchise_state not body.

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getActiveLeague, prepared, type LeagueRow } from '../db.js';
import {
  getFranchiseState,
  setGmConfidence,
  type FranchiseStateRow,
} from '../sim/franchise.js';
import {
  hasDirectiveThisSeason,
  countDirectiveThisSeason,
  recordDirective,
} from '../sim/directives.js';
import { computeTeamStreak } from '../sim/streak.js';
import { promoteInterimManagerDirective } from '../sim/firings.js';
import { insertNewsItem } from '../sim/news.js';

export const directivesRouter = Router();

function emptyBody() {
  return z.object({}).strict();
}

// L2: Detect SQLite UNIQUE constraint errors (race backstop for once/season directives)
function isUniqueConstraintError(err: unknown): boolean {
  if (err instanceof Error && 'code' in err) {
    return (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      || err.message.includes('UNIQUE constraint failed');
  }
  return false;
}

function getLeagueAndFranchise(res: Response): {
  league: LeagueRow;
  fs: FranchiseStateRow;
  ownedTeamId: number;
} | null {
  const league = getActiveLeague();
  if (!league) { res.status(409).json({ error: 'no_active_league' }); return null; }
  const fs = getFranchiseState(league.id);
  if (!fs || fs.owned_team_id == null) { res.status(403).json({ error: 'no_franchise' }); return null; }
  return { league, fs, ownedTeamId: fs.owned_team_id };
}

// GET /api/directive/status — directive availability for UI
directivesRouter.get('/status', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const league = getActiveLeague();
    if (!league) { res.json({}); return; }
    const fs = getFranchiseState(league.id);
    if (!fs || fs.owned_team_id == null) {
      res.json({
        goForIt: { available: false, reason: 'no_franchise' },
        rebuild: { available: false, reason: 'no_franchise' },
        targetPlayer: { available: false, reason: 'no_franchise' },
        fireManager: { available: false, reason: 'no_franchise' },
        trustProcess: { available: false, reason: 'no_franchise' },
        addressClubhouse: { available: false, reason: 'no_franchise', suggested: false },
      });
      return;
    }

    const season = league.season_number;
    const lid = league.id;

    const goForItIssued = hasDirectiveThisSeason(lid, season, 'go_for_it');
    const rebuildIssued = hasDirectiveThisSeason(lid, season, 'rebuild');
    const fireManagerIssued = hasDirectiveThisSeason(lid, season, 'fire_manager');
    const trustProcessIssued = hasDirectiveThisSeason(lid, season, 'trust_process');
    const targetPlayerCount = countDirectiveThisSeason(lid, season, 'target_player');

    // NF-4: Address the Clubhouse — available when owned-team chemistry < 25, one-time use, no cooldown cost
    const addressClubhouseIssued = hasDirectiveThisSeason(lid, season, 'address_clubhouse');
    const ownedTeamChemistry = (prepared(
      'SELECT chemistry_score FROM teams WHERE id = ?'
    ).get(fs.owned_team_id) as { chemistry_score: number } | undefined)?.chemistry_score ?? 50;
    const clubhouseSuggested = ownedTeamChemistry < 25;

    res.json({
      goForIt: {
        available: !goForItIssued && !rebuildIssued,
        reason: goForItIssued ? 'cooldown' : rebuildIssued ? 'mutual_exclusion' : null,
      },
      rebuild: {
        available: !rebuildIssued && !goForItIssued,
        reason: rebuildIssued ? 'cooldown' : goForItIssued ? 'mutual_exclusion' : null,
      },
      targetPlayer: {
        available: targetPlayerCount < 2,
        reason: targetPlayerCount >= 2 ? 'cooldown' : null,
      },
      fireManager: {
        available: !fireManagerIssued && fs.firings_locked_season !== season,
        reason: fireManagerIssued ? 'cooldown' : fs.firings_locked_season === season ? 'firings_locked' : null,
      },
      trustProcess: {
        available: !trustProcessIssued && fs.fire_manager_season !== season,
        reason: trustProcessIssued ? 'cooldown' : fs.fire_manager_season === season ? 'fire_manager_issued' : null,
      },
      // NF-4: Address the Clubhouse — suggested when chemistry < 25, available once per season
      addressClubhouse: {
        available: !addressClubhouseIssued,
        reason: addressClubhouseIssued ? 'cooldown' : null,
        suggested: clubhouseSuggested,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/directive/go-for-it
directivesRouter.post('/go-for-it', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyResult = emptyBody().safeParse(req.body ?? {});
    if (!bodyResult.success) { res.status(400).json({ error: 'invalid_body' }); return; }

    const ctx = getLeagueAndFranchise(res);
    if (!ctx) return;
    const { league, fs, ownedTeamId } = ctx;
    const season = league.season_number;
    const lid = league.id;
    const currentGameNumber = league.current_game_number;

    if (hasDirectiveThisSeason(lid, season, 'go_for_it')) {
      res.status(409).json({ error: 'cooldown' }); return;
    }
    if (hasDirectiveThisSeason(lid, season, 'rebuild')) {
      res.status(409).json({ error: 'mutual_exclusion' }); return;
    }

    const ownedTeamRow = prepared('SELECT * FROM teams WHERE id = ?').get(ownedTeamId) as {
      id: number; city: string; name: string; wins: number; losses: number;
      division: string; gm_name: string;
    } | undefined;
    if (!ownedTeamRow) { res.status(404).json({ error: 'team_not_found' }); return; }

    // Compute GB using half-game formula — D25
    const divTeams = prepared(
      `SELECT wins, losses FROM teams WHERE league_id = ? AND division = ? ORDER BY wins DESC, losses ASC`
    ).all(lid, ownedTeamRow.division) as Array<{ wins: number; losses: number }>;
    const leader = divTeams[0];
    const gb = leader
      ? ((leader.wins - ownedTeamRow.wins) + (ownedTeamRow.losses - leader.losses)) / 2
      : 0;

    recordDirective(lid, season, 'go_for_it', currentGameNumber);

    if (gb >= 15) {
      // 15-back override
      setGmConfidence(lid, -5);
      const headline = `${ownedTeamRow.gm_name} declines to buy despite owner directive, team ${Math.floor(gb)} games out`;
      insertNewsItem({
        leagueId: lid, seasonNumber: season, gameNumber: currentGameNumber,
        eventType: 'milestone', teamId: ownedTeamId,
        headlineText: headline,
        detailsJson: JSON.stringify({ kind: 'go_for_it_override', gb: Math.floor(gb) }),
      });
      // Update go_for_it_season for the outcome tracker even in override
      prepared('UPDATE franchise_state SET go_for_it_season = ? WHERE league_id = ?').run(season, lid);
      const newConf = getFranchiseState(lid)?.gm_confidence ?? 0;
      res.json({ ok: true, gmConfidence: newConf, outcome: 'override_15_back' }); return;
    }

    // Normal: flip to buyer
    prepared('UPDATE teams SET trade_posture = ? WHERE id = ?').run('BUYER', ownedTeamId);
    prepared('UPDATE franchise_state SET go_for_it_season = ? WHERE league_id = ?').run(season, lid);
    insertNewsItem({
      leagueId: lid, seasonNumber: season, gameNumber: currentGameNumber,
      eventType: 'milestone', teamId: ownedTeamId,
      headlineText: `Owner orders ${ownedTeamRow.city} ${ownedTeamRow.name} to go for it — GM shifts to buyer mode.`,
      detailsJson: JSON.stringify({ kind: 'go_for_it' }),
    });

    const newConf = getFranchiseState(lid)?.gm_confidence ?? 100;
    res.json({ ok: true, gmConfidence: newConf });
  } catch (err) {
    if (isUniqueConstraintError(err)) { res.status(409).json({ error: 'cooldown' }); return; }
    next(err);
  }
});

// POST /api/directive/rebuild
directivesRouter.post('/rebuild', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyResult = emptyBody().safeParse(req.body ?? {});
    if (!bodyResult.success) { res.status(400).json({ error: 'invalid_body' }); return; }

    const ctx = getLeagueAndFranchise(res);
    if (!ctx) return;
    const { league, ownedTeamId } = ctx;
    const season = league.season_number;
    const lid = league.id;
    const currentGameNumber = league.current_game_number;

    if (hasDirectiveThisSeason(lid, season, 'rebuild')) {
      res.status(409).json({ error: 'cooldown' }); return;
    }
    if (hasDirectiveThisSeason(lid, season, 'go_for_it')) {
      res.status(409).json({ error: 'mutual_exclusion' }); return;
    }

    const ownedTeamRow = prepared('SELECT id, city, name FROM teams WHERE id = ?').get(ownedTeamId) as {
      city: string; name: string;
    } | undefined;
    if (!ownedTeamRow) { res.status(404).json({ error: 'team_not_found' }); return; }

    recordDirective(lid, season, 'rebuild', currentGameNumber);
    prepared('UPDATE teams SET trade_posture = ? WHERE id = ?').run('SELLER', ownedTeamId);
    prepared('UPDATE franchise_state SET rebuild_season = ? WHERE league_id = ?').run(season, lid);
    insertNewsItem({
      leagueId: lid, seasonNumber: season, gameNumber: currentGameNumber,
      eventType: 'milestone', teamId: ownedTeamId,
      headlineText: `Owner orders a rebuild — ${ownedTeamRow.city} ${ownedTeamRow.name} prospects off-limits, veterans available.`,
      detailsJson: JSON.stringify({ kind: 'rebuild' }),
    });

    const newConf = getFranchiseState(lid)?.gm_confidence ?? 100;
    res.json({ ok: true, gmConfidence: newConf });
  } catch (err) {
    if (isUniqueConstraintError(err)) { res.status(409).json({ error: 'cooldown' }); return; }
    next(err);
  }
});

// POST /api/directive/target-player
directivesRouter.post('/target-player', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyResult = z.object({ targetPlayerId: z.coerce.number().int().positive() }).strict().safeParse(req.body ?? {});
    if (!bodyResult.success) { res.status(400).json({ error: 'invalid_body', details: bodyResult.error.flatten() }); return; }

    const ctx = getLeagueAndFranchise(res);
    if (!ctx) return;
    const { league, ownedTeamId } = ctx;
    const season = league.season_number;
    const lid = league.id;
    const currentGameNumber = league.current_game_number;
    const targetPlayerId = bodyResult.data.targetPlayerId;

    if (countDirectiveThisSeason(lid, season, 'target_player') >= 2) {
      res.status(409).json({ error: 'cooldown' }); return;
    }

    // Validate player exists in active league
    const playerRow = prepared(
      'SELECT id, first_name, last_name FROM players WHERE id = ? AND league_id = ?'
    ).get(targetPlayerId, lid) as { id: number; first_name: string; last_name: string } | undefined;
    if (!playerRow) { res.status(404).json({ error: 'player_not_found' }); return; }

    recordDirective(lid, season, 'target_player', currentGameNumber, targetPlayerId);
    insertNewsItem({
      leagueId: lid, seasonNumber: season, gameNumber: currentGameNumber,
      eventType: 'milestone', teamId: ownedTeamId,
      headlineText: `Owner wants ${playerRow.first_name} ${playerRow.last_name}. GM put on notice to acquire.`,
      detailsJson: JSON.stringify({ kind: 'target_player', playerId: targetPlayerId }),
    });

    const newConf = getFranchiseState(lid)?.gm_confidence ?? 100;
    res.json({ ok: true, gmConfidence: newConf });
  } catch (err) { next(err); }
});

// POST /api/directive/fire-manager
directivesRouter.post('/fire-manager', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyResult = emptyBody().safeParse(req.body ?? {});
    if (!bodyResult.success) { res.status(400).json({ error: 'invalid_body' }); return; }

    const ctx = getLeagueAndFranchise(res);
    if (!ctx) return;
    const { league, fs, ownedTeamId } = ctx;
    const season = league.season_number;
    const lid = league.id;
    const currentGameNumber = league.current_game_number;

    if (hasDirectiveThisSeason(lid, season, 'fire_manager')) {
      res.status(409).json({ error: 'cooldown' }); return;
    }
    if (fs.firings_locked_season === season) {
      res.status(409).json({ error: 'firings_locked' }); return;
    }

    const ownedTeamRow = prepared('SELECT * FROM teams WHERE id = ?').get(ownedTeamId) as {
      id: number; city: string; name: string; wins: number; losses: number;
      games_played: number; manager_name: string; interim_manager: number;
      manager_tactics: number; manager_motivation: number; manager_communication: number;
      job_security: number; gm_name: string;
    } | undefined;
    if (!ownedTeamRow) { res.status(404).json({ error: 'team_not_found' }); return; }

    // Compute streak for reason string
    const { streak } = computeTeamStreak(lid, ownedTeamId, season);
    let streakN = 0;
    if (streak.startsWith('L')) streakN = parseInt(streak.slice(1), 10) || 0;
    const reason = streakN > 0
      ? `Owner lost confidence in manager after ${streakN}-game losing streak`
      : 'Owner lost confidence in manager';

    // Fire via existing path — recordDirective first so UNIQUE index trips before side-effects (PB-7)
    recordDirective(lid, season, 'fire_manager', currentGameNumber);
    promoteInterimManagerDirective(ownedTeamRow, lid, season, currentGameNumber, reason);
    prepared('UPDATE franchise_state SET fire_manager_season = ? WHERE league_id = ?').run(season, lid);
    setGmConfidence(lid, -10);

    const newConf = getFranchiseState(lid)?.gm_confidence ?? 0;

    // Check confidence resignation trigger
    if (newConf <= 0) {
      triggerGmResignation(lid, season, currentGameNumber, ownedTeamRow.gm_name);
    }

    res.json({ ok: true, gmConfidence: newConf });
  } catch (err) {
    if (isUniqueConstraintError(err)) { res.status(409).json({ error: 'cooldown' }); return; }
    next(err);
  }
});

// POST /api/directive/trust-process
directivesRouter.post('/trust-process', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const bodyResult = emptyBody().safeParse(req.body ?? {});
    if (!bodyResult.success) { res.status(400).json({ error: 'invalid_body' }); return; }

    const ctx = getLeagueAndFranchise(res);
    if (!ctx) return;
    const { league, fs, ownedTeamId } = ctx;
    const season = league.season_number;
    const lid = league.id;
    const currentGameNumber = league.current_game_number;

    if (hasDirectiveThisSeason(lid, season, 'trust_process')) {
      res.status(409).json({ error: 'cooldown' }); return;
    }
    if (fs.fire_manager_season === season) {
      res.status(409).json({ error: 'fire_manager_issued' }); return;
    }

    const ownedTeamRow = prepared('SELECT id, city, name FROM teams WHERE id = ?').get(ownedTeamId) as {
      city: string; name: string;
    } | undefined;
    if (!ownedTeamRow) { res.status(404).json({ error: 'team_not_found' }); return; }

    recordDirective(lid, season, 'trust_process', currentGameNumber);
    prepared(
      'UPDATE franchise_state SET firings_locked_season = ?, trust_process_season = ? WHERE league_id = ?'
    ).run(season, season, lid);
    setGmConfidence(lid, +5);
    insertNewsItem({
      leagueId: lid, seasonNumber: season, gameNumber: currentGameNumber,
      eventType: 'milestone', teamId: ownedTeamId,
      headlineText: `Owner signals patience — ${ownedTeamRow.city} ${ownedTeamRow.name} firings frozen for the season.`,
      detailsJson: JSON.stringify({ kind: 'trust_process' }),
    });

    const newConf = getFranchiseState(lid)?.gm_confidence ?? 100;
    res.json({ ok: true, gmConfidence: newConf });
  } catch (err) {
    if (isUniqueConstraintError(err)) { res.status(409).json({ error: 'cooldown' }); return; }
    next(err);
  }
});

// POST /api/directive/address-clubhouse — NF-4
// One-time use, no cooldown cost. Clears all active trade demands on the owned team
// (accelerates resolution per spec line 360 + edge case spec line 504).
// CB-1: team derived from franchise_state, NOT the body.
directivesRouter.post('/address-clubhouse', (req: Request, res: Response, next: NextFunction): void => {
  try {
    const bodyResult = emptyBody().safeParse(req.body ?? {});
    if (!bodyResult.success) { res.status(400).json({ error: 'invalid_body' }); return; }

    const ctx = getLeagueAndFranchise(res);
    if (!ctx) return;
    const { league, ownedTeamId } = ctx;
    const season = league.season_number;
    const lid = league.id;
    const currentGameNumber = league.current_game_number;

    if (hasDirectiveThisSeason(lid, season, 'address_clubhouse')) {
      res.status(409).json({ error: 'cooldown' }); return;
    }

    const chemRow = prepared('SELECT chemistry_score FROM teams WHERE id = ?').get(ownedTeamId) as { chemistry_score: number } | undefined;
    const chemistry = chemRow?.chemistry_score ?? 50;

    recordDirective(lid, season, 'address_clubhouse', currentGameNumber);

    // Effect: accelerate trade demand resolution — immediately clear all active trade demands
    // on the owned team's 25-man roster, restoring any applied penalties (spec line 360)
    const demandingPlayers = prepared(
      `SELECT id, trade_demand_penalty_applied FROM players
       WHERE league_id = ? AND team_id = ? AND trade_demand_active = 1 AND is_on_25man = 1`
    ).all(lid, ownedTeamId) as Array<{ id: number; trade_demand_penalty_applied: number }>;

    for (const p of demandingPlayers) {
      prepared(
        `UPDATE players
         SET contact = MIN(99, contact + CASE WHEN trade_demand_penalty_applied = 1 THEN 3 ELSE 0 END),
             power   = MIN(99, power   + CASE WHEN trade_demand_penalty_applied = 1 THEN 3 ELSE 0 END),
             speed   = MIN(99, speed   + CASE WHEN trade_demand_penalty_applied = 1 THEN 3 ELSE 0 END),
             fielding = MIN(99, fielding + CASE WHEN trade_demand_penalty_applied = 1 THEN 3 ELSE 0 END),
             overall_rating = MIN(99, overall_rating + CASE WHEN trade_demand_penalty_applied = 1 THEN 3 ELSE 0 END),
             trade_demand_active = 0,
             trade_demand_since_game = NULL,
             trade_demand_penalty_applied = 0
         WHERE id = ?`
      ).run(p.id);
    }

    const ownedTeamRow = prepared('SELECT id, city, name FROM teams WHERE id = ?').get(ownedTeamId) as { id: number; city: string; name: string } | undefined;

    insertNewsItem({
      leagueId: lid, seasonNumber: season, gameNumber: currentGameNumber,
      eventType: 'milestone', teamId: ownedTeamId,
      headlineText: `Owner addresses the clubhouse — ${ownedTeamRow ? `${ownedTeamRow.city} ${ownedTeamRow.name}` : 'team'} trade demands resolved.`,
      detailsJson: JSON.stringify({ kind: 'address_clubhouse', chemistry, demands_cleared: demandingPlayers.length }),
    });

    const newConf = getFranchiseState(lid)?.gm_confidence ?? 100;
    res.json({ ok: true, gmConfidence: newConf, demandsClearedCount: demandingPlayers.length });
  } catch (err) {
    if (isUniqueConstraintError(err)) { res.status(409).json({ error: 'cooldown' }); return; }
    next(err);
  }
});

function triggerGmResignation(
  leagueId: number,
  season: number,
  gameNumber: number,
  gmName: string
): void {
  // Immediately insert news item
  insertNewsItem({
    leagueId, seasonNumber: season, gameNumber,
    eventType: 'gm_fired',
    headlineText: `${gmName} resigns, citing inability to operate with ownership interference.`,
    detailsJson: JSON.stringify({ reason: 'low_confidence_resignation' }),
  });
  // Set pending for end-of-season resolution
  prepared('UPDATE franchise_state SET gm_resign_pending_season = ? WHERE league_id = ?').run(season, leagueId);
}
