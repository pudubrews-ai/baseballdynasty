// ARCHETYPES data table — Phase 8 (v0.2.0)
// Per §6 and [AB-12 RULING]: all archetype-driven logic reads from this constant.
// NO ad-hoc `if (archetype === 'analytics')` branches in business logic.

export const ARCHETYPES = {
  'analytics': {
    waiver_target_overall: { min: 50, max: 65 },
    waiver_target_min_age: null,
    veteran_trade_offset_games_before_deadline: 6,
    nontender_arb_year: 3,
    nontender_salary_threshold: 8_000_000,
    draft_potential_weight: 1.5,
    draft_age_weight: 1.2,
    fa_discount_multiplier: 0.85,
    waiver_claim_probability_modifier: 1.3,
    service_time_manipulation_enabled: true,
    veteran_loyalty: 0.3,
  },
  'old-school': {
    waiver_target_overall: { min: 60, max: 99 },
    waiver_target_min_age: 28,
    veteran_trade_offset_games_before_deadline: 0,
    nontender_arb_year: null,
    nontender_salary_threshold: null,
    draft_potential_weight: 0.8,
    draft_age_weight: 0.8,
    fa_discount_multiplier: 1.1,
    waiver_claim_probability_modifier: 0.8,
    service_time_manipulation_enabled: false,
    veteran_loyalty: 1.5,
  },
  'balanced': {
    waiver_target_overall: { min: 50, max: 85 },
    waiver_target_min_age: null,
    veteran_trade_offset_games_before_deadline: 0,
    nontender_arb_year: 3,
    nontender_salary_threshold: 10_000_000,
    draft_potential_weight: 1.0,
    draft_age_weight: 1.0,
    fa_discount_multiplier: 1.0,
    waiver_claim_probability_modifier: 1.0,
    service_time_manipulation_enabled: false,
    veteran_loyalty: 1.0,
  },
} as const;

export type GmArchetype = keyof typeof ARCHETYPES;

export function getArchetype(archetype: string): typeof ARCHETYPES[GmArchetype] {
  return ARCHETYPES[archetype as GmArchetype] ?? ARCHETYPES['balanced'];
}
