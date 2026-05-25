// In-Season Firing Logic — Phase 9 (v0.2.0)
// Per §5, [AB-12 RULING].
//
// Firing threshold formula:
//   firing_threshold = BASE_GAMES_UNDER_500
//                     × owner_patience_modifier
//                     × gm_aggression_modifier (manager firings only)
//
// Owner patience modifiers (§5):
//   meddling:  0.6x  (fires earliest)
//   win-now:   0.8x
//   patient:   1.5x
//   hands-off: 2.0x  (fires latest)
//
// GM aggression modifiers (manager leash only, §5):
//   aggressive:   0.75x
//   moderate:     1.0x
//   conservative: 1.2x
//
// Firing chain:
//   Owner fires GM: every 10 games, threshold = base × patience_mod (no gm_aggression_mod)
//   GM fires manager: every 5 games, threshold = base × patience_mod × gm_aggression_mod
//   Meddling owner fires manager directly (bypasses GM)
//   Non-meddling owner fires manager directly only at threshold × 2.5 (catastrophic)
//
// Interim rules:
//   Interim manager: bench_coach promoted, manager_style same, all ratings -10, interim_manager=1
//   Interim GM: conservative/moderate defaults, tenure=0, interim_gm=1
//   Interims cannot be fired mid-season (stability floor)

import { getDb, prepared, getActiveLeague, type TeamRow } from '../db.js';
import { insertFrontOfficeNewsItem } from './news.js';
import { resetGmConfidence } from './franchise.js';

const BASE_GAMES_UNDER_500 = 8;

// Patience modifier map
const PATIENCE_MODIFIERS: Record<string, number> = {
  'meddling': 0.6,
  'win-now': 0.8,
  'patient': 1.5,
  'hands-off': 2.0,
};

// GM risk_tolerance → aggression modifier
const AGGRESSION_MODIFIERS: Record<string, number> = {
  'aggressive': 0.75,
  'moderate': 1.0,
  'conservative': 1.2,
};

function gamesUnder500(team: TeamRow): number {
  return team.losses - team.wins;
}

function firingThreshold(
  ownerPersonality: string,
  gmRiskTolerance: string | null,
  includeGmMod: boolean
): number {
  const patienceMod = PATIENCE_MODIFIERS[ownerPersonality] ?? 1.0;
  const aggressionMod = includeGmMod && gmRiskTolerance
    ? (AGGRESSION_MODIFIERS[gmRiskTolerance] ?? 1.0)
    : 1.0;
  return Math.round(BASE_GAMES_UNDER_500 * patienceMod * aggressionMod);
}

// Generate a fresh GM name for interim/permanent hire
function makeInterimGmName(): string {
  return 'Interim GM';
}

function makeInterimManagerName(): string {
  return 'Interim Manager';
}

// Log a front_office_event and return the row id
function logFrontOfficeEvent(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  seasonNumber: number,
  teamId: number,
  eventType: string,
  departingPerson: string,
  incomingPerson: string,
  narrative: string,
  reason: string | null = null,
  hiredPersonContext: string | null = null
): number {
  const result = db.prepare(
    `INSERT INTO front_office_events
       (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(leagueId, seasonNumber, teamId, eventType, departingPerson, incomingPerson, narrative, reason, hiredPersonContext, Date.now());
  return result.lastInsertRowid as number;
}

// Log a news transaction for firing events
function logFiringNews(
  db: ReturnType<typeof getDb>,
  leagueId: number,
  seasonNumber: number,
  teamId: number,
  eventType: 'manager_fired' | 'gm_fired',
  playerNarrative: string,
  currentGameNumber: number = 0
): void {
  db.prepare(
    `INSERT INTO transactions
       (league_id, season_number, transaction_type, team_id, player_id, narrative, game_number, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(leagueId, seasonNumber, eventType, teamId, playerNarrative, currentGameNumber, Date.now());
}

// Promote bench coach to interim manager (ratings -10, same style)
function promoteInterimManager(
  db: ReturnType<typeof getDb>,
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number = 0,
  reasonOverride?: string
): void {
  const interimName = makeInterimManagerName();
  const newTactics = Math.max(0, team.manager_tactics - 10);
  const newMotivation = Math.max(0, team.manager_motivation - 10);
  const newCommunication = Math.max(0, team.manager_communication - 10);

  db.prepare(
    `UPDATE teams
     SET manager_name = ?,
         manager_tactics = ?,
         manager_motivation = ?,
         manager_communication = ?,
         interim_manager = 1,
         job_security = 5
     WHERE id = ?`
  ).run(interimName, newTactics, newMotivation, newCommunication, team.id);

  const reason = reasonOverride ??
    `Fired after going ${team.wins}-${team.losses} through ${team.games_played} games (Season ${seasonNumber})`;
  const hiredPersonContext = 'Promoted from bench coach';
  const headlineText = `${team.manager_name} fired, ${team.city} ${team.name} — ${reason}`;

  const foeRowid = logFrontOfficeEvent(
    db, leagueId, seasonNumber, team.id,
    'manager_fired',
    team.manager_name,
    interimName,
    `${team.city} ${team.name} fire manager ${team.manager_name}. ${interimName} takes over.`,
    reason,
    hiredPersonContext
  );

  logFiringNews(
    db, leagueId, seasonNumber, team.id,
    'manager_fired',
    `${team.city} ${team.name} fire manager ${team.manager_name}.`,
    currentGameNumber
  );

  // §1.1(c): Insert front office news item with headlineText (AB-07)
  insertFrontOfficeNewsItem({
    leagueId,
    seasonNumber,
    gameNumber: currentGameNumber,
    eventType: 'manager_fired',
    teamId: team.id,
    sourceTable: 'front_office_events',
    sourceId: foeRowid,
    headlineText,
    detailsJson: JSON.stringify({ reason, eventType: 'manager_fired', teamId: team.id }),
  });

  console.log(`[firings] ${team.city} ${team.name}: manager ${team.manager_name} fired, interim promoted`);
}

// promoteInterimManagerDirective: called from directive endpoint (bypasses evaluateFirings).
export function promoteInterimManagerDirective(
  team: { id: number; city: string; name: string; wins: number; losses: number; games_played: number;
          manager_name: string; interim_manager: number;
          manager_tactics: number; manager_motivation: number; manager_communication: number;
          job_security: number; },
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number,
  reason: string
): void {
  const db = getDb();
  const interimName = makeInterimManagerName();
  const newTactics = Math.max(0, team.manager_tactics - 10);
  const newMotivation = Math.max(0, team.manager_motivation - 10);
  const newCommunication = Math.max(0, team.manager_communication - 10);

  db.prepare(
    `UPDATE teams SET manager_name = ?, manager_tactics = ?, manager_motivation = ?,
     manager_communication = ?, interim_manager = 1, job_security = 5 WHERE id = ?`
  ).run(interimName, newTactics, newMotivation, newCommunication, team.id);

  const hiredPersonContext = 'Interim appointment';
  const headlineText = `${team.manager_name} fired, ${team.city} ${team.name} — ${reason}`;

  const foeRowid = logFrontOfficeEvent(
    db, leagueId, seasonNumber, team.id,
    'manager_fired', team.manager_name, interimName,
    `Owner of ${team.city} ${team.name} fires manager ${team.manager_name}.`,
    reason, hiredPersonContext
  );

  logFiringNews(db, leagueId, seasonNumber, team.id, 'manager_fired',
    headlineText, currentGameNumber);

  insertFrontOfficeNewsItem({
    leagueId, seasonNumber, gameNumber: currentGameNumber,
    eventType: 'manager_fired', teamId: team.id,
    sourceTable: 'front_office_events', sourceId: foeRowid,
    headlineText,
    detailsJson: JSON.stringify({ reason, eventType: 'manager_fired', teamId: team.id }),
  });

  console.log(`[firings] Directive: ${team.city} ${team.name}: manager ${team.manager_name} fired`);
}

// Install interim GM (conservative/moderate, tenure=0)
function installInterimGm(
  db: ReturnType<typeof getDb>,
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number = 0
): void {
  const interimName = makeInterimGmName();

  db.prepare(
    `UPDATE teams
     SET gm_name = ?,
         gm_philosophy = 'balanced',
         gm_risk_tolerance = 'conservative',
         gm_archetype = 'balanced',
         interim_gm = 1
     WHERE id = ?`
  ).run(interimName, team.id);

  const under500 = Math.max(0, team.losses - team.wins);
  const reason = `Fired after team went ${team.wins}-${team.losses}, ${under500} games under .500 at time of dismissal`;
  const hiredPersonContext = 'Interim appointment';
  const headlineText = `${team.gm_name} fired, ${team.city} ${team.name} — ${reason}`;

  const foeRowid = logFrontOfficeEvent(
    db, leagueId, seasonNumber, team.id,
    'gm_fired',
    team.gm_name,
    interimName,
    `${team.city} ${team.name} fire GM ${team.gm_name}. ${interimName} takes over.`,
    reason,
    hiredPersonContext
  );

  logFiringNews(
    db, leagueId, seasonNumber, team.id,
    'gm_fired',
    `${team.city} ${team.name} fire GM ${team.gm_name}.`,
    currentGameNumber
  );

  // §1.1(c): Insert front office news item with headlineText (AB-07)
  insertFrontOfficeNewsItem({
    leagueId,
    seasonNumber,
    gameNumber: currentGameNumber,
    eventType: 'gm_fired',
    teamId: team.id,
    sourceTable: 'front_office_events',
    sourceId: foeRowid,
    headlineText,
    detailsJson: JSON.stringify({ reason, eventType: 'gm_fired', teamId: team.id }),
  });

  // v0.3.0: reset GM confidence on GM change
  try {
    const league = getActiveLeague();
    if (league && league.id === leagueId) {
      resetGmConfidence(leagueId);
    }
  } catch { /* non-critical */ }

  console.log(`[firings] ${team.city} ${team.name}: GM ${team.gm_name} fired, interim installed`);
}

// Evaluate GM firing (owner fires GM)
// Called every 10 games.
function evaluateOwnerFiresGm(
  db: ReturnType<typeof getDb>,
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number = 0
): boolean {
  // Can't fire an interim GM
  if (team.interim_gm === 1) return false;

  const threshold = firingThreshold(team.owner_personality, null, false);
  const under500 = gamesUnder500(team);

  if (under500 >= threshold) {
    installInterimGm(db, team, leagueId, seasonNumber, currentGameNumber);
    // Update last_gm_firing_check_game
    db.prepare(
      'UPDATE teams SET last_gm_firing_check_game = ? WHERE id = ?'
    ).run(team.games_played, team.id);
    return true;
  }
  return false;
}

// Evaluate manager firing (GM fires manager, or meddling/catastrophic owner fires manager)
// Called every 5 games.
// Returns true if a firing occurred (for double-fire guard).
function evaluateManagerFiring(
  db: ReturnType<typeof getDb>,
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number = 0
): boolean {
  // Can't fire an interim manager
  if (team.interim_manager === 1) return false;

  const under500 = gamesUnder500(team);
  const ownerPersonality = team.owner_personality;

  // §3.2 FIX: manager_resigned — a non-interim manager with job_security=0 under a meddling owner
  // resigns rather than being fired. One branch, one event type. Fires before the forced-firing path.
  if (ownerPersonality === 'meddling' && (team.job_security ?? 10) <= 0) {
    const resigningName = team.manager_name;
    const interimName = makeInterimManagerName();
    const newTactics = Math.max(0, team.manager_tactics - 10);
    const newMotivation = Math.max(0, team.manager_motivation - 10);
    const newCommunication = Math.max(0, team.manager_communication - 10);

    db.prepare(
      `UPDATE teams SET manager_name = ?, manager_tactics = ?, manager_motivation = ?,
       manager_communication = ?, interim_manager = 1, job_security = 5,
       last_firing_check_game = ? WHERE id = ?`
    ).run(interimName, newTactics, newMotivation, newCommunication, team.games_played, team.id);

    const reason = 'Resigned citing philosophical differences with ownership';
    const hiredPersonContext = 'Promoted from bench coach';
    const headlineText = `${resigningName} resigned, ${team.city} ${team.name} — ${reason}`;

    const foeRowid = logFrontOfficeEvent(
      db, leagueId, seasonNumber, team.id,
      'manager_resigned',
      resigningName,
      interimName,
      `${team.city} ${team.name} manager ${resigningName} resigns amid front-office pressure. ${interimName} steps in.`,
      reason,
      hiredPersonContext
    );

    insertFrontOfficeNewsItem({
      leagueId,
      seasonNumber,
      gameNumber: currentGameNumber,
      eventType: 'manager_resigned',
      teamId: team.id,
      sourceTable: 'front_office_events',
      sourceId: foeRowid,
      headlineText,
      detailsJson: JSON.stringify({ reason, eventType: 'manager_resigned', teamId: team.id }),
    });

    console.log(`[firings] ${team.city} ${team.name}: manager ${resigningName} resigned (job_security=0, meddling owner)`);
    return true;
  }

  if (ownerPersonality === 'meddling') {
    // Meddling owner fires manager directly, bypasses GM
    const threshold = firingThreshold(ownerPersonality, null, false);
    // §3.5: Always advance last_firing_check_game when check is due, even if no firing
    db.prepare(
      'UPDATE teams SET last_firing_check_game = ? WHERE id = ?'
    ).run(team.games_played, team.id);
    if (under500 >= threshold) {
      promoteInterimManager(db, team, leagueId, seasonNumber, currentGameNumber);
      return true;
    }
    // §3.2: When team is struggling (under500 > 0) but below the fire threshold,
    // a meddling owner pressures the manager — decrement job_security by 1 per check (floor 0).
    // This lets the resignation branch (above) pre-empt the forced firing path.
    if (under500 > 0) {
      db.prepare(
        'UPDATE teams SET job_security = MAX(0, job_security - 1) WHERE id = ?'
      ).run(team.id);
    }
    return false;
  }

  // §3.5: Always advance last_firing_check_game when check is due
  db.prepare(
    'UPDATE teams SET last_firing_check_game = ? WHERE id = ?'
  ).run(team.games_played, team.id);

  // Non-meddling owner fires manager directly (catastrophic — base threshold × 2.5)
  const catastrophicThreshold = Math.round(firingThreshold(ownerPersonality, null, false) * 2.5);
  if (under500 >= catastrophicThreshold) {
    // Owner breaks glass — fires manager directly, bypassing GM
    promoteInterimManager(db, team, leagueId, seasonNumber, currentGameNumber);

    // GM job_security -= 2 (owner embarrassment)
    db.prepare(
      'UPDATE teams SET job_security = MAX(0, job_security - 2) WHERE id = ?'
    ).run(team.id);

    // Log "owner breaks glass" front_office_events entry and news item
    const glassUnder500 = Math.max(0, team.losses - team.wins);
    const glassReason = `Owner lost confidence in manager after ${glassUnder500}-game losing streak`;
    const glassFoeRowid = logFrontOfficeEvent(
      db, leagueId, seasonNumber, team.id,
      'manager_fired',
      team.manager_name,
      'Interim Manager',
      `Owner of ${team.city} ${team.name} fires manager directly — front office shakeup.`,
      glassReason,
      'Interim appointment'
    );
    const glassHeadline = `${team.manager_name} fired, ${team.city} ${team.name} — ${glassReason}`;
    insertFrontOfficeNewsItem({
      leagueId,
      seasonNumber,
      gameNumber: currentGameNumber,
      eventType: 'manager_fired',
      teamId: team.id,
      sourceTable: 'front_office_events',
      sourceId: glassFoeRowid,
      headlineText: glassHeadline,
      detailsJson: JSON.stringify({ reason: glassReason, eventType: 'manager_fired', teamId: team.id }),
    });

    console.log(`[firings] ${team.city} ${team.name}: owner breaks glass, manager fired, GM job_security -= 2`);
    return true;
  }

  // GM fires manager (non-meddling owner, below catastrophic threshold)
  const gmThreshold = firingThreshold(ownerPersonality, team.gm_risk_tolerance, true);
  if (under500 >= gmThreshold) {
    promoteInterimManager(db, team, leagueId, seasonNumber, currentGameNumber);
    return true;
  }
  return false;
}

// Main export: evaluate firings for one team.
// Called from rosterMaintenance.ts per-team.
// manager check: every 5 games (gated by last_firing_check_game)
// GM check: every 10 games (gated by last_gm_firing_check_game)
export function evaluateFirings(
  team: TeamRow,
  leagueId: number,
  seasonNumber: number,
  currentGameNumber: number = 0
): void {
  const db = getDb();

  const firingTx = db.transaction(() => {
    // Read fresh team state inside transaction
    const freshTeam = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id) as TeamRow | undefined;
    if (!freshTeam) return;

    // D24/AB-05: Trust The Process lock — skip procedural firings for owned team
    const fsRow = db.prepare('SELECT firings_locked_season, owned_team_id FROM franchise_state WHERE league_id = ?').get(leagueId) as
      { firings_locked_season: number | null; owned_team_id: number | null } | undefined;
    if (fsRow && fsRow.owned_team_id === team.id && fsRow.firings_locked_season === seasonNumber) {
      return; // Trust The Process: firings locked for owned team this season
    }

    // Manager check every 5 games
    const managerCheckDue = freshTeam.games_played - freshTeam.last_firing_check_game >= 5;
    let managerFired = false;
    if (managerCheckDue) {
      managerFired = evaluateManagerFiring(db, freshTeam, leagueId, seasonNumber, currentGameNumber);
    }

    // GM check every 10 games — §3.5: skip if manager was fired this tick (double-fire guard)
    const gmCheckDue = freshTeam.games_played - freshTeam.last_gm_firing_check_game >= 10;
    if (gmCheckDue && !managerFired) {
      evaluateOwnerFiresGm(db, freshTeam, leagueId, seasonNumber, currentGameNumber);
      // Always update check timestamp even if no firing
      db.prepare(
        'UPDATE teams SET last_gm_firing_check_game = ? WHERE id = ?'
      ).run(freshTeam.games_played, freshTeam.id);
    } else if (gmCheckDue) {
      // GM check due but skipped (manager fired this tick) — still advance cadence
      db.prepare(
        'UPDATE teams SET last_gm_firing_check_game = ? WHERE id = ?'
      ).run(freshTeam.games_played, freshTeam.id);
    }
  });

  try {
    firingTx();
  } catch (err) {
    console.warn(`[firings] Firing eval error for team ${team.id}:`, err);
  }
}

// Exported for testing
export { firingThreshold, gamesUnder500, BASE_GAMES_UNDER_500, PATIENCE_MODIFIERS, AGGRESSION_MODIFIERS };
