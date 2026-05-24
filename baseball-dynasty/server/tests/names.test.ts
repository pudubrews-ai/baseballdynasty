import { describe, it, expect } from 'vitest';
import { NAME_POOLS, ORIGIN_DISTRIBUTION } from '../data/names.js';

// CISO F21: Every name matches /^[\p{L}'.\- ]{1,40}$/u
const NAME_REGEX = /^[\p{L}'.\- ]{1,40}$/u;

describe('Name pool validation (CISO F21)', () => {
  for (const [origin, pool] of Object.entries(NAME_POOLS)) {
    describe(`Origin: ${origin}`, () => {
      it('has at least 20 first names', () => {
        expect(pool.first.length).toBeGreaterThanOrEqual(20);
      });

      it('has at least 20 last names', () => {
        expect(pool.last.length).toBeGreaterThanOrEqual(20);
      });

      it('all first names match character regex', () => {
        for (const name of pool.first) {
          expect(name, `First name "${name}" doesn't match regex`).toMatch(NAME_REGEX);
        }
      });

      it('all last names match character regex', () => {
        for (const name of pool.last) {
          expect(name, `Last name "${name}" doesn't match regex`).toMatch(NAME_REGEX);
        }
      });
    });
  }

  it('origin distribution sums to ~100%', () => {
    const total = ORIGIN_DISTRIBUTION.reduce((sum, d) => sum + d.pct, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });
});
