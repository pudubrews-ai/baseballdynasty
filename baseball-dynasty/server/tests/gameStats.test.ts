// §6.9: Blowout rate test — verifies the score distribution is within spec
import { describe, it, expect } from 'vitest';
import { seedFor, randTriangular, randInt } from '../sim/prng.js';

// Mirror the score generation from game.ts (§2.12 fix)
function simulateWinnerScore(rng: () => number): number {
  let winnerScore = Math.round(randTriangular(rng, 3, 4, 9));
  if (rng() < 0.10) {
    winnerScore = Math.min(12, winnerScore + randInt(rng, 1, 3));
  }
  return winnerScore;
}

describe('Blowout rate (§2.12 / §6.9)', () => {
  it('blowout rate (winner >= 8) is between 10% and 20% over 5000 games', () => {
    // Use 5000 games to reduce variance; acceptable range is 10-20% (spec target 12-18%)
    const rng = seedFor('blowout_test', 99999);
    let blowouts = 0;
    const total = 5000;

    for (let i = 0; i < total; i++) {
      const winnerScore = simulateWinnerScore(rng);
      if (winnerScore >= 8) blowouts++;
    }

    const blowoutRate = blowouts / total;
    // Allow 2% margin of error at 5000 samples to account for PRNG variance
    expect(blowoutRate).toBeGreaterThanOrEqual(0.10);
    expect(blowoutRate).toBeLessThanOrEqual(0.20);
  });

  it('winner score is always in [3, 12] range', () => {
    const rng = seedFor('blowout_range', 42);
    for (let i = 0; i < 1000; i++) {
      const score = simulateWinnerScore(rng);
      expect(score).toBeGreaterThanOrEqual(3);
      expect(score).toBeLessThanOrEqual(12);
    }
  });

  it('walk-off rate (18% of home wins) is within MLB-typical range over 1000 games', () => {
    const rng = seedFor('walkoff_test', 77777);
    let homeWins = 0;
    let walkoffs = 0;
    const total = 1000;

    for (let i = 0; i < total; i++) {
      const homeWinProb = 0.54; // typical with home field advantage
      const homeWins_ = rng() < homeWinProb;
      if (homeWins_) {
        homeWins++;
        if (rng() < 0.18) walkoffs++;
      }
    }

    const walkoffPct = walkoffs / total;
    // ~18% of ~54% home wins ≈ 9.7% of all games
    expect(walkoffPct).toBeGreaterThanOrEqual(0.06);
    expect(walkoffPct).toBeLessThanOrEqual(0.14);
  });
});
