// Shared types between server and client

export type SimSpeed = 'paused' | 'normal' | 'fast' | 'turbo';

export type LeaguePhase =
  | 'setup'
  | 'expansion_draft'
  | 'annual_draft'
  | 'draft'         // API-facing alias for expansion_draft | annual_draft (§2.14)
  | 'regular_season'
  | 'playoffs'
  | 'offseason'
  | 'no_league';    // API-facing state when no league exists (§3.5)

export type OffseasonStep =
  | 'retirement'
  | 'development'
  | 'free_agency'
  | 'front_office'
  | 'annual_draft'
  | 'done';

export interface LlmStatus {
  dailyBudgetRemaining: number;
  circuitBreakerOpen: boolean;
  retryAfterMs: number;
}

export interface LeagueStateSnapshot {
  leagueId: number;
  phase: LeaguePhase;
  seasonNumber: number;
  currentGameDate: number; // epoch ms
  currentGameNumber: number;
  simSpeed: SimSpeed;
  lastPickId: number;
  lastGameId: number;
  llmStatus: LlmStatus;
  worldgenSeed: number;
}

// API response types
export interface TeamSummary {
  id: number;
  name: string;
  city: string;
  region: string;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  marketSize: string;
  color?: string;
}

export interface TeamDetail extends TeamSummary {
  gmPhilosophy: string;
  gmRiskTolerance: string;
  gmFocus: string;
  managerName: string;
  gmName: string;
  ownerName: string;
  payrollBudget: number;
  currentPayroll: number;
  revenue: number;
}

export interface PlayerCard {
  id: number;
  firstName: string;
  lastName: string;
  age: number;
  position: string;
  overallRating: number;
  potential: string;
  teamId: number | null;
  teamName: string | null;
  isOnMlbRoster: boolean;
  contact: number;
  power: number;
  speed: number;
  fielding: number;
  arm: number;
  pitchingVelocity: number;
  pitchingControl: number;
  pitchingStamina: number;
  annualSalary: number;
  contractYearsRemaining: number;
  seasonStats?: SeasonStats;
  careerStats?: CareerStats;
}

export interface SeasonStats {
  seasonNumber: number;
  gamesPlayed: number;
  atBats: number;
  hits: number;
  homeRuns: number;
  rbi: number;
  battingAvg: number;
  inningsPitched: number;
  earnedRuns: number;
  strikeouts: number;
  walks: number;
  era: number;
  whip: number;
}

export interface CareerStats {
  gamesPlayed: number;
  atBats: number;
  hits: number;
  homeRuns: number;
  rbi: number;
  battingAvg: number;
  inningsPitched: number;
  wins: number;
  losses: number;
  strikeouts: number;
  era: number;
}

export interface BoxScore {
  gameId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  gameDate: number;
  gameNumber: number;
  homeHits: number;
  awayHits: number;
  homeErrors: number;
  awayErrors: number;
  notableEvents: NotableEvent[];
  pitcherLines: PitcherLine[];
  batterLines: BatterLine[];
}

export interface NotableEvent {
  type: string;
  playerId?: number;
  playerName?: string;
  description: string;
}

export interface PitcherLine {
  playerId: number;
  playerName: string;
  teamId: number;
  inningsPitched: number;
  hitsAllowed: number;
  earnedRuns: number;
  strikeouts: number;
  walks: number;
  win: boolean;
  loss: boolean;
  save: boolean;
}

export interface BatterLine {
  playerId: number;
  playerName: string;
  teamId: number;
  position: string;
  atBats: number;
  hits: number;
  homeRuns: number;
  rbi: number;
  walks: number;
  strikeouts: number;
}

export interface Standings {
  conferences: ConferenceStandings[];
}

export interface ConferenceStandings {
  name: string;
  divisions: DivisionStandings[];
}

export interface DivisionStandings {
  name: string;
  teams: TeamStandingsRow[];
}

export interface TeamStandingsRow {
  teamId: number;
  teamName: string;
  wins: number;
  losses: number;
  pct: number;
  gb: number;
  runsScored: number;
  runsAllowed: number;
  runDifferential: number;
  streak: string;
  last10: string;
}

export interface DraftPick {
  id: number;
  round: number;
  pickNumber: number;
  teamId: number;
  teamName: string;
  playerId: number | null;
  playerName: string | null;
  playerPosition: string | null;
  playerAge: number | null;
  playerRating: number | null;
  reasoning: string | null;
}

export interface DraftState {
  currentRound: number;
  currentPick: number;
  onClockTeamId: number;
  picks: DraftPick[];
}

export interface Transaction {
  id: number;
  leagueId: number;
  seasonNumber: number;
  transactionType: string;
  teamId: number | null;
  teamName: string | null;
  playerId: number | null;
  playerName: string | null;
  narrative: string | null;
  createdAt: number;
}

export interface TimelineSeason {
  seasonNumber: number;
  championTeamId: number;
  championTeamName: string;
  mvpPlayerId: number | null;
  mvpPlayerName: string | null;
  narrative: string | null;
  year: number;
}

export interface StatLeader {
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  value: number;
  statName: string;
}
