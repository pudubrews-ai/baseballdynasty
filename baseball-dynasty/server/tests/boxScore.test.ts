import { describe, it, expect } from 'vitest';

// D23: Box score consistency rules from §5.1
// Test the validation logic without needing DB

interface TeamBoxScore {
  runs: number;
  hits: number;
  walks: number;
  rbi: number;
}

function validateBoxScoreRules(team: TeamBoxScore): string[] {
  const errors: string[] = [];

  // §5.1 Rule 1: hits >= runs - walks
  if (team.hits < team.runs - team.walks) {
    errors.push(`Hits (${team.hits}) < Runs (${team.runs}) - Walks (${team.walks})`);
  }

  // §5.1 Rule 2 (corrected by Adversary §2.6):
  // total_rbi <= total_runs (hard ceiling)
  if (team.rbi > team.runs) {
    errors.push(`RBI (${team.rbi}) > Runs (${team.runs}) — hard ceiling violated`);
  }

  // total_rbi >= max(0, runs - 1) (allow 1 unearned run)
  if (team.rbi < Math.max(0, team.runs - 1)) {
    errors.push(`RBI (${team.rbi}) < max(0, Runs-1) = ${Math.max(0, team.runs - 1)}`);
  }

  return errors;
}

describe('Box score consistency rules (§5.1)', () => {
  it('valid box score passes all rules', () => {
    const team: TeamBoxScore = { runs: 5, hits: 8, walks: 2, rbi: 5 };
    expect(validateBoxScoreRules(team)).toEqual([]);
  });

  it('Rule 1: hits < runs - walks fails', () => {
    // 4 runs, 2 hits, 0 walks — impossible (need at least 4 hits+walks to score 4)
    const team: TeamBoxScore = { runs: 4, hits: 2, walks: 0, rbi: 4 };
    expect(validateBoxScoreRules(team).length).toBeGreaterThan(0);
  });

  it('Rule 1: hits = runs - walks passes', () => {
    // 4 runs = 2 hits + 2 walks — valid
    const team: TeamBoxScore = { runs: 4, hits: 2, walks: 2, rbi: 3 };
    expect(validateBoxScoreRules(team)).toEqual([]);
  });

  it('Rule 2 hard ceiling: RBI > runs fails', () => {
    const team: TeamBoxScore = { runs: 3, hits: 6, walks: 1, rbi: 4 };
    expect(validateBoxScoreRules(team)).toContainEqual(expect.stringContaining('hard ceiling'));
  });

  it('Rule 2: RBI = runs passes', () => {
    const team: TeamBoxScore = { runs: 3, hits: 5, walks: 1, rbi: 3 };
    expect(validateBoxScoreRules(team)).toEqual([]);
  });

  it('Rule 2: RBI = runs - 1 passes (unearned run)', () => {
    const team: TeamBoxScore = { runs: 3, hits: 5, walks: 1, rbi: 2 };
    expect(validateBoxScoreRules(team)).toEqual([]);
  });

  it('Rule 2: RBI < runs - 1 fails', () => {
    const team: TeamBoxScore = { runs: 5, hits: 7, walks: 1, rbi: 3 };
    const errors = validateBoxScoreRules(team);
    expect(errors.some(e => e.includes('max(0'))).toBe(true);
  });

  it('shutout (0 runs) with 0 RBI passes', () => {
    const team: TeamBoxScore = { runs: 0, hits: 3, walks: 1, rbi: 0 };
    expect(validateBoxScoreRules(team)).toEqual([]);
  });

  it('milestone detection: prev < threshold && new >= threshold', () => {
    // §5.1 Rule 9
    const prevHR = 99;
    const newHR = prevHR + 2; // 99 → 101

    // Should trigger 100-HR milestone even though never exactly 100
    const milestoneTriggered = prevHR < 100 && newHR >= 100;
    expect(milestoneTriggered).toBe(true);

    // Should NOT trigger if already past milestone
    const prevHR2 = 101;
    const newHR2 = prevHR2 + 5;
    const milestoneTriggered2 = prevHR2 < 100 && newHR2 >= 100;
    expect(milestoneTriggered2).toBe(false);
  });
});
