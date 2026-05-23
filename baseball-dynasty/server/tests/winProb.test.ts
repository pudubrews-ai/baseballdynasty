import { describe, it, expect } from 'vitest';

// D23: Win probability clamp test
// Test the formula without needing actual DB

function winProbabilityFormula(
  homeStarterRating: number,
  awayStarterRating: number,
  homeLineupAvg: number,
  awayLineupAvg: number,
  homeBullpenAvg: number,
  awayBullpenAvg: number,
  homeField: boolean
): number {
  let prob = 0.5
    + (homeStarterRating - awayStarterRating) * 0.003
    + (homeLineupAvg - awayLineupAvg) * 0.004
    + (homeBullpenAvg - awayBullpenAvg) * 0.002
    + (homeField ? 0.04 : 0);

  return Math.max(0.15, Math.min(0.85, prob));
}

describe('Win probability formula', () => {
  it('stays within [0.15, 0.85] with extreme inputs', () => {
    // Massive home advantage
    const prob1 = winProbabilityFormula(99, 30, 99, 30, 99, 30, true);
    expect(prob1).toBeLessThanOrEqual(0.85);
    expect(prob1).toBeGreaterThanOrEqual(0.15);

    // Massive away advantage
    const prob2 = winProbabilityFormula(30, 99, 30, 99, 30, 99, false);
    expect(prob2).toBeLessThanOrEqual(0.85);
    expect(prob2).toBeGreaterThanOrEqual(0.15);
  });

  it('returns 0.54 for equal teams at home', () => {
    const prob = winProbabilityFormula(70, 70, 60, 60, 60, 60, true);
    expect(prob).toBeCloseTo(0.54, 2);
  });

  it('returns 0.5 for equal teams away', () => {
    const prob = winProbabilityFormula(70, 70, 60, 60, 60, 60, false);
    expect(prob).toBeCloseTo(0.5, 2);
  });

  it('clamps minimum to 0.15', () => {
    const prob = winProbabilityFormula(1, 99, 1, 99, 1, 99, false);
    expect(prob).toBe(0.15);
  });

  it('clamps maximum to 0.85', () => {
    const prob = winProbabilityFormula(99, 1, 99, 1, 99, 1, true);
    expect(prob).toBe(0.85);
  });
});
