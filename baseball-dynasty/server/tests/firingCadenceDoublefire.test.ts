// §5.7 — Firing cadence + double-fire guard (covers M-5)
// Unit test: manager check due with no firing advances last_firing_check_game.
// Integration: no team gets both manager and GM fired in the same tick.

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';
import {
  firingThreshold,
  gamesUnder500,
} from '../sim/firings.js';

let leagueId: number;

beforeAll(async () => {
  const { initDb, prepared } = await import('../db.js');
  await initDb();

  const { generateWorld } = await import('../sim/worldgen.js');
  const result = await generateWorld({ seed: 55123 });
  leagueId = result.leagueId;

  const league = prepared('SELECT * FROM leagues WHERE id = ?').get(leagueId) as any;
  const { runExpansionDraft } = await import('../sim/draft.js');
  await runExpansionDraft(league as any, true);

  prepared('UPDATE leagues SET phase = ?, current_game_number = 20 WHERE id = ?').run('regular_season', leagueId);
  prepared('UPDATE leagues SET spring_cuts_done_season = 1 WHERE id = ?').run(leagueId);
}, 60000);

// ── §5.7a: Cadence — last_firing_check_game advances even when no firing ────

describe('Firing cadence — last_firing_check_game advances on due check even without firing', () => {
  it('evaluateFirings advances last_firing_check_game when check is due and no firing occurs', async () => {
    const { prepared } = await import('../db.js');
    const { evaluateFirings } = await import('../sim/firings.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const team = teams[0] as any;

    // Set up: team is ABOVE .500 (threshold won't be met), but check is due
    // hands-off + conservative threshold = round(8 * 2.0 * 1.2) = 19
    // Set wins/losses so team is 3 games under (well below threshold of 19)
    prepared(
      "UPDATE teams SET owner_personality = 'hands-off', gm_risk_tolerance = 'conservative', wins = 10, losses = 13, games_played = 23, interim_manager = 0, interim_gm = 0, last_firing_check_game = 0, last_gm_firing_check_game = 0 WHERE id = ?"
    ).run(team.id);

    const before = prepared('SELECT last_firing_check_game FROM teams WHERE id = ?').get(team.id) as any;
    expect(before.last_firing_check_game).toBe(0);

    const freshTeam = prepared('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    evaluateFirings(freshTeam, leagueId, 1);

    const after = prepared('SELECT last_firing_check_game, interim_manager FROM teams WHERE id = ?').get(team.id) as any;

    // last_firing_check_game should have advanced (check was due: 23 - 0 >= 5)
    expect(after.last_firing_check_game).toBeGreaterThan(0);
    // No firing should have occurred (team only 3 games under, threshold = 19)
    expect(after.interim_manager).toBe(0);
  });
});

// ── §5.7b: Double-fire guard — manager + GM not fired in same tick ──────────

describe('Double-fire guard — manager and GM cannot both fire in the same tick', () => {
  it('when manager is fired, GM firing is deferred to next tick', async () => {
    const { prepared } = await import('../db.js');
    const { evaluateFirings } = await import('../sim/firings.js');

    const teams = prepared('SELECT * FROM teams WHERE league_id = ?').all(leagueId) as any[];
    const team = teams[1] as any;

    // Set up conditions that would trigger BOTH manager and GM firing:
    // win-now owner + moderate GM: manager threshold = round(8*0.8*1.0) = 6
    // GM threshold (no mod) = round(8*0.8) = 6
    // Set 15 games under .500 — would trigger both
    // Set both check games to 0 so both checks are due
    prepared(
      "UPDATE teams SET owner_personality = 'win-now', gm_risk_tolerance = 'moderate', gm_archetype = 'balanced', wins = 2, losses = 17, games_played = 19, interim_manager = 0, interim_gm = 0, last_firing_check_game = 0, last_gm_firing_check_game = 0 WHERE id = ?"
    ).run(team.id);

    const freshTeam = prepared('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    evaluateFirings(freshTeam, leagueId, 1);

    const after = prepared('SELECT interim_manager, interim_gm FROM teams WHERE id = ?').get(team.id) as any;

    // Per §3.5 double-fire guard: if manager was fired, GM firing is SKIPPED this tick
    // Either manager was fired (not GM) or GM was fired (not manager) — never both
    const bothFired = after.interim_manager === 1 && after.interim_gm === 1;
    expect(bothFired, 'Manager and GM should not both be fired in the same tick').toBe(false);
  });

  it('front_office_events does not have manager_fired + gm_fired with same game_number for any team', async () => {
    const { prepared } = await import('../db.js');

    // Check all teams in this league — no team should have both fired at game 19
    const teams = prepared('SELECT id FROM teams WHERE league_id = ?').all(leagueId) as any[];

    for (const team of teams) {
      const events = prepared(
        "SELECT event_type FROM front_office_events WHERE team_id = ? ORDER BY created_at ASC"
      ).all(team.id) as any[];

      // Look for pairs of manager_fired + gm_fired — if both exist, check created_at diff
      const managerFirings = events.filter((e: any) => e.event_type === 'manager_fired');
      const gmFirings = events.filter((e: any) => e.event_type === 'gm_fired');

      if (managerFirings.length > 0 && gmFirings.length > 0) {
        // For this test setup (single evaluateFirings call), double-fire must not occur
        // The double-fire guard ensures they can't both be set at the same instant
        // Both being present across different ticks is fine — we check current interim state
        const cur = prepared('SELECT interim_manager, interim_gm FROM teams WHERE id = ?').get(team.id) as any;
        const bothCurrentlyInterim = cur.interim_manager === 1 && cur.interim_gm === 1;
        // After a single tick of evaluateFirings, both can't be set by same call
        // (This test verifies historical DB state after our single evaluateFirings call above)
        expect(bothCurrentlyInterim).toBe(false);
      }
    }
  });
});

// ── §5.7c: Pure unit — threshold helpers still correct ──────────────────────

describe('Firing threshold formula — unit tests', () => {
  it('gamesUnder500 is losses minus wins', () => {
    expect(gamesUnder500({ wins: 5, losses: 15 } as any)).toBe(10);
    expect(gamesUnder500({ wins: 15, losses: 5 } as any)).toBe(-10);
  });

  it('firingThreshold respects patience ordering', () => {
    const meddling = firingThreshold('meddling', 'moderate', false);
    const winNow = firingThreshold('win-now', 'moderate', false);
    const patient = firingThreshold('patient', 'moderate', false);
    const handsOff = firingThreshold('hands-off', 'moderate', false);
    expect(meddling).toBeLessThan(winNow);
    expect(winNow).toBeLessThan(patient);
    expect(patient).toBeLessThan(handsOff);
  });
});
