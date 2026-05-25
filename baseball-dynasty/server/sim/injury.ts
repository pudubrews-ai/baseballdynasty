// Injury system helper — Step 10
// Tier assignment, type assignment, duration mapping, rehab setup.
// Used by game.ts (in-game injury events) and rosterMaintenance.ts (recovery sweep).
//
// Spec: injury_type + injury_tier + rehab_games_remaining all set atomically when injury occurs.
// The double-write in game.ts + engine.ts is collapsed here: game.ts computes all fields
// and passes them via NotableEvent; engine.ts reads them and writes only once.

import { seedFor, randInt } from './prng.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tier weights (seeded roll) — spec says day_to_day common, season_ending rare
// ─────────────────────────────────────────────────────────────────────────────

export const INJURY_TIERS = ['day_to_day', 'short_il', 'standard_il', 'long_il', 'season_ending'] as const;
export type InjuryTier = typeof INJURY_TIERS[number];

const TIER_WEIGHTS = [0.40, 0.30, 0.17, 0.10, 0.03]; // sums to 1.00

function rollTier(rng: () => number): InjuryTier {
  const roll = rng();
  let cumulative = 0;
  for (let i = 0; i < TIER_WEIGHTS.length; i++) {
    cumulative += TIER_WEIGHTS[i]!;
    if (roll < cumulative) return INJURY_TIERS[i]!;
  }
  return 'day_to_day';
}

// ─────────────────────────────────────────────────────────────────────────────
// IL duration (games until return) per tier
// ─────────────────────────────────────────────────────────────────────────────

export function ilDuration(tier: InjuryTier, rng: () => number, seasonGamesRemaining: number): number {
  switch (tier) {
    case 'day_to_day': return randInt(rng, 1, 3);
    case 'short_il': return randInt(rng, 7, 15);
    case 'standard_il': return randInt(rng, 20, 45);
    case 'long_il': return randInt(rng, 60, 90);
    case 'season_ending': return Math.max(1, seasonGamesRemaining);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rehab games per tier (spec: DTD=0, short=3, standard=5, long=8, SE=0)
// ─────────────────────────────────────────────────────────────────────────────

export function rehabGamesForTier(tier: InjuryTier): number {
  const MAP: Record<InjuryTier, number> = {
    day_to_day: 0,
    short_il: 3,
    standard_il: 5,
    long_il: 8,
    season_ending: 0,
  };
  return MAP[tier];
}

// ─────────────────────────────────────────────────────────────────────────────
// Injury type by position
// ─────────────────────────────────────────────────────────────────────────────

export type InjuryType = 'arm' | 'tommy_john' | 'hamstring' | 'oblique' | 'concussion';

export function injuryTypeForPosition(position: string, tier: InjuryTier, rng: () => number): InjuryType {
  const isPitcher = position === 'SP' || position === 'RP';
  if (isPitcher) {
    // Tommy john is season-ending; for other tiers use arm
    return tier === 'season_ending' ? 'tommy_john' : 'arm';
  }
  // Hitters: pick from hamstring/oblique/concussion
  const roll = rng();
  if (roll < 0.45) return 'hamstring';
  if (roll < 0.75) return 'oblique';
  return 'concussion';
}

// ─────────────────────────────────────────────────────────────────────────────
// Medical staff modifier on IL duration
// ─────────────────────────────────────────────────────────────────────────────

export function applyMedicalStaffModifier(duration: number, medicalStaffRating: number): number {
  if (medicalStaffRating >= 8) {
    return Math.max(1, Math.round(duration * 0.85)); // -15%
  }
  if (medicalStaffRating <= 3) {
    return Math.round(duration * 1.10); // +10%
  }
  return duration; // 4-7 baseline
}

// ─────────────────────────────────────────────────────────────────────────────
// Reaggravation risk during rehab (base 15%, modified by medical staff)
// ─────────────────────────────────────────────────────────────────────────────

export function reaggravationRisk(medicalStaffRating: number): number {
  let risk = 0.15;
  if (medicalStaffRating >= 8) risk *= 0.5; // halved
  if (medicalStaffRating <= 3) risk += 0.05; // +5%
  return risk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full injury assignment: returns all fields needed for the injury write
// Seed: combine playerId + gameNumber for determinism
// ─────────────────────────────────────────────────────────────────────────────

export interface InjuryAssignment {
  tier: InjuryTier;
  type: InjuryType;
  ilGames: number;          // injury_return_game = gameNumber + ilGames
  rehabGames: number;       // rehab_games_remaining
}

export function assignInjury(
  position: string,
  medicalStaffRating: number,
  gameNumber: number,
  playerId: number,
  seasonGamesRemaining: number
): InjuryAssignment {
  const seed = playerId ^ (gameNumber * 1000003);
  const rng = seedFor('injury_assign', seed);

  const tier = rollTier(rng);
  const type = injuryTypeForPosition(position, tier, rng);
  const rawDuration = ilDuration(tier, rng, seasonGamesRemaining);
  const ilGames = applyMedicalStaffModifier(rawDuration, medicalStaffRating);
  const rehabGames = rehabGamesForTier(tier);

  return { tier, type, ilGames, rehabGames };
}
