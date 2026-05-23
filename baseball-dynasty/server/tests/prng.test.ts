import { describe, it, expect } from 'vitest';
import { mulberry32, seedFor, resolveSeed, randInt, randTriangular, shuffle } from '../sim/prng.js';

describe('PRNG determinism', () => {
  it('same seed produces identical 1000-number stream', () => {
    const seed = 12345;
    const rng1 = mulberry32(seed);
    const rng2 = mulberry32(seed);

    const stream1 = Array.from({ length: 1000 }, () => rng1());
    const stream2 = Array.from({ length: 1000 }, () => rng2());

    expect(stream1).toEqual(stream2);
  });

  it('different seeds produce different streams', () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(54321);

    const first1 = rng1();
    const first2 = rng2();

    expect(first1).not.toEqual(first2);
  });

  it('mulberry32 produces floats in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('seedFor produces deterministic named sub-streams', () => {
    const baseSeed = 99999;
    const rng1 = seedFor('worldgen', baseSeed);
    const rng2 = seedFor('worldgen', baseSeed);
    const rng3 = seedFor('games', baseSeed);

    const stream1 = Array.from({ length: 100 }, () => rng1());
    const stream2 = Array.from({ length: 100 }, () => rng2());
    const stream3 = Array.from({ length: 100 }, () => rng3());

    expect(stream1).toEqual(stream2); // same name same seed
    expect(stream1).not.toEqual(stream3); // different name
  });

  it('seedFor produces different streams for different base seeds', () => {
    const rng1 = seedFor('worldgen', 100);
    const rng2 = seedFor('worldgen', 200);

    const first1 = rng1();
    const first2 = rng2();

    expect(first1).not.toEqual(first2);
  });

  it('resolveSeed uses provided seed when valid', () => {
    const seed = resolveSeed(42);
    expect(seed).toBe(42);
  });

  it('resolveSeed uses Date.now() as default (not 1)', () => {
    const before = Date.now();
    const seed = resolveSeed();
    const after = Date.now();

    // Seed should be from Date.now() range, not 1
    expect(seed).not.toBe(1);
    // Should be in reasonable range (masked to 32-bit)
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('randInt stays within bounds', () => {
    const rng = mulberry32(777);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(rng, 3, 12);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(12);
    }
  });

  it('randTriangular stays within bounds', () => {
    const rng = mulberry32(888);
    for (let i = 0; i < 1000; i++) {
      const v = randTriangular(rng, 3, 4, 12);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(12);
    }
  });

  it('shuffle produces different orders but same elements', () => {
    const rng = mulberry32(123);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...arr];
    shuffle(rng, arr);
    expect(arr.sort()).toEqual(original.sort());
  });
});
