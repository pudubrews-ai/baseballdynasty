import { z } from 'zod';

export const NewLeagueBody = z.object({
  seed: z.number().int().min(0).max(2 ** 32 - 1).optional(),
  leagueName: z.string().min(1).max(80).regex(/^[\w\s\-'.]+$/).optional(),
  useRealCities: z.boolean().optional(),
});

export const SimSpeedBody = z.object({
  speed: z.enum(['paused', 'normal', 'fast', 'turbo']),
});

export const SimAdvanceBody = z.object({}).strict();

// LLM response schemas
export const DraftPickResponse = z.object({
  pickIndex: z.number().int().min(0).max(9),
  // Allow longer strings — sanitizeNarrative() will truncate to 280 at write time
  reasoning: z.string().max(10000),
});

export const SeasonNarrativeResponse = z.object({
  narrative: z.string().max(2000),
});

export const TradeProposalResponse = z.object({
  accepted: z.boolean(),
  reasoning: z.string().max(500),
});

export const FreeAgentBidResponse = z.object({
  bid: z.number().min(0),
  reasoning: z.string().max(500),
});

export type NewLeagueBodyType = z.infer<typeof NewLeagueBody>;
export type SimSpeedBodyType = z.infer<typeof SimSpeedBody>;
export type DraftPickResponseType = z.infer<typeof DraftPickResponse>;
