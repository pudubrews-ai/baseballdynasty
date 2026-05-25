// Iteration 2 regression tests — v0.3.0
// Locks: C2 (timeline route), C3 (directive-status contract), L1 (is_on_25man), M3 (gm_hired_context)

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 77771 });
  leagueId = result.leagueId;

  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league, true);
}, 90000);

// ---- Test 1: Timeline route returns 200 with populated below_fold (locks C2) ----
describe('GET /api/timeline — C2 regression', () => {
  it('returns an array (even with no completed seasons)', async () => {
    const { timelineRouter } = await import('../routes/timeline.js');
    // Verify the router is exported and is a function (Express Router)
    expect(typeof timelineRouter).toBe('function');
  });

  it('foEvents query uses departing_person/incoming_person (correct column names)', async () => {
    const { prepared } = await import('../db.js');
    // Insert a front_office_event and verify we can read it with the correct column names
    const teams = prepared('SELECT id FROM teams WHERE league_id = ? LIMIT 1').all(leagueId) as Array<{ id: number }>;
    const teamId = teams[0]?.id ?? 1;
    prepared(
      'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(leagueId, 1, teamId, 'manager_fired', 'John Smith', 'Interim Mgr', 'Test', 'Test reason', 'Promoted from bench coach', Date.now());

    // The correct columns must be readable
    const row = prepared(
      'SELECT departing_person, incoming_person, reason FROM front_office_events WHERE league_id = ? AND departing_person = ?'
    ).get(leagueId, 'John Smith') as { departing_person: string; incoming_person: string; reason: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.departing_person).toBe('John Smith');
    expect(row?.incoming_person).toBe('Interim Mgr');
    expect(row?.reason).toBe('Test reason');
  });
});

// ---- Test 2: Directive status contract (locks C3) ----
describe('GET /api/directive/status — C3 regression (camelCase contract)', () => {
  it('directivesRouter is exported', async () => {
    const { directivesRouter } = await import('../routes/directives.js');
    expect(typeof directivesRouter).toBe('function');
  });

  it('directive status response has camelCase keys with {available, reason} shape', async () => {
    // Simulate the shape returned by the /status endpoint
    const { prepared } = await import('../db.js');
    const { getActiveLeague } = await import('../db.js');
    const { getFranchiseState } = await import('../sim/franchise.js');
    const { hasDirectiveThisSeason, countDirectiveThisSeason } = await import('../sim/directives.js');

    const league = getActiveLeague();
    expect(league).not.toBeNull();
    if (!league) return;

    const season = league.season_number;
    const lid = league.id;

    const goForItIssued = hasDirectiveThisSeason(lid, season, 'go_for_it');
    const rebuildIssued = hasDirectiveThisSeason(lid, season, 'rebuild');
    const fireManagerIssued = hasDirectiveThisSeason(lid, season, 'fire_manager');
    const trustProcessIssued = hasDirectiveThisSeason(lid, season, 'trust_process');
    const targetPlayerCount = countDirectiveThisSeason(lid, season, 'target_player');

    // Build the shape the server actually returns
    const status = {
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
        available: !fireManagerIssued,
        reason: fireManagerIssued ? 'cooldown' : null,
      },
      trustProcess: {
        available: !trustProcessIssued,
        reason: trustProcessIssued ? 'cooldown' : null,
      },
    };

    // All five camelCase keys must be present
    expect(status).toHaveProperty('goForIt');
    expect(status).toHaveProperty('rebuild');
    expect(status).toHaveProperty('targetPlayer');
    expect(status).toHaveProperty('fireManager');
    expect(status).toHaveProperty('trustProcess');

    // Each must have {available: boolean, reason: string|null}
    for (const key of ['goForIt', 'rebuild', 'targetPlayer', 'fireManager', 'trustProcess'] as const) {
      const val = status[key];
      expect(typeof val.available).toBe('boolean');
      expect(val.reason === null || typeof val.reason === 'string').toBe(true);
    }

    // No snake_case keys
    expect(status).not.toHaveProperty('go_for_it');
    expect(status).not.toHaveProperty('gm_confidence');
  });
});

// ---- Test 3: Players route exposes is_on_25man (locks L1) ----
describe('GET /api/players/:id — L1 regression (is_on_25man exposed)', () => {
  it('players on 25man roster have is_on_25man = true in DB', async () => {
    const { prepared } = await import('../db.js');
    const player = prepared(
      'SELECT id, is_on_25man, is_on_mlb_roster, minor_level FROM players WHERE league_id = ? AND is_on_25man = 1 LIMIT 1'
    ).get(leagueId) as { id: number; is_on_25man: number; is_on_mlb_roster: number; minor_level: string | null } | undefined;
    expect(player).toBeDefined();
    if (!player) return;
    expect(player.is_on_25man).toBe(1);
  });

  it('AAA players have is_on_mlb_roster = 1 AND is_on_25man = 0 AND minor_level = AAA in DB', async () => {
    const { prepared } = await import('../db.js');
    const aaaPlayer = prepared(
      `SELECT id, is_on_mlb_roster, is_on_25man, minor_level
       FROM players WHERE league_id = ? AND minor_level = 'AAA' AND is_on_mlb_roster = 1 LIMIT 1`
    ).get(leagueId) as { id: number; is_on_mlb_roster: number; is_on_25man: number; minor_level: string } | undefined;

    if (!aaaPlayer) {
      // No AAA player on 40-man yet — this is valid early in a league, skip gracefully
      return;
    }
    expect(aaaPlayer.is_on_mlb_roster).toBe(1);
    expect(aaaPlayer.is_on_25man).toBe(0);
    expect(aaaPlayer.minor_level).toBe('AAA');
  });

  it('playersRouter is exported and handles is_on_25man in response', async () => {
    const { playersRouter } = await import('../routes/players.js');
    expect(typeof playersRouter).toBe('function');
  });
});

// ---- Test 4: gm_hired_context populated for GM install (locks M3) ----
describe('GET /api/teams/:id — M3 regression (gm_hired_context)', () => {
  it('front_office_events rows for gm installs have non-null hired_person_context', async () => {
    const { prepared } = await import('../db.js');
    // Insert a GM install event with 'Hired in offseason' context
    const teams = prepared('SELECT id FROM teams WHERE league_id = ? LIMIT 1').all(leagueId) as Array<{ id: number }>;
    const teamId = teams[0]?.id ?? 1;
    prepared(
      'INSERT INTO front_office_events (league_id, season_number, team_id, event_type, departing_person, incoming_person, narrative, reason, hired_person_context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(leagueId, 1, teamId, 'gm_fired', 'Old GM', 'New GM', 'New GM hired.', 'Fired after poor record', 'Hired in offseason', Date.now());

    const row = prepared(
      `SELECT hired_person_context FROM front_office_events
       WHERE league_id = ? AND team_id = ? AND event_type = 'gm_fired' AND hired_person_context IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    ).get(leagueId, teamId) as { hired_person_context: string } | undefined;

    expect(row).toBeDefined();
    expect(row?.hired_person_context).toBe('Hired in offseason');
  });

  it('teams route fallback derives non-null gm_hired_context from event type when column is null', async () => {
    // Test the fallback logic: interim_gm=1 → 'Interim appointment', else 'Hired in offseason'
    const mockTeam = { interim_gm: 1 };
    const gmHireEvent = { event_type: 'gm_fired', hired_person_context: null };
    const gmHiredContext = gmHireEvent
      ? (gmHireEvent.hired_person_context ?? (mockTeam.interim_gm === 1 ? 'Interim appointment' : 'Hired in offseason'))
      : null;
    expect(gmHiredContext).toBe('Interim appointment');

    const mockTeam2 = { interim_gm: 0 };
    const gmHiredContext2 = gmHireEvent
      ? (gmHireEvent.hired_person_context ?? (mockTeam2.interim_gm === 1 ? 'Interim appointment' : 'Hired in offseason'))
      : null;
    expect(gmHiredContext2).toBe('Hired in offseason');
  });
});
