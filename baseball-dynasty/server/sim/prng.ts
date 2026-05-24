// D7: mulberry32 PRNG with named sub-streams
// Seed source priority: (1) request body seed, (2) DEFAULT_SEED env, (3) Date.now()
// NEVER default to 1 or to league.id

/**
 * mulberry32 PRNG — returns a function that produces floats in [0, 1)
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0; // ensure unsigned 32-bit
  return function () {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a hash of a string (32-bit)
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * D7: Named sub-streams — each gets its own PRNG seeded from baseSeed ^ hash(name)
 * D30: Use seedFor('game:' + gameId) for per-game reproducibility
 */
export function seedFor(name: string, baseSeed: number): () => number {
  const derived = (baseSeed ^ fnv1a(name)) >>> 0;
  return mulberry32(derived);
}

/**
 * Resolve the PRNG seed per D7 priority:
 * 1. Provided seed (from request body)
 * 2. DEFAULT_SEED env var
 * 3. Date.now()
 */
export function resolveSeed(provided?: number): number {
  if (provided !== undefined && Number.isInteger(provided) && provided >= 0) {
    return provided;
  }
  const envSeed = process.env['DEFAULT_SEED'];
  if (envSeed && /^\d+$/.test(envSeed)) {
    const parsed = parseInt(envSeed, 10);
    if (parsed >= 0 && parsed <= 2 ** 32 - 1) {
      return parsed;
    }
  }
  // D7: Default to Date.now(), NEVER to 1
  return Date.now() & 0xffffffff;
}

// Helper: random integer in [min, max] inclusive
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// Helper: triangular distribution
// See: https://en.wikipedia.org/wiki/Triangular_distribution
export function randTriangular(rng: () => number, min: number, mode: number, max: number): number {
  const u = rng();
  const fc = (mode - min) / (max - min);
  if (u < fc) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  } else {
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }
}

// Helper: Fisher-Yates shuffle in place
export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

// Helper: weighted pick from items with corresponding weights
export function weightedPick<T>(rng: () => number, items: T[], weights: number[]): T {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = rng() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

// Helper: sample from normal distribution (Box-Muller) — used for age distribution
export function randNormal(rng: () => number, mean: number, stdDev: number): number {
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}
