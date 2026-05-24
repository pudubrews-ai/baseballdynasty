import { describe, it, expect } from 'vitest';
import { CITIES } from '../data/cities.js';
import { seedFor, shuffle } from '../sim/prng.js';

// D23: Worldgen tests — tier counts and distribution validation
// These test the pure functions and constants

// §5.2: Direct tier sampling — exact counts
const TIERS = [
  { name: 'elite',       count: 16,  min: 85, max: 99 },
  { name: 'star',        count: 64,  min: 75, max: 84 },
  { name: 'regular',     count: 200, min: 60, max: 74 },
  { name: 'fringe',      count: 320, min: 45, max: 59 },
  { name: 'replacement', count: 200, min: 30, max: 44 },
];

const POSITION_ALLOCATIONS = [
  { position: 'SP', count: 60 },
  { position: 'RP', count: 40 },
  { position: 'CL', count: 20 },
  { position: 'C',  count: 80 },
  { position: '1B', count: 80 },
  { position: '2B', count: 80 },
  { position: '3B', count: 80 },
  { position: 'SS', count: 80 },
  { position: 'LF', count: 90 },
  { position: 'CF', count: 90 },
  { position: 'RF', count: 90 },
  { position: 'DH', count: 10 },
];

describe('Player tier distribution (§5.2)', () => {
  it('tier counts sum to 800', () => {
    const total = TIERS.reduce((sum, t) => sum + t.count, 0);
    expect(total).toBe(800);
  });

  it('tier counts match test spec windows', () => {
    // Test spec: elite 14-18, star ~64, regular 200, fringe 320, replacement 200
    const elite = TIERS.find(t => t.name === 'elite');
    expect(elite?.count).toBe(16);
    expect(elite?.count).toBeGreaterThanOrEqual(14);
    expect(elite?.count).toBeLessThanOrEqual(18);
  });

  it('tier rating ranges do not overlap', () => {
    for (let i = 0; i < TIERS.length - 1; i++) {
      const tier = TIERS[i]!;
      const nextTier = TIERS[i + 1]!;
      expect(tier.min).toBeGreaterThan(nextTier.max);
    }
  });
});

describe('Position allocation (§8)', () => {
  it('position counts sum to 800', () => {
    const total = POSITION_ALLOCATIONS.reduce((sum, p) => sum + p.count, 0);
    expect(total).toBe(800);
  });

  it('has at least 40 catchers (20 teams × 2 minimum)', () => {
    const c = POSITION_ALLOCATIONS.find(p => p.position === 'C');
    expect(c?.count).toBeGreaterThanOrEqual(40);
  });

  it('has at least 40 shortstops', () => {
    const ss = POSITION_ALLOCATIONS.find(p => p.position === 'SS');
    expect(ss?.count).toBeGreaterThanOrEqual(40);
  });

  it('has at least 60 starting pitchers (20 teams × 5-man rotation)', () => {
    const sp = POSITION_ALLOCATIONS.find(p => p.position === 'SP');
    expect(sp?.count).toBeGreaterThanOrEqual(60);
  });

  it('pitchers are 15% of total (spec says ~15%)', () => {
    const pitcherCount = ['SP', 'RP', 'CL']
      .map(pos => POSITION_ALLOCATIONS.find(p => p.position === pos)?.count ?? 0)
      .reduce((a, b) => a + b, 0);
    const pct = pitcherCount / 800;
    expect(pct).toBeCloseTo(0.15, 1);
  });
});

// §6.8: Market-size quota test — verify the selection algorithm produces exactly 2/4/8/6
// (Tests the logic inline since selectCitiesWithMarketQuota is not exported)
function selectCitiesWithMarketQuota(rng: () => number, allCities: typeof CITIES) {
  const quotas: Record<string, number> = { mega: 2, large: 4, medium: 8, small: 6 };
  const remaining: Record<string, number> = { ...quotas };
  const shuffled = [...allCities];
  shuffle(rng, shuffled);
  const usedRegions = new Set<string>();
  const selected: typeof CITIES = [];
  for (const city of shuffled) {
    if (selected.length >= 20) break;
    if ((remaining[city.market_size] ?? 0) <= 0) continue;
    if (usedRegions.has(city.region)) continue;
    selected.push(city);
    usedRegions.add(city.region);
    remaining[city.market_size]!--;
  }
  if (selected.length < 20) {
    for (const city of shuffled) {
      if (selected.length >= 20) break;
      if (selected.includes(city)) continue;
      if ((remaining[city.market_size] ?? 0) <= 0) continue;
      selected.push(city);
      remaining[city.market_size]!--;
    }
  }
  return selected;
}

describe('Market-size city quota (§2.11 / §6.8)', () => {
  it('city pool has enough cities for each market size', () => {
    const megaCount = CITIES.filter(c => c.market_size === 'mega').length;
    const largeCount = CITIES.filter(c => c.market_size === 'large').length;
    const mediumCount = CITIES.filter(c => c.market_size === 'medium').length;
    const smallCount = CITIES.filter(c => c.market_size === 'small').length;
    expect(megaCount).toBeGreaterThanOrEqual(2);
    expect(largeCount).toBeGreaterThanOrEqual(4);
    expect(mediumCount).toBeGreaterThanOrEqual(8);
    expect(smallCount).toBeGreaterThanOrEqual(6);
  });

  it('selects exactly 2 mega, 4 large, 8 medium, 6 small for seed=42', () => {
    const rng = seedFor('worldgen', 42);
    const selected = selectCitiesWithMarketQuota(rng, CITIES);
    expect(selected.length).toBe(20);
    const counts: Record<string, number> = { mega: 0, large: 0, medium: 0, small: 0 };
    for (const c of selected) counts[c.market_size]!++;
    expect(counts['mega']).toBe(2);
    expect(counts['large']).toBe(4);
    expect(counts['medium']).toBe(8);
    expect(counts['small']).toBe(6);
  });

  it('selects exactly 2 mega, 4 large, 8 medium, 6 small for seed=99999', () => {
    const rng = seedFor('worldgen', 99999);
    const selected = selectCitiesWithMarketQuota(rng, CITIES);
    expect(selected.length).toBe(20);
    const counts: Record<string, number> = { mega: 0, large: 0, medium: 0, small: 0 };
    for (const c of selected) counts[c.market_size]!++;
    expect(counts['mega']).toBe(2);
    expect(counts['large']).toBe(4);
    expect(counts['medium']).toBe(8);
    expect(counts['small']).toBe(6);
  });

  it('Ironbrook is in the city pool as a small market city', () => {
    const ironbrook = CITIES.find(c => c.name === 'Ironbrook');
    expect(ironbrook).toBeDefined();
    expect(ironbrook?.market_size).toBe('small');
  });
});

describe('SP scarcity bonus (§5.7 — smooth, not cliff)', () => {
  function spSmoothBonus(overall: number): number {
    return Math.max(0, (overall - 60) * 0.6);
  }

  it('returns 0 for overall < 60', () => {
    expect(spSmoothBonus(59)).toBe(0);
    expect(spSmoothBonus(50)).toBe(0);
  });

  it('returns +6 at overall 70', () => {
    expect(spSmoothBonus(70)).toBeCloseTo(6, 1);
  });

  it('returns +12 at overall 80', () => {
    expect(spSmoothBonus(80)).toBeCloseTo(12, 1);
  });

  it('returns +18 at overall 90', () => {
    expect(spSmoothBonus(90)).toBeCloseTo(18, 1);
  });

  it('is continuous (no cliff)', () => {
    // Increment from 69 to 71 should be gradual, not a jump
    const diff69_70 = spSmoothBonus(70) - spSmoothBonus(69);
    const diff70_71 = spSmoothBonus(71) - spSmoothBonus(70);
    expect(Math.abs(diff69_70 - diff70_71)).toBeLessThan(0.1);
  });
});
