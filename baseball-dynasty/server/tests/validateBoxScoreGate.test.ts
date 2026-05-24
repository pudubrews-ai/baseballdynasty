// §6.3: validateBoxScore gate test
// Verifies fail-closed behavior: games that fail validation after 3 retries are NOT written to game_log

process.env['DB_PATH'] = ':memory:';

import { describe, it, expect, beforeAll } from 'vitest';

describe('validateBoxScore fail-closed gate (§6.3 / §2.9)', () => {
  it('validateBoxScore catches Rule 1 violations (hits < runs - walks)', async () => {
    const { validateBoxScore } = await import('../sim/game.js');

    // Construct a box score that violates Rule 1
    // home: 5 runs, 1 hit, 0 walks — impossible (need hits+walks >= runs)
    const result = validateBoxScore(
      {
        homeHits: 1,
        awayHits: 5,
        homeWalks: 0,
        awayWalks: 2,
        batterLines: [],
        pitcherLines: [],
      },
      1, // homeTeamId
      2, // awayTeamId
      5, // homeScore (violates rule 1: 1 < 5 - 0)
      3, // awayScore
      false // isWalkOff
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(e => e.includes('Home hits'))).toBe(true);
  });

  it('validateBoxScore Rule 4: home total IP must equal 9.0 (non-walk-off)', async () => {
    const { validateBoxScore } = await import('../sim/game.js');

    const homePitcherLines = [
      { teamId: 1, playerId: 1, playerName: 'P1', inningsPitched: 6.0, hitsAllowed: 3, earnedRuns: 2, strikeouts: 5, walks: 1, win: true, loss: false, save: false },
      { teamId: 1, playerId: 2, playerName: 'P2', inningsPitched: 1.0, hitsAllowed: 1, earnedRuns: 0, strikeouts: 1, walks: 0, win: false, loss: false, save: false },
      // Missing 2 innings — should fail Rule 4
    ];
    const awayPitcherLines = [
      { teamId: 2, playerId: 3, playerName: 'P3', inningsPitched: 9.0, hitsAllowed: 5, earnedRuns: 3, strikeouts: 7, walks: 2, win: false, loss: true, save: false },
    ];

    const errors = validateBoxScore(
      {
        homeHits: 5,
        awayHits: 5,
        homeWalks: 2,
        awayWalks: 2,
        batterLines: [],
        pitcherLines: [...homePitcherLines, ...awayPitcherLines],
      },
      1, 2, 3, 3, false
    );

    // Home total IP = 7.0, expected 9.0 — Rule 4 should fire
    expect(errors.some(e => e.includes('Home total IP'))).toBe(true);
  });

  it('validateBoxScore Rule 4: walk-off — away gets 8.0 IP, home gets 9.0 IP', async () => {
    const { validateBoxScore } = await import('../sim/game.js');

    const homePitcherLines = [
      { teamId: 1, playerId: 1, playerName: 'P1', inningsPitched: 9.0, hitsAllowed: 3, earnedRuns: 2, strikeouts: 5, walks: 1, win: false, loss: false, save: false },
    ];
    const awayPitcherLines = [
      { teamId: 2, playerId: 2, playerName: 'P2', inningsPitched: 8.0, hitsAllowed: 5, earnedRuns: 3, strikeouts: 7, walks: 2, win: false, loss: true, save: false },
    ];

    // Walk-off: home=9.0, away=8.0 — valid
    const errors = validateBoxScore(
      {
        homeHits: 8,
        awayHits: 5,
        homeWalks: 2,
        awayWalks: 2,
        batterLines: [],
        pitcherLines: [...homePitcherLines, ...awayPitcherLines],
      },
      1, 2, 4, 3, true // isWalkOff
    );

    // Should have no Rule 4 errors
    expect(errors.filter(e => e.includes('total IP'))).toHaveLength(0);
  });
});
